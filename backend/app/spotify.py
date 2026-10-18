"""Spotify metadata via public embed pages (no login, no API key).

Port of the approach proven in Sunnify, trimmed down:
  * /embed/playlist/{id} and /embed/album/{id}: __NEXT_DATA__ JSON with name,
    owner, cover and a trackList (today ~50 tracks).
  * anonymous accessToken inside that JSON -> spclient playlist/v2 for the
    full URI list on big playlists.
  * /embed/track/{id}: artists as a list, cover, release date.
  * open.spotify.com/track/{id} og:description: the only place the album
    name of a single track is exposed.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import re
import time
from dataclasses import dataclass, field, asdict

import requests

log = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0.0.0 Safari/537.36")
EMBED = "https://open.spotify.com/embed/{kind}/{id}"
TRACK_PAGE = "https://open.spotify.com/track/{id}"
SPCLIENT = "https://spclient.wg.spotify.com/playlist/v2/playlist/{id}"
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
OG_DESC_RE = re.compile(r'<meta\s+(?=[^>]*\bproperty="og:description")[^>]*\bcontent="([^"]*)"', re.I)
URL_RE = re.compile(
    r"(?:https?://open\.spotify\.com/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?(?:embed/)?(playlist|album|track)/([A-Za-z0-9]{22})"
    r"|spotify:(playlist|album|track):([A-Za-z0-9]{22}))"
)


class SpotifyError(RuntimeError):
    pass


@dataclass
class Track:
    id: str
    title: str
    artists: list[str]            # as Spotify credits them, in order
    duration_ms: int | None = None
    album: str | None = None
    release_date: str | None = None
    cover_url: str | None = None
    position: int | None = None
    playable: bool = True

    @property
    def credit(self) -> str:
        return ", ".join(self.artists)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["credit"] = self.credit
        return d


@dataclass
class Playlist:
    id: str
    kind: str                     # playlist | album | track
    name: str
    owner: str | None
    cover_url: str | None
    tracks: list[Track] = field(default_factory=list)
    total: int | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "name": self.name, "owner": self.owner,
            "cover_url": self.cover_url, "total": self.total,
            "tracks": [t.to_dict() for t in self.tracks],
        }


def parse_url(url: str) -> tuple[str, str]:
    m = URL_RE.search(url.strip())
    if not m:
        raise SpotifyError("This does not look like a Spotify playlist, album or track link.")
    kind = m.group(1) or m.group(3)
    sid = m.group(2) or m.group(4)
    return kind, sid


def split_credit(subtitle: str) -> list[str]:
    """Spotify joins credited artists with ', '. Split only on that so names
    like 'Earth, Wind & Fire' survive as far as Spotify itself keeps them."""
    subtitle = (subtitle or "").replace("\xa0", " ")
    parts = [p.strip() for p in re.split(r",\s+", subtitle) if p.strip()]
    return parts or [subtitle.strip() or "Unknown Artist"]


def _deep_find(obj, key, depth=0):
    if depth > 8:
        return None
    if isinstance(obj, dict):
        if key in obj:
            return obj
        for v in obj.values():
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    return None


class SpotifyClient:
    def __init__(self, session: requests.Session | None = None):
        self.s = session or requests.Session()
        self.s.headers.update({"user-agent": UA, "accept-language": "en-US,en;q=0.9"})
        self._token: str | None = None
        self._token_exp = 0.0

    # -- low level -----------------------------------------------------------
    def _get(self, url: str, **kw) -> requests.Response:
        last: Exception | None = None
        for attempt in range(4):
            try:
                r = self.s.get(url, timeout=30, **kw)
            except (requests.Timeout, requests.ConnectionError) as exc:
                last = exc
                time.sleep(1.5 ** attempt)
                continue
            if r.status_code == 429:
                wait = float(r.headers.get("retry-after", 2 + attempt * 2))
                log.warning("Spotify 429, waiting %.0fs", wait)
                time.sleep(min(wait, 30))
                continue
            return r
        raise SpotifyError(f"Network error talking to Spotify: {last}")

    def _next_data(self, url: str) -> dict:
        r = self._get(url)
        if r.status_code in (401, 403):
            raise SpotifyError("Spotify refused access. The playlist is private or unavailable.")
        if r.status_code == 404:
            raise SpotifyError("Spotify says this content does not exist.")
        if r.status_code != 200:
            raise SpotifyError(f"Spotify embed page returned HTTP {r.status_code}.")
        m = NEXT_DATA_RE.search(r.text)
        if not m:
            raise SpotifyError("Spotify changed the embed page structure (no __NEXT_DATA__).")
        data = json.loads(m.group(1))
        sess = _deep_find(data, "accessToken")
        if isinstance(sess, dict):
            self._token = sess.get("accessToken")
            self._token_exp = (sess.get("accessTokenExpirationTimestampMs") or 0) / 1000
        return data

    @staticmethod
    def _entity(data: dict) -> dict:
        for path in (("props", "pageProps", "state", "data", "entity"),
                     ("props", "pageProps", "data", "entity"),
                     ("props", "pageProps", "entity")):
            cur = data
            for k in path:
                cur = cur.get(k) if isinstance(cur, dict) else None
            if isinstance(cur, dict):
                return cur
        ent = _deep_find(data, "trackList")
        if ent:
            return ent
        pp = (data.get("props") or {}).get("pageProps") or {}
        if "status" in pp and "state" not in pp:
            raise SpotifyError("Spotify returned an empty page: the content is private, removed or unavailable in your region.")
        raise SpotifyError("Could not find playlist data in the embed page.")

    @staticmethod
    def _cover(ent: dict) -> str | None:
        vi = ent.get("visualIdentity") or {}
        imgs = vi.get("image") or []
        best = None
        for img in imgs:
            if isinstance(img, dict) and img.get("url"):
                best = img["url"]
                if (img.get("maxWidth") or 0) >= 300:
                    break
        if best:
            return best
        ca = ent.get("coverArt") or {}
        srcs = ca.get("sources") or []
        if srcs:
            return max(srcs, key=lambda x: x.get("width") or 0).get("url")
        return None

    # -- public --------------------------------------------------------------
    def fetch(self, url: str, enrich: bool = False) -> Playlist:
        kind, sid = parse_url(url)
        if kind == "track":
            t = self.track(sid)
            return Playlist(id=sid, kind="track", name=t.title, owner=t.credit,
                            cover_url=t.cover_url, tracks=[t], total=1)
        data = self._next_data(EMBED.format(kind=kind, id=sid))
        ent = self._entity(data)
        name = ent.get("name") or ent.get("title") or "Untitled"
        owner = ent.get("subtitle")
        album_name = name if kind == "album" else None
        tracks: list[Track] = []
        seen: set[str] = set()
        for i, tr in enumerate(ent.get("trackList") or [], start=1):
            uri = tr.get("uri", "")
            if not uri.startswith("spotify:track:"):
                continue
            tid = uri.rsplit(":", 1)[-1]
            seen.add(tid)
            tracks.append(Track(
                id=tid,
                title=tr.get("title") or tr.get("name") or "Unknown Track",
                artists=split_credit(tr.get("subtitle") or owner or ""),
                duration_ms=tr.get("duration"),
                album=album_name,
                position=i,
                playable=bool(tr.get("isPlayable", True)),
            ))
        total = len(tracks)
        if kind == "playlist":
            tracks, total = self._extend_via_spclient(sid, tracks, seen)
        pl = Playlist(id=sid, kind=kind, name=name, owner=owner,
                      cover_url=self._cover(ent), tracks=tracks, total=total)
        if enrich:
            self.enrich(pl.tracks)
        return pl

    def _extend_via_spclient(self, sid: str, tracks: list[Track], seen: set[str]):
        if not self._token:
            return tracks, len(tracks)
        try:
            r = self.s.get(SPCLIENT.format(id=sid), timeout=30,
                           headers={"authorization": f"Bearer {self._token}", "accept": "application/json"})
            if r.status_code != 200:
                log.info("spclient HTTP %s, keeping the embed list", r.status_code)
                return tracks, len(tracks)
            items = ((r.json().get("contents") or {}).get("items")) or []
        except Exception as exc:  # noqa: BLE001
            log.info("spclient fallback failed: %s", exc)
            return tracks, len(tracks)
        order: dict[str, int] = {}
        pending: list[str] = []
        for i, it in enumerate(items, start=1):
            uri = it.get("uri", "")
            if not uri.startswith("spotify:track:"):
                continue
            tid = uri.rsplit(":", 1)[-1]
            order[tid] = i
            if tid not in seen:
                pending.append(tid)
        for t in tracks:
            if t.id in order:
                t.position = order[t.id]
        if not pending:
            return tracks, len(order) or len(tracks)
        log.info("playlist has %d tracks, fetching %d more via embed/track", len(order), len(pending))
        with cf.ThreadPoolExecutor(max_workers=6) as pool:
            for t in pool.map(self._safe_track, pending):
                if t:
                    t.position = order.get(t.id)
                    tracks.append(t)
        tracks.sort(key=lambda t: t.position or 10**9)
        return tracks, len(order)

    def _safe_track(self, tid: str) -> Track | None:
        try:
            return self.track(tid, with_album=False)
        except Exception as exc:  # noqa: BLE001
            log.warning("track %s: %s", tid, exc)
            return None

    def track(self, tid: str, with_album: bool = True) -> Track:
        data = self._next_data(EMBED.format(kind="track", id=tid))
        ent = self._entity(data)
        arts = ent.get("artists")
        if isinstance(arts, list) and arts:
            artists = [a.get("name", "").strip() for a in arts if isinstance(a, dict) and a.get("name")]
        else:
            artists = split_credit(ent.get("subtitle") or "")
        rd = ent.get("releaseDate")
        release = rd.get("isoString", "")[:10] if isinstance(rd, dict) else (rd or None)
        t = Track(id=tid, title=ent.get("name") or ent.get("title") or "Unknown Track",
                  artists=artists or ["Unknown Artist"], duration_ms=ent.get("duration"),
                  release_date=release, cover_url=self._cover(ent),
                  playable=bool(ent.get("isPlayable", True)))
        if with_album:
            t.album = self.album_of(tid)
        return t

    def album_of(self, tid: str) -> str | None:
        """og:description on the share page reads 'Artist · Album · Song · Year'."""
        # Spotify serves the SEO page with og: tags only to "simple" clients;
        # a real Chrome UA gets the web player without those meta tags.
        try:
            r = self._get(TRACK_PAGE.format(id=tid), headers={"user-agent": "Mozilla/5.0"})
        except SpotifyError:
            return None
        m = OG_DESC_RE.search(r.text)
        if not m:
            return None
        parts = [p.strip() for p in m.group(1).split("·")]
        if len(parts) >= 4:
            return parts[1] or None
        if len(parts) == 3 and parts[1].lower() != "song":
            return parts[1] or None
        return None

    def enrich(self, tracks: list[Track], workers: int = 6) -> None:
        """Fill cover, album, release date and the proper artist list."""
        def one(t: Track):
            if t.cover_url and t.album and t.release_date:
                return
            try:
                full = self.track(t.id, with_album=not t.album)
            except Exception as exc:  # noqa: BLE001
                log.debug("enrich %s: %s", t.id, exc)
                return
            t.cover_url = t.cover_url or full.cover_url
            t.album = t.album or full.album
            t.release_date = t.release_date or full.release_date
            if full.artists and full.artists != ["Unknown Artist"]:
                t.artists = full.artists
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(one, tracks))
