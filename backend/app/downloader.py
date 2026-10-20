"""YouTube search, picking the right upload, and download via yt-dlp + ffmpeg.

Picking is deliberately not a popularity contest. The playlist entry names one
recording, and the tags written next to the audio claim exactly that recording,
so the candidate closest to the source duration wins, and an upload the title
marks as something else - live, a remix, a cover, a sped-up edit - is pushed
behind the clean ones unless the source itself asks for it. Views only break a
tie. Everything that survived the title/artist filter is kept and handed to the
UI, because the one case the rules cannot settle is a user who simply wants the
famous live take.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import sys
import threading
import unicodedata
from dataclasses import dataclass, field
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
DOWNLOAD_ATTEMPTS = 3
STOPWORDS = re.compile(
    r"\b(official|video|audio|lyrics?|lyric video|hd|hq|4k|remaster(?:ed)?|visualizer|music video|spot)\b", re.I)
PAREN_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")

# What a title says the upload actually is. A tag the candidate has and the
# source track does not costs it the match; the other way round costs it too,
# so a playlist asking for "… - Live at Wembley" stops landing on the studio cut.
VARIANTS: dict[str, re.Pattern] = {
    "live": re.compile(r"\b(live|concert|unplugged|en vivo|u[zž]ivo|session|sessions|acoustic)\b", re.I),
    "remix": re.compile(r"\b(remix|mashup|bootleg|vip mix|re\s?edit|rework|flip)\b", re.I),
    "altered": re.compile(r"\b(sped\s?up|speed\s?up|slowed|nightcore|8d|reverb|pitched|daycore)\b", re.I),
    "cover": re.compile(r"\b(cover|karaoke|instrumental|tribute|backing track|ai\s+(?:cover|version|generated))\b", re.I),
    "lyrics": re.compile(r"\b(lyrics?|letra|tradu[cç][aã]o|legendado|sub\s?espa|testo)\b", re.I),
    "full": re.compile(r"\b(full album|album completo|greatest hits|megamix|mega mix|all songs|playlist)\b", re.I),
}
# How much a mismatched tag costs, in the same units as the duration score.
VARIANT_COST = {"live": 60, "remix": 60, "altered": 70, "cover": 80, "lyrics": 8, "full": 120}
MISSING_COST = 40          # the source wants this tag and the candidate lacks it
OFFICIAL_RE = re.compile(r"\b(official (?:audio|video|music video|lyric video)|topic)\b", re.I)


def duration_score(off: float | None) -> float:
    """A few seconds is an intro or a fade; half a minute is another recording.
    Flat inside the tolerance, steep outside it, so no amount of official
    channel or view count can buy back a duration that does not fit."""
    if off is None:
        return 50.0
    if off <= DURATION_TOL_S:
        return 100.0 - off
    return max(0.0, 100.0 - DURATION_TOL_S - (off - DURATION_TOL_S) * 3)


def variant_tags(title: str) -> list[str]:
    return [name for name, rx in VARIANTS.items() if rx.search(title or "")]


class Cancelled(Exception):
    pass


# Errors that tend to pass on their own. A 403 from googlevideo usually means
# the signed URL went stale or the CDN throttled us, and re-extracting gets a
# fresh one - which is exactly why downloading the same track again by hand
# works.
TRANSIENT_RE = re.compile(
    r"(\b403\b|\b429\b|forbidden|too many requests|timed out|timeout|"
    r"connection (?:reset|aborted|refused|error)|temporary failure|unable to download|"
    r"fragment|incomplete|remote end closed|content too short|HTTP Error 5\d\d)", re.I)
PERMANENT_RE = re.compile(
    r"(sign in to confirm|private video|video unavailable|removed by the uploader|"
    r"age.?restricted|members.?only|blocked it|not available in your country)", re.I)


def transient_error(msg: str | None) -> bool:
    """Whether this one is worth another go later."""
    text = msg or ""
    return bool(TRANSIENT_RE.search(text)) and not PERMANENT_RE.search(text)


def ffmpeg_path() -> str | None:
    """Location handed to yt-dlp (`ffmpeg_location`): a directory holding the
    bundled ffmpeg/ffprobe sidecars when present, otherwise the ffmpeg found
    on PATH. Resolution order:
      1. TUNEFOLD_FFMPEG env var (a binary or a directory)
      2. ffmpeg next to this executable (Tauri installs sidecars side by side)
      3. PATH
    """
    exe = ".exe" if sys.platform == "win32" else ""
    override = os.environ.get("TUNEFOLD_FFMPEG")
    if override and os.path.exists(override):
        return override
    if getattr(sys, "frozen", False):
        here = os.path.dirname(os.path.abspath(sys.executable))
        if os.path.exists(os.path.join(here, f"ffmpeg{exe}")):
            return here
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
    id: str
    url: str
    title: str
    duration: float | None
    views: int | None = None
    channel: str | None = None
    verified: bool = False
    tags: list[str] = field(default_factory=list)
    score: float = 0.0
    off: float | None = None        # seconds away from the source duration
    eligible: bool = True           # False: only reachable by picking it by hand

    def to_dict(self) -> dict:
        return {"id": self.id, "url": self.url, "title": self.title, "duration": self.duration,
                "views": self.views, "channel": self.channel, "verified": self.verified,
                "tags": self.tags, "off": self.off, "eligible": self.eligible}


def rank_matches(entries: list[dict], title: str, artists: list[str], duration_s: float | None,
                 loose: bool = False) -> list[Candidate]:
    """Every upload worth considering, best first.

    Title first, then artist, then duration: a candidate more than 30 s from
    the source is some other recording and cannot be chosen automatically, but
    it stays in the list marked `eligible=False` so the user can still ask for
    it. `loose` drops the artist and duration guards when nothing survives.
    """
    entries = [e for e in entries if e and e.get("id")]
    if not entries:
        return []
    pool = [e for e in entries if _title_matches(e.get("title"), title)]
    if pool:
        by_artist = [e for e in pool if _artist_matches(e, artists)]
        if by_artist:
            pool = by_artist
        elif not loose:
            log.info("no candidate mentions artist %r for %r", artists, title)
            return []
    elif not loose:
        return []
    else:
        pool = entries

    wanted = set(variant_tags(title))
    artist_keys = [_norm(a) for a in artists if a]
    out: list[Candidate] = []
    for e in pool:
        d = e.get("duration")
        off = abs(d - duration_s) if (d and duration_s) else None
        tags = variant_tags(e.get("title") or "")
        score = duration_score(off)
        for t in set(tags) - wanted:
            score -= VARIANT_COST.get(t, 40)
        for t in wanted - set(tags):
            if t != "lyrics":
                score -= MISSING_COST
        # Provenance separates candidates the duration already put side by side;
        # together it is worth less than six seconds of drift.
        chan = _norm(e.get("channel") or e.get("uploader") or "")
        if e.get("channel_is_verified"):
            score += 6
        if chan and any(k and k in chan for k in artist_keys):
            score += 6
        if OFFICIAL_RE.search(f"{e.get('title') or ''} {e.get('channel') or ''}"):
            score += 4
        # Views only separate candidates the rules already consider equal.
        score += min((e.get("view_count") or 0) / 1e9, 1.0)
        out.append(Candidate(
            id=e["id"], url=f"https://www.youtube.com/watch?v={e['id']}",
            title=e.get("title") or "", duration=d, views=e.get("view_count"),
            channel=e.get("channel") or e.get("uploader"), verified=bool(e.get("channel_is_verified")),
            tags=tags, score=round(score, 2), off=off,
            eligible=loose or off is None or off <= DURATION_HARD_S,
        ))
    out.sort(key=lambda c: (not c.eligible, -c.score))
    return out


def pick_match(entries: list[dict], title: str, artists: list[str], duration_s: float | None,
               loose: bool = False) -> Candidate | None:
    """The one upload to download, or None when nothing is close enough."""
    ranked = [c for c in rank_matches(entries, title, artists, duration_s, loose) if c.eligible]
    if not ranked:
        log.info("no candidate within %ds for %r", DURATION_HARD_S, title)
    return ranked[0] if ranked else None


class Downloader:
    def __init__(self, fmt: str = "mp3", quality: str = "320", cookies: str | None = None,
                 loose: bool = False, cancel: threading.Event | None = None):
        self.fmt = fmt if fmt in FORMATS else "mp3"
        self.quality = quality
        self.cookies = cookies or None
        self.loose = loose
        self.cancel = cancel or threading.Event()

    def _base_opts(self) -> dict:
        o = {
            "quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 20,
            # yt-dlp's own retries cover a stumble inside one download; the loop
            # in download() covers the case where the URL itself has gone bad.
            "retries": 10, "fragment_retries": 10, "extractor_retries": 3, "file_access_retries": 3,
            "retry_sleep_functions": {
                "http": lambda n: min(2 ** n, 15),
                "fragment": lambda n: min(2 ** n, 15),
                "extractor": lambda n: min(2 ** n, 15),
            },
        }
        if self.cookies and os.path.exists(self.cookies):
            o["cookiefile"] = self.cookies
        return o

    def _ytsearch(self, query: str, n: int = 6) -> list[dict]:
        if self.cancel.is_set():
            raise Cancelled()
        try:
            with yt_dlp.YoutubeDL({**self._base_opts(), "extract_flat": "in_playlist", "skip_download": True}) as ydl:
                info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
        except Exception as exc:  # noqa: BLE001
            log.warning("ytsearch '%s': %s", query, str(exc)[:200])
            return []
        return [e for e in (info.get("entries") or []) if e]

    def search_ranked(self, title: str, artists: list[str], duration_s: float | None) -> list[Candidate]:
        """Everything worth showing for one track, best first.

        The second query only runs when the first produced nothing downloadable,
        but its results are merged in, so the list the user can pick from is as
        wide as the search actually went.
        """
        queries = [f"{title} {' '.join(artists)} audio",
                   f"{_title_core(title)} {artists[0] if artists else ''}".strip()]
        entries: list[dict] = []
        seen: set[str] = set()
        ranked: list[Candidate] = []
        for q in dict.fromkeys(q for q in queries if q):
            for e in self._ytsearch(q):
                if e.get("id") and e["id"] not in seen:
                    seen.add(e["id"])
                    entries.append(e)
            ranked = rank_matches(entries, title, artists, duration_s, loose=self.loose)
            if any(c.eligible for c in ranked):
                break
        return ranked

    def search_wide(self, title: str, artists: list[str], duration_s: float | None,
                    query: str | None = None) -> list[Candidate]:
        """The list behind "other versions": both standard queries, or one the
        user typed. Nothing is filtered out by artist or duration here - the
        point is to show what else exists, flagged, and let a human decide."""
        queries = [query] if query else [
            f"{title} {' '.join(artists)} audio",
            f"{_title_core(title)} {artists[0] if artists else ''}".strip(),
            f"{_title_core(title)} {artists[0] if artists else ''} live".strip(),
        ]
        entries: list[dict] = []
        seen: set[str] = set()
        for q in dict.fromkeys(q for q in queries if q):
            for e in self._ytsearch(q, n=8):
                if e.get("id") and e["id"] not in seen:
                    seen.add(e["id"])
                    entries.append(e)
        ranked = rank_matches(entries, title, artists, duration_s, loose=True)
        # loose ranking marks everything eligible; restore the honest flag so
        # the UI can still say which ones the automatic pick would refuse.
        for c in ranked:
            c.eligible = c.off is None or c.off <= DURATION_HARD_S
        return ranked

    def probe(self, url: str) -> Candidate | None:
        """One pasted YouTube link, resolved to a candidate."""
        try:
            with yt_dlp.YoutubeDL({**self._base_opts(), "skip_download": True}) as ydl:
                i = ydl.extract_info(url, download=False) or {}
        except Exception as exc:  # noqa: BLE001
            log.warning("probe %s: %s", url, str(exc)[:200])
            return None
        if not i.get("id"):
            return None
        return Candidate(id=i["id"], url=f"https://www.youtube.com/watch?v={i['id']}",
                         title=i.get("title") or "", duration=i.get("duration"),
                         views=i.get("view_count"), channel=i.get("channel") or i.get("uploader"),
                         verified=bool(i.get("channel_is_verified")), tags=variant_tags(i.get("title") or ""))

    def search(self, title: str, artists: list[str], duration_s: float | None) -> Candidate | None:
        for c in self.search_ranked(title, artists, duration_s):
            if c.eligible:
                return c
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
        # Re-extract rather than just retry the request: a 403 means the URL
        # yt-dlp was handed is no longer good, and only a fresh extraction
        # produces a new one.
        for attempt in range(DOWNLOAD_ATTEMPTS):
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.extract_info(url, download=True)
                break
            except Cancelled:
                raise
            except Exception as exc:  # noqa: BLE001
                if self.cancel.is_set():
                    raise Cancelled() from exc
                if attempt == DOWNLOAD_ATTEMPTS - 1 or not transient_error(str(exc)):
                    raise
                log.info("download failed (%s), re-extracting in %ds",
                         str(exc)[:120], 2 * (attempt + 1))
                if self.cancel.wait(2 * (attempt + 1)):
                    raise Cancelled() from exc
        if not os.path.exists(expected):
            raise RuntimeError("yt-dlp did not produce an audio file.")
        return expected
