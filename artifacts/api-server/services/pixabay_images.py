"""Pixabay image search + download for story photos.

Pixabay terms that shape this module (pixabay.com/api/docs and the
Content License, reviewed 2026-11-08):
- Commercial use is allowed and attribution is not required by the
  license; the API terms still ask that Pixabay be shown as the
  source, so stories carry the photographer's name and the photo's
  Pixabay page as their credit.
- Permanent hotlinking of Pixabay URLs is NOT allowed — the chosen
  image is downloaded once at ingestion and hosted from CRRNT's own
  storage (services/image_storage.py). The webformatURL previews
  expire after 24 hours, which is another reason nothing stored on a
  story may point at Pixabay's CDN.
- Rate limit is 100 requests per 60 seconds per key — far above
  ingestion's handful of searches per day. API responses must be
  cached 24h; ingestion uses each result immediately and stores the
  image, so no response is ever re-fetched.
- Full-resolution imageURL requires separate Pixabay approval;
  largeImageURL (1280px) is the standard field and is what we use,
  falling back to webformatURL (640px).

API failures raise; the caller (services/story_images.py) treats any
failure as "no image" and never lets it break an ingestion run.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger("crrnt.pixabay")

PIXABAY_API = "https://pixabay.com/api/"

_MIN_BYTES = 10_000        # anything smaller is an error page or a stub
_MAX_BYTES = 10_000_000


def _api_key() -> str:
    return os.environ.get("PIXABAY_API_KEY", "")


def is_configured() -> bool:
    return bool(_api_key())


async def search_photo(query: str) -> Optional[dict[str, Any]]:
    """Top photo for a subject query, normalized to a hit dict:
    {"download_url", "credit_name", "credit_url"}. None when the key
    is missing or the search returns nothing usable."""
    if not _api_key():
        log.warning("Pixabay search skipped — PIXABAY_API_KEY not set")
        return None
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            PIXABAY_API,
            params={
                "key": _api_key(),
                "q": query,
                "image_type": "photo",
                "orientation": "horizontal",
                "safesearch": "true",
                "per_page": 5,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    for hit in data.get("hits") or []:
        download_url = hit.get("largeImageURL") or hit.get("webformatURL")
        if not download_url:
            continue
        return {
            "download_url": download_url,
            "credit_name": hit.get("user") or "Pixabay",
            "credit_url": hit.get("pageURL") or "https://pixabay.com/",
        }
    return None


async def download(url: str) -> Optional[bytes]:
    """Fetch an image's bytes for re-hosting. None on an implausible
    payload (error page, stub, oversized file)."""
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    content_type = resp.headers.get("content-type", "")
    body = resp.content
    if not content_type.startswith("image/"):
        log.warning("Pixabay download was not an image (%s)", content_type)
        return None
    if not _MIN_BYTES <= len(body) <= _MAX_BYTES:
        log.warning("Pixabay download size implausible: %d bytes", len(body))
        return None
    return body
