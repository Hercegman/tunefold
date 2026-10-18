"""Pisanje tagova i covera u mp3 / m4a / flac / opus / wav (mutagen)."""
from __future__ import annotations

import logging

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
        id3.add(TXXX(encoding=1, desc="SPOTIFY_ARTISTS", text=original_credit))
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
        a["----:com.apple.iTunes:SPOTIFY_ARTISTS"] = original_credit.encode()
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
        a["spotify_artists"] = original_credit
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
        log.info("format %s ne podržava tagove, preskačem", ext)
