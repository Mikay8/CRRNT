# CRRNT

**CURRNT: News crrnt, market crrnt.**

A finance-meets-pop-culture mobile app for young adults. Trending stories across Celebrity, Entertainment, Tech, Government, Sports, Business, and Science — each paired with a relevant stock ticker, an AI market insight ("How does it stocks?"), a personal impact analysis ("How does it affect me?"), an X/Twitter social sentiment summary ("What are people saying?"), a live price chart, and audio playback.

Free for everyone — no paid tier or subscription.

---

## Stack

| Layer | Technology |
|---|---|
| Mobile app | Expo SDK 54 · React Native 0.81.5 · expo-router |
| Backend API | Python 3.11 · FastAPI · uvicorn · asyncpg |
| Database | Railway PostgreSQL |
| Auth | Local JWT (HS256) + bcrypt — no third-party auth provider |
| AI enrichment | Anthropic Claude (`claude-haiku-4-5`) |
| News source | NewsMesh API |
| Social data | xAI Grok (`grok-4.6`, `x_search` tool) |
| Stock data | yfinance |
| Text-to-speech | Fish Audio |
| Email | Resend (falls back to SMTP if unset) |
| Monorepo | pnpm workspaces |

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20 | Required for pnpm and Expo tooling |
| pnpm | 9 | `npm install -g pnpm` |
| Python | 3.11 | Backend API server |
| PostgreSQL | any recent | Local dev can point at a Railway instance instead |
| Expo Go app | latest | Install on your iOS or Android device for live preview |

---

## Repository layout

```
/
├── artifacts/
│   ├── api-server/          # FastAPI backend
│   ├── crrnt/                # Expo React Native app (CRRNT)
│   └── mockup-sandbox/       # Vite component preview tool (design only)
├── lib/
│   ├── api-spec/             # OpenAPI 3.1 schema (single source of truth)
│   ├── api-client-react/     # React Query hooks (codegen output)
│   └── api-zod/              # Zod schemas (codegen output)
├── scripts/                  # Shared utility scripts
├── tests/e2e/                 # Playwright end-to-end tests (admin portal + app)
└── pnpm-workspace.yaml
```

---

## Environment variables

Create a `.env` file in `artifacts/api-server/` (never commit this):

```env
# Required — database
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Required — auth
JWT_SECRET=<any long random string>
SESSION_SECRET=<any long random string>

# Required — Anthropic Claude (news enrichment)
ANTHROPIC_API_KEY=sk-ant-...

# Required — NewsMesh (news fetching)
NEWSMESH_API_KEY=...

# Optional — xAI Grok (X social sentiment via x_search). Skipped if unset.
XAI_API_KEY=...

# Required — Fish Audio (text-to-speech)
FISH_AUDIO_API_KEY=...
FISH_AUDIO_VOICE_ID=...

# Required — admin portal (HTTP Basic Auth at /admin/dashboard)
ADMIN_USERNAME=<your choice>
ADMIN_PASSWORD=<your choice>

# Email — sent via Resend first, falls back to SMTP if RESEND_API_KEY is unset
RESEND_API_KEY=re_...
# RESEND_FROM_EMAIL=CRRNT <noreply@yourdomain.com>   # defaults to Resend's sandbox sender
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
APP_RESET_PASSWORD_URL=

# Optional — tune stories fetched per category on manual ingestion
INGESTION_PER_CATEGORY=

# Port override
PORT=8080
```

Create a `.env.local` in `artifacts/crrnt/`:

```env
EXPO_PUBLIC_API_BASE=http://localhost:8080
```

---

## Running locally

### 1 — Install dependencies

```bash
# From the repository root
pnpm install
pip install -r artifacts/api-server/requirements.txt
```

### 2 — Run the database schema

Apply `artifacts/api-server/schema.sql` to your Postgres database once:

```bash
psql "$DATABASE_URL" -f artifacts/api-server/schema.sql
```

### 3 — Start the API server

```bash
cd artifacts/api-server
uvicorn main:app --host 0.0.0.0 --port 8080 --env-file .env --reload
```

Verify it's up:

```bash
curl http://localhost:8080/api/healthz
```

### 4 — Start the mobile app

```bash
cd artifacts/crrnt
pnpm exec expo start
```

Scan the QR code with the **Expo Go** app on your phone, or press `w` for web, `a` for Android emulator, `i` for iOS simulator.

---

## Regenerating API client code

The generated React Query hooks and Zod schemas are driven by the OpenAPI spec in `lib/api-spec/openapi.yaml`. After modifying the spec, regenerate:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Admin portal

Login at `/admin/dashboard` with HTTP Basic Auth (`ADMIN_USERNAME` / `ADMIN_PASSWORD`):

- Live ingestion status, story browser, user list, breaking news editor
- Ingestion config (which categories run, how many stories each), feed limits, cron schedule
- Digest email recipients, environment secret status
- Manual ingestion/cleanup trigger

---

## End-to-end tests

Playwright tests live in `tests/e2e`, covering the admin portal and the Expo web app. See `tests/e2e/README.md` for how to run them.

---

## Architecture

pnpm monorepo with two production artifacts:

- `artifacts/api-server` (Python FastAPI) — ingests news, serves story/user data, admin portal
- `artifacts/crrnt` (Expo React Native) — mobile app

Internal tooling:

- `artifacts/mockup-sandbox` — Vite-based component preview server (design only)
- `lib/api-spec` — single source of truth OpenAPI 3.1 schema (`openapi.yaml`)
- `lib/api-client-react` / `lib/api-zod` — codegen targets driven by `pnpm --filter @workspace/api-spec run codegen`

### Backend (`artifacts/api-server`)

- **Stack**: FastAPI + uvicorn (Python 3.11), asyncpg, httpx, anthropic SDK, yfinance, APScheduler, python-jose, bcrypt, Jinja2
- **Entrypoint**: `main.py` — mounts all routers, initializes the Postgres pool, configures Jinja2 templates
- **Routers**:
  - `routes/auth.py` — register, login, refresh, forgot/reset password, email verification, logout, me, delete account
  - `routes/stories.py` — daily feed, story detail, breaking news, save/unsave, search, per-user audio
  - `routes/onboarding.py` — quiz GET/POST
  - `routes/stocks.py` — price history + simulate
  - `routes/admin_portal.py` — Jinja2 admin UI, HTTP Basic Auth
  - `routes/health.py` — `/api/healthz`
- **Services**:
  - `services/db.py` — asyncpg connection pool + typed helpers for all tables
  - `services/auth.py` — JWT issuance/verification, password hashing
  - `services/auth_middleware.py` — JWT extraction + user lookup dependency
  - `services/ingestion.py` — orchestrates fetch → enrich → persist to Postgres
  - `services/enrichment.py` — Claude claude-haiku-4-5 (insight) + Grok grok-4.6 x_search (sentiment) two-pass enrichment
  - `services/news_fetcher.py` — NewsMesh API, per category
  - `services/fish_audio.py` — Fish Audio TTS, cached per user in Postgres
  - `services/personalization.py` — story scoring based on onboarding preferences
  - `services/stock_service.py` — yfinance OHLC (1D/1W/1M/1Y)
  - `services/push.py` — Expo push notification token storage
  - `services/scheduler.py` — APScheduler: daily ingestion + cleanup, admin-configurable times
  - `services/email_service.py` — Resend/SMTP transactional email + admin digest
  - `services/log_buffer.py` — in-memory recent log ring buffer for admin portal

### API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/healthz` | — | Health check |
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Login, returns JWT |
| POST | `/api/auth/refresh` | — | Exchange refresh token for a new session |
| POST | `/api/auth/forgot-password` | — | Request a password reset email |
| POST | `/api/auth/reset-password` | — | Reset password with a token |
| POST | `/api/auth/send-verification` | JWT | Send email verification |
| POST | `/api/auth/mark-verified` | JWT | Mark email verified |
| POST | `/api/auth/logout` | JWT | Logout |
| GET | `/api/auth/me` | JWT | Current user profile |
| DELETE | `/api/auth/account` | JWT | Permanently delete account |
| GET | `/api/stories/daily` | optional JWT | Personalized feed |
| GET | `/api/stories/{id}` | JWT | Story detail |
| GET | `/api/stories/{id}/audio` | JWT | Per-user story audio (range requests supported) |
| GET | `/api/stories/breaking` | JWT | Active breaking news |
| POST | `/api/stories/{id}/save` | JWT | Save a story |
| DELETE | `/api/stories/{id}/save` | JWT | Unsave a story |
| GET | `/api/stories/saved` | JWT | User's saved stories |
| GET | `/api/stories/search` | JWT | Full-text story search |
| GET | `/api/onboarding` | JWT | Fetch onboarding preferences |
| POST | `/api/onboarding` | JWT | Submit quiz answers |
| GET | `/api/stock/{ticker}?range=` | — | Price history |
| POST | `/api/simulate` | — | What-if investment |
| POST | `/api/push-token` | — | Register Expo push token |
| GET | `/admin/dashboard` | Basic | Admin portal |

### Frontend (`artifacts/crrnt`)

- **Stack**: Expo SDK 54, expo-router, React Native 0.81.5, expo-audio, expo-av (lock-screen controls), expo-speech, expo-notifications, react-native-svg, @tanstack/react-query
- **Auth**: local JWT (access + refresh token pair) stored in AsyncStorage
- **Screens**:
  - `app/login.tsx` / `app/register.tsx` — auth screens
  - `app/auth/forgot-password.tsx` — password reset request
  - `app/onboarding.tsx` — privacy disclosure + personalization quiz
  - `app/(tabs)/index.tsx` — home feed (category filter, search, personalized)
  - `app/(tabs)/saved.tsx` — saved stories
  - `app/(tabs)/settings.tsx` — account, preferences, appearance, sign out, delete account
  - `app/story/[id].tsx` — story detail (audio, chart, sentiment, save)
- **Contexts**: `AuthContext`, `SavedStoriesContext`, `AudioContext`, `ThemeContext`
- **Theme**: dark/light mode, neon accent palette in `constants/theme.ts`

### Database schema

Applied via `artifacts/api-server/schema.sql`.

| Table | Purpose |
|---|---|
| `users` | App users — email, password hash, onboarding/verification flags |
| `user_preferences` | Onboarding quiz answers |
| `stories` | Enriched news stories with sentiment, expiry |
| `story_audio` | Ingestion-time shared audio (currently unused — audio is generated per user instead) |
| `saved_stories` | User ↔ story bookmarks |
| `breaking_news` | Breaking alerts with 6-hour expiry |
| `ingestion_logs` | One row per ingestion run |
| `push_tokens` | Expo device push tokens |
| `story_personalizations` | Cached per-user personalized story text |
| `user_story_audio` | Cached per-user generated audio (BYTEA) |
| `app_settings` | Admin-configurable key/value config (feed limits, schedule, ingestion config, digest recipients) |
| `password_reset_tokens` | One-time password reset tokens |

### Secrets reference

| Secret | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | backend | Postgres connection string |
| `JWT_SECRET` | backend | Signs/verifies access & refresh tokens |
| `SESSION_SECRET` | backend | General session signing |
| `ANTHROPIC_API_KEY` | backend | Claude enrichment |
| `NEWSMESH_API_KEY` | backend | News source API |
| `XAI_API_KEY` | backend | xAI Grok x_search (optional — sentiment step skipped if unset) |
| `FISH_AUDIO_API_KEY` / `FISH_AUDIO_VOICE_ID` | backend | Text-to-speech |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | backend | Admin portal HTTP Basic auth |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | backend | Transactional + digest email |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | backend | Email fallback if Resend is unset |
| `APP_RESET_PASSWORD_URL` | backend | Deep link used in password reset emails |
| `INGESTION_PER_CATEGORY` | backend | Default story count per category on manual ingestion |

### Daily quotas

- **NewsMesh** free tier: 25 req/day
- **Claude**: one pass per story (insight)
- **Grok**: one x_search pass per story with a resolvable ticker, person, or topic

---

## Notes for contributors (human or agent)

- Never use `console.log`/`print` in backend code — use the `logging` module (see `crrnt.*` loggers already set up in each service).
- Keep story ranking/scoring logic in `services/personalization.py`, not in routes.
- The app has no paid tier — don't reintroduce tier-gating without an explicit product decision.
