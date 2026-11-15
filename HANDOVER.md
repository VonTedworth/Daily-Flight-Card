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
- `multisector-build-brief.md` + `prototype-fuel-multisector.html` — the IFR FUEL spec and the
  approved prototype whose `compute()` the engine ports (reference numbers in brief §6).
- `src/fuelcalc.js` + `src/fuel-planner-dataset.json` — the IFR FUEL tab's pure calc engine
  and its bundled data (OMA 8H / OMB B34 figures). Unit-tested directly via
  `build/fuelcalc.cjs` (emitted by `npm run build`; domtest15). Edit figures in the
  JSON, not in code.
- `approach-minima-reference.md` — planning reference (OMA 8H minima by approach type, per-airfield
  approaches, how approach choice feeds the scenarios). Documentation only: the approaches the app
  shows come from the dataset — keep the two in step when adding a field.
- `src/map-geometry.json` + `tools/gen_map.py` — the IFR FUEL map's county outlines, generated
  from ONS boundaries (OGL; keep the attribution in README §3A). Regenerate only if the site
  bounds change: fetch the ONS counties GeoJSON (Dec 2024 UK BGC, WGS84, envelope
  -1.75,50.45,1.75,52.05) and run `python3 -I tools/gen_map.py counties.geojson`. The raw file is
  not committed. Sites and outlines must share the projection in that script (domtest17 checks).
- `src/service-worker.src.js` — the service worker TEMPLATE. `build_html.py` stamps it and
  writes `service-worker.js` (repo root) — never edit the built copy. `build_html.py` also
  generates `manifest.json` (same icon as the apple-touch-icon).
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
Repo root needs `index.html`, `service-worker.js`, `manifest.json` (all three emitted by
`npm run build` — commit them together) + `README.md`. GitHub Pages serves from main/(root).
Commit + push = deployed. Hard-refresh Safari on the phone; home-screen icon may
need delete/re-add for meta-tag changes (iOS caches aggressively).

## Version stamp
`APP_VERSION` in `src/app.jsx` (top of file) is shown in a small footer on
every tab, next to the build date. **Bump `APP_VERSION` by one on every
change that gets built + committed** — it's how Ed confirms on the phone
which build is actually live. The date next to it is stamped automatically
by `build_html.py` at build time (today's date, `dd.mm.yyyy`), so it can
never go stale even if a version bump is forgotten — but the version number
should still be bumped every time.

## Offline launch (service worker) — rules
- The site is served from a project SUBPATH (`/Daily-Flight-Card/`). Every SW URL and the
  registration are RELATIVE (`./service-worker.js`, `./`, `./index.html`). An absolute
  `/service-worker.js` 404s and silently disables offline (domtest20 checks).
- The cache name is `flightcard-<build date>-<sha256 of index.html, 10 hex>`, stamped by
  `build_html.py`. It changes whenever the page changes, so every deploy installs a new
  cache and purges the old one. (The date alone is NOT enough: two deploys in one day would
  share a cache and strand users on the first.)
- Never reload, navigate or message the page from the SW. New versions install in the
  background (`skipWaiting` + `clients.claim`) and the next launch shows them.
- Page = network-first with a 3 s timeout then cache; same-origin assets and Google Fonts =
  cache-first, refreshed in the background (fonts in a separate cache kept across deploys so
  offline layout matches online).
- Tests: domtest20 (build artefacts, registration, manifest), domtest21 (runs the built SW
  against simulated Cache Storage/network). jsdom cannot run a real SW: for a real-browser
  check run `npm run check:offline` (headless Chrome). Final proof is on the phone in
  airplane mode (README §6).

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
- DEP GW / VAR / VERT margins are DEPARTURE figures via the fuel-inference
  table in README §2.2 (flight 1 = planned — or, on a carried-over card, the
  previous card's last landed fuel; post-refuel = planned; else previous
  landed). Ground runs (0 min) are never listed in the "over 4600" SRP note.
- No per-aircraft weight memory (varies by crew; certified M&B app exists).
- Power check once per card, six fields, REDO to overwrite.
- Carry-over: SRP +1, AVAILABLE = previous REMAINING.
- Every feature must be faster than pen and paper; when in doubt, remove.
- The app must launch with no signal after one online visit (service worker), and an
  update must never reload or interrupt an open session.
- The IFR FUEL tab is an unregulated cross-check: the "Planning cross-check only —
  not a certified flight-planning tool" disclaimer must stay visible. It is fully
  offline — **no network request of any kind** (domtest16/17 fail if one is made). It
  stores only its own trip under `ifr-fuel-trip` and never touches the flight card's
  storage or the other tabs.
- IFR FUEL follows the OMA — never less restrictive, not more restrictive. Rules live in
  the dataset (`oma_rules`: gnss_approach_types, alternate_validity,
  profiles_by_destination, multi_sector), not in code. PinS destinations: C/D only
  (IFR); VFR legs allowed anywhere.

## Decisions log
- July 2026 — WX/METAR tab investigated and rejected: aviationweather.gov
  blocks browser CORS; the workaround (GitHub Actions data pipeline) adds
  15–25 min latency, losing to AeroWeather on the "must beat the existing
  way" test. Do not revisit without a use case that needs weather data
  inside a calculation rather than for display.
- Nov 2026 — IFR FUEL rebuilt as a multi-sector trip planner (brief + prototype in the repo).
  Scenario D changed from "dest → alt1 → alt2 chained, 3 approaches" (Ed's earlier rule) back
  to the OMA "fuel to the farther of the two alternates, 2 approaches", at Ed's direction.
  Dropped with the single-leg planner: the approach stepper, discretionary fuel, editable
  start & taxi, the engine-failure (<75 kg) and usable-fuel (904 kg) notes. Kept: profile
  hints and the approaches lines (now inside each sector's details). The map no longer
  selects fields; it draws the route and tapping a site shows what it is.
- Open items (brief §7, kept as data, awaiting confirmation): contingency 10% per sector
  planned as used; no PinS plan without an alternate; PinS procedure status; site
  coordinates (EGGB user-supplied); OMA PinS text provisional.
- Nov 2026 — IFR FUEL: VFR added as a sixth profile (data: oma_rules.scenarios.VFR, offered for every
  destination): start & taxi + trip + 10% contingency (same as IFR, Ed's choice) + VFR day final
  reserve 100; no approach, no alternate. Night VFR not covered. PLANNED/CONFIRM approach status is
  no longer displayed anywhere (all PinS are unofficial until plates exist); the `status` field
  stays in the data and still bars those sites from being alternates.
