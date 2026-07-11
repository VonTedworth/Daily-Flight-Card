# GAMA KSS Daily Flight Card

A self-contained web app (single `index.html`, no server, no accounts) replacing the paper kneeboard daily flight card. Runs entirely on the device: all data stays in the phone's local storage, nothing is uploaded anywhere. Deployed on GitHub Pages; add to the iPhone home screen via Safari → Share → **Add to Home Screen**.

> **Status of this tool:** aide-mémoire only. It is **not** a certified performance, mass & balance, or flight planning application. Every output must be gross-error checked against the certified sources before use. The calculations below are published in full for exactly that purpose.

---

## 1. FLIGHT CARD tab

### 1.1 Header fields

| Field | What it is | Function / calculation |
|---|---|---|
| **DATE** | Card date, `dd.mm.yyyy` | Drives the sunrise/sunset calculation (§1.2). Defaults to today; editing it recalculates sun times. |
| **AC REG** | Aircraft registration | Dropdown: G-LNAC, G-MGPS, G-KSSC, G-KSST, G-ICER, or OTHER (free text). The last-used registration floats to the top of the list and is remembered per device. |
| **SRP** | SRP number | Free entry, digits only. Appears in the PDF filename/subject. |
| **GW DEP KG** | Gross weight at first departure, kg | Manual entry. **Assumption: this figure includes the planned fuel load** — the per-flight GW calculation (§1.5) depends on it. Take it from the certified mass & balance app; deliberately *not* remembered between cards because it varies with crew. |
| **VAR TOW KG** | Variable (performance-limited) take-off weight, kg | Manual entry from the performance calculation. Entered once per card — if OAT/QNH change materially during the day, update it, or the PERF figures go stale. |
| **PERF KG** | Card-level performance margin | **Computed, not entered:** `PERF = VAR TOW − GW DEP`. Green when positive, amber when negative. Worked example: 4800 − 4400 = **+400 kg**. |
| **PLANNED FUEL KG** | Standard fuel load for the day, kg | Manual entry. Seeds the REQUIRED FUEL field on the UPLIFT tab and feeds the inline refuel and per-flight GW calculations. |
| **HOURS AVAILABLE** | Maintenance hours available at start of day | Accepts `h:mm` (e.g. `7:30`) **or** decimal hours (e.g. `7.5`). Parsed to minutes: `h:mm → h×60 + mm`; `decimal → hours×60`. So `7:30 → 450 min` and `7.5 → 450 min` are identical. Minutes ≥ 60 after the colon are rejected. |
| **SUNRISE / SUNSET** | Civil times for Redhill | **Computed offline** using the NOAA solar position algorithm for Redhill Aerodrome (51.2136 N, 0.1386 W), converted to UK clock time (GMT/BST decided by the card date against European rules). Displayed as e.g. `0453 / 2115`. Accuracy is ±1–2 minutes versus the almanac — cross-check against official sources when it matters operationally. |

### 1.2 Summary strip

| Box | Calculation |
|---|---|
| **AVAILABLE** | HOURS AVAILABLE parsed to minutes, shown `h:mm`. |
| **FLOWN** | Sum of every flight row's FLT MIN, shown `h:mm`. |
| **REMAINING** | `AVAILABLE − FLOWN`, shown `h:mm`. Green when ≥ 0, **amber when negative** (maintenance hours exceeded). |

### 1.3 Flight rows (up to 8 per card)

Rows appear as used; the first empty row is always shown as the working flight; unused rows below stay hidden. Completed rows never collapse — everything stays visible for checking.

| Field | What it is | Function |
|---|---|---|
| **FLT MIN** | Flight time in **minutes** (not h:mm) | Feeds FLOWN. Entering `0` auto-notes **GROUND RUN** and, if no power check exists on the card yet, prompts "POWER CHECK?". |
| **SHTDWN** | Shutdown time, local `HHMM` | **NOW** button stamps the current clock time in one tap. During BST a green Zulu equivalent appears beneath, e.g. `1420 → 1320z` (`Zulu = local − 1 h` in BST; identical in winter). |
| **FUEL KG** | Fuel remaining at shutdown, kg | Feeds the inline refuel and per-flight GW calculations. |
| **REFUEL** | Checkbox | If PLANNED FUEL and this row's FUEL KG are present: litres computed inline (§3) and shown as e.g. `↑ 342 L`. If either is missing, the app switches to the UPLIFT tab to do it manually. Unticking clears the litres. |
| **NOTES** | Free text, upper-cased | Auto-filled with GROUND RUN / POWER CHECK tags where applicable; freely editable. |
| **HEMS** | Checkbox | On tick: phone GPS position converted to a six-figure OS grid reference (§1.4), shown green (e.g. `HEMS · TQ 301 476`), amber `GRID UNAVAILABLE` on failure. Also reveals **PATIENT KG**. |
| **PATIENT KG** | Patient weight, kg (HEMS rows only) | Added into that flight's gross weight (§1.5). |

### 1.4 HEMS grid reference

Phone GPS gives a WGS84 latitude/longitude. Converted **fully offline** to OSGB36 via a 7-parameter Helmert transformation, then projected to National Grid (Transverse Mercator, Airy 1830 ellipsoid), and truncated to a six-figure reference (100 m precision). Verified against Ben Nevis (NN 166 712), St Paul's Cathedral (TQ 320 811) and Redhill Aerodrome (TQ 301 476). Positional error of the datum transformation is ≤ ~5 m — negligible at six-figure precision; the dominant error is the phone GPS fix itself.

### 1.5 Per-flight departure gross weight and performance margin

Shown under each flight row once the inputs exist, and printed on the PDF. This is a **departure** weight — the figure the SRP >4600 notation and PERF margin are judged against. This is post-flight data collation, not a planning tool.

Departure fuel for flight *N* is inferred:

| Situation | Departure fuel assumed |
|---|---|
| Flight 1 of the card | PLANNED FUEL KG |
| Previous flight has REFUEL ticked | PLANNED FUEL KG (refuelled back to plan) |
| Otherwise | Previous flight's FUEL KG (its landed fuel) |

```
DEP GW(flight) = GW DEP + (departure fuel − PLANNED FUEL) + PATIENT KG
PERF(flight)   = VAR TOW − DEP GW(flight)
```

- `PATIENT KG` counts only on HEMS rows (0 otherwise).
- **Assumes GW DEP includes the planned fuel**, and that every refuel brings fuel exactly back to the planned load. A partial or over-plan refuel breaks the inference for the following flight — check manually.
- Flight 1's DEP GW appears as soon as the header is filled: it is simply `GW DEP (+ patient)`.

**Worked example:** GW DEP 4600, planned 650. Flight 1 lands with 500 kg, no refuel. Flight 2 (HEMS, patient 90 kg): departure fuel = 500, so `DEP GW = 4600 + (500 − 650) + 90 = 4540 kg`; against VAR TOW 4650, `PERF = +110 kg`. Flight 2 refuels; flight 3 departure fuel = 650, `DEP GW = 4600 kg`.

Weight flags — two distinct thresholds, deliberately worded differently:

- **`>4600 NOTE ON SRP`** (amber): 4600 kg is **not a limit**. Flights with gross weight above 4600 kg carry maintenance penalties and must be recorded on the SRP. The PDF prints a one-line summary (`NOTE ON SRP — GW OVER 4600 KG: FLT 1, FLT 2`) so the SRP filler doesn't have to scan every row.
- **`OVER AUM 4800 KG`** (amber, bold): 4800 kg is the aircraft's all-up mass. This one *is* an exceedance warning.

PERF shows green when positive, amber when negative. Both thresholds are hard-coded — if a different variant or limit ever applies, the app must be changed.

> The flag is judged on **departure** weight per the inference table in §1.5, so burn-off during the flight cannot hide a >4600 departure. The residual weakness is the refuel assumption: a refuel that doesn't return fuel to exactly the planned load skews the next flight's figure.

### 1.6 Power check (once per card)

Required once per SRP / 10 flight hours / 24 hours, so the app records **one per card** (with a REDO button to overwrite). Triggered either by answering YES to the ground-run prompt or via the **POWER CHECK** button by MISC. Records OAT (°C, signed), QNH (hPa), and N1 % + ITT °C for both engines — all six fields required. No computation is performed on these numbers; they are recorded verbatim for the engineering record and printed on the PDF.

### 1.7 MISC, previous cards, new card

- **MISC** — free-text card-level notes, printed on the PDF.
- **PREVIOUS CARDS** — the last **4** cards (one work run) are kept on-device. Tap one to view and edit it; an amber banner shows you're on a previous card (one card = one SRP page, so several cards per day is normal), edits save automatically to that card, and **EXPORT PDF (THIS CARD)** re-generates a corrected PDF without touching today's card. A fifth new card silently drops the oldest.
- **NEW CARD** — always asks first: **EXPORT PDF & NEW CARD** (card clears only after the share sheet succeeds), **CLEAR WITHOUT PDF**, or **CANCEL**. The outgoing card is archived to PREVIOUS CARDS either way.

### 1.8 PDF export

Generated on-device (no network). Filename and share subject: `REG SRP nnnn DD.MM.YYYY` — iOS Mail adopts the filename as the subject by convention, but this is Apple behaviour, not guaranteed. The recipient cannot be pre-filled by iOS; the footer prints `SUBMIT TO: <address>` from the per-device **SEND PDF TO** field as a reminder. The PDF contains every header field, each used flight row with GW/PERF/flags/notes, power check data, and MISC.

---

## 2. UPLIFT tab

| Field | What it is |
|---|---|
| **CURRENT FUEL KG** | Fuel on board now (auto-filled from a flight row when arriving via REFUEL). |
| **REQUIRED FUEL KG** | Target load (seeded from PLANNED FUEL KG). |
| **DENSITY KG/L** | Jet A-1 density, default **0.79**. Use the actual figure from the bowser/receipt — density varies with temperature, and at 400 kg uplift the difference between 0.775 and 0.80 is roughly 16 litres. |

Power check entry also lives on this tab when triggered from the card.

---

## 3. Uplift calculation

```
UPLIFT KG = max(0, REQUIRED − CURRENT)
UPLIFT L  = UPLIFT KG ÷ DENSITY
```

**Worked example:** required 650 kg, on board 300 kg, density 0.79:
`650 − 300 = 350 kg`, `350 ÷ 0.79 = 443 L`.

The inline refuel on a flight row is the same formula with `REQUIRED = PLANNED FUEL KG` and `CURRENT = that row's FUEL KG`. If the target or density differ from standard, use the UPLIFT tab instead. The result never goes negative — if you land above planned fuel, it shows 0 L.

---

## 4. Time conventions

- **FLT MIN** is minutes only. **SHTDWN** is local `HHMM`. **HOURS AVAILABLE** is `h:mm` or decimal hours.
- Zulu conversion: during BST, `Zulu = local − 1 h`; in winter, local = Zulu. BST state is derived from the card date using UK/European clock-change rules, not the phone's setting.

## 5. Storage, privacy and limits

- Everything lives in the browser's `localStorage` on that phone: current card, previous 4 cards, last-used registration, PDF email address, theme. Each colleague's phone is fully independent.
- Nothing is transmitted. GPS is used only at the moment a HEMS box is ticked, to produce the grid reference.
- localStorage is not indestructible — clearing Safari website data wipes the cards. The PDF, once emailed, is the durable record.
- ☀/☾ button (top right) switches between the night (dark MFD) and day (high-contrast sunlight) themes, remembered per device.

## 6. Known assumptions to check before trusting output

1. GW DEP **includes planned fuel** (§1.5) — verify against the mass & balance definition.
2. 4600 kg (SRP notation threshold) and 4800 kg (AUM) are hard-coded. Departure fuel is inferred (§1.5): refuels are assumed to return fuel exactly to the planned load.
3. VAR TOW is a single daily entry — refresh it if conditions change.
4. Sun times are computed (±1–2 min), not almanac-official.
5. Default density 0.79 is nominal — use the bowser figure.
6. Zulu line and sun times assume UK rules and the Redhill location.
