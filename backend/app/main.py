"""FastAPI backend that the Tauri shell launches as a sidecar."""
from __future__ import annotations

import argparse
import asyncio
import concurrent.futures as cf
import json
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .artists import TrackCredit, analyze, credit_key
from .downloader import FORMATS, Cancelled, Candidate, Downloader, ffmpeg_path, transient_error
from .library import Library
from .models import SourceError, Track
from .sources import LABELS, for_url
from .sources import get as source_for
from .tags import fetch_cover, read_cover, write_tags

log = logging.getLogger("backend")
app = FastAPI(title="Tunefold backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
lib = Library()

ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
YT_URL_RE = re.compile(r"(?:youtube\.com/watch\?\S*?v=|youtube\.com/(?:embed|shorts|live)/|youtu\.be/)"
                       r"([A-Za-z0-9_-]{11})")
YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_id(text: str) -> str | None:
    """A pasted link or a bare video id; anything else is a search query."""
    text = (text or "").strip()
    m = YT_URL_RE.search(text)
    return m.group(1) if m else (text if YT_ID_RE.match(text) else None)
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def safe_name(s: str, fallback: str = "untitled") -> str:
    s = ILLEGAL.sub("", s).strip(" .")
    s = re.sub(r"\s+", " ", s)
    if not s or s.upper() in RESERVED:
        s = fallback
    return s[:150]


# ---------------------------------------------------------------- models
class PreviewIn(BaseModel):
    url: str


class AliasIn(BaseModel):
    credit: str          # original credit, e.g. "Silk Sonic"
    to: str              # canonical name


class CoversIn(BaseModel):
    source: str = "spotify"
    ids: list[str]


class VersionIn(BaseModel):
    video_id: str
    title: str | None = None
    duration: float | None = None


class JobIn(BaseModel):
    url: str
    playlist: dict
    track_ids: list[str]
    artist_map: dict[str, str] = Field(default_factory=dict)
    save_aliases: list[AliasIn] = Field(default_factory=list)
    settings: dict = Field(default_factory=dict)


# ---------------------------------------------------------------- jobs
class Job:
    def __init__(self, jid: str, data: JobIn, settings: dict):
        self.id = jid
        self.data = data
        self.settings = settings
        self.status = "running"
        self.tracks: dict[str, dict] = {}
        self.events: list[dict] = []
        self.cond = threading.Condition()
        self.cancel = threading.Event()
        self.started = time.time()
        self.folder: str | None = None
        self.main_done = False
        self.reruns = 0
        self.lock = threading.Lock()

    def finish(self) -> None:
        """The job is only over once the main pass and every hand-picked
        re-download have left."""
        with self.lock:
            if self.main_done and self.reruns == 0:
                self.status = "cancelled" if self.cancel.is_set() else "finished"
        self.emit("job", **self.snapshot())

    def emit(self, kind: str, **payload):
        ev = {"type": kind, "t": time.time(), **payload}
        with self.cond:
            self.events.append(ev)
            self.cond.notify_all()

    def set_track(self, tid: str, **patch):
        st = self.tracks.setdefault(tid, {"id": tid, "status": "queued", "progress": 0})
        st.update(patch)
        self.emit("track", **st)

    def snapshot(self) -> dict:
        done = sum(1 for t in self.tracks.values() if t["status"] in ("done", "skipped"))
        failed = sum(1 for t in self.tracks.values() if t["status"] == "failed")
        return {"id": self.id, "status": self.status, "total": len(self.data.track_ids), "done": done,
                "failed": failed, "folder": self.folder, "tracks": list(self.tracks.values())}


JOBS: dict[str, Job] = {}


def _target_folder(job: Job, pl: dict, artist: str, album: str | None) -> str:
    mode = job.settings.get("folder_mode", "playlist")
    base = Path(job.settings.get("out_dir") or (Path.home() / "Music"))
    if mode == "artist":
        return str(base / safe_name(artist))
    if mode == "artist-album":
        return str(base / safe_name(artist) / safe_name(album or "Singles"))
    owner = pl.get("owner")
    name = pl["name"] if pl.get("kind") == "track" else (f"{pl['name']} - {owner}" if owner else pl["name"])
    return str(base / safe_name(name))


def _file_stem(job: Job, title: str, artist: str, position: int | None) -> str:
    naming = job.settings.get("naming", "artist-title")
    t, a = safe_name(title, "track"), safe_name(artist, "artist")
    stem = {"artist-title": f"{a} - {t}", "title-artist": f"{t} - {a}", "title": t}.get(naming, f"{a} - {t}")
    if job.settings.get("track_numbers") and position:
        stem = f"{position:02d}. {stem}"
    return stem


def _pick(ranked: list[Candidate], saved: dict | None) -> Candidate | None:
    """The upload to download: whatever the user once chose for this track,
    otherwise the best the rules found. A saved pick is honoured even when the
    search no longer returns it, and even when the duration rules would not
    have allowed it - it was chosen by hand on purpose."""
    if saved:
        for c in ranked:
            if c.id == saved["video_id"]:
                return c
        return Candidate(id=saved["video_id"], url=f"https://www.youtube.com/watch?v={saved['video_id']}",
                         title=saved.get("title") or "", duration=saved.get("duration"))
    return next((c for c in ranked if c.eligible), None)


def _friendly(msg: str) -> str:
    """The error as something worth reading."""
    if "Sign in to confirm" in msg or "bot" in msg.lower():
        return "YouTube wants proof you are not a bot. Add a cookies file from your browser in Settings."
    if "403" in msg or "Forbidden" in msg:
        return "YouTube refused the file (403). This usually clears on its own."
    if "429" in msg or "Too Many Requests" in msg:
        return "YouTube is rate limiting us (429)."
    return msg[:300]


def _run_track(job: Job, dl: Downloader, pl: dict, raw: dict, force: Candidate | None = None,
               last_attempt: bool = False) -> None:
    tid = raw["id"]
    if job.cancel.is_set():
        job.set_track(tid, status="cancelled")
        return
    source = pl.get("source") or "spotify"
    track = Track(id=tid, title=raw["title"], artists=list(raw["artists"]), duration_ms=raw.get("duration_ms"),
                  album=raw.get("album"), release_date=raw.get("release_date"), cover_url=raw.get("cover_url"),
                  position=raw.get("position"), source=source)
    artist = job.data.artist_map.get(tid) or track.credit
    job.set_track(tid, status="metadata", artist=artist)
    try:
        # per-track enrichment: cover, album, year (a call or two, per source)
        try:
            source_for(source).enrich([track], workers=1)
        except Exception as exc:  # noqa: BLE001
            log.debug("enrich %s: %s", tid, exc)
        folder = _target_folder(job, pl, artist, track.album)
        os.makedirs(folder, exist_ok=True)
        if job.folder is None:
            job.folder = folder if job.settings.get("folder_mode", "playlist") == "playlist" else str(Path(folder).parent if job.settings.get("folder_mode") == "artist-album" else job.settings.get("out_dir"))
        ext = FORMATS[dl.fmt]["ext"]
        stem = _file_stem(job, track.title, artist, track.position)
        dest = os.path.join(folder, f"{stem}.{ext}")
        if os.path.exists(dest) and force is None:
            job.set_track(tid, status="skipped", file=dest, progress=100)
            lib.record(track_id=tid, source=source, playlist_id=pl.get("id"), title=track.title,
                       artist=artist, credit=track.credit, album=track.album, file=dest)
            return
        if force is not None:
            cand = force
        else:
            job.set_track(tid, status="searching")
            ranked = dl.search_ranked(track.title, track.artists, (track.duration_ms or 0) / 1000 or None)
            cand = _pick(ranked, lib.choice(source, tid))
            # Everything the search turned up goes to the UI, including the
            # uploads the duration rules refused: picking one of those by hand
            # is exactly what the list is for.
            job.set_track(tid, alternatives=[c.to_dict() for c in ranked[:8]])
            if not cand:
                job.set_track(tid, status="failed",
                              error="No reliable YouTube match (title/artist/duration disagree).")
                return
        job.set_track(tid, status="downloading", chosen=cand.id, yt_title=cand.title, yt_url=cand.url)
        tmp_base = os.path.join(folder, f".{stem}.part-{tid[:6]}")
        final = dl.download(cand.url, tmp_base, progress=lambda p: job.set_track(tid, progress=round(p)),
                            on_convert=lambda: job.set_track(tid, status="converting", progress=99))
        job.set_track(tid, status="tagging", progress=99)
        write_tags(final, title=track.title, artist=artist, album=track.album, date=track.release_date,
                   track_no=track.position if job.settings.get("track_numbers") else None,
                   original_credit=track.credit, cover=fetch_cover(track.cover_url or pl.get("cover_url")))
        os.replace(final, dest)
        lib.record(track_id=tid, source=source, playlist_id=pl.get("id"), title=track.title, artist=artist,
                   credit=track.credit, album=track.album, file=dest)
        job.set_track(tid, status="done", file=dest, progress=100)
    except Cancelled:
        job.set_track(tid, status="cancelled")
    except Exception as exc:  # noqa: BLE001
        log.warning("track %s '%s': %s", tid, track.title, exc)
        msg = str(exc)
        # Something that usually passes gets one more go once the rest of the
        # playlist is done and nothing is competing for bandwidth.
        if transient_error(msg) and not last_attempt and not job.cancel.is_set():
            job.set_track(tid, status="requeued", error=_friendly(msg))
        else:
            job.set_track(tid, status="failed", error=_friendly(msg))
    finally:
        for leftover in Path(folder if 'folder' in locals() else ".").glob(f".{stem}.part-{tid[:6]}*") if 'stem' in locals() else []:
            try:
                leftover.unlink()
            except OSError:
                pass


def _run_job(job: Job) -> None:
    pl = job.data.playlist
    by_id = {t["id"]: t for t in pl.get("tracks", [])}
    todo = [by_id[t] for t in job.data.track_ids if t in by_id]
    for t in todo:
        job.set_track(t["id"], status="queued", title=t["title"], credit=", ".join(t["artists"]),
                      artist=job.data.artist_map.get(t["id"]) or ", ".join(t["artists"]))
    dl = _downloader_for(job)
    workers = max(1, min(int(job.settings.get("parallel", 4)), 8, len(todo) or 1))
    with cf.ThreadPoolExecutor(max_workers=workers, thread_name_prefix="dl") as pool:
        list(pool.map(lambda t: _run_track(job, dl, pl, t), todo))
    # Second pass, one at a time: whatever YouTube refused mid-rush usually
    # goes through once nothing else is pulling at the same time.
    again = [t for t in todo if job.tracks.get(t["id"], {}).get("status") == "requeued"]
    if again and not job.cancel.is_set():
        log.info("retrying %d track(s) after the main pass", len(again))
        for t in again:
            _run_track(job, dl, pl, t, last_attempt=True)
    job.main_done = True
    job.finish()


def _downloader_for(job: Job) -> Downloader:
    return Downloader(fmt=job.settings.get("format", "mp3"), quality=str(job.settings.get("quality", "320")),
                      cookies=job.settings.get("cookies") or None, loose=bool(job.settings.get("loose_match")),
                      cancel=job.cancel)


def _rerun_one(job: Job, pl: dict, raw: dict, cand: Candidate) -> None:
    try:
        _run_track(job, _downloader_for(job), pl, raw, force=cand, last_attempt=True)
    finally:
        with job.lock:
            job.reruns -= 1
        job.finish()


# ---------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": bool(ffmpeg_path()), "version": __version__}


@app.get("/api/settings")
def get_settings():
    return lib.settings()


@app.put("/api/settings")
def put_settings(patch: dict):
    return lib.save_settings(patch)


@app.get("/api/recent")
def recent():
    return lib.recent()


@app.get("/api/aliases")
def aliases():
    return lib.aliases_full()


@app.delete("/api/aliases/{key}")
def delete_alias(key: str):
    lib.delete_alias(key)
    return {"ok": True}


@app.get("/api/stats")
def stats():
    return lib.stats()


@app.get("/api/library")
def library():
    return lib.downloads()


# ------------------------------------------------- the local collection
AUDIO_TYPES = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "opus": "audio/ogg",
               "flac": "audio/flac", "wav": "audio/wav"}
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
CHUNK = 256 * 1024


@app.get("/api/collection")
def collection():
    return lib.collection()


def _owned(path: str) -> str:
    """A path Tunefold downloaded and still has. Everything else is a 404:
    the download history is the whole whitelist these two routes serve."""
    if not lib.has_file(path) or not os.path.exists(path):
        raise HTTPException(404, "not in your collection")
    return path


@app.get("/api/audio")
def audio(path: str, request: Request):
    """The file itself, with range requests so the player can seek."""
    _owned(path)
    media = AUDIO_TYPES.get(path.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    size = os.path.getsize(path)
    m = RANGE_RE.match(request.headers.get("range") or "")
    if not m:
        return FileResponse(path, media_type=media, headers={"accept-ranges": "bytes"})
    start = int(m.group(1)) if m.group(1) else 0
    end = int(m.group(2)) if m.group(2) else size - 1
    start, end = max(0, start), min(end, size - 1)
    if start > end:
        return Response(status_code=416, headers={"content-range": f"bytes */{size}"})

    def body():
        with open(path, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                data = fh.read(min(CHUNK, left))
                if not data:
                    break
                left -= len(data)
                yield data

    return StreamingResponse(body(), status_code=206, media_type=media, headers={
        "content-range": f"bytes {start}-{end}/{size}",
        "accept-ranges": "bytes",
        "content-length": str(end - start + 1),
    })


@app.get("/api/cover")
def cover(path: str):
    """The artwork written into the file when it was tagged."""
    _owned(path)
    art = read_cover(path)
    if not art:
        raise HTTPException(404, "no embedded cover")
    data, mime = art
    return Response(data, media_type=mime, headers={"cache-control": "max-age=86400"})


@app.get("/api/sources")
def sources():
    return LABELS


@app.post("/api/preview")
def preview(body: PreviewIn):
    try:
        name, client = for_url(body.url)
        pl = client.fetch(body.url)
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from exc
    lib.touch_recent(body.url, kind=pl.kind, name=pl.name, owner=pl.owner, cover_url=pl.cover_url,
                     total=pl.total, source=name)
    analysis = analyze([TrackCredit(t.id, t.title, t.artists) for t in pl.tracks], lib.aliases())
    return {"playlist": pl.to_dict(), "analysis": analysis,
            "have": lib.have([t.id for t in pl.tracks], name)}


@app.post("/api/covers")
def covers(body: CoversIn):
    """Artwork for tracks the listing could not supply it for. Separate from
    /api/preview on purpose: the table is worth more on screen straight away
    than two seconds later with its pictures."""
    try:
        return source_for(body.source).covers(body.ids[:80])
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/jobs")
def create_job(body: JobIn):
    settings = {**lib.settings(), **body.settings}
    if not ffmpeg_path():
        raise HTTPException(400, "ffmpeg is not installed or not on PATH.")
    for a in body.save_aliases:
        parts = [p.strip() for p in a.credit.split(", ") if p.strip()]
        lib.save_alias(credit_key(parts), a.credit, a.to)
    jid = uuid.uuid4().hex[:10]
    job = Job(jid, body, settings)
    JOBS[jid] = job
    threading.Thread(target=_run_job, args=(job,), daemon=True, name=f"job-{jid}").start()
    return job.snapshot()


@app.get("/api/jobs/{jid}")
def get_job(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "no such job")
    return job.snapshot()


@app.get("/api/jobs/{jid}/tracks/{tid}/versions")
def track_versions(jid: str, tid: str, q: str | None = None):
    """A wider look than the download itself took: both standard queries plus
    a live one, or whatever the user typed, with nothing filtered away."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "no such job")
    raw = next((t for t in job.data.playlist.get("tracks", []) if t["id"] == tid), None)
    if not raw:
        raise HTTPException(404, "no such track in this job")
    dl = _downloader_for(job)
    vid = youtube_id(q) if q else None
    if vid:
        cand = dl.probe(f"https://www.youtube.com/watch?v={vid}")
        return {"candidates": [cand.to_dict()] if cand else []}
    ranked = dl.search_wide(raw["title"], list(raw["artists"]),
                            (raw.get("duration_ms") or 0) / 1000 or None, query=q)
    return {"candidates": [c.to_dict() for c in ranked[:12]]}


@app.post("/api/jobs/{jid}/tracks/{tid}/version")
def choose_version(jid: str, tid: str, body: VersionIn):
    """Download this track again from a different YouTube upload, and remember
    the choice: the same track in a later playlist goes straight to it."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "no such job")
    pl = job.data.playlist
    raw = next((t for t in pl.get("tracks", []) if t["id"] == tid), None)
    if not raw:
        raise HTTPException(404, "no such track in this job")
    source = pl.get("source") or "spotify"
    lib.save_choice(source, tid, body.video_id, body.title, body.duration)
    if job.main_done:
        job.cancel.clear()          # the main pass is over; this is a fresh ask
    cand = Candidate(id=body.video_id, url=f"https://www.youtube.com/watch?v={body.video_id}",
                     title=body.title or "", duration=body.duration)
    with job.lock:
        job.reruns += 1
    job.status = "running"
    job.set_track(tid, status="queued", progress=0, error=None, file=None, chosen=cand.id)
    threading.Thread(target=_rerun_one, args=(job, pl, raw, cand), daemon=True,
                     name=f"rerun-{jid}-{tid[:6]}").start()
    return job.snapshot()


@app.delete("/api/choices/{source}/{tid}")
def forget_version(source: str, tid: str):
    lib.forget_choice(source, tid)
    return {"ok": True}


@app.post("/api/jobs/{jid}/cancel")
def cancel_job(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "no such job")
    job.cancel.set()
    return {"ok": True}


@app.get("/api/jobs/{jid}/events")
async def job_events(jid: str, since: int = 0):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "no such job")

    async def gen():
        idx = since
        yield f"data: {json.dumps({'type': 'snapshot', **job.snapshot()})}\n\n"
        while True:
            def wait_new():
                with job.cond:
                    job.cond.wait_for(lambda: len(job.events) > idx, timeout=15)
                    return list(job.events[idx:])
            new = await asyncio.to_thread(wait_new)
            if not new:
                yield ": ping\n\n"
                continue
            for ev in new:
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            idx += len(new)
            if job.status != "running" and idx >= len(job.events):
                yield f"data: {json.dumps({'type': 'end', **job.snapshot()})}\n\n"
                return

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"cache-control": "no-cache", "x-accel-buffering": "no"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("SD_PORT", 8765)))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    print(f"BACKEND_READY port={args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
