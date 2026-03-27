# Practice Hub

A desktop practice tracker built with Tauri 2, React, and TypeScript. Connects to the Instrumenta API to load your daily dashboard and log practice sessions.

## Prerequisites

- **Node.js** 18+
- **Rust** (stable) — install via [rustup](https://rustup.rs)
- **Tauri CLI** prerequisites for macOS:
  - Xcode Command Line Tools: `xcode-select --install`

## Environment variables

Two `.env` files are used — one for dev, one for production builds. Neither is committed to git.

**`.env.development`**
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_API_BASE_URL=http://127.0.0.1:8080/api/v2
```

**`.env.production`**
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_API_BASE_URL=https://your-production-api/api/v2
```

Firebase values come from the Firebase console → Project settings → Your apps.

## Development

Install JS dependencies:
```bash
npm install
```

Start the Instrumenta API server (required for the app to load data):
```bash
cd ../practice.astrojason.com
FLASK_ENV=development flask run -p 8080
```

Start the Tauri dev app (in a separate terminal, from this directory):
```bash
npm run tauri dev
```

This runs `npm run dev` (Vite on port 1420) and the Tauri window together. Hot reload works for frontend changes. Rust changes require a full restart.

## Production build

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`:
- `macos/Practice Hub.app` — drag to `/Applications`
- `dmg/Practice Hub_0.1.0_aarch64.dmg` (or `x64`) — distributable installer

The build compiles the Vite frontend, then compiles the Rust binary and bundles everything into the `.app`.

## Project structure

```
src/                    React frontend
  api/                  API client + types (Instrumenta)
  auth/                 Firebase REST OAuth helpers
  components/
    session/            Session view components
      forms/            Per-item log forms
  hooks/                useAuth
  config.ts             Reads VITE_ env vars
src-tauri/
  src/lib.rs            Tauri commands (OAuth window interception)
  tauri.conf.json       Window size, bundle config, app identifier
  Cargo.toml            Rust dependencies
```

## Auth flow

Sign-in uses Firebase REST API + a Tauri `WebviewWindow` rather than the Firebase JS SDK. The Tauri window opens the Google OAuth URL, intercepts the callback redirect (before WKWebView's ITP can block it), and returns the ID token. Refresh tokens are stored in `localStorage` under `ph:refreshToken`.
