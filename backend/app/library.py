"""SQLite: settings, artist aliases, download history, collections."""
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
    "check_updates": True,          # look for a new release when the app starts
}


def data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    p = Path(base) / "tunefold"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _unlink(path: str) -> None:
    """On Windows a file the player was just streaming can stay locked for a
    moment after the stream closes, so give it a few tries before giving up."""
    for attempt in range(5):
        try:
            os.remove(path)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


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
            CREATE TABLE IF NOT EXISTS track_choices(
                source TEXT NOT NULL, track_id TEXT NOT NULL, video_id TEXT NOT NULL, title TEXT,
                duration REAL, created REAL NOT NULL, PRIMARY KEY(source, track_id));
            CREATE TABLE IF NOT EXISTS collections(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS collection_items(
                collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                file TEXT NOT NULL, added REAL NOT NULL, PRIMARY KEY(collection_id, file));
            """)
            # Tunefold 0.2 knew only Spotify, so rows without a source are Spotify's.
            # Track ids are only unique per source (Deezer and Apple both number theirs).
            self._add_column("downloads", "source", "TEXT NOT NULL DEFAULT 'spotify'")
            self._add_column("recent", "source", "TEXT NOT NULL DEFAULT 'spotify'")

    def _add_column(self, table: str, column: str, decl: str) -> None:
        have = {r["name"] for r in self._conn.execute(f"PRAGMA table_info({table})")}
        if column not in have:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

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
                "INSERT OR REPLACE INTO downloads(track_id,source,playlist_id,title,artist,credit,album,file,created) "
                "VALUES(:track_id,:source,:playlist_id,:title,:artist,:credit,:album,:file,:created)",
                {"playlist_id": None, "album": None, "source": "spotify", "created": time.time(), **row})

    def have(self, track_ids: list[str], source: str = "spotify") -> dict[str, str]:
        """track_id -> existing file (only if it is still on disk)."""
        if not track_ids:
            return {}
        q = ",".join("?" * len(track_ids))
        out = {}
        for r in self._conn.execute(
                f"SELECT track_id, file FROM downloads WHERE source=? AND track_id IN ({q})",
                [source, *track_ids]):
            if os.path.exists(r["file"]):
                out[r["track_id"]] = r["file"]
        return out

    # chosen YouTube uploads
    def choice(self, source: str, track_id: str) -> dict | None:
        """The upload the user picked by hand for this track, if any."""
        r = self._conn.execute("SELECT video_id, title, duration FROM track_choices WHERE source=? AND track_id=?",
                               (source, track_id)).fetchone()
        return dict(r) if r else None

    def save_choice(self, source: str, track_id: str, video_id: str, title: str | None, duration: float | None) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT OR REPLACE INTO track_choices VALUES(?,?,?,?,?,?)",
                               (source, track_id, video_id, title, duration, time.time()))

    def forget_choice(self, source: str, track_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM track_choices WHERE source=? AND track_id=?", (source, track_id))

    def stats(self) -> dict:
        """Totals for the home screen. Counts rows, not files on disk."""
        row = self._conn.execute(
            "SELECT COUNT(*) AS tracks, COUNT(DISTINCT artist) AS artists, "
            "COUNT(DISTINCT playlist_id) AS playlists, MAX(created) AS last FROM downloads").fetchone()
        aliases = self._conn.execute("SELECT COUNT(*) AS n FROM aliases").fetchone()["n"]
        return {"tracks": row["tracks"] or 0, "artists": row["artists"] or 0,
                "playlists": row["playlists"] or 0, "aliases": aliases or 0, "last": row["last"]}

    def collection(self) -> list[dict]:
        """Everything still on disk, filed under the folded artist name - the
        canonical one the user confirmed, not the credit the source printed."""
        rows = self._conn.execute(
            "SELECT track_id, source, title, artist, credit, album, file, created FROM downloads "
            "ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, created").fetchall()
        member: dict[str, list[int]] = {}
        for r in self._conn.execute("SELECT collection_id, file FROM collection_items ORDER BY added"):
            member.setdefault(r["file"], []).append(r["collection_id"])
        out, seen = [], set()
        for r in rows:
            if r["file"] in seen or not os.path.exists(r["file"]):
                continue
            seen.add(r["file"])
            out.append({**dict(r), "collections": member.get(r["file"], [])})
        return out

    def has_file(self, path: str) -> bool:
        """Whether this exact path is something Tunefold downloaded. The audio
        and cover endpoints serve nothing that is not in here."""
        return self._conn.execute("SELECT 1 FROM downloads WHERE file=? LIMIT 1", (path,)).fetchone() is not None

    def downloads(self, limit: int = 500) -> list[dict]:
        rows = self._conn.execute("SELECT * FROM downloads ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def delete_files(self, files: list[str]) -> dict:
        """Delete downloaded files from disk and forget them. Only paths in the
        download history are touched, so this can never reach anything else."""
        deleted, failed = [], {}
        for f in files:
            if not self.has_file(f):
                failed[f] = "not in your collection"
                continue
            try:
                _unlink(f)
            except OSError as exc:
                failed[f] = str(exc)
                continue
            with self._lock, self._conn:
                self._conn.execute("DELETE FROM downloads WHERE file=?", (f,))
                self._conn.execute("DELETE FROM collection_items WHERE file=?", (f,))
            deleted.append(f)
        return {"deleted": deleted, "failed": failed}

    # collections: the user's own groupings. They point at files and own none
    # of them - dropping a collection, or a track from one, leaves the file be.
    def collections(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT c.id, c.name, c.created, COUNT(i.file) AS count FROM collections c "
            "LEFT JOIN collection_items i ON i.collection_id = c.id "
            "GROUP BY c.id ORDER BY c.name COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]

    def collection_exists(self, cid: int) -> bool:
        return self._conn.execute("SELECT 1 FROM collections WHERE id=?", (cid,)).fetchone() is not None

    def create_collection(self, name: str) -> dict:
        now = time.time()
        with self._lock, self._conn:
            cur = self._conn.execute("INSERT INTO collections(name, created) VALUES(?,?)", (name, now))
        return {"id": cur.lastrowid, "name": name, "created": now, "count": 0}

    def rename_collection(self, cid: int, name: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE collections SET name=? WHERE id=?", (name, cid))

    def delete_collection(self, cid: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM collection_items WHERE collection_id=?", (cid,))
            self._conn.execute("DELETE FROM collections WHERE id=?", (cid,))

    def add_to_collection(self, cid: int, files: list[str]) -> None:
        now = time.time()
        with self._lock, self._conn:
            for f in files:
                if self._conn.execute("SELECT 1 FROM downloads WHERE file=? LIMIT 1", (f,)).fetchone():
                    self._conn.execute("INSERT OR IGNORE INTO collection_items VALUES(?,?,?)", (cid, f, now))

    def remove_from_collection(self, cid: int, files: list[str]) -> None:
        with self._lock, self._conn:
            self._conn.executemany("DELETE FROM collection_items WHERE collection_id=? AND file=?",
                                   [(cid, f) for f in files])

    def move_between(self, src: int, dst: int, files: list[str]) -> None:
        self.add_to_collection(dst, files)
        if src != dst:
            self.remove_from_collection(src, files)

    # recent
    def touch_recent(self, url: str, **meta) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO recent(url,kind,name,owner,cover_url,total,seen,source) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (url, meta.get("kind"), meta.get("name"), meta.get("owner"), meta.get("cover_url"),
                 meta.get("total"), time.time(), meta.get("source") or "spotify"))

    def recent(self, limit: int = 12) -> list[dict]:
        return [dict(r) for r in self._conn.execute("SELECT * FROM recent ORDER BY seen DESC LIMIT ?", (limit,))]
