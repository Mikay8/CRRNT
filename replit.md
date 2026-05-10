# CRRNT

A finance-meets-pop-culture mobile app for young adults. Discover trending news in Celebrity, Entertainment, Tech, Government, Sports, Business, and Science — every story is paired with a relevant stock ticker, an AI market insight ("How does it stocks?"), a personal impact analysis ("How does it affect me?"), a social sentiment summary ("What are people saying?"), a price chart, and audio playback.

## Admin Portal

Login at `/admin/dashboard` with HTTP Basic Auth:
- **Username**: `ADMIN_USERNAME` secret
- **Password**: `ADMIN_PASSWORD` secret

Features: live ingestion status, story browser, user list, breaking news editor, settings + env check, manual ingestion trigger.

## Running Locally

### Prerequisites

- Node.js 20+ and pnpm 9+
- Python 3.11+
- Expo Go app on your phone (iOS or Android) — or a simulator

### 1. Clone and install dependencies

```bash
pnpm install
pip install -r artifacts/api-server/requirements.txt
```

### 2. Set environment variables

Create a `.env` file in `artifacts/api-server/` (never commit this):

```env
SUPABASE_URL=https://gdgqbneacjirwlkbgnyb.supabase.co
SUPABASE_SERVICE_KEY=<your service role key>
SUPABASE_ANON_KEY=<your anon key>
ANTHROPIC_API_KEY=<your anthropic key>
NEWSMESH_API_KEY=<your newsmesh key>
XAPI_KEY=<your getxapi key>
SESSION_SECRET=<any long random string>
ADMIN_USERNAME=<your choice>
ADMIN_PASSWORD=<your choice>
REVENUECAT_API_KEY=<your revenuecat key>
PORT=8080
```

Create a `.env.local` in `artifacts/crrnt/`:

```env
EXPO_PUBLIC_API_BASE=http://localhost:8080
```

### 3. Run the database migrations

Go to your [Supabase SQL Editor](https://supabase.com/dashboard/project/gdgqbneacjirwlkbgnyb/sql) and run `artifacts/api-server/migrations.sql` in full. This only needs to be done once.

Also create the audio storage bucket: Supabase dashboard → **Storage** → **New bucket** → name: `story-audio` → Public: ON.

### 4. Start the API server

```bash
cd artifacts/api-server
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

Admin portal will be at: http://localhost:8080/admin/dashboard

### 5. Start the Expo app

```bash
cd artifacts/crrnt
pnpm exec expo start
```

Scan the QR code with Expo Go on your phone, or press `w` for web, `a` for Android emulator, `i` for iOS simulator.

---

## Architecture

pnpm monorepo with two production artifacts:

- `artifacts/api-server` (Python FastAPI) — backend ingesting news + serving story data
- `artifacts/crrnt` (Expo React Native) — mobile app

Internal tooling:

- `artifacts/mockup-sandbox` — Vite-based component preview server (design only)
- `lib/api-spec` — single source of truth OpenAPI 3.1 schema (`openapi.yaml`)
- `lib/api-client-react` / `lib/api-client-fetch` / `lib/api-zod` — codegen targets driven by `pnpm --filter @workspace/api-spec run codegen`

## Backend (`artifacts/api-server`)

- **Stack**: FastAPI + uvicorn (Python 3.11), httpx, anthropic SDK, yfinance, APScheduler, supabase-py, Jinja2
- **Entrypoint**: `main.py` — mounts all routers, configures Jinja2 templates
- **Routers**:
  - `routes/auth.py` — register, login, logout, me
  - `routes/stories.py` — daily feed, story detail, breaking news, save/unsave, search
  - `routes/onboarding.py` — quiz GET/POST
  - `routes/subscriptions.py` — RevenueCat webhook + identify + status
  - `routes/stocks.py` — price history + simulate
  - `routes/admin_portal.py` — Jinja2 admin UI (4 pages, HTTP Basic Auth)
  - `routes/health.py` — `/api/healthz`
- **Services**:
  - `services/db.py` — Supabase client + typed helpers for all tables
  - `services/auth_middleware.py` — JWT extraction + user lookup
  - `services/ingestion.py` — orchestrates fetch → enrich → TTS → persist to Supabase
  - `services/enrichment.py` — Claude claude-haiku-4-5 two-pass enrichment (insight + sentiment)
  - `services/news_fetcher.py` — NewsMesh API, 6 categories per run
  - `services/fish_audio.py` — Fish Audio TTS → uploads MP3 to Supabase Storage
  - `services/xapi.py` — GetXAPI Twitter/X client for sentiment tweet fetching
  - `services/personalization.py` — story scoring based on user preferences
  - `services/stock_service.py` — yfinance OHLC (1D/1W/1M/1Y)
  - `services/push.py` — Expo push notifications after ingestion
  - `services/scheduler.py` — APScheduler: ingestion 8 AM ET, cleanup 3 AM ET
  - `services/log_buffer.py` — in-memory recent log ring buffer for admin portal

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/healthz` | — | Health check |
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Login, returns JWT |
| GET | `/api/auth/me` | JWT | Current user profile |
| GET | `/api/stories/daily` | JWT | Personalized feed (free: 5, paid: 15) |
| GET | `/api/stories/{id}` | JWT | Story detail |
| GET | `/api/stories/breaking` | JWT | Active breaking news |
| POST | `/api/stories/{id}/save` | JWT | Save a story |
| DELETE | `/api/stories/{id}/save` | JWT | Unsave a story |
| GET | `/api/stories/saved` | JWT | User's saved stories |
| GET | `/api/search?q=` | JWT | Full-text story search |
| GET | `/api/onboarding` | JWT | Fetch quiz questions |
| POST | `/api/onboarding` | JWT | Submit quiz answers |
| GET | `/api/stock/{ticker}?range=` | JWT | Price history |
| POST | `/api/simulate` | JWT | What-if investment |
| POST | `/api/push-token` | — | Register Expo push token |
| POST | `/api/subscriptions/webhook` | RC sig | RevenueCat webhook |
| GET | `/api/subscriptions/status` | JWT | Subscription status |
| GET | `/admin/dashboard` | Basic | Admin portal |

## Frontend (`artifacts/crrnt`)

- **Stack**: Expo SDK 54, expo-router, React Native 0.81.5, expo-audio, expo-speech, expo-notifications, react-native-svg, @tanstack/react-query
- **Auth**: Supabase Auth email/password → app JWT stored in AsyncStorage
- **Screens**:
  - `app/(auth)/login.tsx` — Login screen
  - `app/(auth)/register.tsx` — Registration screen
  - `app/onboarding.tsx` — Onboarding quiz
  - `app/(tabs)/index.tsx` — Home feed (category filter, personalized)
  - `app/(tabs)/saved.tsx` — Saved stories
  - `app/story/[id].tsx` — Story detail (audio, chart, sentiment, save)
- **Contexts**: `AuthContext`, `SubscriptionContext`, `SavedStoriesContext`, `AudioContext`
- **Theme**: Dark mode, neon accent palette in `constants/colors.ts`

## Supabase Schema

| Table | Purpose |
|---|---|
| `users` | App users — tier (free/paid), subscription status, onboarding flag |
| `user_preferences` | Onboarding quiz answers |
| `stories` | Enriched news stories with tts_url, sentiment, expiry |
| `story_audio` | Raw MP3 bytes (BYTEA) |
| `saved_stories` | User ↔ story bookmarks |
| `breaking_news` | Breaking alerts with 6-hour expiry |
| `ingestion_logs` | One row per ingestion run |
| `push_tokens` | Expo device push tokens |

## Secrets Reference

| Secret | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | backend + frontend | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | backend only | Bypasses RLS — never expose to client |
| `SUPABASE_ANON_KEY` | frontend | Respects RLS |
| `ANTHROPIC_API_KEY` | backend | Claude enrichment |
| `NEWSMESH_API_KEY` | backend | News source API |
| `XAPI_KEY` | backend | GetXAPI Twitter/X search |
| `SESSION_SECRET` | backend | JWT signing + admin auth |
| `ADMIN_USERNAME` | backend | Admin portal HTTP Basic username |
| `ADMIN_PASSWORD` | backend | Admin portal HTTP Basic password |
| `REVENUECAT_API_KEY` | backend | RevenueCat REST API |

## Daily Quotas

- **NewsMesh** free tier: 25 req/day — 6 per ingestion (one per category)
- **Claude**: ~60 Pass-1 + ~30 Pass-2 sentiment calls per ingestion (perCategory=10)
- **GetXAPI**: ~30 searches per ingestion (stories with tickers)

## User Preferences

- Never use `console.log` in backend code — use `req.log` or the `logger` singleton
- Keep story tier logic in `services/personalization.py`, not in routes
