# BUILD BRIEF — multi-sector IFR fuel planning (IFR FUEL tab)

**For Claude Code.** Read HANDOVER.md and README.md first. Implement against the current repo state. All existing tests stay green; HANDOVER.md invariants must not regress.

## Companion files
- `prototype-fuel-multisector.html` — a **working** prototype. Its `compute()` function is the reference implementation of the maths and its screen is the approved layout. Port the logic; do not reinvent it.
- `fuel-planner-dataset.json` — updated data: PinS sites with ICAO codes, profile rules, alternate-validity rule, multi-sector rules.
- `fuel-calc-spec.md`, `approach-minima-reference.md` — background on the OMA/OMB sources.

## Governing rule (from the user — applies to every decision here)
The Operations Manual is the authority. The planner must **never be less restrictive than the OMA**, and should **not be more restrictive** than it. Where the OMA is silent or a point is still open, implement what this brief states, keep it as data so it can be changed without touching logic, and list it in your summary. If something in the repo, the dataset or this brief looks less restrictive than the OMA text quoted below, stop and flag it.

The tab stays an **unregulated cross-check** with its visible disclaimer, and stays **fully offline** (no runtime network).

---

## 1. What changes

The planner becomes a **trip of sectors** instead of one leg. If a single-leg IFR FUEL tab already exists in the repo, this replaces it: a two-stop trip is the single-leg case, and its numbers must not change for profile B. If the tab does not exist yet, build this directly.

The reason: hospital sites have no fuel, so everything needed for the whole chain must be on board at the first lift. The crew needs
1. the total fuel required to lift from the first site, and
2. a **minimum fuel to lift** figure at every later site, to check against the gauge before departing it.

If actual fuel at a site is below its minimum, an IFR departure from there is not available: the crew refuels or waits for weather.

---

## 2. Data (`fuel-planner-dataset.json`)

New or changed:
- **PinS sites** (`type: "pins_site"`): EGKD William Harvey (WHH), EGKC King's College (KCH), EGRS Royal Sussex (RSCH), EGGB East Brighton Park (EBP). Each has `fuel: false` and a PinS approach. William Harvey carries `fuel_planned: true` (see §5).
- **Redhill (EGKR)** now lists a PinS approach with `status: "planned"`. Show a small "PLANNED" tag wherever a site's only approach has `status` of `planned` or `confirm`; it remains selectable.
- `oma_rules.gnss_approach_types`, `alternate_validity`, `profiles_by_destination`, `multi_sector` — read the rules from here, do not hard-code them.

Selectable as a stop: every `airfield_ifr` and `pins_site`. Other hospitals and the VFR refuel points remain map markers only.

---

## 3. Calculation (port from the prototype)

Per sector *i* (stop *i* → stop *i+1*), with OMB34 figures from `aircraft`:

```
trip   = round(dist_nm / 130 * 280)          haversine, nm
cont   = round(0.10 * trip)                  planned as used on every sector
burn   = 30 (start & taxi) + trip + cont + 70 (one approach at the destination)

own requirement, by profile:
  VMC : burn + 150
  A   : burn + 70 (second approach) + 70 (15 min added to trip) + 150
  B, C: burn + alt_kg + 70 (approach at alternate) + 150
  D   : as B, with alt_kg to the FARTHER of the two alternates

alt_kg = round(dist(destination → alternate) / 130 * 280)
```

Minimum to lift, worked **backwards** from the last sector:

```
gate[last] = own[last]
gate[i]    = max( own[i],  burn[i] + gate[i+1] )      unless stop i+1 is a refuel stop,
                                                      in which case gate[i] = own[i]
```

Fuel chain, forwards: fuel at each stop is the actual figure if the user has entered one, otherwise the planned figure (previous fuel − previous burn). Margin = fuel − gate. At a refuel stop with no figure entered, assume uplift to exactly the minimum and show the uplift required.

**Profiles (OMA 8H 8.1.3.3.2), chosen per sector:**
- Airfield destination: VMC, A, B, C, D; default B. A is offered only where the field has two approaches on independent aids (so not Shoreham, which is RNP only).
- PinS destination: **C and D only; default C.** Basis: 8.3.2.7.4 "PinS procedures offer no alleviation from requirements to declare and carry fuel for a destination alternate", and 8.3.2.7.7 "It is assumed that PinS IFR flights will be conducted with provision for one destination alternate unless the destination meets Planning Minima… using meteorological information which complies with CAP 746". Site weather (SkylinkPro) is uncertified, so B does not apply.
- B and C carry the same fuel; they differ in the alternate planning minima shown in the description (B: RVR/VIS +400 m, ceiling +200 ft; C: +800 m, +400 ft).

**Alternate validity (do not relax):** 8.1.3.3.2 — "The commander should only select an aerodrome as a destination alternate if an instrument approach procedure that does not rely on GNSS is available either at that aerodrome or at the destination aerodrome." 8.3.2.7.4 — for PinS, "The destination alternate shall have a serviceable and applicable procedure which does not rely on GNSS". So: if the destination has a non-GNSS approach, any airfield with an approach may be the alternate; otherwise (PinS, or RNP-only fields) only airfields with a non-GNSS approach. Derive this from each site's approach types and `gnss_approach_types`.

**Default alternate:** the nearest valid alternate to that sector's destination, labelled "nearest"; the user can change it ("chosen"). Changing a destination resets that sector's alternate and profile to defaults.

---

## 4. Screen (match the prototype)

Top to bottom inside the existing IFR FUEL tab styling, both themes:
1. Map (if already built): draw the route through all stops; otherwise unchanged.
2. Headline: REQUIRED TO LIFT <first site>, with ENOUGH/SHORT against the fuel entered at the first stop.
3. One card per stop: site dropdown; MIN TO LIFT; ACTUAL KG input (placeholder shows the planned figure); MARGIN. Amber border and the message "BELOW MINIMUM — IFR DEPARTURE NOT AVAILABLE. REFUEL BEFORE CONTINUING, OR HOLD FOR WEATHER." when margin is negative. The last stop shows planned fuel on landing only.
4. Between cards, one collapsed sector line: destination, distance, profile letter, alternate(s), sector burn. Tapping opens: the profile strip with its description, the alternate picker(s), and the OMB §5.2.3-style table (SERIAL · REQUIREMENT · L · KG) that sums to that site's minimum. When the onward chain governs, the table ends with an "Onward — min to lift <next site>" line instead of alternate and reserve.
5. "+ ADD SECTOR", and ✕ to remove a stop (minimum two stops).
6. Disclaimer.

Keep the collapsed view to three numbers per stop. Do not add fields to it.

Persist the current trip (stops, profiles, alternates, refuel flags, actual figures) in localStorage under its own key, with a RESET TRIP control. It must not touch the flight card's storage.

---

## 5. Refuel stops
- A REFUEL HERE toggle appears on any mid-trip stop whose site has `fuel: true`.
- Turning it on breaks the chain at that stop (§3), relabels the input "AFTER REFUEL KG", and shows "ARRIVE WITH n KG · UPLIFT AT LEAST n KG" (or that no uplift is needed).
- All listed airfields and Redhill have fuel. William Harvey does **not** yet: leave `fuel: false`. The prototype's "what if" tick box is a design aid only; do not ship it. When fuel arrives there, it is a one-line dataset change.

---

## 6. Tests (numbers taken from the prototype)

Default trip EGKR → EGKD → EGKC → EGKR, profile C throughout, nearest alternates:
- alternates chosen: EGMD, EGLC, EGKK
- sector burns: 194, 200, 136 kg
- minimum to lift: **759, 565, 365 kg**; with 820 kg at the start, planned landing fuel 290 kg

Further cases:
- Same trip with William Harvey given fuel and REFUEL HERE on: minimum to lift EGKR becomes **437**; EGKD stays 565.
- Add a fourth sector EGKR → EGKK: profile VMC gives minimums **790, 596, 396, 260**; profile A gives **930, 736, 536, 400**; profile D (alternates EGKB + EGKA) gives **901, 707, 507, 371**.
- PinS destination offers only C and D; Shoreham destination does not offer A.
- Alternate list for a PinS destination excludes Shoreham; for Gatwick it includes Shoreham.
- Entering actual fuel below a site's minimum shows the amber state and message; later planned figures follow from the entered value.
- A two-stop trip reproduces the single-leg planner's result for profile B (if that planner exists).
- Allow ±2 kg where rounding differs. All existing tests green.

---

## 7. Open items — implement as stated, keep as data, repeat in your summary
1. **Contingency:** 10% per sector, planned as used, nothing carried forward. Awaiting confirmation.
2. **PinS in clear VMC:** whether a PinS flight can ever be planned without an alternate. Currently not offered, following 8.3.2.7.7.
3. **PinS approach status:** which PinS procedures are published and usable; dataset marks them `confirm` / `planned`.
4. **Site coordinates:** East Brighton Park (EGGB) is the position supplied by the user, 50.8174, -0.1018. All other site coordinates are still to be verified.
5. The OMA PinS text is described by the programme lead as a provisional starting position and may change.

## 8. Acceptance
`npm run build && npm test` green; no runtime network; new version entry per the version-history invariant; push to main. Summary to state the version pushed, the default-trip minimums the build produces (expect 759 / 565 / 365), and the open items above.
