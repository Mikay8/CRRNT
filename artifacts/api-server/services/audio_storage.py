"""S3-compatible object storage for generated story audio (Railway bucket).

Audio is generated once per story at ingestion time and uploaded here;
the object key is the story id so cleanup can delete it by id alone.
Railway buckets are private (no public bucket URLs) — reads go through
presigned GET URLs generated on demand, not a stored static URL.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Optional

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

log = logging.getLogger("crrnt.audio_storage")

_KEY_PREFIX = "story-audio"


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
    return f"{_KEY_PREFIX}/{story_id}.mp3"


def is_configured() -> bool:
    return bool(_client() and _bucket())


def upload_story_audio(story_id: str, mp3_bytes: bytes) -> Optional[str]:
    """Upload MP3 bytes for a story, return the object key, or None if storage isn't configured."""
    client = _client()
    bucket = _bucket()
    if not client or not bucket:
        log.warning("S3 not configured — skipping audio upload for story %s", story_id)
        return None

    key = _key(story_id)
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=mp3_bytes,
            ContentType="audio/mpeg",
        )
    except ClientError as exc:
        log.warning("S3 upload failed for story %s: %s", story_id, exc)
        return None

    return key


def presigned_audio_url(key: str, expires_in: int = 3600) -> Optional[str]:
    """Generate a time-limited GET URL for a stored audio object key."""
    client = _client()
    bucket = _bucket()
    if not client or not bucket or not key:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )
    except ClientError as exc:
        log.warning("Failed to presign audio URL for key %s: %s", key, exc)
        return None


def delete_story_audio(story_id: str) -> None:
    client = _client()
    bucket = _bucket()
    if not client or not bucket:
        return
    try:
        client.delete_object(Bucket=bucket, Key=_key(story_id))
    except ClientError as exc:
        log.warning("S3 delete failed for story %s: %s", story_id, exc)
