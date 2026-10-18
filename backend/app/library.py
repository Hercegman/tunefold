"""SQLite: settings, artist aliases, download history."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

DEFAULT_SETTINGS = {
    "out_dir": str(Path.home() / "Music"),
    "format": "mp3",
    "quality": "320",
    "naming": "artist-title",          # artist-title | title-artist | title
    "track_numbers": False,
    "folder_mode": "playlist",         # playlist | artist | artist-album
    "parallel": 4,
    "loose_match": False,
    "cookies": "",
}


def data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    p = Path(base) / "tunefold"
    p.mkdir(parents=True, exist_ok=True)
    return p


class Library:
    def __init__(self, path: str | None = None):
        self.path = path or str(data_dir() / "library.db")
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self):
        with self._conn:
            self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS aliases(
                credit_key TEXT PRIMARY KEY, credit TEXT NOT NULL, canonical TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS downloads(
                track_id TEXT NOT NULL, playlist_id TEXT, title TEXT, artist TEXT, credit TEXT, album TEXT,
                file TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY(track_id, file));
            CREATE TABLE IF NOT EXISTS recent(
                url TEXT PRIMARY KEY, kind TEXT, name TEXT, owner TEXT, cover_url TEXT, total INTEGER, seen REAL NOT NULL);
            """)

    # settings
    def settings(self) -> dict:
        rows = self._conn.execute("SELECT key, value FROM settings").fetchall()
        s = dict(DEFAULT_SETTINGS)
        for r in rows:
            try:
                s[r["key"]] = json.loads(r["value"])
            except ValueError:
                s[r["key"]] = r["value"]
        return s

    def save_settings(self, patch: dict) -> dict:
        with self._lock, self._conn:
            for k, v in patch.items():
                if k in DEFAULT_SETTINGS:
                    self._conn.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (k, json.dumps(v)))
        return self.settings()

    # aliases
    def aliases(self) -> dict[str, str]:
        return {r["credit_key"]: r["canonical"] for r in self._conn.execute("SELECT credit_key, canonical FROM aliases")}

    def aliases_full(self) -> list[dict]:
        return [dict(r) for r in self._conn.execute("SELECT * FROM aliases ORDER BY canonical")]

    def save_alias(self, credit_key: str, credit: str, canonical: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT OR REPLACE INTO aliases VALUES(?,?,?,?)",
                               (credit_key, credit, canonical, time.time()))

    def delete_alias(self, credit_key: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM aliases WHERE credit_key=?", (credit_key,))

    # downloads
    def record(self, **row) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO downloads(track_id,playlist_id,title,artist,credit,album,file,created) "
                "VALUES(:track_id,:playlist_id,:title,:artist,:credit,:album,:file,:created)",
                {"playlist_id": None, "album": None, "created": time.time(), **row})

    def have(self, track_ids: list[str]) -> dict[str, str]:
        """track_id -> existing file (only if it is still on disk)."""
        if not track_ids:
            return {}
        q = ",".join("?" * len(track_ids))
        out = {}
        for r in self._conn.execute(f"SELECT track_id, file FROM downloads WHERE track_id IN ({q})", track_ids):
            if os.path.exists(r["file"]):
                out[r["track_id"]] = r["file"]
        return out

    def downloads(self, limit: int = 500) -> list[dict]:
        rows = self._conn.execute("SELECT * FROM downloads ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # recent
    def touch_recent(self, url: str, **meta) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT OR REPLACE INTO recent VALUES(?,?,?,?,?,?,?)",
                               (url, meta.get("kind"), meta.get("name"), meta.get("owner"),
                                meta.get("cover_url"), meta.get("total"), time.time()))

    def recent(self, limit: int = 12) -> list[dict]:
        return [dict(r) for r in self._conn.execute("SELECT * FROM recent ORDER BY seen DESC LIMIT ?", (limit,))]
