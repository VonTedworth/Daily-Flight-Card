# Handover — GAMA KSS Flight Card (from Claude.ai chat sessions, July 2026)

## What this is
Single-file web app (dist = one `index.html`) replacing the paper daily flight card.
Deployed on GitHub Pages. Full field/calculation documentation is in README.md —
read it before changing any calculation; it is the gross-error-check reference the
crew relies on.

## Layout
- `src/app.jsx` — the entire app (React, single file, heavily commented)
- `build_html.py` — inlines the esbuild bundle into the final HTML with iOS PWA
  meta tags. NOTE: it currently writes to `/mnt/user-data/outputs/flight-card-app.html`
  (a Claude sandbox path) — change that output path to `./index.html` first thing.
- `domtest*.js` — jsdom regression tests, run via `npm test`. They load the BUILT
  html, seed localStorage in `beforeParse`, and assert on rendered text/DOM.
  domtest10/11 cover the page split + carry-over; keep them green.
- `build/` — esbuild output (generated)

## Commands
    npm install
    npm run build     # -> index.html (after fixing the path in build_html.py)
    npm test

## Critical build gotcha
`--jsx=automatic` in the esbuild command is MANDATORY. Without it the bundle
throws "React is not defined" and the live site shows a black screen. This has
happened once already.

## Deploy
Repo root needs `index.html` + `README.md`. GitHub Pages serves from main/(root).
Commit + push = deployed. Hard-refresh Safari on the phone; home-screen icon may
need delete/re-add for meta-tag changes (iOS caches aggressively).

## Testing limits
- jsdom can't do geolocation or the share sheet: the HEMS grid button and PDF
  export must be tested on the live HTTPS deployment on a real phone.
- CSS zoom scaling (iPad) is visual-only — check on device.

## Invariants the user (Ed) has explicitly set — do not regress
- 7 flight rows (one SRP page = seven sectors); legacy 8-row cards must never
  lose a used row on load.
- Rows never collapse; empty trailing rows stay hidden.
- 4600 kg is a maintenance notation threshold, NOT a limit (AUM = 4800 kg).
  Rows show plain grey DEP GW; only >4800 gets an amber warning; the PDF carries
  the one-line "NOTE ON SRP" summary.
- DEP GW / DEP PERF are DEPARTURE figures via the fuel-inference table in
  README §2.2 (flight 1 = planned; post-refuel = planned; else previous landed).
- No per-aircraft weight memory (varies by crew; certified M&B app exists).
- Power check once per card, six fields, REDO to overwrite.
- Carry-over: SRP +1, AVAILABLE = previous REMAINING.
- Every feature must be faster than pen and paper; when in doubt, remove.

## Decisions log
- July 2026 — WX/METAR tab investigated and rejected: aviationweather.gov
  blocks browser CORS; the workaround (GitHub Actions data pipeline) adds
  15–25 min latency, losing to AeroWeather on the "must beat the existing
  way" test. Do not revisit without a use case that needs weather data
  inside a calculation rather than for display.
