"""Per-story image lookup, dispatched on the configured provider.

The owner picks the provider in admin Settings (ingest_config
``image_source``: "unsplash" or "pixabay"). Either way the image is
searched by the story's SUBJECT — Claude Pass 1 returns an
``imageQuery`` (concrete visual subject, never a person's name) — so
the photo matches what the story is about instead of being a generic
category picture.

Provider rules differ and are honored here:
- Unsplash: images are hotlinked (their terms require it) and each
  use triggers the photo's download_location. Requires Production
  approval before a public app may rely on it.
- Pixabay: hotlinking is not allowed, so the chosen photo is
  downloaded once and hosted from CRRNT's own S3 bucket
  (services/image_storage.py); the story's media_url points at the
  API's /api/stories/{id}/image redirect.

Fallbacks keep ingestion unbreakable: a failed or empty subject
search falls back to the generic category query (Unsplash: the
existing per-category pool), and any failure at all degrades to no
image — the app renders its bundled category art. Nothing in this
module raises into the ingestion loop.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from services import image_storage, pixabay_images, unsplash_pool

log = logging.getLogger("crrnt.story_images")


def _public_base() -> Optional[str]:
    """Public base URL of this API, used to build the stable image URL
    stored on Pixabay-sourced stories. API_PUBLIC_BASE wins; Railway
    injects RAILWAY_PUBLIC_DOMAIN for services with a public domain."""
    base = (os.environ.get("API_PUBLIC_BASE") or "").rstrip("/")
    if base:
        return base
    domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN") or ""
    if domain:
        return f"https://{domain}"
    return None


async def find_for_story(
    provider: str,
    query: Optional[str],
    category: Optional[str],
) -> Optional[dict[str, Any]]:
    """Search the configured provider for this story's image.

    Returns a normalized hit or None:
      unsplash: {"kind", "image_url", "photographer_name",
                 "photographer_url", "download_location", "pool_id"}
      pixabay:  {"kind", "download_url", "credit_name", "credit_url"}
    """
    if provider == "pixabay":
        return await _find_pixabay(query, category)
    return await _find_unsplash(query, category)


async def _find_unsplash(
    query: Optional[str], category: Optional[str]
) -> Optional[dict[str, Any]]:
    # Subject search first: a topical photo beats a generic pool one.
    if query and unsplash_pool._api_key():
        try:
            results = await unsplash_pool.search_photos(query)
            if results:
                top = results[0]
                return {
                    "kind": "unsplash",
                    "image_url": top["image_url"],
                    "photographer_name": top["photographer_name"],
                    "photographer_url": top["photographer_url"],
                    "download_location": top.get("download_location") or "",
                    "pool_id": None,
                }
            log.info("Unsplash subject search empty for %r — pool fallback", query)
        except Exception as exc:
            log.warning("Unsplash subject search failed for %r: %s", query, exc)
    # Generic per-category pool (the pre-existing behaviour).
    pool_img = await unsplash_pool.pick_for_story(category)
    if pool_img:
        return {
            "kind": "unsplash",
            "image_url": pool_img["image_url"],
            "photographer_name": pool_img["photographer_name"],
            "photographer_url": pool_img["photographer_url"],
            "download_location": pool_img.get("download_location") or "",
            "pool_id": pool_img["id"],
        }
    return None


async def _find_pixabay(
    query: Optional[str], category: Optional[str]
) -> Optional[dict[str, Any]]:
    # Subject first, then the generic category query — same ladder as
    # Unsplash, minus the pool (Pixabay images are per-story downloads,
    # never shared pool assets).
    candidates = [query] if query else []
    generic = unsplash_pool.CATEGORY_QUERIES.get(category or "")
    if generic and generic not in candidates:
        candidates.append(generic)
    for q in candidates:
        try:
            hit = await pixabay_images.search_photo(q)
        except Exception as exc:
            log.warning("Pixabay search failed for %r: %s", q, exc)
            return None
        if hit:
            return {"kind": "pixabay", **hit}
        log.info("Pixabay search empty for %r", q)
    return None


async def host_pixabay_image(
    story_id: str, hit: dict[str, Any]
) -> Optional[dict[str, Any]]:
    """Download a Pixabay hit into CRRNT storage and build the story's
    image fields. Returns None (story keeps no image) on any failure —
    including a missing public base URL, where a stored URL would be
    broken rather than merely absent."""
    base = _public_base()
    if not base:
        log.warning(
            "Pixabay image for story %s skipped — no API_PUBLIC_BASE / "
            "RAILWAY_PUBLIC_DOMAIN to build the image URL from", story_id,
        )
        return None
    try:
        image_bytes = await pixabay_images.download(hit["download_url"])
    except Exception as exc:
        log.warning("Pixabay download failed for story %s: %s", story_id, exc)
        return None
    if not image_bytes:
        return None
    key = image_storage.upload_story_image(story_id, image_bytes)
    if not key:
        return None
    return {
        "media_url": f"{base}/api/stories/{story_id}/image",
        "credit_name": hit.get("credit_name"),
        "credit_url": hit.get("credit_url"),
    }
