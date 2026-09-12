"""One-off backfill: fix stories stuck invisible in the feed due to NULL published_at.

Root cause (fixed in services/ingestion.py / services/db.py going forward):
APITube occasionally returned a missing/unparseable publishedDate, which was
inserted as published_at = NULL. The feed query used `published_at >= $1`,
and under SQL NULL semantics `NULL >= anything` is never true, so those rows
were silently excluded from every feed request forever.

This script finds existing rows with published_at IS NULL and backfills
published_at to created_at (their actual ingestion time) so they sort and
filter correctly. Also reports rows that are NULL/expired for visibility.

Usage:
  python3 scripts/backfill_published_at.py            # dry run, reports only
  python3 scripts/backfill_published_at.py --apply     # actually updates rows

Requires DATABASE_URL in the environment (same as the API server). When run
from outside Railway's private network (DATABASE_URL points at a
*.railway.internal host, unreachable from a local machine), falls back to
DATABASE_PUBLIC_URL if that's set instead.
"""
from __future__ import annotations

import asyncio
import os
import sys

import asyncpg


async def main(apply: bool) -> None:
    dsn = os.environ.get("DATABASE_URL", "")
    public_dsn = os.environ.get("DATABASE_PUBLIC_URL", "")
    if not dsn and not public_dsn:
        print("DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    if ".railway.internal" in dsn and public_dsn:
        dsn = public_dsn

    conn = await asyncpg.connect(dsn)
    try:
        null_rows = await conn.fetch(
            "SELECT id, title, created_at, expires_at FROM stories "
            "WHERE published_at IS NULL ORDER BY created_at DESC"
        )
        expired_rows = await conn.fetch(
            "SELECT id, title, published_at, expires_at FROM stories "
            "WHERE published_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= NOW() "
            "ORDER BY published_at DESC LIMIT 20"
        )

        print(f"Stories with published_at IS NULL: {len(null_rows)}")
        for r in null_rows[:20]:
            print(f"  {r['id']}  created_at={r['created_at']}  {r['title'][:60] if r['title'] else ''!r}")
        if len(null_rows) > 20:
            print(f"  ... and {len(null_rows) - 20} more")

        print(f"\nStories already expired (expires_at <= now, shown for context, not touched): {len(expired_rows)}")
        for r in expired_rows[:10]:
            print(f"  {r['id']}  published_at={r['published_at']}  expires_at={r['expires_at']}")

        if not null_rows:
            print("\nNothing to backfill.")
            return

        if not apply:
            print(f"\nDry run — would set published_at = created_at for {len(null_rows)} row(s).")
            print("Re-run with --apply to write the change.")
            return

        result = await conn.execute(
            "UPDATE stories SET published_at = created_at WHERE published_at IS NULL"
        )
        print(f"\nUpdated: {result}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
