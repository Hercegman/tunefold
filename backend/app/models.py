"""Source-independent metadata model.

Every catalogue source (Spotify, Deezer, Apple Music) parses its own pages or
API into these two dataclasses, so artist folding, the downloader and the tag
writer never need to know where a playlist came from.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field


class SourceError(RuntimeError):
    """Anything the user should read: bad link, private playlist, network."""


@dataclass
class Track:
    id: str
    title: str
    artists: list[str]            # as the source credits them, in order
    duration_ms: int | None = None
    album: str | None = None
    release_date: str | None = None
    cover_url: str | None = None
    position: int | None = None
    playable: bool = True
    source: str = "spotify"

    @property
    def credit(self) -> str:
        return ", ".join(self.artists)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["credit"] = self.credit
        return d


@dataclass
class Playlist:
    id: str
    kind: str                     # playlist | album | track
    name: str
    owner: str | None
    cover_url: str | None
    tracks: list[Track] = field(default_factory=list)
    total: int | None = None
    source: str = "spotify"

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "name": self.name, "owner": self.owner,
            "cover_url": self.cover_url, "total": self.total, "source": self.source,
            "tracks": [t.to_dict() for t in self.tracks],
        }


def split_credit(subtitle: str) -> list[str]:
    """Sources join credited artists with ', '. Split only on that, so names
    like 'Earth, Wind & Fire' survive as far as the source itself keeps them."""
    subtitle = (subtitle or "").replace("\xa0", " ")
    parts = [p.strip() for p in re.split(r",\s+", subtitle) if p.strip()]
    return parts or [subtitle.strip() or "Unknown Artist"]
