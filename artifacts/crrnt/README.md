# CRRNT — iOS Build & Development Guide

Finance meets pop-culture. CRRNT delivers trending news paired with stock tickers, AI market insights, social sentiment, and audio playback.

---

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment variables](#environment-variables)
4. [Running the backend API](#running-the-backend-api)
5. [Web preview (Replit)](#web-preview-replit)
6. [iOS development build](#ios-development-build)
7. [Building in Xcode step-by-step](#building-in-xcode-step-by-step)
8. [Configuration reference](#configuration-reference)
9. [Troubleshooting](#troubleshooting)

---

## Architecture overview

```
artifacts/
  api-server/      Python FastAPI backend  →  serves /api/*
  crrnt/           Expo React Native app   →  iOS, Android, Web
```

The app talks to the backend at the same domain — no hardcoded URLs. On Replit the proxy routes `/api` to the FastAPI server automatically. When building locally with Xcode you must configure the API base URL so the device knows where to connect (see [Step 3](#step-3--configure-the-api-base-url)).

---

## Prerequisites

### For web preview (Replit only)
- Nothing extra — runs in the browser

### For iOS development build (your Mac)

| Tool | Minimum version | Install |
|---|---|---|
| macOS | Ventura 13+ | — |
| Xcode | 15+ | Mac App Store |
| Xcode Command Line Tools | — | `xcode-select --install` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) or `brew install node` |
| pnpm | 9+ | `npm i -g pnpm` |
| Ruby | 3.1+ (system Ruby is fine) | pre-installed on macOS |
| CocoaPods | 1.14+ | `sudo gem install cocoapods` |

---

## Environment variables

All secrets live in **Replit's Secrets manager** (the padlock icon in the sidebar). They are injected automatically when the server starts — never put them in code or `.env` files.

### Backend (`artifacts/api-server`)

| Secret key | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude AI — story enrichment (Pass 1 ticker/insight, Pass 2 sentiment) |
| `NEWSMESH_API_KEY` | Yes | NewsMesh — news source, 6 req/ingestion, 25 req/day free tier |
| `SESSION_SECRET` | Yes | Admin portal auth token AND fallback X-Admin-Token for admin endpoints |
| `XAPI_KEY` | Yes | GetXAPI (getxapi.com) — Twitter/X tweet search, ~30 searches/ingestion |

To add a secret in Replit: open **Secrets** → **+ New Secret** → paste key + value → **Add Secret**.

### Frontend (`artifacts/crrnt`)

The Expo app has no secrets of its own. The dev server script (in `package.json`) injects these automatically from Replit's environment at startup:

```
EXPO_PACKAGER_PROXY_URL  — Expo QR code tunnel URL (set by Replit)
EXPO_PUBLIC_DOMAIN       — base domain for API calls (set by Replit)
EXPO_PUBLIC_REPL_ID      — Replit project ID (set by Replit)
REACT_NATIVE_PACKAGER_HOSTNAME — Metro bundler hostname (set by Replit)
```

When running on Replit these are set automatically. When building locally with Xcode, `EXPO_PUBLIC_DOMAIN` is not injected — you must set `EXPO_PUBLIC_API_BASE` manually (see [Step 3 in the iOS build section](#step-3--configure-the-api-base-url)).

---

## Running the backend API

The backend runs automatically via the **`artifacts/api-server: API Server`** workflow in Replit. To start it manually:

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload --app-dir artifacts/api-server
```

**Running locally:** create a `.env` file inside `artifacts/api-server/` (it is gitignored):

```bash
# artifacts/api-server/.env
REPLIT_DB_URL=https://kv.replit.com/v0/<your-token>
ANTHROPIC_API_KEY=...
NEWSMESH_API_KEY=...
SESSION_SECRET=...
XAPI_KEY=...
```

The server loads `.env` automatically on startup via python-dotenv — no need to `source` it manually. Get the current `REPLIT_DB_URL` by running `echo $REPLIT_DB_URL` in the Replit shell. Note it contains an expiring JWT (~24–48 hrs) so you'll need to refresh it periodically.

Verify it's up:
```bash
curl http://localhost:80/api/healthz
```

To trigger a manual news ingestion (requires `SESSION_SECRET`):
```bash
curl -X POST http://localhost:80/api/admin/refresh \
  -H "X-Admin-Token: <SESSION_SECRET>"
```

Admin portal (full web UI):
```
https://<your-replit-domain>/api/admin/portal?token=<SESSION_SECRET>
```

---

## Web preview (Replit)

The Expo workflow serves a web version at the Replit preview URL. This uses `AudioContext.tsx` (expo-audio + expo-speech) — audio works but this is not the same code path as iOS.

The workflow command is:
```bash
pnpm --filter @workspace/marktr run dev
```

This is managed automatically. You don't need to run it manually.

---

## iOS development build

> **Important:** CRRNT uses `react-native-track-player`, a native module. Expo Go will crash on launch — you must use a development build compiled with Xcode.

### Step 1 — Get the code on your Mac

```bash
git clone <your-repo-url>
cd <repo-root>
pnpm install
```

### Step 2 — Install CocoaPods dependencies

```bash
cd artifacts/crrnt/ios
pod install
cd ..
```

This generates `CRRNT.xcworkspace` and links all native modules including RNTP.

### Step 3 — Configure the API base URL

When Xcode builds the app there are no Replit environment variables, so the app doesn't know where the backend is and **all API calls silently fail**.

Fix: create `artifacts/crrnt/.env.local` (already gitignored):

```bash
# Option A — point to your running Replit backend (easiest)
EXPO_PUBLIC_API_BASE=https://fe91dcb7-c4aa-4498-b560-3ba792d414a2-00-3qj7kti9d7lgg.riker.replit.dev

# Option B — point to uvicorn running locally on your Mac
# EXPO_PUBLIC_API_BASE=http://<your-mac-lan-ip>:8080
```

Expo loads `.env.local` automatically at Metro bundler start — no extra steps needed. The Replit backend URL is stable for this project; only change it if you moved to a new Repl.

> **Why this happens:** on Replit, the dev workflow injects `EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN` and `_layout.tsx` calls `setBaseUrl()` from that. Locally neither variable exists, so `setBaseUrl()` is never called and every fetch goes to a relative path that resolves nowhere on a real device.

### Step 4 — Start the Metro bundler (from Replit or locally)

The Metro bundler can run on Replit (the Expo workflow is already running) — your device connects to it over the Replit dev domain. Alternatively run it locally:

```bash
# from artifacts/crrnt/
pnpm exec expo start
```

### Step 5 — Build and run

```bash
# from artifacts/crrnt/
pnpm exec expo run:ios
```

Or open Xcode directly (see next section).

---

## Building in Xcode step-by-step

### Open the project

Always open the **workspace** file, never the `.xcodeproj`:

```
artifacts/crrnt/ios/CRRNT.xcworkspace
```

Double-click it in Finder, or:
```bash
open artifacts/crrnt/ios/CRRNT.xcworkspace
```

### Configure signing

1. In the Xcode project navigator, select the **CRRNT** project (top-level blue icon)
2. Select the **CRRNT** target → **Signing & Capabilities** tab
3. Check **Automatically manage signing**
4. Set **Team** to your Apple Developer account
5. Xcode will generate a provisioning profile automatically

> For a free Apple ID (no paid developer account), you can still build and run on a physically connected device — you just cannot distribute to the App Store.

### Select a destination

In the toolbar at the top, click the device/simulator selector and choose:
- **iPhone 16 (Simulator)** — for quick testing without a physical device
- **Your iPhone** — plug in via USB, trust the Mac on your device, then select it

### Build and run

Press **⌘ R** or click the **▶ Run** button.

First build takes 5–10 minutes while it compiles React Native from source. Subsequent builds are much faster (incremental).

### Connecting to the backend

The app reads `EXPO_PUBLIC_API_BASE` from `artifacts/crrnt/.env.local` (which you created in Step 3) to know where to send API requests. Make sure the **Expo workflow is running** in Replit so Metro can serve JS bundles to the device.

If you want the device to connect to a locally running Metro bundler instead:
1. Run `pnpm exec expo start` on your Mac
2. Shake the device to open the dev menu → **Change Bundle Location** → enter your Mac's local IP on port 8081

---

## Configuration reference

### `app.json` — Expo config

| Field | Value | Notes |
|---|---|---|
| `name` | `CRRNT` | Display name |
| `slug` | `crrnt` | EAS Build identifier |
| `scheme` | `crrnt` | Deep link URL scheme (`crrnt://`) |
| `ios.bundleIdentifier` | `com.crrnt.app` | Must match your Xcode signing profile |
| `android.package` | `com.crrnt.app` | Android package name |
| `newArchEnabled` | `true` | Required for RNTP on SDK 54 |
| `ios.infoPlist.UIBackgroundModes` | `["audio"]` | Enables background audio playback |

### Changing the bundle identifier

If you need a different bundle ID (e.g. for your own App Store account):

1. Edit `app.json` → `expo.ios.bundleIdentifier`
2. Re-run prebuild: `pnpm exec expo prebuild --platform ios`
3. Update signing in Xcode

### Audio architecture

| Platform | Implementation | File |
|---|---|---|
| iOS / Android | `react-native-track-player` | `contexts/AudioContext.native.tsx` |
| Web (Replit preview) | expo-audio + expo-speech | `contexts/AudioContext.tsx` |

Metro automatically picks the `.native.tsx` file on device builds. The web file is the Replit preview fallback.

### Entry points

| File | Used by | Purpose |
|---|---|---|
| `index.js` | Web (webpack) | Plain expo-router bootstrap |
| `index.native.js` | iOS / Android (Metro) | Registers RNTP PlaybackService before app mounts |

### Ingestion config (admin)

News ingestion runs daily at 8:00 AM ET. To change the number of stories per category (1–25):

```bash
curl -X POST http://localhost:80/api/admin/config \
  -H "X-Admin-Token: <SESSION_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"perCategory": 10}'
```

---

## Troubleshooting

### Feed is blank / no data on device
API calls are silently failing because the base URL is not set. Make sure `artifacts/crrnt/.env.local` exists and contains `EXPO_PUBLIC_API_BASE=https://...` pointing to your Replit backend. Then restart Metro and rebuild.

### "No bundle URL present" on launch
Metro is not reachable. Make sure the Expo workflow is running in Replit and your device has internet access. Shake the device → **Reload**.

### App crashes immediately on launch
You are probably using Expo Go. RNTP requires a dev build — open `CRRNT.xcworkspace` in Xcode and build from there.

### `pod install` fails
```bash
sudo gem install cocoapods   # reinstall CocoaPods
cd artifacts/crrnt/ios
pod repo update              # refresh specs repo
pod install
```

### TypeScript errors in Xcode build logs
These come from Metro, not Xcode. Run `pnpm exec tsc --noEmit` in `artifacts/crrnt/` to see them.

### RNTP not playing on device
- Confirm the device is not in silent mode (or that UIBackgroundModes audio is set — it is)
- Confirm the API server is running and the story has an `audioUrl` field
- Check Metro logs for any JS errors

### Seek bar does not work on iOS
This was the original bug — it is fixed. The seek bar now uses `react-native-gesture-handler`'s `GestureDetector` instead of the raw responder system, so it wins over the ScrollView gesture on iOS.

### `pod install` takes forever
Enable CocoaPods caching:
```bash
export CP_HOME_DIR=~/.cocoapods
pod install
```
