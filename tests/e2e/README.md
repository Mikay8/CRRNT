# CRRNT end-to-end tests (Playwright)

Two independent suites:

- **admin-portal** — the FastAPI Jinja2 admin UI at `/admin/*`
- **expo-web** — the React Native app running in Expo web mode

Both require their target server running locally first — Playwright does not
start them for you (the API server needs a Python venv, and Expo's dev
server takes too long to boot reliably as a Playwright `webServer`).

## 1. Start the API server

```bash
cd artifacts/api-server
source .venv/bin/activate   # first time: python3 -m venv .venv && pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Requires `artifacts/api-server/.env` to be filled in (`DATABASE_URL`,
`JWT_SECRET`, `ADMIN_USERNAME`/`ADMIN_PASSWORD`, third-party API keys) and
`schema.sql` already applied to the database.

## 2. Start the Expo web app

```bash
cd artifacts/crrnt
pnpm exec expo start --web --port 8081
```

Requires `artifacts/crrnt/.env.local` with `EXPO_PUBLIC_API_BASE=http://localhost:8080`.

## 3. Run the tests

```bash
cd tests/e2e
ADMIN_USERNAME=admin ADMIN_PASSWORD=<your admin password> pnpm test
```

- `pnpm test` — everything
- `pnpm test:admin` — admin portal only
- `pnpm test:app` — Expo web app only
- `pnpm test:ui` — interactive Playwright UI mode

Override target URLs with `ADMIN_BASE_URL` / `APP_BASE_URL` env vars if the
servers are running on different ports/hosts.

## Notes

- App tests that need a signed-in user register a brand-new throwaway
  account per test run (`pw-<timestamp>-<random>@example.com`) — no seed
  data or fixtures required, but it does write real rows to whatever
  database `DATABASE_URL` points at.
- Feed/story-detail assertions are intentionally light: a fresh database has
  no ingested stories (ingestion requires NewsMesh/Anthropic/Fish Audio API
  keys and a cron run), so these tests check the screen renders correctly
  rather than asserting on specific story content.
