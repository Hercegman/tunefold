"""Apple Music metadata from the public web pages (no login, no developer key).

music.apple.com server-renders the whole page model into a
<script id="serialized-server-data"> tag: the header (title, artists, artwork,
track count) and a `trackLockup` section with one entry per song, carrying the
duration in milliseconds and - on playlists - every credited artist as a
separate link. That covers albums, singles and playlists up to the ~100 tracks
the page renders.

Longer playlists are finished off through amp-api.music.apple.com, the endpoint
the web player itself uses. Its bearer token is the anonymous "WebPlayKid" JWT
embedded in the player's JS bundle, so it still needs no account.
"""
from __future__ import annotations

import json
import logging
import re

from . import net
from .models import Playlist, SourceError, Track, split_credit

log = logging.getLogger(__name__)

PAGE_URL = "https://music.apple.com/{cc}/{kind}/x/{id}"
AMP = "https://amp-api.music.apple.com/v1/catalog/{cc}/{kind}/{id}/tracks"
BUNDLE_HOST = "https://music.apple.com"
SERIALIZED_RE = re.compile(r'<script type="application/json" id="serialized-server-data">(.*?)</script>', re.S)
BUNDLE_RE = re.compile(r'src="(/assets/index~[A-Za-z0-9]+\.js)"')
TOKEN_RE = re.compile(rb"eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IldlYlBsYXlLaWQifQ"
                      rb"\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
URL_RE = re.compile(
    r"https?://(?:(?:beta\.)?music|itunes)\.apple\.com/(?:([a-z]{2})/)?(album|playlist|song)/"
    r"(?:[^/?#]+/)?((?:pl\.)?[A-Za-z0-9._-]+)", re.I)
SONG_PARAM_RE = re.compile(r"[?&]i=(\d+)")
COUNT_RE = re.compile(r"(\d[\d,]*)\s+songs?", re.I)
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}
DATE_RE = re.compile(r"([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})")
PAGE_SIZE = 100
MAX_TRACKS = 5000


def _artwork(art: dict | None, size: int = 1000) -> str | None:
    """{'dictionary': {'url': '…/{w}x{h}bb.{f}'}} -> a real jpg url."""
    d = (art or {}).get("dictionary") if isinstance(art, dict) else None
    url = (d or art or {}).get("url") if isinstance(d or art, dict) else None
    if not url:
        return None
    return (url.replace("{w}", str(size)).replace("{h}", str(size))
               .replace("{f}", "jpg").replace("{c}", "bb"))


def _iso_date(text: str | None) -> str | None:
    """'March 12, 2001' -> '2001-03-12'; '…· 2001' -> '2001'."""
    if not text:
        return None
    m = DATE_RE.search(text)
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    y = re.search(r"\b(19|20)\d{2}\b", text)
    return y.group(0) if y else None


def _links(item: dict, key: str) -> list[str]:
    return [l["title"].strip() for l in (item.get(key) or [])
            if isinstance(l, dict) and (l.get("title") or "").strip()]


class AppleMusicClient:
    NAME = "apple"
    LABEL = "Apple Music"

    def __init__(self, session=None):
        self.s = session or net.new_session()
        self._token: str | None = None
        self._bundle: str | None = None

    @staticmethod
    def matches(url: str) -> bool:
        return bool(URL_RE.search(url.strip()))

    # -- low level -----------------------------------------------------------
    def parse_url(self, url: str) -> tuple[str, str, str, str | None]:
        """-> (kind, id, storefront, song_id). kind is album|playlist|track."""
        u = url.strip()
        m = URL_RE.search(u)
        if not m:
            raise SourceError("This does not look like an Apple Music album, playlist or song link.")
        cc = (m.group(1) or "us").lower()
        page, pid = m.group(2).lower(), m.group(3)
        song = SONG_PARAM_RE.search(u)
        if page == "song":
            return "track", pid, cc, pid
        if song:
            return "track", pid, cc, song.group(1)
        return ("album" if page == "album" else "playlist"), pid, cc, None

    def _page(self, cc: str, kind: str, pid: str) -> dict:
        """The page model behind music.apple.com/{cc}/{kind}/x/{id}."""
        r = net.get(self.s, PAGE_URL.format(cc=cc, kind=kind, id=pid), label=self.LABEL)
        net.check(r, label=self.LABEL)
        page_html = net.html(r)
        m = SERIALIZED_RE.search(page_html)
        if not m:
            raise SourceError("Apple Music changed the page structure (no serialized-server-data).")
        try:
            data = json.loads(m.group(1))
            page = data["data"][0]["data"]
        except (ValueError, KeyError, IndexError) as exc:
            raise SourceError("Could not read the Apple Music page model.") from exc
        m = BUNDLE_RE.search(page_html)
        if m:
            self._bundle = m.group(1)
        return page

    @staticmethod
    def _section(page: dict, *kinds: str) -> dict | None:
        for s in page.get("sections") or []:
            if s.get("itemKind") in kinds:
                return s
        return None

    @staticmethod
    def _footer(page: dict) -> str:
        sec = AppleMusicClient._section(page, "containerDetailTracklistFooterLockup")
        items = (sec or {}).get("items") or []
        return (items[0].get("description") or "") if items else ""

    # -- amp-api (only for playlists longer than the page renders) -----------
    def _web_token(self) -> str | None:
        """The anonymous player token, read out of the JS bundle on demand: it
        is only needed for playlists longer than one rendered page, and the
        bundle is several megabytes, so it is never fetched speculatively."""
        if self._token:
            return self._token
        if not self._bundle:
            return None
        try:
            r = self.s.get(BUNDLE_HOST + self._bundle, timeout=30, stream=True)
            if r.status_code != 200:
                return None
            buf = b""
            for chunk in r.iter_content(64 * 1024):
                buf += chunk
                hit = TOKEN_RE.search(buf)
                if hit:
                    r.close()
                    self._token = hit.group(0).decode()
                    return self._token
                buf = buf[-512:]
        except Exception as exc:  # noqa: BLE001
            log.info("Apple Music token lookup failed: %s", exc)
        return None

    def _amp_tracks(self, cc: str, kind: str, pid: str, offset: int, total: int) -> list[Track]:
        token = self._web_token()
        if not token:
            log.info("no Apple Music web token, keeping the %d tracks the page rendered", offset)
            return []
        headers = {"authorization": f"Bearer {token}", "origin": "https://music.apple.com",
                   "accept": "application/json"}
        out: list[Track] = []
        url = AMP.format(cc=cc, kind="playlists" if kind == "playlist" else "albums", id=pid)
        while offset + len(out) < min(total, MAX_TRACKS):
            r = net.get(self.s, url, label=self.LABEL, headers=headers,
                        params={"limit": PAGE_SIZE, "offset": offset + len(out)})
            if r.status_code != 200:
                log.info("amp-api HTTP %s, keeping %d tracks", r.status_code, offset + len(out))
                break
            data = r.json()
            batch = data.get("data") or []
            if not batch:
                break
            for i, song in enumerate(batch, start=offset + len(out) + 1):
                a = song.get("attributes") or {}
                out.append(Track(
                    id=str(song.get("id") or ""),
                    title=a.get("name") or "Unknown Track",
                    artists=split_credit(a.get("artistName") or ""),
                    duration_ms=a.get("durationInMillis"),
                    album=a.get("albumName"),
                    release_date=a.get("releaseDate"),
                    cover_url=_artwork(a.get("artwork")),
                    position=i,
                    source=self.NAME,
                ))
            if not data.get("next"):
                break
        return out

    # -- mapping -------------------------------------------------------------
    def _track(self, item: dict, *, position: int, album: str | None, cover: str | None,
               artists_fallback: list[str], release: str | None) -> Track:
        names = _links(item, "subtitleLinks") or split_credit(item.get("artistName") or "")
        if names == ["Unknown Artist"] and artists_fallback:
            names = list(artists_fallback)
        tert = _links(item, "tertiaryLinks")
        cd = (item.get("contentDescriptor") or {}).get("identifiers") or {}
        return Track(
            id=str(cd.get("storeAdamID") or ""),
            title=item.get("title") or "Unknown Track",
            artists=names,
            duration_ms=item.get("duration"),
            album=album or (tert[0] if tert else None),
            release_date=release,
            cover_url=_artwork(item.get("artwork")) or cover,
            position=item.get("trackNumber") or position,
            playable=not item.get("isDisabled", False),
            source=self.NAME,
        )

    # -- public --------------------------------------------------------------
    def fetch(self, url: str, enrich: bool = False) -> Playlist:
        kind, pid, cc, song = self.parse_url(url)
        if kind == "track":
            t = self.track(song or pid, cc, album_id=None if song == pid else pid)
            return Playlist(id=t.id or pid, kind="track", name=t.title, owner=t.credit,
                            cover_url=t.cover_url, tracks=[t], total=1, source=self.NAME)
        page = self._page(cc, kind, pid)
        hsec = self._section(page, "containerDetailHeaderLockup")
        head = ((hsec or {}).get("items") or [{}])[0]
        name = head.get("title") or "Untitled"
        head_artists = _links(head, "subtitleLinks")
        cover = _artwork(head.get("artwork"))
        footer = self._footer(page)
        release = _iso_date(footer) if kind == "album" else None
        album_name = name if kind == "album" else None
        tsec = self._section(page, "trackLockup", "songLockup")
        items = (tsec or {}).get("items") or []
        tracks = [self._track(it, position=i, album=album_name, cover=cover,
                              artists_fallback=head_artists, release=release)
                  for i, it in enumerate(items, start=1)]
        tracks = [t for t in tracks if t.id]
        count = COUNT_RE.search(footer)
        total = head.get("trackCount") or (int(count.group(1).replace(",", "")) if count else len(tracks))
        if total > len(tracks):
            tracks += self._amp_tracks(cc, kind, pid, len(tracks), total)
        pl = Playlist(id=pid, kind=kind, name=name,
                      owner=(head_artists[0] if head_artists else None), cover_url=cover,
                      tracks=tracks, total=total or len(tracks), source=self.NAME)
        if enrich:
            self.enrich(pl.tracks)
        return pl

    def track(self, song_id: str, cc: str = "us", album_id: str | None = None) -> Track:
        """A single song. Duration and track number only live on the album page,
        so the song page is used to find the album and then that page is read."""
        t: Track | None = None
        if album_id is None:
            page = self._page(cc, "song", song_id)
            sec = self._section(page, "songDetailHeader")
            head = ((sec or {}).get("items") or [{}])[0]
            t = Track(id=song_id, title=head.get("title") or "Unknown Track",
                      artists=_links(head, "artistLinks") or split_credit(head.get("artists") or ""),
                      album=head.get("album"), release_date=_iso_date(head.get("releaseDate")),
                      cover_url=_artwork(head.get("artwork")), source=self.NAME)
            play = ((head.get("playAction") or {}).get("items") or [{}])[0]
            album_id = ((play.get("contentDescriptor") or {}).get("albumID")
                        or ((head.get("albumLinks") or [{}])[0].get("segue", {})
                            .get("destination", {}).get("contentDescriptor", {})
                            .get("identifiers", {}) or {}).get("storeAdamID"))
            if not album_id:
                return t
        album = self.fetch(f"https://music.apple.com/{cc}/album/x/{album_id}")
        for cand in album.tracks:
            if cand.id == song_id:
                if t:
                    cand.album = cand.album or t.album
                    cand.release_date = cand.release_date or t.release_date
                return cand
        if t:
            return t
        raise SourceError("Apple Music does not list that song on its album any more.")

    def covers(self, ids: list[str], workers: int = 4) -> dict[str, str]:
        """Nothing to fetch: every lockup in the page model carries artwork."""
        return {}

    def enrich(self, tracks: list[Track], workers: int = 4) -> None:
        """No-op: the page model already carries cover, album and duration."""
        return
