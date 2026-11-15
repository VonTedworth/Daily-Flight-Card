# GAMA KSS Daily Flight Card

A self-contained web app (single `index.html`, no server, no accounts) replacing the paper kneeboard daily flight card. Runs entirely on the device: all data stays in the phone's local storage, nothing is uploaded anywhere. Deployed on GitHub Pages; add to the iPhone home screen via Safari → Share → **Add to Home Screen**.

> **Status of this tool:** aide-mémoire only. It is **not** a certified performance, mass & balance, or flight planning application. Every output must be gross-error checked against the certified sources before use. The calculations below are published in full for exactly that purpose.

One card = **one SRP page** (seven sectors). Several cards per day is normal; see §4 (carry-over).

The app has four tabs: **A/C DATA** (once-per-SRP setup and admin), **FLIGHTS** (the seven sector rows), **UPLIFT** (fuel calculator), **IFR FUEL** (multi-sector IFR fuel cross-check, §3A). It auto-scales by device: iPhone 1×, iPad mini ≈1.35×, iPad ≈1.55×.

---

## 1. A/C DATA tab

### 1.1 Header fields

Fields are grouped on the page as DATE/AC REG, SRP/HOURS AVAILABLE, then a **PERFORMANCE** divider, GW DEP/VAR TOW, VERT TOW/PERF KG, then a plain divider, PLANNED FUEL/SUNRISE-SUNSET. The table below follows that on-screen order.

| Field | What it is | Function / calculation |
|---|---|---|
| **DATE** | Card date, `dd.mm.yyyy` | Drives the sunrise/sunset calculation. Defaults to today; editing it recalculates sun times. |
| **AC REG** | Aircraft registration | Dropdown: G-LNAC, G-MGPS, G-KSSC, G-KSST, G-ICER, or OTHER (free text). Last-used registration floats to the top and is remembered per device. |
| **SRP** | SRP number | Digits only. Appears in the PDF filename/subject and increments on carry-over (§4). |
| **HOURS AVAILABLE** | Maintenance hours available at start of this card | Number pad, digits only; colon auto-inserts before the last two digits: `934 → 9:34`, `2530 → 25:30`. One or two digits are whole hours. |
| **GW DEP KG** | Gross weight at first departure, kg | Manual entry. **Assumption: this figure includes the planned fuel load** — the departure GW calculation (§2.2) depends on it. Take it from the certified mass & balance app; deliberately *not* remembered between cards because it varies with crew. |
| **VAR TOW KG** | Variable (performance-limited) take-off weight, kg | Manual entry from the performance calculation. Entered once per card — if OAT/QNH change materially during the day, update it, or the PERF/VAR margin figures go stale. |
| **VERT TOW KG** | Vertical take-off weight limit, kg | Manual entry, same rules as VAR TOW: entered once per card from the performance calculation, integer, *not* remembered between cards. |
| **PERF KG** | Card-level performance margin, dual display | **Computed, not entered:** `VAR = VAR TOW − GW DEP` and `VERT = VERT TOW − GW DEP`, shown side by side split by a hairline. Each margin is coloured independently — green ≥ 0, amber negative — and shows an em-dash if its TOW figure (or GW DEP) is missing. **Worked example:** GW DEP 4600, VAR TOW 4650, VERT TOW 4550 → `VAR +50` (green), `VERT −50` (amber). |
| **PLANNED FUEL KG** | Standard fuel load for the day, kg | Seeds REQUIRED FUEL on the UPLIFT tab; feeds the inline refuel and departure GW calculations. |
| **SUNRISE / SUNSET** | Civil times for Redhill | **Computed offline** (NOAA solar algorithm, Redhill 51.2136 N 0.1386 W, GMT/BST from UK clock-change rules). Accuracy ±1–2 min vs the almanac — cross-check when it matters operationally. |

VAR TOW and VERT TOW are independent limits from the same performance calculation (e.g. power-limited vs the aircraft's vertical/OEI figure) — both are checked against the same GW DEP, and both margins are informational only. The FLIGHTS-page per-flight line also shows both margins, computed against that flight's own DEP GW (§2.2).

### 1.2 Summary strip

| Box | Calculation |
|---|---|
| **AVAILABLE** | HOURS AVAILABLE in `h:mm`. |
| **FLOWN** | Sum of every flight row's FLT MIN, in `h:mm`. |
| **REMAINING** | `AVAILABLE − FLOWN`. Green ≥ 0, **amber when negative** (maintenance hours exceeded). Also shown live on the FLIGHTS context bar. |

### 1.3 Power check (once per card)

Required once per SRP / 10 flight hours / 24 hours → recorded **once per card**, REDO to overwrite. Triggered by the POWER CHECK button here, or by answering the prompt after a 0-minute (ground run) entry on a flight row. Records OAT (°C — number pad with a **±** button to flip sign, since the iOS pad has no minus key), QNH (hPa), N1 % and ITT °C for both engines; all six required. Recorded verbatim, no computation; prints on the PDF. Entry from a flight row returns you to FLIGHTS; entry from the button returns here.

### 1.4 MISC, previous cards, new card

- **MISC** — free-text card-level notes, printed on the PDF.
- **PREVIOUS CARDS** — the last **4** cards kept on-device. Tap to view/edit (amber banner shows you're on a previous card; edits save to that card automatically); **EXPORT PDF (THIS CARD)** re-generates a corrected PDF. A fifth card silently drops the oldest.
- **NEW CARD** — always asks first: **EXPORT PDF & NEW CARD** (clears only after the share sheet succeeds), **CLEAR WITHOUT PDF**, or **CANCEL**. The outgoing card is archived either way. The **CARRY OVER** toggle in this dialog is described in §4.

### 1.5 PDF export

Generated on-device. Filename/share subject: `REG SRP nnnn DD.MM.YYYY` (iOS Mail adopts the filename as subject by convention — Apple behaviour, not guaranteed). Recipient cannot be pre-filled by iOS — pick the address in Mail after the share sheet. The PDF contains the full card regardless of the tab split: header, every used flight with DEP GW / VAR / VERT margins / flags / notes / grid, the SRP >4600 summary line (§2.3), power check, MISC.

---

## 2. FLIGHTS tab

A context bar at the top shows `REG · SRP · REM h:mm` so the A/C page isn't needed mid-day. Rows appear as used; the first empty row is always the working flight; unused rows stay hidden. Completed rows never collapse.

### 2.1 Flight row fields (7 sectors — one SRP page)

| Field | What it is | Function |
|---|---|---|
| **FLT MIN** | Flight time in **minutes** | Feeds FLOWN. `0` auto-notes **GROUND RUN** and prompts "POWER CHECK?" if none recorded yet. |
| **SHTDWN** | Shutdown time, local `HHMM` | **NOW** button stamps the current time; the button hides once a time exists (clear the field to bring it back). During BST a green Zulu line appears, e.g. `1420 → 1320z`. |
| **FUEL KG** | Fuel remaining at shutdown, kg | Feeds inline refuel and the *next* flight's departure fuel (§2.2). |
| **REFUEL** | Checkbox | With PLANNED FUEL and this row's FUEL KG present: litres computed inline (§3), e.g. `↑ 342 L`. Otherwise the UPLIFT tab opens for manual entry. Also resets the next flight's departure fuel to planned (§2.2). |
| **NOTES** | Free text, upper-cased | Auto-tagged GROUND RUN / POWER CHECK where applicable; freely editable. |
| **HEMS** | Checkbox | GPS position → six-figure OS grid (§2.4), green `HEMS · TQ 301 476`, amber `GRID UNAVAILABLE` on failure. Reveals **PATIENT KG**. |
| **PATIENT KG** | Patient weight, kg (HEMS rows) | Added into that flight's departure gross weight. |

### 2.2 Departure gross weight and VAR/VERT margins

Shown under each row once computable, and on the PDF, as a single non-wrapping line: `DEP GW 4540KG · VAR +110 · VERT +10`. These are **departure** figures — post-flight data collation, not planning. Departure fuel for flight *N* is inferred:

| Situation | Departure fuel assumed |
|---|---|
| Flight 1 of the card | PLANNED FUEL KG — **except the first sector of a carried-over card** (§4): the previous card's last landed fuel |
| Previous flight has REFUEL ticked | PLANNED FUEL KG (refuelled back to plan) |
| Otherwise | Previous flight's FUEL KG (its landed fuel) |

```
DEP GW(flight)  = GW DEP + (departure fuel − PLANNED FUEL) + PATIENT KG
VAR(flight)     = VAR TOW  − DEP GW(flight)
VERT(flight)    = VERT TOW − DEP GW(flight)
```

- PATIENT KG counts only on HEMS rows.
- **Assumes GW DEP includes planned fuel** and every refuel returns fuel exactly to the planned load; a partial/over-plan refuel skews the following flight's figure — check manually.
- Flight 1's DEP GW appears as soon as the header is filled (`GW DEP + patient`), so preloading a patient weight on the next row shows the lift margin **before** flight time or landing fuel exist — the intended pre-departure glance when power-limited.
- Each margin is independently coloured (green ≥ 0 / amber negative) and shown with no `KG` suffix; VERT prints an em-dash if VERT TOW is empty. The `DEP GW` figure itself has no space before `KG` (`4540KG`), grey unless over AUM.

GW DEP is the baseline weight *at planned fuel*, so any departure fuel simply shifts the weight by (departure fuel − planned fuel) — burn lightens the aircraft, a refuel back to plan restores it, and passengers are added for their own sector only. This is the same as working forward from the previous takeoff weight: previous weight − fuel burnt (+ any uplift) − last patient + next patient.

**Known simplifications** (figures can differ from reality by these): the start-up/taxi burn between shutdown and takeoff (roughly 30 kg) is not deducted, so each figure reads slightly heavy; a refuel is assumed to return to exactly the planned load; and PLANNED FUEL is taken as the fuel in GW DEP, so editing it after typing GW DEP shifts every figure by the difference.

**Worked example:** GW DEP 4600, planned 650. Flight 1 lands with 500 kg, no refuel. Flight 2 (HEMS, patient 90): departure fuel 500 → `DEP GW = 4600 + (500 − 650) + 90 = 4540`; VAR TOW 4650 → `VAR = +110`; VERT TOW 4440 → `VERT = −100`. Flight 2 refuels → flight 3 departure fuel 650, `DEP GW = 4600`.

### 2.3 Weight thresholds

- **4600 kg is NOT a limit** — it is the maintenance-penalty notation threshold (strictly *over* 4600; exactly 4600 is not flagged). Rows show the plain grey `DEP GW` figure with no annotation (crews know the threshold); the **PDF prints one summary line** — `NOTE ON SRP — GW OVER 4600 KG: FLT 1, FLT 3` — for direct transcription to the SRP. A **0-minute ground run is never listed**: it has no takeoff, so it is not a flight over 4600 (it still shows its DEP GW on screen and in the PDF row).
- **`— OVER AUM`** (amber, bold) — the aircraft's all-up mass (4800 kg, not repeated in the wording since the limit is fixed and known); this *is* an exceedance warning. The VAR/VERT margins still print on the same line.
- VAR / VERT margins: green positive, amber negative. Both TOW figures and the AUM threshold are hard-coded/manual per card.

### 2.4 HEMS grid reference

WGS84 GPS fix converted **fully offline** to OSGB36 (7-parameter Helmert, then Transverse Mercator on Airy 1830), truncated to six figures (100 m). Verified against Ben Nevis (NN 166 712), St Paul's Cathedral (TQ 320 811), Redhill (TQ 301 476). Datum error ≤ ~5 m — the dominant error is the phone's GPS fix.

---

## 3. UPLIFT tab

| Field | What it is |
|---|---|
| **CURRENT FUEL KG** | Fuel on board now (auto-filled from a flight row when arriving via REFUEL). |
| **REQUIRED FUEL KG** | Target load (seeded from PLANNED FUEL KG). |
| **DENSITY KG/L** | Jet A-1, default **0.79**. Use the bowser/receipt figure — at 400 kg the difference between 0.775 and 0.80 is ~16 litres. |

```
UPLIFT KG = max(0, REQUIRED − CURRENT)
UPLIFT L  = UPLIFT KG ÷ DENSITY
```

**Example:** required 650, on board 300, density 0.79 → 350 kg → **443 L**. Inline row refuel is the same formula with REQUIRED = planned and CURRENT = that row's landed fuel; result never goes negative.

**README link.** The bottom of the UPLIFT tab (the shortest tab) carries **README — HOW THE APP WORKS ↗**, which opens this guide on GitHub in a new tab. It needs signal; the app itself does not.

---

## 3A. IFR FUEL tab — multi-sector planning

> **Planning cross-check only — not a certified flight-planning tool. Verify against the OFP and current plates.** It applies the company fuel scheme (OMB B34 §5.2.3) and the OMA 8H destination/alternate rules to a **trip of sectors**, so you can gross-error-check your own plan. The OMA is the authority: the planner is meant to be neither less nor more restrictive than it.

**Why a trip, not a leg.** PinS hospital sites have no fuel, so everything the whole chain needs must be on board at the first lift. The tab gives (1) **REQUIRED TO LIFT** from the first site, and (2) a **MIN TO LIFT** at every later site, to check against the gauge before departing it. If the fuel at a site is below its minimum, an IFR departure from there is not available: refuel, or hold for weather.

**Fully offline.** Every figure and rule comes from `src/fuel-planner-dataset.json`, bundled at build; nothing is fetched. The current trip is saved on the phone under its own key (`ifr-fuel-trip`) — it never touches the flight card. **RESET TRIP** (asks first) returns to the default trip. Units: fuel **kg** (L = kg ÷ 0.79), distance **nm**. The maths is a port of the approved prototype (`prototype-fuel-multisector.html`); the build brief is `multisector-build-brief.md`.

### Planning a trip — step by step
1. **Build the route.** Set the first stop (where you lift from) and each following stop with the dropdowns; **+ ADD SECTOR** adds one, **✕** removes one. The map draws the route as you go.
2. **Check each sector's profile.** The collapsed line under each card shows destination · distance · profile · alternate(s) · sector burn. Tap it to open the sector: pick the profile that matches the forecast (the hint inside each letter says what it means — e.g. *1 ALTN +800M*) — or **VFR** if that leg is flown visually — and check the alternate. The nearest valid alternate is chosen for you; change it if needed. Profiles the OMA does not allow for that destination are greyed out.
3. **Read REQUIRED TO LIFT.** The headline is the fuel needed at the first stop for the whole trip, including every later minimum that has to be carried because the stops in between have no fuel.
4. **Enter the fuel on board at the first stop.** The headline turns **ENOUGH +n** or **SHORT −n**, and the planned fuel at every later stop follows (shown dim in each ACTUAL box).
5. **During the trip, check the gauge against MIN TO LIFT before each departure.** Type the actual figure into that stop's box: MARGIN updates, and every later planned figure follows from what you entered. A negative margin turns the card amber — *IFR departure not available: refuel, or hold for weather.*
6. **Refuel stops.** At a mid-trip airfield with fuel, **REFUEL HERE** breaks the chain: the stops before only have to get you there with their own reserves, and the card tells you what you will arrive with and the uplift needed.
7. **Keep a record.** **EXPORT PLAN (PDF)** saves the plan exactly as shown (below).

### Stops
Any **IFR airfield** or **PinS site** can be a stop: EGKR Redhill, EGKK, EGKB, EGKA, EGMD, EGMC, EGHI, EGLL, EGLC, EGSS, and the PinS sites EGKD William Harvey (WHH), EGKC King's College (KCH), EGRS Royal Sussex (RSCH), EGGB East Brighton Park (EBP). Other hospitals and the VFR refuel points (Manston, Rochester) are map markers only. **+ ADD SECTOR** adds a stop; **✕** removes one (minimum two).

### Approach status (planned / confirm) — not shown
Every PinS procedure in the dataset is still in the planning phase: Redhill's PinS is marked `planned` (it does not exist yet) and the hospital PinS procedures (William Harvey, King's College, Royal Sussex, East Brighton Park) are marked `confirm` (not yet confirmed as published and usable — open item 3). Since everything except the airfields is unofficial for now, the app **no longer shows** these as tags, in the approaches lines, on the map or in the PDF. The `status` stays in the dataset for one reason: a field whose only approach is not usable cannot be offered as an **alternate**, which is why Redhill never appears in an alternate list. To be revisited when the plates and procedure minima are available — clearing a procedure's `status` in the dataset makes it a normal published approach.

### Per sector (stop *i* → stop *i+1*)
```
trip  = round(dist_nm ÷ 130 × 280)       great-circle distance, unrounded nm
cont  = round(10% × trip)                planned as used on every sector
burn  = 30 start & taxi + trip + cont + 70 (one approach at the destination; none on a VFR leg)

own requirement, by profile:
  VMC : burn + 150
  A   : burn + 70 (second approach) + 70 (15 min added to trip) + 150
  B, C: burn + alternate + 70 (approach at the alternate) + 150
  D   : as B, alternate = the FARTHER of the two alternates from the destination
  VFR : 30 start & taxi + trip + cont + 100 (VFR day final reserve) — no approach, no alternate
```

### Minimum to lift — worked backwards from the last sector
```
min[last] = own[last]
min[i]    = max( own[i],  burn[i] + min[i+1] )     — unless stop i+1 is a REFUEL stop,
                                                     then min[i] = own[i]
```
Fuel then runs forwards: at each stop it is the **ACTUAL** figure if you entered one, otherwise the plan (previous fuel − previous burn), shown as the input's placeholder. **MARGIN = fuel − min**; below zero the card turns amber with *BELOW MINIMUM — IFR DEPARTURE NOT AVAILABLE. REFUEL BEFORE CONTINUING, OR HOLD FOR WEATHER.* The last stop shows only **PLANNED ON LANDING**. With nothing entered at the first stop the plan assumes you lift exactly the minimum, and the headline asks for the figure.

### Profiles (OMA 8H 8.1.3.3.2), chosen per sector
| Profile | Alternate | Hint | Offered for |
|---|---|---|---|
| VMC | none | NO ALTN · 1 APP | airfields |
| A | none | NO ALTN · 2 APPS | airfields with **two approaches on independent aids** (not Shoreham — RNP only) |
| B | 1 | 1 ALTN · +400M | airfields (default) |
| C | 1 | 1 ALTN · +800M | airfields; **PinS destinations (default)** |
| D | 2 (fuel to the farther) | 2 ALTN · FARTHER | airfields; PinS destinations |
| VFR | none | NO ALTN · NO APP | **every destination** — a leg flown VFR (e.g. back to Redhill after an IFR approach elsewhere) |

**VFR leg.** Pick **VFR** in a sector's profile strip when that leg is flown visually: it carries no IFR approach and no alternate, and plans start & taxi 30 + trip + the same 10% contingency as the IFR sectors + the **VFR day final reserve 100 kg** (both from the dataset; the contingency choice is Ed's, Nov 2026). The collapsed line reads *VFR · NO ALTN*, and the leg still feeds the minimum-to-lift chain. Example: Redhill → Biggin Hill IFR (B, alternate London City) then Biggin Hill → Redhill VFR = **366 / 153 kg**, against 475 / 352 if the return were planned IFR. Night VFR is not covered (the dataset has no night VFR reserve).

**PinS destinations: C and D only** (for IFR; a VFR leg into a PinS site is a VFR flight and may use VFR). OMA 8.3.2.7.4 — *PinS procedures offer no alleviation from requirements to declare and carry fuel for a destination alternate*; 8.3.2.7.7 — one destination alternate is assumed unless the destination meets planning minima from CAP 746-compliant weather. Site weather (SkylinkPro) is uncertified, so B does not apply. A site counts as a PinS destination if it is a PinS site or its only procedure is a PinS (so Redhill too). **B and C carry the same fuel**; they differ only in the alternate planning minima in the description (B +400 m / +200 ft, C +800 m / +400 ft). The weather minima are descriptive — **this version does not check weather**.

**Alternate validity (OMA 8.1.3.3.2; PinS 8.3.2.7.4).** An airfield can be the alternate only if a **non-GNSS** approach exists at the alternate or at the destination. GNSS types are listed in the dataset (`gnss_approach_types`: RNP LNAV, RNP LNAV/VNAV, LPV, PinS). So for a PinS destination or Shoreham, only airfields with an ILS/NDB/VOR qualify; for Gatwick, Shoreham is allowed. Only airfields with a *usable* (not planned/confirm) approach are alternates, so Redhill is never one. The **nearest** valid alternate is chosen by default ("nearest"); pick another and it shows "chosen". Changing a destination resets that sector's profile and alternate to the defaults.

### Refuel stops
**REFUEL HERE** appears on a mid-trip stop whose site has fuel (every airfield; no PinS site yet). It breaks the chain at that stop, relabels the input **AFTER REFUEL KG**, and shows *ARRIVE WITH n KG · UPLIFT AT LEAST n KG* (or that no uplift is needed). William Harvey has `fuel: false` (`fuel_planned: true`); when fuel arrives there it is a one-line dataset change.

### Screen
Map (route through every stop solid, each sector's alternate(s) dashed; tap a site to see what it is) → **REQUIRED TO LIFT** headline with ENOUGH/SHORT against the fuel entered at the first stop → one card per stop with three numbers (MIN TO LIFT · ACTUAL KG · MARGIN) → between cards a collapsed sector line (destination · distance · profile · alternate(s) · sector burn) → **+ ADD SECTOR**, **EXPORT PLAN (PDF)**, **RESET TRIP**. Tap the line for the profile strip, its description, the approaches at the destination and alternate(s), the alternate picker(s), and the OMB §5.2.3-style table (MIN TO LIFT · REQUIREMENT · L · KG) summing to that site's minimum — ending **Onward — min to lift next site** when the onward chain governs.

### Export plan (PDF)
**EXPORT PLAN (PDF)** (between + ADD SECTOR and RESET TRIP) builds a one- or two-page A4 PDF of the plan exactly as on screen and opens the share sheet (save to Files, Mail, etc.). It works offline. File name: `IFR FUEL <route> <dd.mm.yyyy> <hhmm>.pdf`, e.g. `IFR FUEL EGKR-EGKD-EGKC-EGKR 15.11.2026 1803.pdf`. Contents:
- header with date/time, the disclaimer, the **app version** and **every figure the sums used** (130 kt, 280 kg/hr, start & taxi 30, approach 70, final reserve 150, contingency 10%, 15 min = 70, density 0.79) — so a plan can be re-checked by hand later;
- the route, REQUIRED TO LIFT and the fuel entered at the first stop with ENOUGH/SHORT;
- every stop: MIN TO LIFT, fuel (actual / planned / after refuel / planned on landing), margin, refuel uplift, and any BELOW MINIMUM warning;
- every sector: distance, profile and its description, alternate(s) (nearest / chosen), sector burn, the approaches at the destination and alternate(s), and the full requirement table (MIN TO LIFT · REQUIREMENT · L · KG) summing to that site's minimum, noting when the onward chain governs;
- the open items still awaiting confirmation.

Exporting changes nothing in the trip or the flight card. Use it for record keeping and to error-check the planner against your own figures.

**Reference check (brief §6).** Default trip EGKR → EGKD → EGKC → EGKR, profile C, nearest alternates (EGMD, EGLC, EGKK): burns 194 / 200 / 136 kg, **MIN TO LIFT 759 / 565 / 365 kg**; with 820 kg at the start, planned landing fuel 290 kg. Add EGKR → EGKK: VMC 790 / 596 / 396 / 260, A 930 / 736 / 536 / 400, D (EGKB + EGKA) 901 / 707 / 507 / 371.

### Open items (implemented as stated, kept as data, awaiting confirmation)
1. **Contingency** 10% per sector, planned as used, nothing carried forward.
2. **PinS in clear VMC** — whether a PinS flight can ever be planned without an alternate. Not offered, following 8.3.2.7.7.
3. **PinS approach status** — which PinS procedures are published and usable; the dataset marks them `confirm` / `planned`.
4. **Site coordinates** — East Brighton Park (EGGB) is the user-supplied 50.8174, −0.1018; all other site coordinates still to be verified.
5. The OMA PinS text is a provisional starting position and may change.

### Map
A wireframe map of south-east England (Kent, Surrey, Sussex, Greater London, Hampshire, Isle of Wight, and Essex up to Stansted and Chelmsford), bundled inline — no tiles, no runtime fetch. Airfields are cyan circles, PinS sites cyan Ⓗ, other hospitals grey Ⓗ, refuel points amber diamonds; the first stop is green, other stops cyan, alternates amber. Every site is labelled — airfields by ICAO, hospitals and PinS sites by short name (RSCH, WHH, KCH, EBP, SGH, MAID, PEM, STM, QA, QEQM, FPH, EDGH, SOTON, HAST = Conquest Hastings, MMH = Medway Maritime, DVH = Darent Valley, BROOM = Broomfield Chelmsford) — with labels nudged clear of each other and of the markers.

The county outlines are ONS data simplified to ~200 m — fine for orientation and for placing markers, **not for navigation**. They are generated by `tools/gen_map.py` into `src/map-geometry.json` in the *same projection* the markers use (equirectangular, longitude scaled by cos 51.1°), which `domtest17` checks by confirming airfields land in their real counties. Boundary data: *Contains OS data © Crown copyright and database right 2024. Source: Office for National Statistics, licensed under the Open Government Licence v3.0* (Counties and Unitary Authorities, December 2024, UK BGC).

**Verify before trusting:** airfield coordinates are published ARP and hospital coordinates are approximate — confirm against the current eAIP. Approach DH values in the dataset are OMA 8H **system-minima floors by approach type, not published OCH**; the actual DH comes from the company plate. They do not affect fuel.

---

## 4. Carry-over (day runs past 7 sectors)

An SRP page holds seven sectors. When a day overruns, tick **CARRY OVER A/C DATA — SRP +1, AVAILABLE = REMAINING** in the NEW CARD dialog, then use either exit button. The new card:

- copies AC REG, GW DEP, VAR TOW, VERT TOW, PLANNED FUEL;
- **increments SRP by one** (the SRP field is digits-only, so this always applies);
- sets the **first sector's departure fuel to the old card's last landed fuel** (so sector 1 of the new card is GW DEP + (landed − planned), not GW DEP) — or planned fuel if that last sector was refuelled, or if no landed fuel was recorded. Sector 2 onward follow each landing as usual;
- sets **AVAILABLE = the old card's REMAINING**, so the maintenance countdown continues across SRP pages;
- starts with blank flights, MISC, and power check (the once-per-SRP/10 hr/24 hr power check requirement is judged by the crew, not re-prompted);
- **does NOT copy DATE or SUNRISE/SUNSET** — the new card always shows today's date and today's recomputed sun times, even for a same-day overrun (where today already equals the outgoing date, so nothing changes) or a shift that crosses midnight (where copying would silently show yesterday's date and stale sun times).

The completed card is archived under PREVIOUS CARDS with its original SRP.

---

## 5. Time conventions

**FLT MIN** minutes only; **SHTDWN** local `HHMM`; **HOURS AVAILABLE** digits with auto-colon. Zulu: BST = local − 1 h, winter = local; BST state derives from the card date and UK clock-change rules, not the phone setting.

## 6. Storage, privacy, display

- Everything lives in `localStorage` on that phone: current card, previous 4 cards, last reg, theme, and the IFR FUEL trip (its own key, `ifr-fuel-trip`, separate from the card). Each device independent; nothing transmitted. GPS used only when a HEMS box is ticked.
- localStorage is not indestructible — clearing Safari website data wipes cards. The emailed PDF is the durable record.
- **Launches with no signal.** A service worker keeps a copy of the app on the phone. Open it once with signal (and add it to the Home Screen); after that it launches with no connection at all. On weak signal it tries the network for about 3 seconds, then opens the saved copy rather than hanging. With good signal it loads the latest version and refreshes the saved copy.
- **Updates never interrupt you.** A new version downloads quietly in the background; the page you have open is never reloaded or swapped mid-session. The next time you open the app it is the new version (check the `vN · date` stamp).
- **Honest limit:** this is as reliable as the web allows, not as bulletproof as a native app. iOS can still clear a web app's saved data after long periods of non-use or when the phone is very short of storage; the app then needs one launch with signal to save itself again (and any cards on the phone would be lost with it — the emailed PDFs are the record). For a tool used regularly this is rare; only a native App Store build removes it entirely.
- ☀/☾ (top right): night (dark MFD) / day (high-contrast sunlight) theme, per device.
- Safe-area padding keeps content clear of the iPhone status bar and home indicator; layout auto-scales on iPads.
- A small `vN · dd.mm.yyyy` version/build-date stamp sits below the card on every tab, so you can confirm which build is live after a deploy.

## 7. Assumptions to check before trusting output

1. GW DEP **includes planned fuel** (§2.2) — verify against the mass & balance definition.
2. 4600 kg (SRP notation) and 4800 kg (AUM) hard-coded. Departure fuel is inferred (§2.2): refuels assumed to return exactly to planned load.
3. VAR TOW and VERT TOW are manual entries — refresh them if conditions change; the PERF box and every flight-row margin are only as current as those two numbers.
4. Sun times computed (±1–2 min), not almanac-official.
5. Default density 0.79 is nominal — use the bowser figure.
6. Zulu line and sun times assume UK rules and the Redhill location.
7. Carry-over sets the new card's AVAILABLE to the previous REMAINING — correct only if the two cards are the same maintenance countdown.
