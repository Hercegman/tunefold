"""YouTube search, picking the right upload, and download via yt-dlp + ffmpeg."""
from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import unicodedata
from dataclasses import dataclass
from typing import Callable

import yt_dlp

log = logging.getLogger(__name__)

FORMATS = {
    "mp3": {"ext": "mp3", "lossy": True},
    "m4a": {"ext": "m4a", "lossy": True},
    "opus": {"ext": "opus", "lossy": True},
    "flac": {"ext": "flac", "lossy": False},
    "wav": {"ext": "wav", "lossy": False},
}
DURATION_TOL_S = 8
DURATION_HARD_S = 30
STOPWORDS = re.compile(
    r"\b(official|video|audio|lyrics?|lyric video|hd|hq|4k|remaster(?:ed)?|visualizer|music video|spot)\b", re.I)
PAREN_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")


class Cancelled(Exception):
    pass


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def _norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s).casefold()
    return re.sub(r"\s+", " ", s).strip()


def _title_core(title: str) -> str:
    """'Hello - Live at X (Remastered 2011)' -> 'hello'."""
    t = PAREN_RE.sub(" ", title)
    t = t.split(" - ")[0]
    return _norm(t)


def _title_matches(yt_title: str | None, want: str) -> bool:
    core = _title_core(want)
    yt = _norm(STOPWORDS.sub(" ", yt_title or ""))
    if len(core) >= 4:
        return core in yt
    return bool(re.search(rf"\b{re.escape(core)}\b", yt))


def _artist_matches(entry: dict, artists: list[str]) -> bool:
    hay = _norm(" ".join(filter(None, [entry.get("title"), entry.get("channel"), entry.get("uploader")])))
    for a in artists:
        a_n = _norm(a)
        if a_n and (a_n in hay or any(len(tok) > 2 and tok in hay for tok in a_n.split())):
            return True
    return False


@dataclass
class Candidate:
    url: str
    title: str
    duration: float | None
    score: float


def pick_match(entries: list[dict], title: str, artists: list[str], duration_s: float | None,
               loose: bool = False) -> Candidate | None:
    """Title first, then artist, then duration. Reject when the duration is
    >30 s off (live/remix/sped-up). `loose` takes the closest duration when the
    strict pass finds nothing."""
    entries = [e for e in entries if e and e.get("id")]
    if not entries:
        return None
    pool = [e for e in entries if _title_matches(e.get("title"), title)]
    if pool:
        by_artist = [e for e in pool if _artist_matches(e, artists)]
        if by_artist:
            pool = by_artist
        elif not loose:
            log.info("no candidate mentions artist %r for %r", artists, title)
            return None
    elif not loose:
        return None
    else:
        pool = entries

    def dist(e):
        d = e.get("duration")
        return abs(d - duration_s) if (d and duration_s) else 10**6

    best = min(pool, key=dist)
    off = dist(best)
    if duration_s and off > DURATION_HARD_S and not loose:
        log.info("best candidate is %.0fs off for %r, rejecting", off, title)
        return None
    score = 100 - min(off, 100) if duration_s else 50
    return Candidate(url=f"https://www.youtube.com/watch?v={best['id']}", title=best.get("title", ""),
                     duration=best.get("duration"), score=score)


class Downloader:
    def __init__(self, fmt: str = "mp3", quality: str = "320", cookies: str | None = None,
                 loose: bool = False, cancel: threading.Event | None = None):
        self.fmt = fmt if fmt in FORMATS else "mp3"
        self.quality = quality
        self.cookies = cookies or None
        self.loose = loose
        self.cancel = cancel or threading.Event()

    def _base_opts(self) -> dict:
        o = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 15, "retries": 3}
        if self.cookies and os.path.exists(self.cookies):
            o["cookiefile"] = self.cookies
        return o

    def search(self, title: str, artists: list[str], duration_s: float | None) -> Candidate | None:
        queries = [f"{title} {' '.join(artists)} audio", f"{_title_core(title)} {artists[0] if artists else ''}".strip()]
        seen = set()
        for q in queries:
            if q in seen:
                continue
            seen.add(q)
            if self.cancel.is_set():
                raise Cancelled()
            try:
                with yt_dlp.YoutubeDL({**self._base_opts(), "extract_flat": "in_playlist", "skip_download": True}) as ydl:
                    info = ydl.extract_info(f"ytsearch6:{q}", download=False)
            except Exception as exc:  # noqa: BLE001
                log.warning("ytsearch '%s': %s", q, str(exc)[:200])
                continue
            cand = pick_match(info.get("entries") or [], title, artists, duration_s, loose=self.loose)
            if cand:
                return cand
        return None

    def download(self, url: str, dest_base: str, progress: Callable[[float], None] | None = None,
                 on_convert: Callable[[], None] | None = None) -> str:
        """Download `url` into `dest_base`.<ext>. Returns the finished file path."""
        ff = ffmpeg_path()
        if not ff:
            raise RuntimeError("ffmpeg was not found on PATH.")
        spec = FORMATS[self.fmt]
        pp = {"key": "FFmpegExtractAudio", "preferredcodec": self.fmt}
        if spec["lossy"]:
            pp["preferredquality"] = self.quality
        expected = f"{dest_base}.{spec['ext']}"

        def hook(d):
            if self.cancel.is_set():
                raise Cancelled()
            if progress and d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                if total:
                    progress(min(99.0, d.get("downloaded_bytes", 0) / total * 100))

        def pp_hook(d):
            if on_convert and d.get("status") == "started" and d.get("postprocessor") == "ExtractAudio":
                on_convert()

        opts = {
            **self._base_opts(),
            "postprocessor_hooks": [pp_hook],
            "format": "bestaudio/best",
            "outtmpl": dest_base + ".%(ext)s",
            "ffmpeg_location": ff,
            "postprocessors": [pp],
            "progress_hooks": [hook],
            "concurrent_fragment_downloads": 4,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
        if not os.path.exists(expected):
            raise RuntimeError("yt-dlp did not produce an audio file.")
        return expected
