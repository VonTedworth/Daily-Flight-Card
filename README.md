# GAMA KSS Daily Flight Card

A self-contained web app (single `index.html`, no server, no accounts) replacing the paper kneeboard daily flight card. Runs entirely on the device: all data stays in the phone's local storage, nothing is uploaded anywhere. Deployed on GitHub Pages; add to the iPhone home screen via Safari → Share → **Add to Home Screen**.

> **Status of this tool:** aide-mémoire only. It is **not** a certified performance, mass & balance, or flight planning application. Every output must be gross-error checked against the certified sources before use. The calculations below are published in full for exactly that purpose.

One card = **one SRP page** (seven sectors). Several cards per day is normal; see §4 (carry-over).

The app has three tabs: **A/C DATA** (once-per-SRP setup and admin), **FLIGHTS** (the seven sector rows), **UPLIFT** (fuel calculator). It auto-scales by device: iPhone 1×, iPad mini ≈1.35×, iPad ≈1.55×.

---

## 1. A/C DATA tab

### 1.1 Header fields

| Field | What it is | Function / calculation |
|---|---|---|
| **DATE** | Card date, `dd.mm.yyyy` | Drives the sunrise/sunset calculation. Defaults to today; editing it recalculates sun times. |
| **AC REG** | Aircraft registration | Dropdown: G-LNAC, G-MGPS, G-KSSC, G-KSST, G-ICER, or OTHER (free text). Last-used registration floats to the top and is remembered per device. |
| **SRP** | SRP number | Digits only. Appears in the PDF filename/subject and increments on carry-over (§4). |
| **GW DEP KG** | Gross weight at first departure, kg | Manual entry. **Assumption: this figure includes the planned fuel load** — the departure GW calculation (§2.2) depends on it. Take it from the certified mass & balance app; deliberately *not* remembered between cards because it varies with crew. |
| **VAR TOW KG** | Variable (performance-limited) take-off weight, kg | Manual entry from the performance calculation. Entered once per card — if OAT/QNH change materially during the day, update it, or the DEP PERF figures go stale. |
| **PERF KG** | Card-level performance margin | **Computed, not entered:** `PERF = VAR TOW − GW DEP`. Green positive, amber negative. Example: 4650 − 4600 = **+50 kg**. |
| **PLANNED FUEL KG** | Standard fuel load for the day, kg | Seeds REQUIRED FUEL on the UPLIFT tab; feeds the inline refuel and departure GW calculations. |
| **HOURS AVAILABLE** | Maintenance hours available at start of this card | Number pad, digits only; colon auto-inserts before the last two digits: `934 → 9:34`, `2530 → 25:30`. One or two digits are whole hours. |
| **SUNRISE / SUNSET** | Civil times for Redhill | **Computed offline** (NOAA solar algorithm, Redhill 51.2136 N 0.1386 W, GMT/BST from UK clock-change rules). Accuracy ±1–2 min vs the almanac — cross-check when it matters operationally. |

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

Generated on-device. Filename/share subject: `REG SRP nnnn DD.MM.YYYY` (iOS Mail adopts the filename as subject by convention — Apple behaviour, not guaranteed). Recipient cannot be pre-filled by iOS — pick the address in Mail after the share sheet. The PDF contains the full card regardless of the tab split: header, every used flight with DEP GW / DEP PERF / flags / notes / grid, the SRP >4600 summary line (§2.3), power check, MISC.

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

### 2.2 Departure gross weight and DEP PERF

Shown under each row once computable, and on the PDF. These are **departure** figures — post-flight data collation, not planning. Departure fuel for flight *N* is inferred:

| Situation | Departure fuel assumed |
|---|---|
| Flight 1 of the card | PLANNED FUEL KG |
| Previous flight has REFUEL ticked | PLANNED FUEL KG (refuelled back to plan) |
| Otherwise | Previous flight's FUEL KG (its landed fuel) |

```
DEP GW(flight)   = GW DEP + (departure fuel − PLANNED FUEL) + PATIENT KG
DEP PERF(flight) = VAR TOW − DEP GW(flight)
```

- PATIENT KG counts only on HEMS rows.
- **Assumes GW DEP includes planned fuel** and every refuel returns fuel exactly to the planned load; a partial/over-plan refuel skews the following flight's figure — check manually.
- Flight 1's DEP GW appears as soon as the header is filled (`GW DEP + patient`), so preloading a patient weight on the next row shows the lift margin **before** flight time or landing fuel exist — the intended pre-departure glance when power-limited.

**Worked example:** GW DEP 4600, planned 650. Flight 1 lands with 500 kg, no refuel. Flight 2 (HEMS, patient 90): departure fuel 500 → `DEP GW = 4600 + (500 − 650) + 90 = 4540`; VAR TOW 4650 → `DEP PERF = +110 kg`. Flight 2 refuels → flight 3 departure fuel 650, `DEP GW = 4600`.

### 2.3 Weight thresholds

- **4600 kg is NOT a limit** — it is the maintenance-penalty notation threshold. Rows show the plain grey `DEP GW` figure with no annotation (crews know the threshold); the **PDF prints one summary line** — `NOTE ON SRP — GW OVER 4600 KG: FLT 1, FLT 3` — for direct transcription to the SRP.
- **`OVER AUM 4800 KG`** (amber, bold) — the aircraft's all-up mass; this *is* an exceedance warning.
- DEP PERF: green positive, amber negative. Both thresholds hard-coded.

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

---

## 4. Carry-over (day runs past 7 sectors)

An SRP page holds seven sectors. When a day overruns, tick **CARRY OVER A/C DATA — SRP +1, AVAILABLE = REMAINING** in the NEW CARD dialog, then use either exit button. The new card:

- copies DATE, AC REG, GW DEP, VAR TOW, PLANNED FUEL, SUNRISE/SUNSET;
- **increments SRP by one** (the SRP field is digits-only, so this always applies);
- sets **AVAILABLE = the old card's REMAINING**, so the maintenance countdown continues across SRP pages;
- starts with blank flights, MISC, and power check (the once-per-SRP/10 hr/24 hr power check requirement is judged by the crew, not re-prompted).

The completed card is archived under PREVIOUS CARDS with its original SRP.

---

## 5. Time conventions

**FLT MIN** minutes only; **SHTDWN** local `HHMM`; **HOURS AVAILABLE** digits with auto-colon. Zulu: BST = local − 1 h, winter = local; BST state derives from the card date and UK clock-change rules, not the phone setting.

## 6. Storage, privacy, display

- Everything lives in `localStorage` on that phone: current card, previous 4 cards, last reg, theme. Each device independent; nothing transmitted. GPS used only when a HEMS box is ticked.
- localStorage is not indestructible — clearing Safari website data wipes cards. The emailed PDF is the durable record.
- ☀/☾ (top right): night (dark MFD) / day (high-contrast sunlight) theme, per device.
- Safe-area padding keeps content clear of the iPhone status bar and home indicator; layout auto-scales on iPads.

## 7. Assumptions to check before trusting output

1. GW DEP **includes planned fuel** (§2.2) — verify against the mass & balance definition.
2. 4600 kg (SRP notation) and 4800 kg (AUM) hard-coded. Departure fuel is inferred (§2.2): refuels assumed to return exactly to planned load.
3. VAR TOW is a manual entry — refresh it if conditions change; DEP PERF is only as current as that number.
4. Sun times computed (±1–2 min), not almanac-official.
5. Default density 0.79 is nominal — use the bowser figure.
6. Zulu line and sun times assume UK rules and the Redhill location.
7. Carry-over sets the new card's AVAILABLE to the previous REMAINING — correct only if the two cards are the same maintenance countdown.
