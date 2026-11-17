# Approach & Minima Reference — IFR Fuel Planner (design data, v0)

Purpose: the data behind **approach selection** in the fuel planner. Answers "what approaches does this field have, what type, and what minima" — which drives the scenario gating and fuel.

**Authority & currency:** the UK eAIP (NATS Aurora, `EG-AD-2.<ICAO>`) is the authority for published approaches and minima. It is robots-blocked for automated fetch, and changes every 28 days (AIRAC). So **Part 2 (per-field availability) must be verified against the current eAIP, and actual flown minima come from the company plates.** Part 1 (minima by type) is from OMA 8H and is stable.

**Helicopter rule:** an ILS is flown as a **Type A (Cat A) approach** — DH 200 ft floor. We are not using Cat II/III. Company plates are used to fly; this table is for planning options only.

---

## Part 1 — Helicopter system minima by approach type (OMA 8H 8.1.3.5.1, Table 1)

These are the **lowest DH/MDH floors**. A specific runway's published OCH may be higher — the plate wins.

| Approach type | DH/MDH floor (ft) |
|---------------|-------------------|
| ILS / MLS / GLS (Cat A) | **200** |
| LPV (GNSS/SBAS) | 200 *(250 unless FAS datablock VAL ≤ 35 m)* |
| PAR | 200 |
| RNP LNAV (GNSS) | 250 |
| RNP LNAV/VNAV (Baro-VNAV) | 250 |
| Helicopter PinS | 250 |
| LOC (± DME) | 250 |
| VOR/DME | 250 |
| VOR | 300 |
| NDB/DME | 300 |
| NDB | 350 |
| SRA (½ / 1 / 2 nm) | 250 / 300 / 350 |

### RVR by DH band and approach lighting (OMA 8H 8.1.3.5.2, Table 2 — onshore)

| DH/MDH (ft) | FALS | IALS | BALS | NALS |
|-------------|------|------|------|------|
| 200 | 550 | 600 | 700 | 1000 |
| 201–249 | 550 | 650 | 750 | 1000 |
| 250–299 | 600* | 700* | 800 | 1000 |
| 300+ | 750* | 800 | 900 | 1000 |

*2D (non-precision) approaches: RVR floor 800 m. Lighting classes: FALS = full (HIALS ≥720 m), IALS = intermediate (420–719 m), BALS = basic (210–419 m), NALS = nil/<210 m.*

---

## Part 2 — Per-airfield approach availability (VERIFY against current eAIP)

Confidence note: approach *types* below are from public sources and general knowledge; exact runway designators and published minima **must be confirmed on the current eAIP / company plate** before any operational use. This is the planning-options structure, not a chart.

| ICAO | Airfield | Published instrument approaches (type · rwy) | Notes |
|------|----------|----------------------------------------------|-------|
| EGKR | Redhill | **None** — VFR only | Origin field; no IAP |
| EGKK | Gatwick | ILS · 08R/26L · RNP · 08R/26L | Cat III field; we plan ILS as Cat A |
| EGKB | Biggin Hill | ILS · 21 · RNP (GNSS) · 21 · RNP 03 (RF, new 2026) | NDB withdrawn |
| EGKA | Shoreham | RNP (GNSS) · 02/20 | RNP only — no ILS, no NDB (confirmed) |
| EGMD | Lydd | ILS · 21 · RNP · NDB | London Ashford |
| EGMC | Southend | ILS · 05 · RNP · 05/23 · VOR | |
| EGHI | Southampton | ILS · 20 · RNP · 20/02 | VOR historically |
| EGLL | Heathrow | ILS · all rwys (Cat III) · RNP | Plan ILS as Cat A |
| EGLF | Farnborough | ILS/DME · 06 & 24 · LOC/DME · 06 & 24 · SRA RTR 2 NM · 06 & 24 | No RNP approach published. 3.5° GP mandatory on all approaches. PPR; no rotors-running refuelling; helicopters normally VFR by day, IAPs on request. eAIP AIRAC 29 Oct 2026. (London City removed Nov 2026 — approved operators only.) |
| EGSS | Stansted | ILS · 04 · ILS · 22 · RNP · 04/22 | Cat III field; plan ILS as Cat A. Northernmost site |

---

## Part 3 — How approach choice feeds fuel planning

Selecting an approach sets its **DH** (Part 1) and, with the field's lighting class, its **RVR** (Part 1 table). That DH/RVR then drives:

- **Destination usable?** Forecast must meet the approach's DH + RVR at ETA.
- **Scenario A (two approaches, one field):** forecast ceiling ≥ **DH + 400 ft** and vis ≥ **3000 m**, two *independent* approaches (e.g. ILS + RNP, not ILS twice). Fuel: both approaches (2 × 70 kg) + 15 min on trip, no alternate.
- **Scenario B (one alternate):** alternate forecast ≥ **RVR/VIS + 400 m** and ceiling ≥ **DH/MDH + 200 ft**. Fuel: full diversion + approaches.
- **Scenario C (reasonable probability):** alternate ≥ **RVR/VIS + 800 m**, ceiling ≥ **DH/MDH + 400 ft**.
- **VMC:** destination forecast VMC 1 hr either side of ETA → no alternate, lightest fuel.

In Scenario A the "most-fuel approach" is the one the trip fuel is planned on; the planner picks the higher of the two selected approaches.

---

## Sources
- OMA Part A Issue 7 Rev 1 (Aug 2026), Section 8H — minima tables (8.1.3.5), scenario rules (8.1.3.3.2).
- UK eAIP (authority, verify current): https://www.aurora.nats.co.uk/htmlAIP/ — aerodrome pages `EG-AD-2.EGKK`, `EG-AD-2.EGKB`, `EG-AD-2.EGKA`, `EG-AD-2.EGMD`, `EG-AD-2.EGMC`, `EG-AD-2.EGHI`, `EG-AD-2.EGLL`, `EG-AD-2.EGLF`.
- Biggin Hill RNP 03: [airspacechange.co.uk ACP201986](https://consultations.airspacechange.co.uk/biggin-hill-airport/biggin-hill-airport-21-rnav-acp/supporting_documents/21%20RNAV%20CONSULTATION%20DOCUMENT%20%20ACP201986%20Issue%201%20Approved.pdf)
