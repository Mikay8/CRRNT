# Marktr

A finance-meets-pop-culture mobile app for young adults. Discover trending news in Celebrity, Tech, Government, Sports, Business, and Science — every story is paired with a relevant public stock ticker, an AI-written market insight, a price chart, and a "What If I had invested?" simulator.

## Architecture

This is a pnpm monorepo with two production artifacts:

- `artifacts/api-server` (Python FastAPI) — backend ingesting news + serving stock data
- `artifacts/marktr` (Expo React Native) — mobile app

Plus internal tooling:

- `artifacts/mockup-sandbox` — Vite-based component preview server (used during design exploration only, not part of the product)
- `lib/api-spec` — single source of truth OpenAPI 3.1 schema (`openapi.yaml`)
- `lib/api-client-react` / `lib/api-client-fetch` / `lib/api-zod` — codegen targets driven by `pnpm --filter @workspace/api-spec run codegen`

## Backend (`artifacts/api-server`)

- **Stack**: FastAPI + uvicorn (Python 3.11), httpx, anthropic SDK, yfinance, APScheduler
- **Entrypoint**: `main.py` mounts routers under `/api`
- **Routers**: `routes/{health,news,stocks,admin}.py`
- **Services**:
  - `services/news_fetcher.py` — calls NewsMesh `/v1/latest` once per category sequentially (1.5s spacing) to avoid rate limit. Maps editorial categories: celebrity→entertainment, tech→technology, government→politics, sports→sports, business→business, science→science.
  - `services/enrichment.py` — Claude `claude-haiku-4-5` enriches each article with `{ticker, companyName, insight, explanation}`. Concurrency capped at 5; falls back to a generic insight on failure.
  - `services/stock_service.py` — yfinance for historical OHLC and the simulate endpoint. Returns `latestPrice` / `previousClose` at the top level, `points: [{date, close}]` for the chart.
  - `services/cache.py` — Replit DB HTTP wrapper with in-memory fallback. Keys: `news:YYYY-MM-DD`, `article:{id}`, `stock:{TICKER}:{range}:{date}`, `ingestion:status`.
  - `services/ingestion.py` — orchestrates fetch + enrich, persists daily news payload.
  - `services/scheduler.py` — APScheduler daily 8 AM ET; lifespan hook also ensures today's news is cached on startup.
- **Endpoints**: `/api/healthz`, `/api/news`, `/api/news/{id}`, `/api/search?q=<query>`, `/api/stock/{ticker}`, `/api/simulate`, `/api/admin/status`, `/api/admin/refresh`

## Frontend (`artifacts/marktr`)

- **Stack**: Expo SDK 54, expo-router, React Native 0.79, react-native-svg, @tanstack/react-query, AsyncStorage
- **Screens**:
  - `app/(tabs)/index.tsx` — Home Feed with category filter (All / Celebrity / Tech / Government / Sports)
  - `app/(tabs)/saved.tsx` — Saved tab (AsyncStorage-backed)
  - `app/story/[id].tsx` — Story Detail: hero image, Marktr Take, ticker chip, price chart, What-If simulator
- **Components**: `StoryCard`, `CategoryFilter`, `CategoryBadge`, `SaveButton`, `EmptyState`, `PriceChart` (custom SVG), `SimulatorPanel`
- **State**: `contexts/SavedStoriesContext` (AsyncStorage), React Query for server state via generated `useListStories`, `useGetStory`, `useGetStockHistory`, `useSimulateInvestment` hooks.
- **API base URL**: configured in `app/_layout.tsx` via `setBaseUrl(\`https://${EXPO_PUBLIC_DOMAIN}\`)`.
- **Theme**: dark, neon accent palette in `constants/colors.ts`; categories color-coded in `constants/categories.ts`.

## Secrets

- `ANTHROPIC_API_KEY` — Claude enrichment
- `NEWSMESH_API_KEY` — news source
- `SESSION_SECRET` — reserved

## Workflows

- `artifacts/api-server: API Server` → uvicorn on `$PORT`
- `artifacts/marktr: expo` → Expo dev server on `$PORT`
- `artifacts/mockup-sandbox: Component Preview Server` → Vite (only used for design iteration)

## Daily Quotas

NewsMesh free tier = 25 req/day. We use 4 (one per category) per ingestion, scheduled once daily. Plenty of headroom for manual `/api/admin/refresh` calls.
