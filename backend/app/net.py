"""One retrying HTTP helper shared by every metadata source."""
from __future__ import annotations

import logging
import time

import requests

from .models import SourceError

log = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0.0.0 Safari/537.36")


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"user-agent": UA, "accept-language": "en-US,en;q=0.9"})
    return s


def get(session: requests.Session, url: str, *, label: str, attempts: int = 4, **kw) -> requests.Response:
    """GET with backoff on timeouts, connection errors and 429."""
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            r = session.get(url, timeout=30, **kw)
        except (requests.Timeout, requests.ConnectionError) as exc:
            last = exc
            time.sleep(1.5 ** attempt)
            continue
        if r.status_code == 429:
            wait = float(r.headers.get("retry-after", 2 + attempt * 2))
            log.warning("%s 429, waiting %.0fs", label, wait)
            time.sleep(min(wait, 30))
            continue
        return r
    raise SourceError(f"Network error talking to {label}: {last}")


def html(r: requests.Response) -> str:
    """Page text, decoded as UTF-8 unless the server actually said otherwise.

    requests falls back to ISO-8859-1 for a text/* response with no charset in
    the Content-Type (RFC 2616), and music.apple.com sends exactly that - which
    turns every apostrophe and every diacritic into mojibake.
    """
    if not r.encoding or "charset" not in (r.headers.get("content-type") or "").lower():
        r.encoding = "utf-8"
    return r.text


def check(r: requests.Response, *, label: str) -> None:
    """Turn the usual HTTP failures into messages worth showing the user."""
    if r.status_code in (401, 403):
        raise SourceError(f"{label} refused access. The playlist is private or unavailable.")
    if r.status_code == 404:
        raise SourceError(f"{label} says this content does not exist.")
    if r.status_code != 200:
        raise SourceError(f"{label} returned HTTP {r.status_code}.")
