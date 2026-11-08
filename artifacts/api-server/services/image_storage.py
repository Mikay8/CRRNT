"""S3-compatible object storage for story images downloaded from Pixabay.

Pixabay's license does not allow permanent hotlinking of its image
URLs, so ingestion downloads the chosen photo once and stores it here;
the object key is the story id so cleanup can delete it by id alone.
The bucket is private (no public bucket URLs) — reads go through
presigned GET URLs generated on demand, exactly like story audio.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Optional

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

log = logging.getLogger("crrnt.image_storage")

_KEY_PREFIX = "story-images"

# Serving performance: story photos are immutable per story in
# practice (a replacement overwrites the same key), so both the
# stored object and its presigned GET responses carry a day of
# cache headers — repeat views then come from the browser's cache
# instead of re-downloading 100-500KB every time.
RESPONSE_CACHE_CONTROL = "public, max-age=86400"
# A presigned URL must stay valid FAR longer than the /image
# redirect is cached for (see routes/stories.py): a browser holding
# a cached redirect must never follow it to an expired signature.
PRESIGNED_URL_TTL_SECONDS = 86400
REDIRECT_CACHE_SECONDS = 300


@lru_cache(maxsize=1)
def _client():
    endpoint = os.environ.get("S3_ENDPOINT")
    if not endpoint:
        return None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("S3_REGION") or "auto",
        config=BotoConfig(signature_version="s3v4"),
    )


def _bucket() -> Optional[str]:
    return os.environ.get("S3_BUCKET")


def _key(story_id: str) -> str:
    return f"{_KEY_PREFIX}/{story_id}.jpg"


def story_image_key(story_id: str) -> str:
    return _key(story_id)


def is_configured() -> bool:
    return bool(_client() and _bucket())


def upload_story_image(story_id: str, image_bytes: bytes) -> Optional[str]:
    """Upload JPEG bytes for a story, return the object key, or None if
    storage isn't configured or the upload fails."""
    client = _client()
    bucket = _bucket()
    if not client or not bucket:
        log.warning("S3 not configured — skipping image upload for story %s", story_id)
        return None

    key = _key(story_id)
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=image_bytes,
            ContentType="image/jpeg",
            CacheControl=RESPONSE_CACHE_CONTROL,
        )
    except ClientError as exc:
        log.warning("S3 image upload failed for story %s: %s", story_id, exc)
        return None

    return key


def presigned_image_url(key: str, expires_in: int = PRESIGNED_URL_TTL_SECONDS) -> Optional[str]:
    """Generate a time-limited GET URL for a stored image object key.
    The response carries cache headers (ResponseCacheControl) so a
    browser can reuse the downloaded bytes for the URL's lifetime."""
    client = _client()
    bucket = _bucket()
    if not client or not bucket or not key:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ResponseCacheControl": RESPONSE_CACHE_CONTROL,
            },
            ExpiresIn=expires_in,
        )
    except ClientError as exc:
        log.warning("Failed to presign image URL for key %s: %s", key, exc)
        return None


def delete_story_image(story_id: str) -> None:
    client = _client()
    bucket = _bucket()
    if not client or not bucket:
        return
    try:
        client.delete_object(Bucket=bucket, Key=_key(story_id))
    except ClientError as exc:
        log.warning("S3 image delete failed for story %s: %s", story_id, exc)
