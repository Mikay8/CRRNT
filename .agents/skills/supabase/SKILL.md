---
name: supabase
description: Supabase setup, schema changes, RLS policies, queries, and migrations for the CRRNT project. Use when adding tables, modifying schema, running SQL, debugging Supabase auth/RLS, or interacting with Supabase storage.
---

# Supabase — CRRNT Project

## Project Details

- **Project URL**: `SUPABASE_URL` env var → `https://gdgqbneacjirwlkbgnyb.supabase.co`
- **Service key**: `SUPABASE_SERVICE_KEY` — bypasses all RLS, used by the Python backend
- **Anon key**: `SUPABASE_ANON_KEY` — used by the Expo frontend (respects RLS)
- **Dashboard**: https://supabase.com/dashboard/project/gdgqbneacjirwlkbgnyb

## Schema (current tables)

| Table | Purpose |
|---|---|
| `users` | App users — tier (free/paid), subscription_status, onboarding_complete |
| `user_preferences` | Onboarding quiz answers (job_type, housing_status, city, interests, etc.) |
| `stories` | News stories with enrichment (summary, life_impact, wallet_impact, tts_url, sentiment_*) |
| `story_audio` | Raw MP3 bytes for stories (BYTEA) |
| `saved_stories` | User ↔ story saves (unique constraint on user_id+story_id) |
| `breaking_news` | Breaking alerts with 6-hour default expiry |
| `ingestion_logs` | One row per ingestion run (stories_fetched, enriched, tts_generated, errors, status) |
| `push_tokens` | Expo push tokens — no RLS, backend-only writes |

## Running Migrations

**Direct TCP to Supabase PostgreSQL is blocked in this environment.**

To run migrations:
1. Go to https://supabase.com/dashboard/project/gdgqbneacjirwlkbgnyb/sql
2. Paste the SQL and click Run

The full migration file is at `artifacts/api-server/migrations.sql`.

## Checking Tables from Code

```python
import os, urllib.request, json

url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_SERVICE_KEY']

for tbl in ['users', 'stories', 'saved_stories']:
    r = urllib.request.Request(
        f'{url}/rest/v1/{tbl}?select=count&limit=1',
        headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Prefer': 'count=exact'},
    )
    try:
        resp = urllib.request.urlopen(r, timeout=5)
        print(f'✅ {tbl}')
    except urllib.error.HTTPError as e:
        print(f'❌ {tbl}:', e.read()[:80])
```

## Backend Client (artifacts/api-server/services/db.py)

Uses `supabase-py` with the service role key. Key methods:

```python
from services.db import db

db.get_stories(category=None, tier=None, limit=20)
db.get_story(story_id)
db.upsert_story(story_dict)       # uses external_id as conflict key
db.get_user(user_id)
db.upsert_user(user_dict)
db.get_saved_stories(user_id)
db.save_story(user_id, story_id)
db.unsave_story(user_id, story_id)
db.count_stories(tier=None)
db.count_users(tier=None)
db.get_active_breaking_news()
db.create_breaking_news(headline, link, expires_hours)
db.log_ingestion(run)
```

## RLS Summary

- `users` — own row only (`auth.uid() = id`)
- `user_preferences` — own row only
- `stories` — free tier: any authenticated user; paid tier: users with `tier='paid'`
- `saved_stories` — own rows only
- `breaking_news` — read by any authenticated user
- `push_tokens` — no RLS (service role only)
- `ingestion_logs` — no user-facing policy (service role only)

## Auth

Supabase Auth is used for email/password. The backend issues its **own JWT** (via `python-jose`) on top of Supabase auth — this decouples app sessions from Supabase sessions.

Auth flow:
1. `POST /api/auth/register` — creates Supabase auth user + inserts row in `users` table
2. `POST /api/auth/login` — verifies via Supabase Auth, returns signed app JWT
3. `GET /api/auth/me` — verifies app JWT, returns user profile

JWT secret: `SESSION_SECRET` env var.

## Storage

Bucket: `story-audio` (public)
- Create via Supabase dashboard → Storage → New bucket → name: `story-audio`, Public: ON
- Or SQL: `INSERT INTO storage.buckets (id, name, public) VALUES ('story-audio', 'story-audio', true);`
- Fish Audio TTS MP3s are uploaded here; `tts_url` in `stories` table points to the public URL

## Adding a New Table

1. Write `ALTER TABLE` / `CREATE TABLE` SQL in `artifacts/api-server/migrations.sql`
2. Add a helper method to `artifacts/api-server/services/db.py`
3. Remind the user to run the new SQL in the Supabase SQL editor (TCP is blocked here)
4. Verify with the Python check snippet above

## Common Issues

- **"relation does not exist"** — migrations haven't been run; send the user to SQL editor
- **403 on REST API** — RLS blocking; make sure service key header is `Authorization: Bearer <service_key>` AND `apikey: <service_key>`
- **JWT expired** — `SESSION_SECRET` mismatch or token TTL too short (default 7 days in auth.py)
- **Direct TCP blocked** — psycopg2 direct connection doesn't work in Replit sandbox; use REST API or SQL editor
