"""One-off backfill: give every existing story a readable slug.

New stories get a slug at insert time (services/db.py via
services/slug.py); rows created before migration 007 have slug NULL.
This script fills them in, oldest first, using the same slugify and
collision rules (slug, then slug-2, slug-3, ...). It only touches
rows whose slug IS NULL, so it is safe to re-run and will never
rename a slug a shared link already points at.

Run migration 007 first (adds the column + unique index).

Usage:
  python3 scripts/backfill_slugs.py            # dry run, reports only
  python3 scripts/backfill_slugs.py --apply    # actually updates rows

Requires DATABASE_URL in the environment (same as the API server).
When run from outside Railway's private network (DATABASE_URL points
at a *.railway.internal host, unreachable from a local machine), falls
back to DATABASE_PUBLIC_URL if that's set instead. For the Supabase
database, use the session-pooler connection string.
"""
from __future__ import annotations

import asyncio
import os
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from services.slug import slugify, suffixed  # noqa: E402


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
        rows = await conn.fetch(
            "SELECT id, title, display_title FROM stories "
            "WHERE slug IS NULL ORDER BY created_at ASC"
        )
        taken = {
            r["slug"]
            for r in await conn.fetch(
                "SELECT slug FROM stories WHERE slug IS NOT NULL"
            )
        }
        print(f"Stories missing a slug: {len(rows)}")
        assigned = 0
        for r in rows:
            base = slugify(r["display_title"] or r["title"]) or "story"
            candidate = base
            n = 2
            while candidate in taken:
                candidate = suffixed(base, n)
                n += 1
            taken.add(candidate)
            assigned += 1
            if assigned <= 20:
                print(f"  {candidate}  <-  {(r['display_title'] or r['title'] or '')[:55]!r}")
            if apply:
                await conn.execute(
                    "UPDATE stories SET slug = $2 WHERE id = $1",
                    r["id"], candidate,
                )
        if len(rows) > 20:
            print(f"  ... and {len(rows) - 20} more")
        print(f"{'Updated' if apply else 'Would update'} {assigned} stories.")
        if not apply:
            print("Dry run only — pass --apply to write.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
