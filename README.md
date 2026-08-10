# Beading

A custom web app for designing seed bead patterns (peyote stitch, with brick/square/loom
planned later) — a personal, non-commercial replacement for a commercial iPad app. Runs in
Safari on iPad, installable to the home screen.

Vanilla JS, ES modules, no framework, no bundler, no build step. See `CLAUDE.md` for full
project context, architecture, and phase history.

## Running locally

No build step — serve the directory root and open it:

```sh
python3 -m http.server
```

Then visit `http://localhost:8000` (or the Mac's LAN IP, to test from an iPad on the same
network).

## Running tests

```sh
node --test src/test/**/*.test.js
```

Covers grid math, tools, history, storage helpers, and export logic. Storage modules that
depend on IndexedDB (`db.js`, `designStore.js`, `preferencesStore.js`,
`customColorStore.js`, `photoTraceStore.js`) have no Node coverage — those are verified in
a real browser (headless Chromium via Playwright).

## Deploying / installing on iPad

The app is static files, so it can be hosted on any static host (Netlify, Vercel, GitHub
Pages, etc.) with no build step:

1. Deploy this directory to a static host over HTTPS.
2. On the iPad, open the deployed URL in Safari.
3. Share → **Add to Home Screen**.

HTTPS also ensures `crypto.randomUUID()` is available natively (see `src/storage/id.js`),
since it's gated behind a secure context.
