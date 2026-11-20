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
- `src/powercheck.js` + `assets/rfm-fig-s3-13-v1.jpg` — the PWR CHK calculator and the RFM page image
  (see "Power check" below). Delivered files: never edit, re-encode or regenerate them.
- `src/duties.js` — the DUTIES tab's lists (data only; see "Base duties" below).
- `test-fixtures/` — the v19 card PDF for a card with pre-v20 power checks (domtest26 proves
  legacy entries still print byte-for-byte the same).
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
- Crew guide (`crew-guide-v2.pdf`, ~8.8 MB, 40 slides, repo root): its own cache `flightcard-guide-v2`, kept
  across deploys like the fonts, so a deploy never downloads it again. Cached best-effort at
  install AFTER the shell (never fails or delays the shell); served cache-first with no
  background refresh (immutable under its name); not cached + no signal → a 503 notice
  "Crew guide not saved on this phone yet. Open it once with signal."
- **Updating the crew guide:** add `crew-guide-vN.pdf` (byte-for-byte original, never a
  re-render), delete the old file, then bump TOGETHER `GUIDE_URL` (src/app.jsx), `GUIDE` and
  `GUIDE_CACHE` (src/service-worker.src.js, e.g. `flightcard-guide-v3`), update the expected file
  name/page count in domtest20/21/22 and tools/check_offline_chrome.js, and rebuild. The old
  `flightcard-guide-*` cache is deleted by the activate filter. The README link label
  "README — HOW THE APP WORKS" is quoted in the guide (slides 19 and 40) — don't rename it.
- RFM chart image (`assets/rfm-fig-s3-13-v1.jpg`, ~0.6 MB) for PWR CHK: same pattern as the guide —
  own cache `flightcard-assets-v1` (`RFM_IMG` / `ASSET_CACHE`), cached best-effort at install after
  the shell, kept across deploys, cache-first with no background refresh; not cached + no signal →
  an empty 503, and the app shows "RFM CHART IMAGE NOT SAVED ON THIS PHONE YET — OPEN ONCE WITH
  SIGNAL" (the PDF still builds, with a grey box in its place). The app only fetches it while PWR CHK
  is open (no network use on any other tab).
- Tests: domtest20 (build artefacts, registration, manifest, the guide file itself), domtest21 (runs the built SW
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
- Power check once per card, REDO to overwrite; recording for a row replaces that row's entry. Since
  v20 it is worked on the PWR CHK tab (see "Power check"); pre-v20 entries are never migrated.
- Carry-over: SRP +1, AVAILABLE = previous REMAINING.
- Every feature must be faster than pen and paper; when in doubt, remove.
- The app must launch with no signal after one online visit (service worker), and an
  update must never reload or interrupt an open session.
- Purple (`C.purple`, NIGHT #B57CFF / DAY #6A2FC0) means "tap to expand" and is used only by
  `ExpandArrow` (domtest23 fails if it appears anywhere else). In IFR FUEL and PWR CHK every expandable thing
  uses it; the sector FUEL WORKINGS are a `<details>` (closed by default, state `workOpen`, reset
  wherever `open` is reset). Collapsing is screen-only: the PDF always prints every sector's
  full workings, and the table stays in the DOM.
- The IFR FUEL tab is an unregulated cross-check: the "Planning cross-check only —
  not a certified flight-planning tool" disclaimer must stay visible. It is fully
  offline — **no network request of any kind** (domtest16/17 fail if one is made). It
  stores only its own trip under `ifr-fuel-trip` and never touches the flight card's
  storage or the other tabs.
- IFR FUEL follows the OMA — never less restrictive, not more restrictive. Rules live in
  the dataset (`oma_rules`: gnss_approach_types, alternate_validity,
  profiles_by_destination, multi_sector), not in code. PinS destinations: C/D only
  (IFR); VFR legs allowed anywhere.

## Power check (PWR CHK tab, v20) — personal trial
- **Source:** AW169 RFM 169F0290X001 Supplement 3, Fig S3-13 "P&WC 210A Hover Power Check Chart -
  EAPS OFF", page S3-32, Issue 3 Rev 1. `PC_CHART` in `src/powercheck.js` holds the RFM PDF's own
  vector paths (17 pressure-altitude lines, 10 + 10 OAT lines), extracted from the PDF, not hand-traced.
  **Do not edit PC_CHART** (or the maths) by hand. The one sanctioned edit so far is fix 1 (v22, at Ed's
  direction): two lines at the top of `interpFamily` so a value exactly on a drawn line reads that line
  alone — file now 10,088 bytes, sha256 f4466e8e… (domtest25 checks it). The page image is `assets/rfm-fig-s3-13-v1.jpg`
  (2121 × 1533 px, page S3-32 rotated and cropped; `pcU`/`pcV` map chart points onto it).
- **Validation:** the same extraction method run on Fig S3-12 (EAPS ON) reproduces the RFM worked
  example (3000 ft, 0 °C, TQ 91 % → 761.7 °C / 90.20 % against the RFM's 760 / 90.2). domtest25 holds the
  golden values and imports `src/powercheck.js` itself.
- **Rounding:** max ITT rounded DOWN to the whole °C, max NG DOWN to 0.1 % (a reading error can only
  make the check stricter); PAM = rounded max − indicated. Never extrapolates: outside the drawn lines
  there is no result (an error message instead).
- **Logic = RFM Supp 3 steps 7, 11, 12 exactly:** 1-minute reading — both PAMs > 0 → WITHIN LIMITS;
  otherwise repeat holding a fixed collective for 3 min — PAM ≥ 0 → WITHIN LIMITS ON 3-MIN REPEAT;
  still negative → "PAM STILL NEGATIVE ON 3-MIN REPEAT — RFM PERFORMANCE MAY NOT BE ACHIEVED. REFER TO
  MM". Advisories that never change the result: above the chart's 930 °C / 98.2 % note; TQ below the
  92 % company minimum.
- **Cross-check against another app:** "AGREES" within 2 °C ITT / 0.1 % NG — a trial comparison
  threshold, NOT an RFM figure (`PC_AGREE`).
- **Stored entry** `{v: 2, row, acReg, srp, site, dateZ, timeZ, oat, qnh, elev, paIn, eng, result}`:
  inputs as typed plus a `result` snapshot taken at RECORD, so an archived card never changes if the
  chart data is ever updated. Entries without `v: 2` (pre-v20) display and print exactly as before
  (domtest26 compares against `test-fixtures/legacy-card-v19.pdf`).
- **Personal trial:** the page, the PDF and this note all say the company power check method governs.
- **When the RFM changes:** get the new figure from the RFM PDF → re-extract its vector paths into a
  new `PC_CHART` (re-validate against the worked example) → save the new page image as
  `assets/rfm-fig-s3-13-v2.jpg` → bump TOGETHER `PC_IMAGE.file` (powercheck.js), `RFM_IMG` and
  `ASSET_CACHE` (`flightcard-assets-v2`, service-worker.src.js) and `PC_CHART_REF` (app.jsx) → update
  domtest20/21/25/26 and tools/check_offline_chrome.js, then rebuild. The old asset cache is deleted
  by the activate filter.

## Base duties (DUTIES tab, v24)
- **Data:** `src/duties.js` (`DUTIES`: `daily`, `night`, `days` keyed by `getDay()` 0 = Sunday … 6 = Saturday,
  `optional`, `winter`). Edit the lists there; `DutiesPage` in app.jsx only renders them, section by section.
  Item shapes: `{id, t}`, `{id, t, auto: "pc"}`, `{id, t, handover: true}`, `{id, t, sub: [items]}`.
- **Stable ids:** ticks are stored on the card as `card.duties = {id: true}` (only ticked leaves; a parent's
  own id is never stored — its tick is "all its sub-items ticked"). NEVER rename or reuse an id: old cards
  would show the wrong ticks. A changed wording keeps its id; a new duty gets a new id; a removed duty's id
  is retired, never given to something else. domtest27 checks every id is unique.
- **Adding a duty:** add `{id: "new-id", t: "Text"}` to the list (sub-items: `sub: [...]` with their own ids).
  A weekday duty goes in `days[n]`. **A new optional group** (like Fuel check cabinet): one item with `sub`.
  **A new section** (beyond daily / night / days / optional / winter) needs one `dropSection(...)` line in
  `DutiesPage` and one line in `dutiesPdfLines` — the rest is data.
- **Auto power check:** the `auto: "pc"` item counts as done when `card.powerChecks.length > 0` (any shape,
  legacy included) or when ticked by hand; the auto tick is never stored.
- **Handover line:** under the `handover` item, while the compressor wash (`cw`) or the power check is not
  done: `HAND OVER: COMPRESSOR WASH / POWER CHECK / COMPRESSOR WASH + POWER CHECK NOT DONE`. The card PDF
  prints `HANDOVER: … NOT DONE` (amber) on the same condition.
- **Storage rules:** `freshCard()` has `duties: {}`; a card loaded from storage is never given a `duties`
  field — no field = pre-v24 card: no ticks on screen, no DUTIES section in its PDF (byte-for-byte as
  before, domtest26). The first tick on such a card creates the field. Carry-over copies no ticks.
  `cardUsed` counts ticks. Drop-down open/closed is screen state in FlightCard (`dutyOpen`), never saved.
- **Weekday:** from the card date (`parseCardDate`, UTC noon → `getUTCDay`); today's if the date can't be read.
- **Later (not built):** show only the card date's duties once the lists are final — the page renders per
  section so a filter can be added without restructuring.

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
- Open items (brief §7, kept as data, awaiting confirmation): no PinS plan without an alternate; PinS procedure status; site
  coordinates (EGGB user-supplied); OMA PinS text provisional.
- Nov 2026 — IFR FUEL: VFR added as a sixth profile (data: oma_rules.scenarios.VFR, offered for every
  destination): start & taxi + trip + 10% contingency (same as IFR, Ed's choice) + VFR day final
  reserve 100; no approach, no alternate. Night VFR not covered. PLANNED/CONFIRM approach status is
  no longer displayed anywhere (all PinS are unofficial until plates exist); the `status` field
  stays in the data and still bars those sites from being alternates.
- Nov 2026 (v14) — IFR FUEL opens blank and RESET TRIP clears to a blank trip (two empty stops),
  at Ed's direction: no pre-filled Redhill → William Harvey → King's College → Redhill route
  (that route now lives only in the tests, `exampleTrip()`). Incomplete trips show
  "SELECT EVERY STOP TO PLAN", no minimums, and EXPORT PLAN (PDF) disabled. Contingency rule
  CONFIRMED by Ed (closed as an open item): 10% of each sector's trip is burnt on that sector;
  none of it is carried forward to the next leg (the maths already did this; wording only).
- Nov 2026 (v15) — London City (EGLC) removed from the dataset entirely (stop, alternate, map):
  Ed confirmed it is approved-operators only. Farnborough (EGLF) added as an IFR airfield from
  UK eAIP AD 2 EGLF (AIRAC 29 Oct 2026): ARP 51°16'31"N 000°46'39"W, Jet A-1, ILS/DME, LOC/DME
  and SRA 2 NM to 06 and 24, no RNP. A stored trip naming a site no longer in the dataset now
  keeps its other stops and shows that one as SELECT (previously the whole trip was wiped).
  Example-trip minimums unchanged (759/565/365; King's College's nearest alternate is now Biggin
  Hill). Redhill → Biggin Hill (B) → Redhill VFR example: 366 → 373 kg (alternate now Gatwick).
- Nov 2026 (v16) — IFR sector tables always show the full own OMA working (alternate, approaches,
  final reserve), then "This leg (OMA)", the "Onward legs" extra and MIN TO LIFT, then the fuel at
  that stop and "Discretionary" (commander's discretion = fuel − min to lift; BELOW MINIMUM if
  negative). Ed: "all the working is shown … so someone else doesn't go 'where has that figure gone?'"
  Previously, when the onward chain governed, the own working (incl. final reserve) was replaced by
  a single Onward line. Display only — no minimum changed. Do not hide working again.
- Nov 2026 (v17) — IFR FUEL presentation: purple boxed arrows replace the ▾/▴ characters (Ed
  couldn't tell the sector lines were tappable); an opened sector shows one plain-English sentence
  (src/ifr-explain.mjs, reads engine figures only) and the full table moves behind a FUEL WORKINGS
  toggle, closed by default. For profile A the sentence also says "(incl. 15 min added to trip)",
  because A's figure includes it. No calculation, data, PDF or storage change.
- Nov 2026 (v18) — FLIGHTS: (A) HEMS is ticked on the flight that LANDS at the scene; the patient
  boards there, so ticking HEMS flags the NEXT row `patient: true` and that row's `patientKg` is
  added to its own DEP GW (`DEP GW 4395KG (PT 85)`). PATIENT KG input moved off the HEMS row to a
  PATIENT ON BOARD line. Sector 7 HEMS → new card row 1 flagged on carry-over. Unticking HEMS
  clears the next row's flag only if its weight is empty (Ed unticks it himself). (B) REFUEL now
  asks for confirmation (planned, or OTHER FIGURE + note), saved as `refuelTo` / `refuelNote` only
  on CONFIRM; limits: above usable 904 kg or below landed fuel block CONFIRM. depFuel after a
  refuel = `refuelTo` (old rows without it = planned). Carry-over startFuel = last refuelTo when it
  differs from planned. OLD ENTRIES ARE NOT MIGRATED: a HEMS row saved before v18 with a patient
  weight no longer counts it — don't update mid-shift with a patient or refuel already entered.
  Reopening a confirmed refuel and pressing CANCEL keeps the confirmed figure (only a fresh,
  unconfirmed tick is undone by CANCEL).
- 19.11.2026 (v19) — UPLIFT tab: link to the crew guide (PDF), saved for offline use. README link kept
  below it (label unchanged; subtext now "Full calculations on GitHub (needs signal).").
  tools/check_offline_chrome.js now reads the current APP_VERSION instead of a hard-coded "v8", and
  checks the IFR tab by its disclaimer (the old "AW169 CROSS-CHECK" heading no longer exists).
  OUTSTANDING: Ed's iPhone check that the home-screen app's in-app browser sheet opens the guide
  offline (flight mode, app closed and reopened, tap USER GUIDE, Done returns to the card intact).
  If it fails: do not improvise — choose between an in-app slide viewer and accepting "needs signal".
- 19.11.2026 (v20) — PWR CHK tab: RFM Fig S3-13 hover power assurance check — max ITT/NG, PAM, 3-min
  repeat logic, readings drawn over the RFM page, power check PDF. Replaces the power check panel on
  UPLIFT (UPLIFT is fuel only again). Tab bar now five tabs + toggle at 375 px: tabs flex 1 1 auto,
  padding 12px 4px, gap 6, toggle 36 px, text 10.5 px / 0.03em (11 px measured 1-3 px too wide).
  New palette colour `red` (PAM failing / exceeds only). The real-Chrome check now runs at 375 px.
  Personal trial — the company power check method governs.
- 19.11.2026 (v21) — PWR CHK, at Ed's request: A/C REG and SRP follow the A/C DATA page (live, until
  typed over on PWR CHK — `follow` ref); CHART and CROSS-CHECK: OTHER APP are now `<details>` drop-downs
  with the purple ExpandArrow (CHART open by default and kept as left for the session; CROSS-CHECK
  closed, opened automatically when a recorded check with cross-check figures is reopened). Screen
  only — the PDF always has the chart and any cross-check.
- 19.11.2026 (v22) — Power check: reading exactly on a chart line fixed; ENG 2 drawn dotted on top of
  ENG 1. (1) `interpFamily` now reads a drawn line alone when the value is exactly on it (e.g. PFD
  1000 ft): TQ 92 at 0 ft, OAT 10 → max ITT 756 (was "outside the chart lines"). Consequence agreed with
  Ed's rule "outside the chart = outside the airframe's parameters = no result": TQ 105 at exactly
  -1000 ft (OAT 40) now gives 870 / 95.6, because the drawn -1000 ft line reaches TQ 108.83; -999 ft,
  -500 ft and TQ 109 at -1000 ft still give no result (domtest25). (2) Overlay: ENG 1 red solid 1.6 with
  r 7 rings + dots, drawn first; ENG 2 magenta round dots (dasharray 0.01 4.4, width 2.2, round caps)
  with r 9.5 dotted rings, no dot, drawn on top. PDF: ENG 2 0.55 mm, round cap, dash [0.01, 1.15],
  reset to solid/butt afterwards. Captions and the PDF legend updated.
- 19.11.2026 (v23) — Bug fix (Ed): switching DAY/NIGHT cleared an unrecorded power check. The theme
  toggle remounts every tab (key={theme}); PWR CHK's check in progress now lives in App (`pwrKeep`:
  figures, context seq, REG/SRP follow flags, drop-down state), so the toggle keeps it. Rule for any
  future tab: state that must survive the theme toggle belongs in App or storage, not in the tab.
- 19.11.2026 (v24) — DUTIES tab: daily / end-of-shift, night, weekday, optional and winter checklists;
  ticks saved on the card and printed on the card PDF. Tab bar now two rows: A/C DATA · FLIGHTS ·
  UPLIFT / DUTIES · PWR CHK · IFR FUEL (row 2 order at Ed's request). Grid `1fr 1fr 1fr 40px`,
  gap 6, the theme toggle in column 4 spanning both rows; tab text unchanged (10.5 px / 0.03em). Lists in
  `src/duties.js` (stable ids — see "Base duties"); the page renders inside FlightCard (`page="duties"`)
  so it shares the card and its save. Card PDF: DUTIES DONE between POWER CHECKS and MISC, only when the
  card has a `duties` field; the HANDOVER line in amber. domtest27 (new) covers data, layout, storage,
  behaviour and the PDF; tools/check_offline_chrome.js checks the two-row bar at 375 px.
- 19.11.2026 (v25) — PWR CHK, at Ed's request: the CHART drop-down starts closed (`pwrKeep.chartOpen`
  false); open it with its arrow, and it stays as left for the session. Screen only — the power check
  PDF always includes the chart.
- 20.11.2026 (v26) — Crew guide updated to Ed's new 40-slide version (covers v24 DUTIES, the two-row
  tab bar and v25's closed CHART): `crew-guide-v2.pdf`, byte-for-byte his file (8,772,731 bytes, sha256
  89a45e6a…), `crew-guide-v1.pdf` deleted. `GUIDE_URL`, `GUIDE` and `GUIDE_CACHE` (`flightcard-guide-v2`) bumped
  together, so every phone downloads the new guide once (best-effort, after the shell) and the activate
  filter deletes `flightcard-guide-v1` (domtest21). UPLIFT link text: 40-slide crew guide.
- 20.11.2026 (v27) — Bug fix (Ed): figures typed on PWR CHK were cleared when a ground run's
  POWER CHECK? → YES started a check for that flight (every new context loaded a blank). Now, when
  there is no recorded entry to load for the new row, an unrecorded check with figures typed in
  (`pwrKeep.unrecorded` + `pcHasFigures`) is kept and just moves to that row (FOR: FLIGHT n), time
  and all. RECORD and CANCEL clear `unrecorded`, so the next start is empty; tapping a recorded entry
  still loads that entry. domtest26 section v27.
- 20.11.2026 (v28) — FLIGHTS, at Ed's request: a departure weight over 4600 kg (SRP notation) is
  underlined on the row so it catches the eye for the paperwork. Cyan underline (Ed's choice of three
  options), not amber: it is a note, not a fault. Same rule as the PDF's NOTE ON SRP line: strictly
  over 4600, never a 0-minute ground run; a planned (not yet flown) row is underlined too. Over AUM
  keeps bold amber — OVER AUM, also underlined. The DEP GW sideways-scroll box got paddingBottom 4:
  without it Chrome clipped the underline (seen at 375 px). domtest28.
- 20.11.2026 (v29) — Audit B1 fix: typing then switching DAY/NIGHT within the 600 ms save delay lost
  the edit (the remounted FlightCard loaded the card from before the edit; the next keystroke saved
  over it). FlightCard now keeps the pending card in `pendingSave` and writes it on unmount
  (`flushSave`, synchronous localStorage write, which React runs before the new instance's load).
  Before → after: B1 reproduction (MISC, flight 1 FUEL KG, a DUTIES tick) 6 failing checks → 0;
  tests 765 → 777 (domtest29 new, 12 checks; includes an edit on a previous card and "no pending save
  = no write"); index.html 1,197,934 → 1,198,069 bytes (gzip 371,813 → 371,831).
- 20.11.2026 (v30) — Audit T1: golden TEXT snapshots of every PDF (domtest30, tests only; no app
  change apart from the version). `test-fixtures/golden/`: card-modern (53 lines, from
  `test-fixtures/modern-card.json`: 4600 note, ground run + v2 power check with repeat and
  cross-check, HEMS, refuel to planned and to a hand figure, patient over AUM, DUTIES, MISC),
  ifr-reference (209 lines, EGKR-EGKD-EGKC-EGKR, C, 820 kg), powercheck-image (49) and
  powercheck-noimage (50). Only the app version (v<N>) and "now" stamps (<DATE>/<TIME>, build date) are
  normalised. A deliberate PDF change: `GOLDEN_UPDATE=1 node domtest30.js`, review the diff, commit.
  Mutation check: altering one golden line fails the test. Before → after: tests 777 → 790;
  index.html 1,198,069 → 1,198,069 bytes (gzip 371,831 → 371,829).
- 20.11.2026 (v31) — Audit T5 then F1. T5 (domtest31): `build/app.js` size budget (the size after the
  last deliberate change + 2 %), read with the esbuild metafile `build/meta.json` that `npm run build`
  now also writes; first set at 1,196,709 + 2 % and passed on the unchanged build. F1: the build marks
  jsPDF's `html2canvas`, `canvg` and `dompurify` as `--external`. They serve only `doc.html()` and SVG,
  which the app never calls (it uses text, lines, rect, circle and one JPEG `addImage`); the bundle
  keeps three unreached `import("…")` calls. T5 tightened to 798,007 + 2 % = 813,967 and now also fails
  if any of those libraries (metafile inputs or their code signatures) comes back.
  Before → after: build/app.js 1,196,709 → 798,007 bytes (−33 %); index.html 1,198,069 → 799,367
  (gzip 371,829 → 258,513); first render (§1.5 method, median of 7, paired run) 450 → 366 ms, first
  contentful paint 452 → 332 ms; PDFs text-identical (domtest30); tests 790 → 800; Chrome check 27/27.
  Test timing note: a suite run while the Mac slept with the lid shut took 5,139 s wall time and the
  Chrome check's 10 s "flaky signal" step then read 905,783 ms; both re-run awake: green / 27/27.
- 20.11.2026 (v32) — Audit F2: jsPDF's PNG reader is stubbed. The build aliases `fast-png` to
  `src/stubs/fast-png.js` (decode/encode throw "PNG images are not supported in this build"), which
  leaves fast-png, pako and iobuffer out; the app's only PDF image is the RFM JPEG. T5 (domtest31)
  extended: no fast-png/pako/iobuffer input, no PngDecoder, the stub is the input, PNG/pako code
  signatures absent; budget 732,226 + 2 % = 746,870. If a PNG is ever needed in a PDF, remove the alias
  and raise the budget in the same version.
  Before → after: build/app.js 798,007 → 732,226 bytes; index.html 799,367 → 733,586 (gzip 258,513 →
  238,429); first render (paired, median of 7) 372 → 349 ms, first contentful paint 364 → 312 ms; PDFs
  text-identical, RFM JPEG still embedded (domtest30); tests 800 → 804; Chrome check 27/27.
