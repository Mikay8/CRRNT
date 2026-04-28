# Marktr

A finance-meets-pop-culture mobile app for young adults. Discover trending news in Celebrity, Entertainment, Tech, Government, Sports, Business, and Science — every story is paired with a relevant stock ticker, an AI market insight ("How does it stocks?"), a personal impact analysis ("How does it affect me?"), a social sentiment summary ("What are people saying?"), a price chart, and audio playback.

## Architecture

pnpm monorepo with two production artifacts:

- `artifacts/api-server` (Python FastAPI) — backend ingesting news + serving stock data
- `artifacts/marktr` (Expo React Native) — mobile app

Internal tooling:

- `artifacts/mockup-sandbox` — Vite-based component preview server (design only)
- `lib/api-spec` — single source of truth OpenAPI 3.1 schema (`openapi.yaml`)
- `lib/api-client-react` / `lib/api-client-fetch` / `lib/api-zod` — codegen targets driven by `pnpm --filter @workspace/api-spec run codegen`

## Backend (`artifacts/api-server`)

- **Stack**: FastAPI + uvicorn (Python 3.11), httpx, anthropic SDK, yfinance, APScheduler
- **Entrypoint**: `main.py` mounts routers under `/api`
- **Routers**: `routes/{health,news,stocks,admin}.py`
- **Services**:
  - `services/news_fetcher.py` — NewsMesh `/v1/latest` once per category. Maps: celebrity→entertainment (Claude splits into celebrity/entertainment), tech→technology, government→politics, sports→sports, business→business, science→science.
  - `services/enrichment.py` — Two-pass Claude enrichment with `claude-haiku-4-5`:
    - Pass 1: `{ticker, companyName, insight, explanation, everydayImpact, category}`. max_tokens=600. Concurrency=5.
    - Pass 2: For stories with tickers, fetches tweets via xapi.py then runs sentiment analysis → `{tweetSummary, sentiment, tweets}`. Concurrency=3.
  - `services/xapi.py` — GetXAPI (getxapi.com) Twitter/X client. Searches recent tweets by $TICKER or "company name". Returns top tweets sorted by engagement.
  - `services/push.py` — Expo Push Notification service. Stores tokens in KV under `push:tokens`. Sends after each successful ingestion ("Updated News").
  - `services/config.py` — Runtime config in KV (`config:ingestion`). Key: `perCategory` (1-25, default 10).
  - `services/stock_service.py` — yfinance OHLC, 1d (5-min candles), 5d (hourly), 1mo/1y (daily). Returns `latestPrice`, `previousClose`, `points[]`.
  - `services/cache.py` — Replit DB HTTP wrapper with in-memory fallback. Keys: `news:YYYY-MM-DD`, `article:{id}`, `stock:{TICKER}:{range}:{date}`, `ingestion:status`, `push:tokens`, `config:ingestion`.
  - `services/ingestion.py` — Orchestrates fetch + enrich, persists daily batch, sends push notification on success. Reads `perCategory` from config service.
  - `services/scheduler.py` — APScheduler daily 8 AM ET.
- **Endpoints**:
  - `/api/healthz`
  - `/api/news` — list stories (filter by category)
  - `/api/news/{id}` — single story
  - `/api/search?q=` — full-text search
  - `/api/stock/{ticker}?range=` — price history
  - `/api/simulate` — what-if investment
  - `/api/push-token` — register Expo push token (public, POST)
  - `/api/admin/status` — ingestion status (X-Admin-Token)
  - `/api/admin/refresh` — trigger ingestion (X-Admin-Token)
  - `/api/admin/stats` — KV cache stats (X-Admin-Token)
  - `/api/admin/config` — GET/POST ingestion config (X-Admin-Token)
  - `/api/admin/stories` — DELETE all stories (X-Admin-Token)
  - `/api/admin/portal?token=` — web admin portal (HTML, validates SESSION_SECRET)

## Frontend (`artifacts/marktr`)

- **Stack**: Expo SDK 54, expo-router, React Native 0.81.5, expo-speech, expo-notifications, expo-device, react-native-svg, @tanstack/react-query, AsyncStorage
- **Screens**:
  - `app/(tabs)/index.tsx` — Home Feed with category filter + search
  - `app/(tabs)/saved.tsx` — Saved stories (AsyncStorage)
  - `app/story/[id].tsx` — Story Detail with:
    - Audio play button (expo-speech reads title + everyday impact + insights)
    - **"How does it stocks?"** — Claude financial insight + explanation
    - **"How does it affect me?"** — Claude everyday impact analysis
    - Stock price chart with 1D/1W/1M/1Y range tabs
    - **"What are people saying?"** — X/Twitter sentiment badge + AI summary + tweet cards
    - Read full story button
- **Components**: `StoryCard`, `CategoryFilter`, `CategoryBadge`, `SaveButton`, `EmptyState`, `PriceChart`
- **Push notifications**: Registered on app startup via `expo-notifications`. Token POSTed to `/api/push-token`. Android channel configured. Web gracefully skipped.
- **State**: `contexts/SavedStoriesContext` (AsyncStorage), React Query via generated hooks.
- **Theme**: Dark, neon accent palette in `constants/colors.ts`.

## Admin Portal

Accessible at: `https://<domain>/api/admin/portal?token=<SESSION_SECRET>`

Features:
- Live ingestion status (auto-refresh every 10s)
- Cache stats (stories, batches, stocks, push tokens)
- Stories per category config (1–25 slider)
- Trigger manual news refresh
- Delete all cached stories

## Secrets

- `ANTHROPIC_API_KEY` — Claude enrichment (Pass 1 + Pass 2 sentiment)
- `NEWSMESH_API_KEY` — News source
- `SESSION_SECRET` — Admin portal token + X-Admin-Token fallback
- `XAPI_KEY` — GetXAPI (getxapi.com) Twitter/X API key

## Workflows

- `artifacts/api-server: API Server` → uvicorn on `$PORT`
- `artifacts/marktr: expo` → Expo dev server on `$PORT`
- `artifacts/mockup-sandbox: Component Preview Server` → Vite (design only)

## Data Model (KV)

| Key pattern | TTL / retention |
|---|---|
| `news:YYYY-MM-DD` | 7-day rolling window |
| `article:{id}` | 14 days |
| `stock:{TICKER}:{range}:{date}` | set on write |
| `ingestion:status` | always current |
| `push:tokens` | permanent (device registration) |
| `config:ingestion` | permanent (admin config) |

## Daily Quotas

- NewsMesh free tier: 25 req/day. We use 6 per ingestion (one per category).
- Claude: ~60 Pass-1 calls + ~30 Pass-2 sentiment calls per ingestion (perCategory=10).
- GetXAPI: ~30 searches per ingestion (stories with tickers).
