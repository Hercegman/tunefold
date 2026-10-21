"""Writing tags and cover art to mp3 / m4a / flac / opus / wav (mutagen).

The artist credit as the source printed it goes into a custom ORIGINAL_ARTISTS
tag, so folding an artist name never destroys what Spotify, Deezer or Apple
Music actually said.
"""
from __future__ import annotations

import logging
import os

import mutagen
import requests
from mutagen.easyid3 import EasyID3
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TXXX
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggopus import OggOpus

log = logging.getLogger(__name__)


def fetch_cover(url: str | None) -> bytes | None:
    if not url:
        return None
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        return r.content
    except Exception as exc:  # noqa: BLE001
        log.debug("cover %s: %s", url, exc)
        return None


def read_cover(path: str) -> tuple[bytes, str] | None:
    """The cover art already inside the file, so the player needs no network
    and works for everything downloaded before there was a player."""
    ext = path.rsplit(".", 1)[-1].lower()
    try:
        if ext == "mp3":
            for frame in ID3(path).getall("APIC"):
                return frame.data, frame.mime or _mime(frame.data)
        elif ext == "m4a":
            for art in (MP4(path).get("covr") or []):
                return bytes(art), "image/png" if art.imageformat == MP4Cover.FORMAT_PNG else "image/jpeg"
        elif ext == "flac":
            for pic in FLAC(path).pictures:
                return pic.data, pic.mime or _mime(pic.data)
        elif ext == "opus":
            import base64
            from mutagen.flac import Picture as FlacPicture
            for blob in (OggOpus(path).get("metadata_block_picture") or []):
                pic = FlacPicture(base64.b64decode(blob))
                return pic.data, pic.mime or _mime(pic.data)
    except Exception as exc:  # noqa: BLE001
        log.debug("cover in %s: %s", path, exc)
    return None


def read_meta(path: str) -> dict:
    """Title, artist and album as the file itself carries them.

    For a file Tunefold downloaded the library already knows all of this; this
    is for the ones the user opened from the desktop, where the tags - and
    failing those, the file name - are the only description there is.
    """
    stem = os.path.splitext(os.path.basename(path))[0]
    meta = {"title": stem, "artist": _artist_from_name(stem), "album": None, "duration": None}
    try:
        f = mutagen.File(path, easy=True)
    except Exception as exc:  # noqa: BLE001
        log.debug("tags in %s: %s", path, exc)
        return meta
    if f is None:
        return meta
    tags = f.tags or {}

    def first(*keys) -> str | None:
        for k in keys:
            v = tags.get(k)
            if isinstance(v, list):
                v = v[0] if v else None
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    meta["title"] = first("title") or stem
    meta["artist"] = first("artist", "albumartist", "performer") or meta["artist"]
    meta["album"] = first("album")
    length = getattr(getattr(f, "info", None), "length", None)
    if isinstance(length, (int, float)) and length > 0:
        meta["duration"] = round(float(length), 3)
    return meta


def _artist_from_name(stem: str) -> str:
    """"Artist - Title" is how most loose files are named, including the ones
    Tunefold writes, so the dash is worth a guess before giving up."""
    for sep in (" - ", " – ", " — "):
        if sep in stem:
            left = stem.split(sep, 1)[0].strip()
            if left:
                return left
    return "Unknown artist"


def _mime(data: bytes) -> str:
    return "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"


def write_tags(path: str, *, title: str, artist: str, album: str | None, date: str | None,
               track_no: int | None, original_credit: str, cover: bytes | None) -> None:
    ext = path.rsplit(".", 1)[-1].lower()
    if ext == "mp3":
        try:
            a = EasyID3(path)
        except Exception:  # noqa: BLE001
            ID3().save(path)
            a = EasyID3(path)
        a["title"] = title
        a["artist"] = artist
        a["albumartist"] = artist
        if album:
            a["album"] = album
        if date:
            a["date"] = date[:4]
        if track_no:
            a["tracknumber"] = str(track_no)
        a.save(v2_version=3)
        id3 = ID3(path)
        id3.add(TXXX(encoding=1, desc="ORIGINAL_ARTISTS", text=original_credit))
        if cover:
            id3.add(APIC(encoding=1, mime=_mime(cover), type=3, desc="Cover", data=cover))
        id3.update_to_v23()
        id3.save(v2_version=3)
    elif ext == "m4a":
        a = MP4(path)
        a["\xa9nam"] = title
        a["\xa9ART"] = artist
        a["aART"] = artist
        if album:
            a["\xa9alb"] = album
        if date:
            a["\xa9day"] = date[:4]
        if track_no:
            a["trkn"] = [(track_no, 0)]
        a["----:com.apple.iTunes:ORIGINAL_ARTISTS"] = original_credit.encode()
        if cover:
            fmt = MP4Cover.FORMAT_PNG if _mime(cover) == "image/png" else MP4Cover.FORMAT_JPEG
            a["covr"] = [MP4Cover(cover, imageformat=fmt)]
        a.save()
    elif ext in ("flac", "opus"):
        a = FLAC(path) if ext == "flac" else OggOpus(path)
        a["title"] = title
        a["artist"] = artist
        a["albumartist"] = artist
        if album:
            a["album"] = album
        if date:
            a["date"] = date[:4]
        if track_no:
            a["tracknumber"] = str(track_no)
        a["original_artists"] = original_credit
        if cover:
            pic = Picture()
            pic.type = 3
            pic.mime = _mime(cover)
            pic.data = cover
            if ext == "flac":
                a.clear_pictures()
                a.add_picture(pic)
            else:
                import base64
                a["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
        a.save()
    else:
        log.info("format %s does not support tags, skipping", ext)
