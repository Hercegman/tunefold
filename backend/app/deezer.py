"""Deezer metadata via the public API (no login, no API key).

api.deezer.com is open for read-only catalogue calls:
  * /playlist/{id} and /album/{id}: title, cover, track count, first page of
    tracks; /playlist/{id}/tracks and /album/{id}/tracks page through the rest.
  * /track/{id}: contributors (the full credit, in order), album, release date.
Errors arrive as HTTP 200 with an {"error": {...}} body, so every response has
to be unwrapped rather than just status-checked.
"""
from __future__ import annotations

import concurrent.futures as cf
import logging
import re

from . import net
from .models import Playlist, SourceError, Track

log = logging.getLogger(__name__)

API = "https://api.deezer.com"
PAGE = 100
MAX_TRACKS = 5000
URL_RE = re.compile(
    r"https?://(?:www\.)?deezer\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?(playlist|album|track)/(\d+)"
    r"|deezer://(?:www\.deezer\.com/)?(playlist|album|track)/(\d+)"
)
SHORT_RE = re.compile(r"https?://(?:deezer\.page\.link|dzr\.page\.link|link\.deezer\.com)/\S+", re.I)
ERRORS = {
    "DataException": "Deezer has no data for this link: it is private, removed or unavailable in your country.",
    "Exception": "Deezer refused the request.",
}


def _cover(d: dict, *keys: str) -> str | None:
    for k in keys:
        for suffix in ("_xl", "_big", "_medium", ""):
            v = (d or {}).get(f"{k}{suffix}")
            if v:
                return v
    return None


class DeezerClient:
    NAME = "deezer"
    LABEL = "Deezer"

    def __init__(self, session=None):
        self.s = session or net.new_session()

    @staticmethod
    def matches(url: str) -> bool:
        u = url.strip()
        return bool(URL_RE.search(u) or SHORT_RE.match(u))

    # -- low level -----------------------------------------------------------
    def _api(self, path: str, **params) -> dict:
        r = net.get(self.s, f"{API}{path}", label=self.LABEL, params=params or None,
                    headers={"accept": "application/json"})
        net.check(r, label=self.LABEL)
        try:
            data = r.json()
        except ValueError as exc:
            raise SourceError("Deezer returned something that is not JSON.") from exc
        err = data.get("error") if isinstance(data, dict) else None
        if err:
            kind = err.get("type") if isinstance(err, dict) else None
            raise SourceError(ERRORS.get(kind) or f"Deezer error: {(err or {}).get('message') or err}")
        return data

    def _resolve_short(self, url: str) -> str:
        """deezer.page.link/... -> the real www.deezer.com URL."""
        try:
            r = self.s.get(url.strip(), timeout=30, allow_redirects=True)
            final = r.url
        except Exception as exc:  # noqa: BLE001
            raise SourceError(f"Could not follow the Deezer short link: {exc}") from exc
        if not URL_RE.search(final):
            raise SourceError("That Deezer short link does not point at a playlist, album or track.")
        return final

    def parse_url(self, url: str) -> tuple[str, str]:
        u = url.strip()
        if SHORT_RE.match(u):
            u = self._resolve_short(u)
        m = URL_RE.search(u)
        if not m:
            raise SourceError("This does not look like a Deezer playlist, album or track link.")
        kind = m.group(1) or m.group(3)
        did = m.group(2) or m.group(4)
        return kind, did

    def _page_tracks(self, path: str, have: int, total: int | None) -> list[dict]:
        """Everything after the first page that /playlist/{id} already gave us."""
        out: list[dict] = []
        index = have
        while index < min(total or MAX_TRACKS, MAX_TRACKS):
            data = self._api(path, index=index, limit=PAGE)
            batch = data.get("data") or []
            if not batch:
                break
            out.extend(batch)
            index += len(batch)
            if not data.get("next"):
                break
        return out

    # -- mapping -------------------------------------------------------------
    def _track(self, raw: dict, *, position: int | None, album: str | None, cover: str | None) -> Track:
        art = raw.get("artist") or {}
        contributors = [c.get("name", "").strip() for c in (raw.get("contributors") or []) if c.get("name")]
        artists = contributors or ([art["name"].strip()] if art.get("name") else ["Unknown Artist"])
        alb = raw.get("album") or {}
        dur = raw.get("duration")
        return Track(
            id=str(raw.get("id")),
            title=raw.get("title") or raw.get("title_short") or "Unknown Track",
            artists=artists,
            duration_ms=int(dur) * 1000 if dur else None,
            album=album or alb.get("title"),
            release_date=raw.get("release_date") or None,
            cover_url=_cover(alb, "cover") or cover,
            position=position if position is not None else raw.get("track_position"),
            playable=bool(raw.get("readable", True)),
            source=self.NAME,
        )

    # -- public --------------------------------------------------------------
    def fetch(self, url: str, enrich: bool = False) -> Playlist:
        kind, did = self.parse_url(url)
        if kind == "track":
            t = self.track(did)
            return Playlist(id=did, kind="track", name=t.title, owner=t.credit,
                            cover_url=t.cover_url, tracks=[t], total=1, source=self.NAME)
        ent = self._api(f"/{kind}/{did}")
        total = ent.get("nb_tracks")
        if kind == "album":
            name = ent.get("title") or "Untitled"
            owner = (ent.get("artist") or {}).get("name")
            cover = _cover(ent, "cover")
            album_name = name
        else:
            name = ent.get("title") or "Untitled"
            owner = (ent.get("creator") or {}).get("name")
            cover = _cover(ent, "picture")
            album_name = None
        raws = list((ent.get("tracks") or {}).get("data") or [])
        raws += self._page_tracks(f"/{kind}/{did}/tracks", len(raws), total)
        tracks: list[Track] = []
        seen: set[str] = set()
        for i, raw in enumerate(raws, start=1):
            tid = str(raw.get("id") or "")
            if not tid or tid in seen:
                continue
            seen.add(tid)
            tracks.append(self._track(raw, position=i, album=album_name, cover=cover))
        pl = Playlist(id=did, kind=kind, name=name, owner=owner, cover_url=cover,
                      tracks=tracks, total=total or len(tracks), source=self.NAME)
        if enrich:
            self.enrich(pl.tracks)
        return pl

    def track(self, tid: str) -> Track:
        return self._track(self._api(f"/track/{tid}"), position=None, album=None, cover=None)

    def enrich(self, tracks: list[Track], workers: int = 4) -> None:
        """Fill release date, album and the full contributor list (1 call each)."""
        def one(t: Track):
            if t.cover_url and t.album and t.release_date:
                return
            try:
                full = self.track(t.id)
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
