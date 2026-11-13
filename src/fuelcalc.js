// IFR FUEL planner — pure calculation engine. No DOM, no network: every
// constant comes from the bundled fuel-planner-dataset.json (OMA 8H / OMB B34).
// Kept separate from app.jsx so it can be unit-tested directly (domtest15).
import DATA from "./fuel-planner-dataset.json";
import GEO from "./map-geometry.json";

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

// ───────────────────────── wireframe map helpers ─────────────────────────
// Geometry (src/map-geometry.json) is generated by tools/gen_map.py in exactly
// this projection, so sites and county outlines align by construction.
export const MAP = GEO;

// Equirectangular with a cos(mean-latitude) longitude correction → SVG units.
export function project(lat, lon) {
  const m = GEO.meta;
  return { x: (lon - m.lonMin) * m.k * m.scale, y: (m.latMax - lat) * m.scale };
}

const ROLE_KEYS = ["origin", "dest", "alt1", "alt2"];

/**
 * Tap on a map marker → next selection state (mirrors the dropdown rules).
 * sel = {origin, dest, alt1, alt2}; needAlts = alternates the scenario wants (0–2).
 * Tapping a field already holding a role clears that role. Otherwise it takes the
 * next unset role in the order origin → destination → alternate(s). Destination and
 * alternates need ≥1 approach (so Redhill stays origin-only). Refuel points and
 * hospitals are display-only: they just return a caption.
 */
export function tapSite(sel, id, needAlts) {
  const site = siteById(id);
  if (!site) return { sel, note: "" };
  if (site.type !== "airfield_ifr") {
    return { sel, note: `${site.name} — ${site.type === "hospital" ? "hospital" : "refuel point"} (display only)` };
  }
  for (const k of ROLE_KEYS) if (sel[k] === id) return { sel: { ...sel, [k]: "" }, note: "" };
  const hasApp = (site.approaches || []).length > 0;
  const n = { ...sel };
  const noApp = { sel, note: `${site.icao} ${site.name} has no approaches — origin only` };
  if (!n.origin) n.origin = id;
  else if (!n.dest) { if (!hasApp) return noApp; n.dest = id; }
  else if (needAlts >= 1 && !n.alt1) { if (!hasApp) return noApp; n.alt1 = id; }
  else if (needAlts === 2 && !n.alt2) { if (!hasApp) return noApp; n.alt2 = id; }
  else return { sel, note: "All roles set — tap a selected field to clear it" };
  return { sel: n, note: "" };
}

/**
 * Greedy label declutter. items: [{id, x, y, text, must}] in priority order (selected
 * roles first). Tries right / left / above / below of each marker and keeps the first
 * spot that overlaps no placed label and no marker. Unplaceable optional labels are
 * dropped (revealed by tapping); `must` labels are always placed (first candidate).
 * obstacles: extra {x,y} marker positions (e.g. hospitals) labels must not cover.
 */
export function placeLabels(items, fs = 6.5, markerR = 4.5, obstacles = []) {
  const placed = [];
  const out = {};
  // every marker (labelled or not, hospitals included) is an obstacle for every label
  const markers = [...items.map((i) => ({ x: i.x, y: i.y })), ...obstacles];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const W = GEO.meta.w, H = GEO.meta.h;
  for (const it of items) {
    const w = it.text.length * fs * 0.62, h = fs;
    const cand = [
      { x: it.x + markerR + 1, y: it.y - h / 2, anchor: "start" },
      { x: it.x - markerR - 1 - w, y: it.y - h / 2, anchor: "end" },
      { x: it.x - w / 2, y: it.y - markerR - 1 - h, anchor: "middle" },
      { x: it.x - w / 2, y: it.y + markerR + 1, anchor: "middle" },
    ].map((c) => ({ ...c, w, h }));
    const ok = (c) =>
      c.x >= 0 && c.y >= 0 && c.x + w <= W && c.y + h <= H &&
      !placed.some((p) => hit(c, p)) &&
      !markers.some((m) => m.x > c.x - markerR && m.x < c.x + w + markerR && m.y > c.y - markerR && m.y < c.y + h + markerR);
    const pick = cand.find(ok) || (it.must ? cand[0] : null);
    if (pick) {
      placed.push(pick);
      const tx = pick.anchor === "start" ? pick.x : pick.anchor === "end" ? pick.x + w : pick.x + w / 2;
      out[it.id] = { x: tx, y: pick.y + h * 0.8, anchor: pick.anchor };
    }
  }
  return out;
}
