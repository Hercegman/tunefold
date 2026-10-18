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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .artists import TrackCredit, analyze, credit_key
from .downloader import FORMATS, Cancelled, Downloader, ffmpeg_path
from .library import Library
from .spotify import SpotifyClient, SpotifyError, Track
from .tags import fetch_cover, write_tags

log = logging.getLogger("backend")
app = FastAPI(title="Tunefold backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
lib = Library()
spotify = SpotifyClient()

ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
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


def _run_track(job: Job, dl: Downloader, pl: dict, raw: dict) -> None:
    tid = raw["id"]
    if job.cancel.is_set():
        job.set_track(tid, status="cancelled")
        return
    track = Track(id=tid, title=raw["title"], artists=list(raw["artists"]), duration_ms=raw.get("duration_ms"),
                  album=raw.get("album"), release_date=raw.get("release_date"), cover_url=raw.get("cover_url"),
                  position=raw.get("position"))
    artist = job.data.artist_map.get(tid) or track.credit
    job.set_track(tid, status="metadata", artist=artist)
    try:
        # per-track enrichment: cover, album, year (2 HTTP calls)
        try:
            spotify.enrich([track], workers=1)
        except Exception as exc:  # noqa: BLE001
            log.debug("enrich %s: %s", tid, exc)
        folder = _target_folder(job, pl, artist, track.album)
        os.makedirs(folder, exist_ok=True)
        if job.folder is None:
            job.folder = folder if job.settings.get("folder_mode", "playlist") == "playlist" else str(Path(folder).parent if job.settings.get("folder_mode") == "artist-album" else job.settings.get("out_dir"))
        ext = FORMATS[dl.fmt]["ext"]
        stem = _file_stem(job, track.title, artist, track.position)
        dest = os.path.join(folder, f"{stem}.{ext}")
        if os.path.exists(dest):
            job.set_track(tid, status="skipped", file=dest, progress=100)
            lib.record(track_id=tid, playlist_id=pl.get("id"), title=track.title, artist=artist,
                       credit=track.credit, album=track.album, file=dest)
            return
        job.set_track(tid, status="searching")
        cand = dl.search(track.title, track.artists, (track.duration_ms or 0) / 1000 or None)
        if not cand:
            job.set_track(tid, status="failed", error="No reliable YouTube match (title/artist/duration disagree).")
            return
        job.set_track(tid, status="downloading", yt_title=cand.title, yt_url=cand.url)
        tmp_base = os.path.join(folder, f".{stem}.part-{tid[:6]}")
        final = dl.download(cand.url, tmp_base, progress=lambda p: job.set_track(tid, progress=round(p)),
                            on_convert=lambda: job.set_track(tid, status="converting", progress=99))
        job.set_track(tid, status="tagging", progress=99)
        write_tags(final, title=track.title, artist=artist, album=track.album, date=track.release_date,
                   track_no=track.position if job.settings.get("track_numbers") else None,
                   original_credit=track.credit, cover=fetch_cover(track.cover_url or pl.get("cover_url")))
        os.replace(final, dest)
        lib.record(track_id=tid, playlist_id=pl.get("id"), title=track.title, artist=artist,
                   credit=track.credit, album=track.album, file=dest)
        job.set_track(tid, status="done", file=dest, progress=100)
    except Cancelled:
        job.set_track(tid, status="cancelled")
    except Exception as exc:  # noqa: BLE001
        log.warning("track %s '%s': %s", tid, track.title, exc)
        msg = str(exc)
        if "Sign in to confirm" in msg or "bot" in msg.lower():
            msg = "YouTube wants proof you are not a bot. Add a cookies file from your browser in Settings."
        job.set_track(tid, status="failed", error=msg[:300])
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
    dl = Downloader(fmt=job.settings.get("format", "mp3"), quality=str(job.settings.get("quality", "320")),
                    cookies=job.settings.get("cookies") or None, loose=bool(job.settings.get("loose_match")),
                    cancel=job.cancel)
    workers = max(1, min(int(job.settings.get("parallel", 4)), 8, len(todo) or 1))
    with cf.ThreadPoolExecutor(max_workers=workers, thread_name_prefix="dl") as pool:
        list(pool.map(lambda t: _run_track(job, dl, pl, t), todo))
    job.status = "cancelled" if job.cancel.is_set() else "finished"
    job.emit("job", **job.snapshot())


# ---------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": bool(ffmpeg_path()), "version": "0.1.0"}


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


@app.get("/api/library")
def library():
    return lib.downloads()


@app.post("/api/preview")
def preview(body: PreviewIn):
    try:
        pl = spotify.fetch(body.url)
    except SpotifyError as exc:
        raise HTTPException(400, str(exc)) from exc
    lib.touch_recent(body.url, kind=pl.kind, name=pl.name, owner=pl.owner, cover_url=pl.cover_url, total=pl.total)
    analysis = analyze([TrackCredit(t.id, t.title, t.artists) for t in pl.tracks], lib.aliases())
    return {"playlist": pl.to_dict(), "analysis": analysis, "have": lib.have([t.id for t in pl.tracks])}


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
