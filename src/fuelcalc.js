// IFR FUEL planner — pure calculation engine. No DOM, no network: every
// constant comes from the bundled fuel-planner-dataset.json (OMA 8H / OMB B34).
// Kept separate from app.jsx so it can be unit-tested directly (domtest15).
import DATA from "./fuel-planner-dataset.json";

export { DATA };
export const AC = DATA.aircraft;
export const SCENARIO_ORDER = ["VMC", "A", "B", "C", "D"];

// Plain-English descriptor shown under the scenario strip
// (OMA 8H 8.1.3.3.2 / approach-minima-reference.md Part 3).
export const SCENARIO_TEXT = {
  VMC: "Destination forecast VMC for 1 hr either side of ETA. No alternate; fuel for one approach.",
  A: "Two independent approaches at one field (ceiling ≥ DH + 400 ft, vis ≥ 3000 m). No alternate; 15 min added to trip fuel.",
  B: "One alternate. Alternate forecast ≥ RVR/vis + 400 m and ceiling ≥ DH/MDH + 200 ft. Full diversion fuel + approaches.",
  C: "One alternate, weather below minima has reasonable probability: alternate ≥ RVR/vis + 800 m, ceiling ≥ DH/MDH + 400 ft. Fuel as B.",
  D: "Two alternates. Plan fuel to the farther of the two. Three approaches by default.",
};

const NM_M = 1852;
const EARTH_R_M = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in nautical miles.
export function haversineNm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return (2 * EARTH_R_M * Math.asin(Math.sqrt(h))) / NM_M;
}

// Fuel for a leg at planning speed / cruise burn: round(nm ÷ 130 × 280).
export function legKg(nm) {
  return Math.round((nm / AC.plan_speed_kt) * AC.cruise_burn_kg_per_hr);
}

export const kgToL = (kg) => Math.round(kg / AC.fuel_density_kg_per_l);

export const siteById = (id) => DATA.sites.find((s) => s.id === id) || null;
// Origin: any IFR airfield. Destination / alternate: IFR airfield with ≥1 approach.
export const originSites = () => DATA.sites.filter((s) => s.type === "airfield_ifr");
export const destSites = () => originSites().filter((s) => (s.approaches || []).length > 0);

export const defaultApproaches = (scenario) => DATA.oma_rules.scenarios[scenario].approaches_default;
export const PIN_S_KG = Math.round((DATA.oma_rules.scenario_A_trip_add_min / 60) * AC.cruise_burn_kg_per_hr);

// Distances are rounded to whole nm first, so every kg figure in the table can be
// reproduced by hand from the nm shown on screen.
const wholeNm = (a, b) => Math.round(haversineNm(a, b));

/**
 * @param {object} p
 *  origin, dest: site ids; alts: array of site ids (0–2); scenario: VMC|A|B|C|D
 *  fob: kg on board (number|null); startTaxi, approaches, discretionary: kg/count (numbers)
 * @returns breakdown lines, REQUIRED, margin, verdict and indicative flags.
 *  Anything not yet selectable yields `incomplete` with a reason — never throws.
 */
export function computeFuel(p) {
  const sc = DATA.oma_rules.scenarios[p.scenario];
  const origin = siteById(p.origin);
  const dest = siteById(p.dest);
  const out = { incomplete: null, tripNm: null, altnNm: null, lines: [], required: null, margin: null, verdict: null, flags: [] };
  if (!sc) { out.incomplete = "scenario"; return out; }
  if (!origin || !dest) { out.incomplete = "route"; return out; }
  if (origin.id === dest.id) { out.incomplete = "same"; return out; }

  const tripNm = wholeNm(origin, dest);
  out.tripNm = tripNm;
  const trip = legKg(tripNm);
  const contingency = Math.round((DATA.oma_rules.contingency_pct_ifr / 100) * trip);

  // Alternate line: B/C one alternate, D the farther of two; none for VMC/A.
  let altKg = null;
  let altLabel = "ALTERNATE";
  if (sc.alt_fuel) {
    const need = sc.alternates;
    const chosen = (p.alts || []).slice(0, need).map(siteById).filter(Boolean);
    if (chosen.length === need) {
      const dists = chosen.map((a) => wholeNm(dest, a));
      const far = Math.max(...dists);
      out.altnNm = far;
      altKg = legKg(far);
      if (need === 2) altLabel = `ALTERNATE (FARTHER: ${chosen[dists.indexOf(far)].icao})`;
    } else {
      out.incomplete = "alternate";
    }
  }

  const startTaxi = Number.isFinite(p.startTaxi) ? p.startTaxi : AC.start_taxi_default_kg;
  const approachCount = Number.isFinite(p.approaches) ? p.approaches : sc.approaches_default;
  const discretionary = Number.isFinite(p.discretionary) ? p.discretionary : 0;

  const lines = [];
  const add = (key, label, kg, extra) => lines.push({ key, label, kg, l: kg === null ? null : kgToL(kg), ...extra });
  add("startTaxi", "START & TAXI", startTaxi);
  add("trip", "TRIP", trip);
  if (sc.alt_fuel) add("alternate", altLabel, altKg);
  add("contingency", "CONTINGENCY 10%", contingency);
  add("finalReserve", "FINAL RESERVE", AC.final_reserve_ifr_kg);
  add("approaches", "IFR APPROACHES", approachCount * AC.per_ifr_approach_kg, { count: approachCount });
  if (p.scenario === "A") add("pins", "PinS / 2-APP (15 MIN)", PIN_S_KG);
  add("discretionary", "DISCRETIONARY", discretionary);
  lines.forEach((ln, i) => (ln.serial = i + 1));
  out.lines = lines;

  if (out.incomplete) return out;

  out.required = lines.reduce((s, ln) => s + ln.kg, 0);
  if (Number.isFinite(p.fob)) {
    out.margin = p.fob - out.required;
    out.verdict = out.margin >= 0 ? "ENOUGH" : "SHORT";
    if (out.margin >= 0 && out.margin < AC.engine_failure_hold_kg_derived) {
      out.flags.push(`margin below engine-failure ${AC.engine_failure_hold_min}-min hold (${AC.engine_failure_hold_kg_derived} kg).`);
    }
  }
  if (out.required > AC.usable_fuel_kg) {
    out.flags.push(`REQUIRED exceeds usable fuel (${AC.usable_fuel_kg} kg).`);
  }
  return out;
}
