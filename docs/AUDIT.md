# Whole-app audit: efficiency and tidiness

**App version audited:** v28 (commit `666e27b`), 20.11.2026. The request said v26; the live app had already moved on to v28 (v27 power check fix, v28 4600 kg underline), so this audit covers v28.
**Report only:** no app code was changed for this audit. Every number below was measured on this repo unless it is marked *estimate*.

---

## Rules for any change that comes out of this report

1. **No visible or functional change:**
   * same screens and wording;
   * same stored data shape;
   * previous cards still load;
   * generated PDFs text-identical apart from the version and date stamps.
2. **All tests pass before and after.** Where coverage is thin, add the tests first, in their own version (see §5).
3. **One finding per version**, so any one can be rolled back on its own.
4. **Record before and after numbers** in each version entry (HANDOVER.md decisions log). Use the methods in §1 so the numbers are comparable.

---

## Bug found while auditing (outside the ranking: fix it first)

### B1. Typing then switching DAY/NIGHT within 0.6 s loses the typed text

**Where:** `src/app.jsx`.
* The flight card saves 600 ms after the last edit (`scheduleSave`, line 917).
* The DAY/NIGHT toggle remounts every tab (`key={theme}`, line 4130).
* The new FlightCard reloads the card from storage (line 877) before the pending save has been written.
* There is no unmount clean-up that writes the pending save.

**Reproduced (jsdom):**
1. Type "oil checked" in MISC.
2. Toggle DAY/NIGHT 100 ms later.
   * Screen MISC = `""`. Storage MISC = `"oil checked"` (the old timer still fires).
3. Type one more character: storage MISC = `"X"`. **"oil checked" is lost.**

The same applies to every card field, including a DUTIES tick and an edit on a previous card. It's the same family as the v23 power check bug: state lost because of the theme remount.

**Fix (behaviour-restoring, its own version):** write any pending save at once when FlightCard unmounts. Use a clean-up effect that calls `flushSave` with the latest card, kept in a ref.

**Risk:** low. **Effort:** S.

**Verification:** a new jsdom test that does exactly the reproduction above for MISC, a flight row field and a DUTIES tick:
* screen and storage both keep the text after the toggle;
* a further keystroke appends to it.

The rest of the suite stays green.

---

## Do first (maximum 5)

| # | Finding | Measured gain | Risk | Effort |
|---|---|---|---|---|
| 1 | **T1** Golden text snapshots of all three PDFs (§5). The safety net for everything below. | Catches any PDF text change | none (tests only) | S |
| 2 | **F1** Stop bundling jsPDF's unused html2canvas, canvg and DOMPurify. | −399 KB raw (−33 %), −113 KB gzip; first render 442 → 368 ms (−17 %) | low | S |
| 3 | **F2** Stub jsPDF's PNG decoder (fast-png + pako + iobuffer); the app only embeds a JPEG. | A further −66 KB raw, −20 KB gzip; 368 → 348 ms | low | S |
| 4 | **F3** Delete `src/app-v9-backup.jsx`: a dead 61 KB, 1,733-line copy of the v9 app. | Tidiness: no stale code in searches | none | S |
| 5 | **F4** One shared PDF share/download function instead of three copies. | −30 lines; one place to fix iOS sharing | low | S |

After 1 to 5: index.html would be about **733 KB, down from 1,198 KB**, and first render about **21 % faster** (measured on a test build, §1.5). There would be no visible change.

---

## 1. Baseline measurements (v28)

### 1.1 index.html

| | Bytes |
|---|---|
| Raw | 1,197,934 |
| gzip -9 | 371,813 |

`build/app.js` (minified bundle, inlined into index.html) is 1,196,574 bytes from 215 inputs.

### 1.2 Bundle composition

Method: `esbuild src/app.jsx --bundle --minify --metafile` with the same flags as `npm run build`. esbuild 0.28.1, jsPDF 4.2.1, React 19.2.7.

**15 largest inputs:**

| # | Bytes in output | Share | Input |
|---|---:|---:|---|
| 1 | 339,743 | 28.4 % | node_modules/jspdf/dist/jspdf.es.min.js |
| 2 | 205,221 | 17.2 % | node_modules/html2canvas/dist/html2canvas.js |
| 3 | 177,030 | 14.8 % | node_modules/react-dom/cjs/react-dom-client.production.js |
| 4 | 101,587 | 8.5 % | src/app.jsx |
| 5 | 82,941 | 6.9 % | node_modules/canvg/lib/index.es.js |
| 6 | 57,923 | 4.8 % | src/map-geometry.json |
| 7 | 47,567 | 4.0 % | node_modules/pako/dist/pako.esm.mjs |
| 8 | 28,932 | 2.4 % | node_modules/dompurify/dist/purify.es.mjs |
| 9 | 18,435 | 1.5 % | node_modules/svg-pathdata/lib/SVGPathData.module.js |
| 10 | 8,569 | 0.7 % | node_modules/fast-png/lib-esm/PngDecoder.js |
| 11 | 8,560 | 0.7 % | src/fuelcalc.js |
| 12 | 7,659 | 0.6 % | node_modules/react/cjs/react.production.js |
| 13 | 7,611 | 0.6 % | src/fuel-planner-dataset.json |
| 14 | 6,665 | 0.6 % | node_modules/fflate/esm/browser.js |
| 15 | 6,251 | 0.5 % | src/powercheck.js |

**By dependency tree:**

| Group | Bytes | Used by the app? |
|---|---:|---|
| jsPDF core | 339,743 | yes (3 PDFs) |
| html2canvas | 205,221 | **no**: only for `doc.html()` |
| react-dom + react + scheduler | 188,722 | yes |
| canvg tree (canvg, core-js 47,003, svg-pathdata, rgbcolor, stackblur-canvas, raf…) | 159,464 | **no**: only for SVG in PDFs |
| app source (`src/`) | 183,764 | yes |
| fast-png tree (fast-png, pako, iobuffer) | 65,815 | **no**: PNG images only; the app adds one JPEG |
| DOMPurify | 28,932 | **no**: only for `doc.html()` |

### 1.3 Source files

| File | Lines | Bytes |
|---|---:|---:|
| src/app.jsx | 4,252 | 177,304 |
| src/app-v9-backup.jsx | 1,733 | 61,753 (dead: F3 — deleted in v33) |
| src/fuelcalc.js | 329 | 18,043 |
| src/service-worker.src.js | 222 | 9,528 |
| src/powercheck.js | 138 | 10,088 (delivered file: do not edit) |
| src/fuel-planner-dataset.json | 102 | 10,061 |
| src/duties.js | 54 | 2,375 |
| src/ifr-explain.mjs | 19 | 1,257 |
| src/map-geometry.json | 1 (single line) | 58,172 |

### 1.4 Test run time

`npm test` runs 23 files and 765 checks, all passing, in **338 s**, timed per file on this Mac:

| | |
|---|---|
| Slowest files | domtest26 57 s · domtest27 50 s · domtest19 48 s · domtest24 36 s · domtest12 19 s · domtest22 19 s · domtest16 18 s · domtest13 15 s · domtest28 13 s |
| Fixed waits | **240.8 s** of the 338 s is fixed `sleep(…)` waits (58 × a 2.5 s app start, plus many short waits). See F11. |

### 1.5 Time to first render

**Method.** Playwright isn't installed in this repo. I used the same headless Chrome it would drive, via the DevTools protocol, which is how `tools/check_offline_chrome.js` already works. Chrome version: 157.

Settings:
* iPhone viewport 390 × 844 at 3×, iPhone Safari user agent;
* CPU throttled ×4;
* fresh profile every run (cold: no HTTP cache, no service worker);
* Google Fonts blocked so network noise doesn't count.

"App rendered" is when the FLIGHTS screen's text first appears. Each figure is the median of 7 runs. The script is in this report's appendix.

| Build | Script size (raw / gzip) | First contentful paint | App rendered | DOMContentLoaded | JS heap |
|---|---|---:|---:|---:|---:|
| **v28 as shipped** | 1,197 KB / 372 KB | **436 ms** | **442 ms** | 355 ms | 5.9 MB |
| F1 applied (test build) | 798 KB / 258 KB | 332 ms | 368 ms (−17 %) | 281 ms | 5.3 MB |
| F1 + F2 (test build) | 732 KB / 238 KB | 316 ms | 348 ms (−21 %) | 261 ms | 5.0 MB |
| F1 + F2 + no jsPDF at start (upper bound for F9) | 377 KB / 124 KB | 228 ms | 266 ms (−40 %) | 183 ms | 3.4 MB |
| PWR CHK and IFR FUEL not mounted until opened (F8) | 1,197 KB / 371 KB | 412 ms | 404 ms (−9 %) | 322 ms | 5.7 MB |

The test builds were made in a scratch folder; the repo was not changed. Absolute times on an iPhone will differ; the relative gains are the point.

### 1.6 Typing cost and storage

Measured in the same Chrome set-up (CPU ×4), with a full 7-flight card, a power check, duties, 4 previous cards and a 4-stop IFR trip. Each keystroke is timed from input to React update and layout, median of 10.

| Typing in | Median | Max |
|---|---:|---:|
| UPLIFT · CURRENT FUEL | 5.8 ms | 13 ms |
| IFR FUEL · actual fuel | 2.4 ms | 8.2 ms |
| FLIGHTS · flight 7 FUEL KG | 1.6 ms | 6.2 ms |
| PWR CHK · OAT | 1.1 ms | 6.0 ms |
| A/C DATA · MISC | 0.9 ms | 4.6 ms |

All stay well under one screen frame (16.7 ms).

**Storage (characters):**

| Key | Size |
|---|---:|
| `daily-flight-card` | 2,316 |
| `card-history` (4 full cards) | 9,369 |
| `ifr-fuel-trip` | 178 |
| `theme` | 5 |

That's about 12 KB of the roughly 5 MB browser allowance.

---

## 2. Findings, ranked by gain ÷ risk

The "Do first" items above are F1 to F4 plus test T1. In this section, the findings each have:
* **Where:** file and lines;
* **Gain:** measured, or marked *estimate*;
* **Risk:** low / medium / high;
* **Effort:** S / M / L;
* **Verify:** how to prove the change altered nothing.

### F1. jsPDF's unused optional libraries are bundled: html2canvas, canvg (+ core-js) and DOMPurify

**Where:**
* `package.json` `build` script;
* `src/app.jsx:3` (`import { jsPDF } from "jspdf"`).

jsPDF 4.2.1 loads these three with dynamic `import("…")`, and only from `doc.html()` (html2canvas, DOMPurify) and SVG support (canvg). esbuild, without code-splitting, inlines dynamic imports into the single bundle anyway.

**Confirmed against our real bundle and code:**
* The three trees are 393,617 bytes of the 1,196,574.
* The only jsPDF calls in the app are `text`, `setFont`, `setFontSize`, `setTextColor`, `line`, `splitTextToSize`, `setLineWidth`, `addPage`, `setDrawColor`, `output`, `setLineDashPattern`, `setLineCap`, `setPage`, `setFillColor`, `rect`, `getTextWidth`, `getNumberOfPages`, `circle` and `addImage(…, "JPEG", …)` (line 3503).
* No `.html()`, `addSvgAsImage`, `svg` or `context2d` call exists.
* The three PDF builders are `makeCardPdf` (547), `makeTripPdf` (2326) and `makePowerCheckPdf` (3417).

**Change:** add `--external:html2canvas --external:canvg --external:dompurify` to the esbuild command in `package.json`.
* The bundle is then left with three `import("…")` strings that are never reached (checked: exactly 3).
* Alternative: `--alias:` each one to a small stub file that throws "not supported in this build". This leaves no bare module names in the output.

| | |
|---|---|
| **Gain** | Bundle 1,196,574 → 797,870 bytes (−398,704, −33 %); index.html gzip 371 → 258 KB. First render 442 → 368 ms, first contentful paint 436 → 332 ms, JS heap −0.6 MB. This confirms the quick jsPDF-only test (820 → 419 KB). |
| **Risk** | Low. The only failure mode is a future change calling `doc.html()` or adding an SVG to a PDF, which would then fail at export. A test (T5) makes that impossible to miss. |
| **Effort** | S (one line in package.json). |
| **Verify** | T1 PDF snapshots identical; full suite; `npm run check:offline` 27/27; `build/app.js` no longer contains html2canvas code; T5 size budget passes. |

### F2. jsPDF's PNG decoder (fast-png, pako, iobuffer) is bundled; the app never adds a PNG

**Where:** same build script. jsPDF imports `fast-png` statically, so it can't be marked external; it has to be swapped for a stub. The app's only image is the RFM chart JPEG (`src/app.jsx:3503`).

**Change:** `--alias:fast-png=./src/stubs/fast-png.js`. The stub is about 3 lines; its `decode`/`encode` throw "PNG not supported in this build".

| | |
|---|---|
| **Gain** | A further −65,842 bytes (797,870 → 732,028), −20 KB gzip; first render 368 → 348 ms. |
| **Risk** | Low. Same failure mode as F1 (a future PNG in a PDF), covered the same way. |
| **Effort** | S. |
| **Verify** | As F1. The power check PDF test (domtest26) already embeds the JPEG and checks `/DCTDecode`, which proves the JPEG path still works. |

### F3. Dead file: `src/app-v9-backup.jsx`

**Where:** `src/app-v9-backup.jsx`: 1,733 lines, 61,753 bytes, in git since the first commit. Nothing imports it; the build bundles only `src/app.jsx`.

| | |
|---|---|
| **Gain** | Repo tidiness. Searches of `src/` stop returning stale v9 code (it contains old versions of `makeCardPdf`, `freshCard` and others). Git history still has it. |
| **Risk** | None. |
| **Effort** | S. |
| **Verify** | `build/app.js` byte-identical before and after (the file is not an input to the build); full suite. |

### F4. The PDF share/download code is written three times

**Where:**
* `src/app.jsx:1214–1231` (card PDF, `sharePdf` inside FlightCard);
* `2514–2533` (`shareTripPdf`);
* `3558–3572` (`shareDocPdf`).

All three do the same thing: blob → File → `navigator.share` if possible, else a download link. `shareDocPdf` is already general.

**Change:** keep `shareDocPdf(doc, name, subject)`. Make the card and IFR versions build their name and subject, then call it.

| | |
|---|---|
| **Gain** | About −30 lines. One place to change if iOS sharing ever needs a fix. |
| **Risk** | Low. File names and subjects must stay exactly as they are; tests already check them for all three PDFs. |
| **Effort** | S. |
| **Verify** | Existing share-stub tests (domtest22, 26, 27 and the legacy fixture); add T6 for the download fallback first. |

*Observation, not a no-change item:* all three call `URL.revokeObjectURL` straight after `a.click()`. Some desktop browsers cancel the download when that happens. The phone always uses the share sheet, so this only matters on a computer.

### F5. Duplicated small helpers

**Where (`src/app.jsx`):**

| Helper | Duplicate | Lines |
|---|---|---|
| `two` | `pad2` | 2324 and 3193. Identical. Also four inline `String(…).padStart(2, "0")` in `todayString`, `nowHHMM`, `zuluFromLocal` and `formatMinutes` (138–171). |
| `rowUsedPdf` | `rowUsed` | 606 and 843. Same six fields, same logic. |
| `signed` | `pcSgn`, `pcSgnA` | 2310, 3200 and 3201. Three "+n / −n" formatters with different decimals and minus signs: two keep "−" for the screen, one uses ASCII for the PDF. |
| `todayString` | `nowZulu`, `shareTripPdf` | `todayString` (local, 141), `nowZulu` (UTC, 3194), and the date built inline in `shareTripPdf` (2515–2517). |
| `pdfText` | `pcPdfText` | 2323 and 3415. `pcPdfText` also removes ° and en/em dashes. |

| | |
|---|---|
| **Gain** | About −20 lines and one definition of each. Small. |
| **Risk** | Low, but merge only exact equivalents. `pdfText` and `pcPdfText` must stay two behaviours: merging them would change IFR PDF text if it ever contains ° or a dash. |
| **Effort** | S. |
| **Verify** | T1 snapshots; a unit test of each helper (T3) written before the merge. |

*Not a no-change item:* the card PDF prints NOTES and MISC without any sanitiser (lines 663 and 756). A character outside the PDF font's set, such as "→", "≥" or an emoji, prints wrongly. Fixing it changes PDF output for such text, so it would be a separate, deliberate change.

### F6. PDF colours are hard-coded RGB values, scattered

**Where:**
* 29 colour calls across the three PDF builders: `src/app.jsx` lines 582–763, 2339–2350 and 3425–3542.
* 9 distinct values: (20,20,20) ×7, (0,130,60) ×4, (90,90,90) ×3, (110,110,110) ×3, (200,120,0) ×2, (60,60,60), (225,228,232), and greys 150 ×3.
* `PC_PDF_TONE` (3370) already shows the pattern to follow.

**On-screen colours** are all from the two palettes, with two exceptions:
* the deliberate chart ink colours `#e0201b` and `#b000d0` (`PC_ENG_STYLE`, 3188–3190), which are the same in both themes because they're drawn over the RFM page;
* the panel shadow (4188).

`build_html.py` repeats `#05080b` (= `NIGHT.bg`) for the page before JS runs. That's correct, but it has to be kept in step by hand.

**Change:** one `PDF_INK` object (text, section green, grey, amber note, rule, fill) used by all three builders.

| | |
|---|---|
| **Gain** | Tidiness; one place to adjust print colours. |
| **Risk** | Low. |
| **Effort** | S. |
| **Verify** | PDFs **byte-identical** after normalising date and ID (stronger than text-identical, because colour operators are compared too). The legacy-card fixture test already does this. |

### F7. Stale comments and docs

**Where:**
* `src/app.jsx:24–37`: header reads "Fuel Uplift + Daily Flight Card — v10" with v10 UX notes.
* `src/app.jsx:2298–2300`: an empty "App shell" banner sits above the IFR section; the App is at 4030.
* `HANDOVER.md` Layout section: "build_html.py … writes to `/mnt/user-data/outputs/…` — change that first thing" is no longer true; it writes `./index.html`.

| | |
|---|---|
| **Gain** | Fewer wrong signposts for the next maintainer. |
| **Risk** | None. |
| **Effort** | S. |
| **Verify** | `build/app.js` byte-identical (comments are stripped by minify). |

### F8. Hidden tabs are all built at start-up

**Where:** `src/app.jsx:4191–4229`. All five tab bodies are mounted at launch and hidden with `display: none`:
* FlightCard (A/C DATA, FLIGHTS and DUTIES);
* FuelCalc;
* PowerCheck;
* IfrFuel, which runs `computeTrip`, `placeLabels` and the full county map at mount.

The state that must survive is already in App or storage. This is the v23 rule.

**Change:** mount PowerCheck and IfrFuel the first time their tab is opened, then keep them mounted.

| | |
|---|---|
| **Gain** | Measured: first render 442 → 404 ms (−9 %), first contentful paint 436 → 412 ms. |
| **Risk** | Low to medium. Check that nothing reads those tabs before they're opened. `cardInfo` flows App → PowerCheck, not back; the RFM image only loads while PWR CHK is active; the IFR trip is read from storage on mount. |
| **Effort** | S. |
| **Verify** | Full suite (domtest16/22/23 and 26 open these tabs); the Chrome check; add a test that opening each tab first, last or after a theme toggle shows the same content (T4). |

### F9. Load jsPDF only when a PDF is exported

**Where:** `src/app.jsx:3`. Today jsPDF is parsed at every launch but used only on export.

**How it could stay offline-safe:**
* Put jsPDF in a second file, named with a content hash (e.g. `pdf-3fa9c1.js`).
* Add it to the service worker's must-cache `SHELL` list (`src/service-worker.src.js:37`). It then installs with index.html, or the install fails and the old version keeps serving. A page can never get an index.html without its matching PDF file.
* Load it with `import()` when the user taps export, and also once in the background a few seconds after first render. Then a first visit that loses signal straight away can still export.

| | |
|---|---|
| **Gain** | Measured upper bound with F1 + F2 already done: first render 348 → 266 ms (a further −24 %); start-up script 732 → 377 KB. |
| **Risk** | Medium to high. (1) It breaks the single-file design that `build_html.py`, the service worker rules and **every jsdom test** rely on: tests load index.html as one inline file, so each PDF test would need resource loading and a file server. (2) A new offline failure mode exists if the second file were ever missing. |
| **Effort** | L, mostly test infrastructure. |
| **Verify** | All PDF tests through the real loader; the Chrome check extended to export a PDF offline after a fresh install and after a deploy. |
| **Recommendation** | Don't do it now. F1 + F2 already take 21 % off first render at no risk. Revisit only if launch still feels slow on the phone. |

### F10. Split `src/app.jsx` into modules

**Where:** `src/app.jsx`, 4,252 lines. Proposed layout, in the order to do it (one module per version):

| Step | New file(s) | Moves (current lines) | About |
|---|---|---|---|
| 1 | `src/ui/theme.js` | NIGHT, DAY, `C`, `mono`, `label`, `inputWell`, `inputStyle`, `btnStyle`, `miniBtn` (53–345) | 150 lines |
| 2 | `src/ui/components.jsx` | `PanelHeader`, `CheckBox`, `ExpandArrow` (346–394, 2539–2562) | 90 lines |
| 3 | `src/lib/format.js` | `parseNum`, `parseMinutes`, `parseAvailMinutes`, `formatMinutes`, `todayString`, `nowHHMM`, `parseCardDate`, `isBST`, `zuluFromLocal`, `SAN`, `KIND_MODE`, plus F5's single pad/sign helpers | 150 lines |
| 4 | `src/lib/geo.js` | `sunTimes`, `latLonToOSGrid` (175–268) | 95 lines |
| 5 | `src/pdf/share.js`, `card-pdf.js`, `trip-pdf.js`, `powercheck-pdf.js` | F4's share function; `makeCardPdf` (547–767); `makeTripPdf` (2320–2533); `makePowerCheckPdf` with `loadRfmImage` (3392–3575) | 650 lines |
| 6 | `src/tabs/Duties.jsx` | duties helpers + `DutiesPage` (2031–2296) | 265 lines |
| 7 | `src/tabs/PowerCheck.jsx` | `pc*` helpers + `PowerCheck` (3165–4028, minus the PDF) | 700 lines |
| 8 | `src/tabs/IfrFuel.jsx` | `IfrMap`, `IfrFuel`, `siteName`, `siteCaption` (2302–3164, minus the PDF) | 650 lines |
| 9 | `src/tabs/FuelCalc.jsx` | `FuelCalc` (395–542) | 150 lines |
| 10 | `src/tabs/FlightCard.jsx` | card constants, `freshRow`, `freshCard`, `cardUsed`, `FlightCard` (769–2030) | 1,260 lines |
| — | `src/app.jsx` keeps | `App`, mount | ~250 lines |

**Watch-outs:**
* `C` is one shared object that App changes in place on a theme toggle (`Object.assign(C, …)`). Every module must import the same `C` from `ui/theme.js`, never a copy.
* The module-level `rfmImagePromise` and `pwrKeep` behaviour must stay single instances.
* esbuild output order changes, so compare behaviour, not bundle bytes.

| | |
|---|---|
| **Gain** | Navigation and review: each tab becomes a 150 to 1,260-line file. Diffs touch one file. Helpers become unit-testable directly, as `fuelcalc.js` and `powercheck.js` already are (domtest15, 25). Bundle size: no change (±1 %, *estimate*). Speed: none. |
| **Cost** | About 10 small versions. During the work, every cross-file name has to be imported correctly; a missed import shows up as a crash at load, which the test suite catches at once. |
| **Risk** | Medium overall, low per step. |
| **Effort** | L in total (S to M per step). |
| **Verify, every step** | Full suite; T1 PDF snapshots; T2 previous-card fixtures; the Chrome check; T7 screenshots of each tab, day and night at 375 px, compared before and after. Do T1, T2 and T7 first. |

### F11. Test suite: fixed waits make up 71 % of the run time

**Where:** all `domtest*.js`.
* 58 × `await sleep(2500)` to wait for app start.
* Hundreds of 40 to 1,500 ms waits.
* 240.8 s of fixed waits in a 338 s run.

**Change:** a shared `waitFor(condition, timeout)` helper (e.g. `test-fixtures/harness.js`) that returns as soon as the app is ready or a save has landed. It replaces the fixed sleeps file by file.

| | |
|---|---|
| **Gain** | *Estimate:* suite 338 s → about 100 s, so every future version's test step is about 4 minutes faster. |
| **Risk** | Low for the app (tests only). The risk is flaky tests if a wait condition is wrong, so convert one file per version and run it 5× before moving on. |
| **Effort** | M. |
| **Verify** | Same PASS lines (names and count) before and after for each converted file. |

### F12. Fonts load late (Google Fonts `@import` inside a React-rendered style)

**Where:** `src/app.jsx:4145`. The font stylesheet is requested only after the 1.2 MB script has run and App has rendered. The `<style>` element is also rebuilt on every DAY/NIGHT toggle, because the tree remounts.

**Change options:**
* (a) Move it into `<head>` as `<link rel="preconnect">` + `<link rel="stylesheet">` in `build_html.py`. The service worker's font cache rules are unchanged.
* (b) Ship IBM Plex Mono (OFL licence) with the app instead. This removes the only third-party request at launch.

| | |
|---|---|
| **Gain** | *Estimate:* the font is ready a few hundred ms sooner on a first visit, so there's less of a swap from the fallback font. No gain on later launches, where the service worker serves the font from its cache. Option (b) also means no Google request at all. |
| **Risk** | Medium. Font timing affects layout, and the narrow tab bar and flight-row lines were tuned with this font. |
| **Effort** | S for (a), M for (b). |
| **Verify** | The Chrome check's tab-fit and no-signal checks; T7 screenshots. |

### F13. Theme switching by remounting the whole app

**Where:** `src/app.jsx:4130` (`key={theme}`) and 84 (`const C = { ...NIGHT }`, changed in place).

Every DAY/NIGHT toggle throws away and rebuilds every tab. That caused the v23 bug, causes B1, and forces any surviving state up into App.

**Change:** use CSS variables for the palette, so the toggle only changes variables and nothing remounts.

| | |
|---|---|
| **Gain** | Removes the cause of a bug class, not just its symptoms; the toggle becomes instant. |
| **Risk** | Medium to high: it touches nearly every style in the app. |
| **Effort** | L. |
| **Verify** | T7 screenshots of every tab in both themes; the B1 and v23 regression tests. |
| **Recommendation** | Only after F10 (the split), if at all. B1's small fix is enough for now. |

### F14. Re-renders while typing (checked; no change recommended)

**Where:** App holds UPLIFT's figures and `cardInfo`, so a keystroke in UPLIFT, or in A/C REG or SRP, re-renders every mounted tab. IfrFuel recomputes `computeTrip`, the label layout and the county map on every keystroke (2697, 2587, 2617), and deep-copies the trip with `JSON.parse(JSON.stringify(…))` (2688).

| | |
|---|---|
| **Gain** | Measured: the worst case is UPLIFT at 5.8 ms per keystroke (max 13 ms) with CPU ×4; the others are 0.9 to 2.4 ms. All are under one frame. `React.memo` or `useMemo` could cut UPLIFT to about 1 ms (*estimate*), which nobody would notice. |
| **Risk** | Medium. Memoising tabs that read the shared `C` object can show stale colours after a toggle if not done carefully. |
| **Effort** | M. |
| **Recommendation** | Don't. Re-measure after F10 if any tab ever feels slow. |

### F15. Storage (checked; no change recommended)

* **Card:** written 600 ms after the last edit (debounced, line 917). The whole card is about 2.3 KB.
* **Previous card:** an edit rewrites the 4-card history, about 9.4 KB.
* **IFR trip:** written on every change, at once (2692), but only 178 characters.
* **Theme and last reg:** on change only.
* **Total:** about 12 KB.

No size or frequency problem. The only real storage issue is B1, which is about *when* the pending card save happens, not how often.

### Dead-code sweep (method and result)

**Method:** every top-level `const`, `function` and `let` in `src/app.jsx` (over 200 names) and every imported name was counted across the file.

**Result:**
* **No unused function, constant or import was found.** Every prop passed to the tab components is read.
* What *is* left over: the backup file (F3), the stale comments (F7) and the duplicated helpers (F5).
* Legacy-shape code is **not** dead and must stay. It keeps previous cards loading:
  * the `tdpWat` → `gwDep` migration (903);
  * the pre-v20 power check lines on the card and PDF;
  * cards without `duties`.

### Naming

Small inconsistencies; fix them only while moving code in F10, never on their own:
* **Prefixes:** `pc*` for power check and `duty*` for duties, but IFR helpers have none (`signed`, `two`, `siteName`, `siteCaption`).
* **Share functions:** named three ways (`sharePdf`, `shareTripPdf`, `shareDocPdf`).
* **Storage access:** FlightCard uses the async `storage` wrapper, while IFR FUEL and the theme use `localStorage` directly.

---

## 3. Load path today (what runs before the first paint)

1. **Parse HTML.** The `<head>` holds only inline CSS and the manifest link, so nothing blocks on the network.
2. **Parse, compile and run one 1.2 MB inline script.** This is the biggest single cost; F1 + F2 remove 39 % of it.
3. **`createRoot().render(<App/>)`** mounts all five tab bodies (F8). FlightCard shows "LOADING CARD…", then reads storage in an effect and renders the card.
4. **Google Fonts `@import`** starts only now (F12).
5. **After `load`:** the service worker registers. On a first visit it caches the shell, then the RFM image, then the crew guide in the background. None of it delays the first paint.

---

## 4. Ranking summary

| Rank | ID | Gain | Risk | Effort |
|---|---|---|---|---|
| — | **B1** data loss on theme toggle (bug, fix first) | correctness | low | S |
| 1 | T1 PDF golden snapshots | safety net | none | S |
| 2 | F1 drop html2canvas / canvg / DOMPurify | −33 % size, −17 % first render | low | S |
| 3 | F3 delete backup file | tidiness | none | S |
| 4 | F2 stub fast-png | −8 % more size, −5 % first render | low | S |
| 5 | F4 one share function | tidiness | low | S |
| 6 | F7 stale comments and docs | tidiness | none | S |
| 7 | F5 duplicate helpers | tidiness | low | S |
| 8 | F6 PDF ink palette | tidiness | low | S |
| 9 | F8 mount PWR CHK / IFR FUEL on first open | −9 % first render | low–medium | S |
| 10 | F11 faster tests | suite 338 s → about 100 s (*estimate*) | low | M |
| 11 | F10 split app.jsx | maintainability | medium | L |
| 12 | F12 fonts in head / self-hosted | earlier font (*estimate*) | medium | S–M |
| 13 | F9 lazy jsPDF | a further −24 % first render | medium–high | L |
| 14 | F13 theme without remount | removes a bug class | medium–high | L |
| — | F14 re-renders, F15 storage | none needed | — | — |

---

## 5. Test gaps: where a refactor could break something unnoticed

Add these first, each in its own version, before the findings that depend on them.

| ID | Gap | Why it matters | Add |
|---|---|---|---|
| **T1** | Only the **legacy** card PDF is compared in full (byte-for-byte, `test-fixtures/legacy-card-v19.pdf`). The modern card PDF, the IFR plan PDF and the power check PDF are only spot-checked line by line. | F1, F2, F4, F5, F6, F9 and F10 all touch PDF code; a changed or dropped line elsewhere would pass. | Golden **text** snapshots, with version and date stamps normalised, of: a full modern card (refuels, HEMS, patient, ground run, a v2 power check with repeat, DUTIES, 4600/AUM notes, MISC); the IFR reference trip; the power check PDF with and without the image. |
| **T2** | No fixtures of **old card shapes**. The `tdpWat` migration (903), more than 7 legacy rows, missing `plannedFuel`, `sunriseSet`, `powerChecks` or `duties`: none are loaded by any test. Previous cards (`card-history`) aren't normalised on load at all. | "Previous cards still load" is a stated rule, and F10 moves this code. | One fixture per historical card shape, taken from git history of `freshCard`. Load each as the current card and as a previous card; render every tab; export the PDF. |
| **T3** | The shared helpers (`parseNum`, `parseMinutes`, `parseCardDate`, `zuluFromLocal`, `isBST`, `sunTimes`, `latLonToOSGrid`, `SAN`) are tested only through the screen. | F5 and F10 merge and move them. | Unit tests that import them directly (possible once F10 step 3 exists; until then, through the screen in a dedicated file). |
| **T4** | The theme toggle is tested only for PWR CHK (v23) and DUTIES. | B1 and F8; F13 later. | Toggle mid-edit on every tab: UPLIFT figures, a FLIGHTS row, MISC, a DUTIES tick, the IFR trip. This includes B1's case. |
| **T5** | No **size budget**. html2canvas could quietly come back with a jsPDF upgrade. | Protects F1 and F2. | Fail the build test if `build/app.js` exceeds the new size + 2 %, or if it contains `html2canvas`, `canvg` or `PngDecoder` code. |
| **T6** | The download fallback (no `navigator.share`) is never exercised. | F4 merges the three copies of it. | Stub `canShare` to false; check that a download link with the right file name is clicked, for each PDF. |
| **T7** | jsdom can't see layout. Clipping, wrapping and overflow are checked only by the manual Chrome check, and only for the tab bar and a few elements. | F10, F12 and F13 can move pixels. | In `tools/check_offline_chrome.js`: screenshots of every tab, day and night, at 375 px, compared with a stored baseline (pixel difference below a small threshold). |

---

## Appendix: how the numbers were taken

* **Sizes:** `wc -c`, `gzip -9c | wc -c`.
* **Bundle composition:** `npx esbuild src/app.jsx --loader:.jsx=jsx --jsx=automatic --bundle --minify --metafile=meta.json`, then `bytesInOutput` per input, summed per package.
* **Test builds:** the same command with `--external:html2canvas --external:canvg --external:dompurify` (F1), plus `--alias:fast-png=<stub>` (F2), plus `--alias:jspdf=<stub>` (F9 upper bound), plus a scratch copy of `src/` with PowerCheck and IfrFuel rendered only on their tab (F8). Each was inlined into a copy of index.html in a scratch folder.
* **First render:** headless Chrome 157 over the DevTools protocol, as described in §1.5:
  * `Emulation.setDeviceMetricsOverride` 390×844 @3, iPhone user agent;
  * `Emulation.setCPUThrottlingRate` 4;
  * fresh `--user-data-dir` per run, cache disabled, `fonts.googleapis.com` / `fonts.gstatic.com` blocked;
  * a MutationObserver records when the FLIGHTS text appears; the paint and navigation timings come from `performance`;
  * median of 7 runs.
* **Typing:** in the same set-up, with the CPU throttle applied after load. For each keystroke: set the value, dispatch `input`, wait one macrotask, force layout; median of 10 keystrokes.
* **Tests:** each `domtest*.js` timed on its own, sequentially, on the same Mac; total 338 s.
