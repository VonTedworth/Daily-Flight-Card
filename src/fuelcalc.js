// IFR FUEL planner — pure calculation engine. No DOM, no network: every constant and rule
// comes from the bundled fuel-planner-dataset.json (OMA 8H / OMB B34). Kept separate from
// app.jsx so it can be unit-tested directly (domtest15).
//
// MULTI-SECTOR (brief: multisector-build-brief.md). A trip is a list of stops; each sector
// i → i+1 has its own weather profile and alternate(s). The maths is a port of the approved
// prototype's compute() (prototype-fuel-multisector.html); nothing here is invented — every
// figure and rule is read from the dataset passed to makePlanner().
import DATA from "./fuel-planner-dataset.json";
import GEO from "./map-geometry.json";

export { DATA };
export const AC = DATA.aircraft;
export const SCENARIO_ORDER = ["VMC", "A", "B", "C", "D", "VFR"];

// Profile descriptions (from the approved prototype; OMA 8H 8.1.3.3.2).
export const SCENARIO_TEXT = {
  VMC: "Destination forecast VMC for approach and landing, 1 hr either side of ETA. No alternate.",
  A: "Two approaches on independent aids at the destination. Ceiling ≥ minima + 400 ft, vis ≥ 3000 m. No alternate: carry both approaches + 15 min.",
  B: "One alternate. Alternate forecast ≥ RVR/VIS + 400 m, ceiling ≥ DH/MDH + 200 ft.",
  C: "One alternate; destination weather from an uncertified source (e.g. SkylinkPro at a PinS site). Alternate forecast ≥ RVR/VIS + 800 m, ceiling ≥ DH/MDH + 400 ft. Same fuel as B.",
  D: "Two alternates. Fuel planned to the farther one.",
  VFR: "VFR leg (day): flown visually, so no IFR approach and no alternate. Start & taxi + trip + contingency + VFR day final reserve.",
};
export const PINS_NOTE = "PinS destination: VMC, A and B not offered (OMA 8.3.2.7.7; site weather uncertified).";

// Two-line hint printed inside each profile button, so the plan type reads at a glance.
export const SCENARIO_HINT = {
  VMC: ["NO ALTN", "1 APP"],
  A: ["NO ALTN", "2 APPS"],
  B: ["1 ALTN", "+400M"],
  C: ["1 ALTN", "+800M"],
  D: ["2 ALTN", "FARTHER"],
  VFR: ["NO ALTN", "NO APP"],
};

// Published approaches at a site, for the information lines in each sector's details.
// (Types/runways from the bundled dataset — verify against the current eAIP / company plate.)
const APP_LABEL = {
  ILS: "ILS", LPV: "LPV", PAR: "PAR", RNP_LNAV: "RNP", RNP_LNAV_VNAV: "RNP VNAV", PinS: "PinS",
  LOC: "LOC", VOR_DME: "VOR/DME", VOR: "VOR", NDB_DME: "NDB/DME", NDB: "NDB",
  SRA_half_nm: "SRA", SRA_1_nm: "SRA", SRA_2_nm: "SRA",
};
export function approachSummary(id, data = DATA) {
  const st = data.sites.find((x) => x.id === id);
  if (!st || !st.approaches) return [];
  return st.approaches.map((a) => {
    const r = String(a.rwy || "").trim();
    const rwy = r.toLowerCase() === "all" ? " ALL RWYS" : r && r !== "-" ? " " + r.toUpperCase() : "";
    // `status` (planned / confirm) is kept in the data — it still bars a site from being an
    // alternate — but is no longer displayed: every PinS is in planning until plates exist.
    const extra = a.note ? a.note.toUpperCase() : "";
    return `${APP_LABEL[a.type] || a.type.replace(/_/g, " ")}${rwy}${extra ? ` (${extra})` : ""}`;
  });
}

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

// Fuel for a leg at planning speed / cruise burn: round(nm ÷ 130 × 280), unrounded nm (as the prototype).
export function legKg(nm) {
  return Math.round((nm / AC.plan_speed_kt) * AC.cruise_burn_kg_per_hr);
}
export const kgToL = (kg) => Math.round(kg / AC.fuel_density_kg_per_l);
export const siteById = (id) => DATA.sites.find((s) => s.id === id) || null;

// A new / reset trip is blank: two empty stops to choose. "" = stop not chosen yet.
export const DEFAULT_TRIP = Object.freeze({
  stops: ["", ""],
  actual: ["", ""],
  refuel: [false, false],
  scen: [null],
  alt: [null],
  alt2: [null],
});
export const freshTrip = () => JSON.parse(JSON.stringify(DEFAULT_TRIP));
// The brief's reference trip (§6) — used by the tests, never shown by default.
export const EXAMPLE_TRIP = Object.freeze({
  stops: ["EGKR", "EGKD", "EGKC", "EGKR"],
  actual: ["", "", "", ""],
  refuel: [false, false, false, false],
  scen: [null, null, null],
  alt: [null, null, null],
  alt2: [null, null, null],
});
export const exampleTrip = () => JSON.parse(JSON.stringify(EXAMPLE_TRIP));

/** Build a planner over a dataset (tests pass modified copies; the app uses the bundled one). */
export function makePlanner(data = DATA) {
  const ac = data.aircraft, rules = data.oma_rules, ms = rules.multi_sector;
  const GNSS = new Set(rules.gnss_approach_types);
  const APP = ac.per_ifr_approach_kg, TAXI = ac.start_taxi_default_kg, RESERVE = ac.final_reserve_ifr_kg;
  const PER_ARRIVAL = ms.approach_per_arrival;
  const CONT = rules.contingency_pct_ifr / 100;
  const site = (id) => data.sites.find((s) => s.id === id) || null;
  const nm = (a, b) => haversineNm(a, b);
  const leg = (d) => Math.round((d / ac.plan_speed_kt) * ac.cruise_burn_kg_per_hr);
  const apps = (s) => (s && s.approaches) || [];
  // An approach marked "planned" / "confirm" is not (yet) a usable procedure.
  const usable = (a) => !a.status;
  const nonGnss = (s) => apps(s).some((a) => usable(a) && !GNSS.has(a.type));
  const isPins = (s) => s.type === "pins_site" || (apps(s).length > 0 && apps(s).every((a) => a.type === "PinS"));
  // Independent aids: every GNSS procedure shares one aid; each ground-based procedure is its own.
  const aids = (s) => new Set(apps(s).filter(usable).map((a) => (GNSS.has(a.type) ? "GNSS" : `${a.type}:${a.rwy}`))).size;

  const stopSites = () => data.sites.filter((s) => s.type === "airfield_ifr" || s.type === "pins_site");
  // "PLANNED"-style tag when a site's only approach(es) are not yet usable.
  const planStatus = (s) => (apps(s).length && apps(s).every((a) => a.status) ? apps(s)[0].status : null);
  const hasFuel = (s) => !!(s && s.fuel === true);

  function profilesFor(dest) {
    const key = isPins(dest) ? "pins" : aids(dest) >= 2 ? "airfield" : "airfield_one_aid";
    return { key, ...rules.profiles_by_destination[key] };
  }
  // OMA 8H 8.1.3.3.2 / 8.3.2.7.4: valid only if a non-GNSS approach exists at the alternate or
  // at the destination. Only airfields with a usable approach can be alternates. Nearest first.
  function alternatesFor(dest) {
    return data.sites
      .filter((s) => s.type === "airfield_ifr" && s.id !== dest.id && apps(s).some(usable) && (nonGnss(dest) || nonGnss(s)))
      .sort((a, b) => nm(dest, a) - nm(dest, b));
  }

  /** Make a stored trip safe to compute: valid ids, consistent array lengths. */
  function normalizeTrip(t) {
    const ok = t && Array.isArray(t.stops) && t.stops.length >= 2 && t.stops.every((id) => id === "" || stopSites().some((s) => s.id === id));
    if (!ok) return freshTrip();
    const n = t.stops.length, m = n - 1;
    const pad = (arr, len, fill) => Array.from({ length: len }, (_, i) => (Array.isArray(arr) && arr[i] !== undefined ? arr[i] : fill));
    return {
      stops: [...t.stops],
      actual: pad(t.actual, n, "").map((v) => String(v || "").replace(/[^0-9]/g, "")),
      refuel: pad(t.refuel, n, false).map(Boolean),
      scen: pad(t.scen, m, null),
      alt: pad(t.alt, m, null),
      alt2: pad(t.alt2, m, null),
    };
  }

  /** The prototype's compute(), reading every figure from the dataset. */
  function computeTrip(tIn) {
    const t = normalizeTrip(tIn);
    const n = t.stops.length, sec = [];
    const refuelAt = (j) => j > 0 && j < n - 1 && !!t.refuel[j] && hasFuel(site(t.stops[j]));
    for (let i = 0; i < n - 1; i++) {
      const from = site(t.stops[i]), to = site(t.stops[i + 1]);
      if (!from || !to) {
        // a stop not chosen yet: nothing to compute for this sector (and the chain before it)
        sec.push({ i, from, to, incomplete: true, profile: null, sc: null, vfr: false, needAlts: 0, list: [], a1: null, a2: null, far: null, auto: true, dist: null, trip: null, cont: null, burn: null, altNm: null, altKg: null, own: null, error: null });
        continue;
      }
      const prof = profilesFor(to);
      const sc = prof.allowed.includes(t.scen[i]) ? t.scen[i] : prof.default;
      const scen = rules.scenarios[sc];
      const list = alternatesFor(to);
      const chosen1 = list.find((s) => s.id === t.alt[i]);
      const a1 = chosen1 || list[0] || null;
      const rest = list.filter((s) => s !== a1);
      const a2 = rest.find((s) => s.id === t.alt2[i]) || rest[0] || null;
      const dist = nm(from, to), trip = leg(dist), cont = Math.round(CONT * trip);
      // A VFR leg (scenario ifr: false) flies no IFR approach at its destination.
      const arrivalApps = scen.ifr === false ? 0 : PER_ARRIVAL;
      const reserve = scen.final_reserve ? ac[scen.final_reserve] : RESERVE;
      const burn = TAXI + trip + cont + arrivalApps * APP;
      const needAlts = scen.alt_fuel ? scen.alternates : 0;
      const far = needAlts === 2 && a2 && a1 && nm(to, a2) > nm(to, a1) ? a2 : a1;
      let own, altNm = null, altKg = null, error = null;
      if (needAlts) {
        if (!far || (needAlts === 2 && !a2)) { own = null; error = "NO VALID ALTERNATE"; }
        else { altNm = nm(to, far); altKg = leg(altNm); own = burn + altKg + PER_ARRIVAL * APP + RESERVE; }
      } else {
        const extraApps = Math.max(0, scen.approaches_default - arrivalApps); // A: second approach; VMC/VFR: none
        const add = scen.trip_add_min ? Math.round((scen.trip_add_min / 60) * ac.cruise_burn_kg_per_hr) : 0;
        own = burn + extraApps * APP + add + reserve;
      }
      sec.push({ i, from, to, profile: prof, sc, vfr: scen.ifr === false, arrivalApps, reserve, needAlts, list, a1, a2, far, auto: !chosen1, dist, trip, cont, burn, altNm, altKg, own, error });
    }
    // Minimum to lift, worked backwards. A refuel stop breaks the chain.
    for (let i = sec.length - 1; i >= 0; i--) {
      const s = sec[i];
      const next = i < sec.length - 1 && !refuelAt(i + 1) ? sec[i + 1].gate : undefined;
      const onward = next === undefined ? -1 : next === null ? null : s.burn + next;
      if (s.own === null || onward === null) { s.gate = null; s.useOnward = false; continue; }
      s.useOnward = onward > s.own;
      s.gate = Math.max(s.own, onward);
    }
    // Fuel chain, forwards: actual where entered, else planned (previous fuel − previous burn).
    const fuel = [], planned = [], uplift = [], margin = [];
    for (let i = 0; i < n; i++) {
      planned[i] = i === 0 || fuel[i - 1] === null || sec[i - 1].burn === null ? null : fuel[i - 1] - sec[i - 1].burn;
      const a = parseInt(t.actual[i], 10);
      const gate = i < n - 1 ? sec[i].gate : undefined;
      if (!isNaN(a)) fuel[i] = a;
      else if (i === 0) fuel[i] = gate === null ? null : gate;
      else if (refuelAt(i) && gate !== null && planned[i] !== null) { fuel[i] = Math.max(planned[i], gate); uplift[i] = Math.max(0, gate - planned[i]); }
      else fuel[i] = planned[i];
      margin[i] = i < n - 1 && fuel[i] !== null && gate !== null ? fuel[i] - gate : null;
    }
    // Requirement table per sector, summing to that site's minimum to lift (OMB §5.2.3 style).
    for (const s of sec) {
      if (s.incomplete) { s.rows = []; continue; }
      const pct = Math.round(CONT * 100);
      const rows = [
        { item: "Start & Taxi", req: "Start and taxi", kg: TAXI },
        { item: "Trip", req: `${s.from.id}→${s.to.id} · ${Math.round(s.dist)} nm`, kg: s.trip },
        { item: "Contingency", req: `${pct}% of trip, burnt this leg`, kg: s.cont },
      ];
      const scen = rules.scenarios[s.sc];
      if (s.gate === null) rows.push({ item: "—", req: s.error || "chain incomplete", kg: null });
      else if (s.useOnward) {
        if (s.arrivalApps) rows.push({ item: "IFR Approach", req: `${PER_ARRIVAL} × ${APP} kg at ${s.to.id}`, kg: PER_ARRIVAL * APP });
        rows.push({ item: "Onward", req: `Min to lift ${s.to.id}`, kg: sec[s.i + 1].gate });
      } else if (s.vfr) {
        rows.push({ item: "Final Reserve", req: "VFR day", kg: s.reserve });
      } else if (!s.needAlts) {
        const nApp = scen.approaches_default;
        rows.push({ item: nApp > 1 ? "IFR Approaches" : "IFR Approach", req: `${nApp} × ${APP} kg at ${s.to.id}`, kg: nApp * APP });
        if (scen.trip_add_min) rows.push({ item: "Additional", req: `${scen.trip_add_min} min added to trip`, kg: Math.round((scen.trip_add_min / 60) * ac.cruise_burn_kg_per_hr) });
        rows.push({ item: "Final Reserve", req: "30 min holding", kg: RESERVE });
      } else {
        rows.push({ item: "IFR Approach", req: `${PER_ARRIVAL} × ${APP} kg at ${s.to.id}`, kg: PER_ARRIVAL * APP });
        rows.push({ item: "Alternate", req: `${s.to.id}→${s.far.id} · ${Math.round(s.altNm)} nm`, kg: s.altKg });
        rows.push({ item: "Altn approach", req: `${PER_ARRIVAL} × ${APP} kg at ${s.far.id}`, kg: PER_ARRIVAL * APP });
        rows.push({ item: "Final Reserve", req: "30 min holding", kg: RESERVE });
      }
      s.rows = rows;
    }
    const entered = !isNaN(parseInt(t.actual[0], 10));
    return {
      complete: t.stops.every((id) => id !== ""),
      trip: t, sec, fuel, planned, uplift, margin,
      refuelAt: Array.from({ length: n }, (_, j) => refuelAt(j)),
      headline: { site: t.stops[0], gate: sec[0].gate, entered, margin: entered ? margin[0] : null },
      landing: fuel[n - 1],
    };
  }

  return { stopSites, planStatus, hasFuel, profilesFor, alternatesFor, normalizeTrip, computeTrip, isPins, nonGnss };
}

export const planner = makePlanner(DATA);

// ───────────────────────── wireframe map helpers ─────────────────────────
// Geometry (src/map-geometry.json) is generated by tools/gen_map.py in exactly
// this projection, so sites and county outlines align by construction.
export const MAP = GEO;

// Equirectangular with a cos(mean-latitude) longitude correction → SVG units.
export function project(lat, lon) {
  const m = GEO.meta;
  return { x: (lon - m.lonMin) * m.k * m.scale, y: (m.latMax - lat) * m.scale };
}

/**
 * Label placement. items: [{id, x, y, text, fs?, must?}] in priority order (selected roles
 * first). For each item try 8 compass positions at two radii and keep the first that overlaps
 * no placed label and no marker. If nothing is clean, `must` items take the least-overlapping
 * spot (so every airfield and hospital is always labelled); others are dropped.
 * obstacles: extra {x,y} marker positions that labels must avoid.
 */
export function placeLabels(items, obstacles = [], markerR = 4.5) {
  const placed = [];
  const out = {};
  const markers = [...items.map((i) => ({ x: i.x, y: i.y })), ...obstacles];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const W = GEO.meta.w, H = GEO.meta.h;
  for (const it of items) {
    const fs = it.fs || 6.5;
    const w = it.text.length * fs * 0.62, h = fs;
    const cands = [];
    for (const r of [markerR + 1, markerR + 6.5]) {
      const d = r * 0.72;
      cands.push(
        { x: it.x + r, y: it.y - h / 2, anchor: "start" },
        { x: it.x - r - w, y: it.y - h / 2, anchor: "end" },
        { x: it.x - w / 2, y: it.y - r - h, anchor: "middle" },
        { x: it.x - w / 2, y: it.y + r, anchor: "middle" },
        { x: it.x + d, y: it.y - d - h, anchor: "start" },
        { x: it.x - d - w, y: it.y - d - h, anchor: "end" },
        { x: it.x + d, y: it.y + d, anchor: "start" },
        { x: it.x - d - w, y: it.y + d, anchor: "end" }
      );
    }
    const cost = (c) => {
      let n = 0;
      if (c.x < 0 || c.y < 0 || c.x + w > W || c.y + h > H) n += 100;
      n += 10 * placed.filter((p) => hit({ ...c, w, h }, p)).length;
      n += markers.filter((m) => m.x > c.x - markerR && m.x < c.x + w + markerR && m.y > c.y - markerR && m.y < c.y + h + markerR).length;
      return n;
    };
    let best = null, bestCost = Infinity;
    for (const c of cands) {
      const k = cost(c);
      if (k < bestCost) { best = c; bestCost = k; }
      if (k === 0) break;
    }
    if (bestCost === 0 || it.must) {
      placed.push({ ...best, w, h });
      const tx = best.anchor === "start" ? best.x : best.anchor === "end" ? best.x + w : best.x + w / 2;
      out[it.id] = { x: tx, y: best.y + h * 0.8, anchor: best.anchor, fs };
    }
  }
  return out;
}
