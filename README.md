# CRRNT

**CURRNT: News crrnt, market crrnt.**

A finance-meets-pop-culture mobile app for young adults. Trending stories across Celebrity, Entertainment, Tech, Government, Sports, Business, and Science — each paired with a relevant stock ticker, AI market insight, everyday impact analysis, X/Twitter social sentiment, a live price chart, and audio playback.

---

## Stack

| Layer | Technology |
|---|---|
| Mobile app | Expo SDK 54 · React Native 0.81.5 · expo-router |
| Backend API | Python 3.11 · FastAPI · uvicorn |
| AI enrichment | Anthropic Claude (`claude-haiku-4-5`) |
| News source | NewsMesh API |
| Social data | GetXAPI (X / Twitter) |
| Stock data | yfinance |
| Cache / KV | Replit DB (HTTP KV store) |
| Monorepo | pnpm workspaces |

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20 | Required for pnpm and Expo tooling |
| pnpm | 9 | `npm install -g pnpm` |
| Python | 3.11 | Backend API server |
| Expo Go app | latest | Install on your iOS or Android device for live preview |

---

## Repository layout

```
/
├── artifacts/
│   ├── api-server/          # FastAPI backend
│   └── marktr/              # Expo React Native app (CRRNT)
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 schema (single source of truth)
│   ├── api-client-react/    # React Query hooks (codegen output)
│   ├── api-client-fetch/    # Fetch client (codegen output)
│   └── api-zod/             # Zod schemas (codegen output)
├── scripts/                 # Shared utility scripts
└── pnpm-workspace.yaml
```

---

## Environment variables

Create a `.env` file in `artifacts/api-server/` with the following keys:

```env
# Required — Anthropic Claude (news enrichment)
ANTHROPIC_API_KEY=sk-ant-...

# Required — NewsMesh (news fetching)
NEWSMESH_API_KEY=...

# Required — GetXAPI (X/Twitter social data)
XAPI_KEY=...

# Optional — Replit KV store URL.
# On Replit this is injected automatically — do not add it manually there.
# For local development outside Replit you can omit it entirely;
# the server will fall back to an in-memory dictionary (data lost on restart).
# REPLIT_DB_URL=https://kv.replit.com/v0/...

# Required — Admin portal authentication
SESSION_SECRET=<any long random string>

# Optional — port override (defaults to 8000)
PORT=8000
```

> If `REPLIT_DB_URL` is not set, the server falls back to a local in-memory dictionary. Data will not persist across restarts in that mode.

---

## Running locally

### 1 — Install dependencies

```bash
# From the repository root
pnpm install
```

### 2 — Start the API server

```bash
cd artifacts/api-server
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at `http://localhost:8000`. You can verify it with:

```bash
curl http://localhost:8000/api/healthz
```

### 3 — Start the mobile app

Open a second terminal:

```bash
# From the repository root
pnpm --filter @workspace/marktr run dev
```

This starts the Expo Metro bundler. Scan the QR code with the **Expo Go** app on your phone, or press `w` to open the web preview in your browser.

> The mobile app expects the API at `/api`. When running on Replit the shared reverse proxy handles routing automatically. For purely local development outside Replit, set `EXPO_PUBLIC_API_BASE=http://localhost:8000` in `artifacts/marktr/.env.local` and update the API client base URL accordingly.

---

## Regenerating API client code

The generated React Query hooks and Zod schemas are driven by the OpenAPI spec in `lib/api-spec/openapi.yaml`. After modifying the spec, regenerate:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Admin portal

The admin portal lives at:

```
http://localhost:8000/api/admin/portal?token=<SESSION_SECRET>
```

If your `SESSION_SECRET` contains special characters, URL-encode the token value (e.g. `+` → `%2B`, `/` → `%2F`, `=` → `%3D`).

From the portal you can:
- View live ingestion status
- See cache stats (stories, batches, stock entries, push tokens)
- Adjust stories-per-category (1–25)
- Trigger a manual news refresh
- Delete all cached stories

---

## Seeding mock data (when NewsMesh credits are exhausted)

```bash
curl -X POST http://localhost:8000/api/admin/seed \
  -H "X-Admin-Token: <SESSION_SECRET>"
```

This writes 9 realistic mock stories across all 7 categories directly into the KV cache so the app has content to display without consuming NewsMesh API credits.

---

## Key API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Health check |
| GET | `/api/news` | List stories (optional `?category=`) |
| GET | `/api/news/{id}` | Single story detail |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/stock/{ticker}?range=` | Price history (`1d` / `5d` / `1mo` / `1y`) |
| POST | `/api/simulate` | What-if investment simulator |
| POST | `/api/push-token` | Register Expo push notification token |
| GET | `/api/admin/portal` | Web admin portal (requires `?token=`) |
| POST | `/api/admin/refresh` | Trigger news ingestion (X-Admin-Token header) |
| DELETE | `/api/admin/stories` | Clear all cached stories (X-Admin-Token header) |

---

## Secrets reference

| Variable | Where used |
|---|---|
| `ANTHROPIC_API_KEY` | Claude enrichment (insight, impact, sentiment) |
| `NEWSMESH_API_KEY` | Fetching latest news per category |
| `XAPI_KEY` | GetXAPI — tweet search for social sentiment |
| `SESSION_SECRET` | Admin portal auth (`X-Admin-Token` header) |
| `REPLIT_DB_URL` | Replit KV store (auto-set on Replit) |
