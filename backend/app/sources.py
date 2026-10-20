"""Which catalogue a pasted link belongs to.

Each source exposes the same three things - matches(url), fetch(url) and
enrich(tracks) - so everything downstream (artist folding, the downloader, the
tag writer) is written once against models.Track.
"""
from __future__ import annotations

from .applemusic import AppleMusicClient
from .deezer import DeezerClient
from .models import SourceError
from .spotify import SpotifyClient

SOURCES = {c.NAME: c for c in (SpotifyClient(), DeezerClient(), AppleMusicClient())}
LABELS = {name: client.LABEL for name, client in SOURCES.items()}
DEFAULT = "spotify"


def for_url(url: str):
    """-> (name, client). Raises SourceError with every accepted link listed."""
    for name, client in SOURCES.items():
        if client.matches(url):
            return name, client
    raise SourceError(
        "Unrecognised link. Tunefold takes a playlist, album or track from "
        "Spotify (open.spotify.com), Deezer (deezer.com) or Apple Music (music.apple.com)."
    )


def get(name: str | None):
    """The client a stored playlist came from; Spotify for rows saved before
    Tunefold had more than one source."""
    return SOURCES.get(name or DEFAULT) or SOURCES[DEFAULT]
