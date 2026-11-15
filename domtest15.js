// IFR FUEL — multi-sector engine, unit tests against build/fuelcalc.cjs (built by `npm run build`).
// Reference numbers are brief §6 (multisector-build-brief.md), taken from the approved prototype.
const f = require("./build/fuelcalc.cjs");
const res = [];
const check = (n, ok) => res.push([n, !!ok]);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const P = f.planner;
const S = (id) => f.siteById(id);
const trip = (patch = {}) => Object.assign(f.freshTrip(), patch);
const withSector = (t, stop, sc = null) => { t.stops.push(stop); t.actual.push(""); t.refuel.push(false); t.scen.push(sc); t.alt.push(null); t.alt2.push(null); return t; };
const gates = (r) => r.sec.map((s) => s.gate);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── distances / leg fuel ──
check("haversine Redhill→Shoreham ≈ 23.5 nm", near(f.haversineNm(S("EGKR"), S("EGKA")), 23.5, 0.2));
check("leg fuel = round(nm ÷ 130 × 280): 23 nm → 50 kg", f.legKg(23) === 50);
check("kg → L at 0.79", f.kgToL(79) === 100);

// ── brief §6: default trip EGKR → EGKD → EGKC → EGKR, profile C, nearest alternates ──
const t0 = trip(); t0.actual[0] = "820";
const r0 = P.computeTrip(t0);
check("default trip stops EGKR → EGKD → EGKC → EGKR", eq(r0.trip.stops, ["EGKR", "EGKD", "EGKC", "EGKR"]));
check("profile C on every sector (PinS destinations default to C)", r0.sec.every((s) => s.sc === "C"));
check("nearest alternates EGMD, EGLC, EGKK", eq(r0.sec.map((s) => s.a1.id), ["EGMD", "EGLC", "EGKK"]) && r0.sec.every((s) => s.auto));
check(`sector burns 194, 200, 136 (${r0.sec.map((s) => s.burn).join(", ")})`, eq(r0.sec.map((s) => s.burn), [194, 200, 136]));
check(`MINIMUM TO LIFT 759, 565, 365 (${gates(r0).join(", ")})`, eq(gates(r0), [759, 565, 365]));
check(`820 kg at the start → planned landing fuel 290 (${r0.landing})`, r0.landing === 290);
check("headline: required to lift EGKR 759, margin +61", r0.headline.gate === 759 && r0.headline.entered && r0.headline.margin === 61);
check("no fuel entered at the start: lifts at exactly the minimum, headline not 'entered'", (() => { const r = P.computeTrip(trip()); return r.fuel[0] === 759 && !r.headline.entered && r.headline.margin === null; })());
check("each sector's table sums to its minimum to lift", r0.sec.every((s) => s.rows.reduce((a, x) => a + x.kg, 0) === s.gate));
check("onward chain governs sectors 1–2 (table ends 'Onward — min to lift next site')", r0.sec[0].useOnward && r0.sec[1].useOnward && !r0.sec[2].useOnward && r0.sec[0].rows[r0.sec[0].rows.length - 1].req === "Min to lift EGKD");

// ── William Harvey with fuel + REFUEL HERE ──
const dW = clone(f.DATA); dW.sites.find((s) => s.id === "EGKD").fuel = true;
const PW = f.makePlanner(dW);
const tW = trip(); tW.refuel[1] = true;
const rW = PW.computeTrip(tW);
check(`WHH given fuel + REFUEL HERE: min to lift EGKR 437, EGKD stays 565 (${gates(rW).join(", ")})`, eq(gates(rW).slice(0, 2), [437, 565]));
check("refuel stop: arrive with 243, uplift at least 322, leave with 565", rW.planned[1] === 243 && rW.uplift[1] === 322 && rW.fuel[1] === 565);
check("shipped data: William Harvey has NO fuel, so REFUEL there is ignored (759 stands)", S("EGKD").fuel === false && S("EGKD").fuel_planned === true && eq(gates(P.computeTrip(tW)), [759, 565, 365]));

// ── a fourth sector EGKR → EGKK ──
for (const [sc, want] of [["VMC", [790, 596, 396, 260]], ["A", [930, 736, 536, 400]], ["D", [901, 707, 507, 371]]]) {
  const r = P.computeTrip(withSector(trip(), "EGKK", sc));
  check(`4th sector EGKR→EGKK profile ${sc}: ${want.join(", ")} (${gates(r).join(", ")})`, eq(gates(r), want));
}
const rD = P.computeTrip(withSector(trip(), "EGKK", "D"));
check("D: alternates default to EGKB + EGKA, fuel to the FARTHER (Shoreham)", rD.sec[3].a1.id === "EGKB" && rD.sec[3].a2.id === "EGKA" && rD.sec[3].far.id === "EGKA");
check("D: one approach at the farther alternate only (2 in all)", rD.sec[3].rows.filter((x) => /approach/i.test(x.item)).length === 2);
const rB = P.computeTrip(withSector(trip(), "EGKK", "B"));
const rC = P.computeTrip(withSector(trip(), "EGKK", "C"));
check("B and C carry the same fuel", eq(gates(rB), gates(rC)) && rB.sec[3].a1.id === "EGKB");
const rA = P.computeTrip(withSector(trip(), "EGKK", "A"));
check("A: 2 approaches + 15 min (70) + reserve, no alternate", rA.sec[3].needAlts === 0 && rA.sec[3].rows.some((x) => x.item === "Additional" && x.kg === 70) && rA.sec[3].rows.some((x) => x.item === "IFR Approaches" && x.kg === 140));

// ── profiles by destination (OMA 8H 8.3.2.7.4 / 8.3.2.7.7) ──
for (const id of ["EGKD", "EGKC", "EGRS", "EGGB", "EGKR"]) {
  const p = P.profilesFor(S(id));
  check(`PinS destination ${id}: IFR profiles C and D only (+ VFR leg), default C`, eq(p.allowed, ["C", "D", "VFR"]) && p.default === "C");
}
check("Shoreham destination (RNP only): A not offered", !P.profilesFor(S("EGKA")).allowed.includes("A") && P.profilesFor(S("EGKA")).default === "B");
for (const id of ["EGKK", "EGKB", "EGMD", "EGMC", "EGHI", "EGLL", "EGLC", "EGSS"]) check(`${id} destination: all five IFR profiles + VFR, default B`, eq(P.profilesFor(S(id)).allowed, ["VMC", "A", "B", "C", "D", "VFR"]) && P.profilesFor(S(id)).default === "B");
const rPin = P.computeTrip(trip({ scen: ["B", "VMC", "A"] }));
check("a PinS sector asked for B / VMC / A falls back to C", rPin.sec.every((s) => s.sc === "C"));

// ── alternate validity (OMA 8.1.3.3.2; PinS 8.3.2.7.4) ──
const ids = (list) => list.map((s) => s.id);
check("PinS destination: alternate list excludes Shoreham (GNSS-only)", !ids(P.alternatesFor(S("EGKC"))).includes("EGKA"));
check("Gatwick destination (has ILS): alternate list includes Shoreham", ids(P.alternatesFor(S("EGKK"))).includes("EGKA"));
check("Shoreham destination: only alternates with a non-GNSS approach", P.alternatesFor(S("EGKA")).every((s) => P.nonGnss(s)));
check("Redhill is never an alternate (its only procedure is a PLANNED PinS)", f.DATA.sites.filter((s) => s.type === "airfield_ifr").every((d) => !ids(P.alternatesFor(d)).includes("EGKR")));
check("PinS sites are never alternates", f.DATA.sites.every((d) => P.alternatesFor(d).every((s) => s.type === "airfield_ifr")));
check("alternates sorted nearest first", (() => { const l = P.alternatesFor(S("EGKC")); return l.every((s, i) => i === 0 || f.haversineNm(S("EGKC"), l[i - 1]) <= f.haversineNm(S("EGKC"), s)); })());
const tChosen = trip(); tChosen.alt[0] = "EGKK";
const rChosen = P.computeTrip(tChosen);
check("a chosen alternate is used and marked 'chosen' (not nearest); it changes that sector's own requirement", rChosen.sec[0].a1.id === "EGKK" && !rChosen.sec[0].auto && rChosen.sec[0].own !== r0.sec[0].own);
check("…but the minimum to lift stays 759 there, because the onward chain governs that sector", rChosen.sec[0].useOnward && rChosen.sec[0].gate === 759);
const tBad = trip(); tBad.alt[0] = "EGKA"; // Shoreham is not valid for a PinS destination
check("an invalid stored alternate falls back to the nearest valid one", P.computeTrip(tBad).sec[0].a1.id === "EGMD");

// ── actual fuel below minimum ──
const tLow = trip(); tLow.actual[1] = "400";
const rLow = P.computeTrip(tLow);
check("actual 400 at EGKD (min 565): margin −165", rLow.margin[1] === -165);
check("later planned figures follow the entered value (EGKC 200, landing 64)", rLow.planned[2] === 200 && rLow.fuel[2] === 200 && rLow.landing === 64);

// ── refuel stop at an airfield with fuel breaks the chain ──
const tRf = { stops: ["EGKR", "EGKD", "EGKK", "EGKC", "EGKR"], actual: ["", "", "", "", ""], refuel: [false, false, true, false, false], scen: [null, null, null, null], alt: [null, null, null, null], alt2: [null, null, null, null] };
const rRf = P.computeTrip(tRf);
check("REFUEL HERE at Gatwick: sector into Gatwick uses its own requirement, not the onward chain", !rRf.sec[1].useOnward && rRf.refuelAt[2] && rRf.sec[1].gate === rRf.sec[1].own);
check("refuel flag ignored at the first and last stop", (() => { const t = trip(); t.refuel = [true, false, false, true]; const r = P.computeTrip(t); return !r.refuelAt[0] && !r.refuelAt[3] && eq(gates(r), [759, 565, 365]); })());

// ── a two-stop trip reproduces the single-leg planner (profile B) ──
const r2 = P.computeTrip({ stops: ["EGKR", "EGKA"], actual: ["500", ""], refuel: [false, false], scen: ["B"], alt: ["EGKK"], alt2: [null] });
check(`two-stop Redhill→Shoreham, altn Gatwick, B: ${r2.sec[0].gate} kg ≈ single-leg 416 (±2)`, near(r2.sec[0].gate, 416, 2));

// ── the rules really come from the dataset ──
const d20 = clone(f.DATA); d20.oma_rules.contingency_pct_ifr = 20;
check("contingency read from data (20% → bigger burns)", f.makePlanner(d20).computeTrip(trip()).sec[0].burn > 194);
const dG = clone(f.DATA); dG.oma_rules.gnss_approach_types = ["LPV", "PinS"]; // pretend RNP were ground-based
check("GNSS approach types read from data (Shoreham then valid for a PinS destination)", ids(f.makePlanner(dG).alternatesFor(S("EGKC"))).includes("EGKA"));
const dP = clone(f.DATA); dP.oma_rules.profiles_by_destination.pins = { allowed: ["B", "C", "D"], default: "B" };
check("profiles by destination read from data", f.makePlanner(dP).profilesFor(S("EGKC")).default === "B");
const dA = clone(f.DATA); dA.oma_rules.multi_sector.approach_per_arrival = 2;
check("approaches per arrival read from data", f.makePlanner(dA).computeTrip(trip()).sec[0].burn === 194 + 70);

// ── PLANNED / CONFIRM tags and approach lines ──
check("Redhill tagged PLANNED (its PinS is planned)", P.planStatus(S("EGKR")) === "planned");
check("William Harvey / King's / Royal Sussex / East Brighton Park tagged CONFIRM", ["EGKD", "EGKC", "EGRS", "EGGB"].every((id) => P.planStatus(S(id)) === "confirm"));
check("published airfields carry no tag", ["EGKK", "EGSS", "EGKA"].every((id) => P.planStatus(S(id)) === null));
check("approach line: Biggin Hill ILS 21 · RNP 21 · RNP 03 (RF, NEW 2026)", f.approachSummary("EGKB").join(" · ") === "ILS 21 · RNP 21 · RNP 03 (RF, NEW 2026)");
check("approach lines no longer show planned/confirm status (Redhill, William Harvey: 'PinS')", f.approachSummary("EGKR").join() === "PinS" && f.approachSummary("EGKD").join() === "PinS");
check("…while approach notes stay (Biggin Hill RNP 03 RF, NEW 2026)", f.approachSummary("EGKB").join(" · ").includes("(RF, NEW 2026)"));

// ── VFR leg (no alternate, no IFR approach, VFR day final reserve) ──
const tV = { stops: ["EGKR", "EGKB", "EGKR"], actual: ["", "", ""], refuel: [false, false, false], scen: ["B", "VFR"], alt: [null, null], alt2: [null, null] };
const rV = P.computeTrip(tV);
const v = rV.sec[1];
check("Biggin Hill IFR (B) then VFR to Redhill: minimums 366 / 153", eq(gates(rV), [366, 153]));
check("VFR leg = start & taxi 30 + trip + 10% contingency + VFR day reserve 100 (no approach)", v.vfr && v.own === 30 + v.trip + v.cont + 100 && v.burn === 30 + v.trip + v.cont);
check("VFR leg has no alternate", v.needAlts === 0 && !v.rows.some((x) => /Alternate|Approach/.test(x.item)));
check("VFR leg table: Start & Taxi · Trip · Contingency · Final Reserve (VFR day 100) summing to its minimum", eq(v.rows.map((x) => x.item), ["Start & Taxi", "Trip", "Contingency", "Final Reserve"]) && v.rows[3].req === "VFR day" && v.rows[3].kg === 100 && v.rows.reduce((a, x) => a + x.kg, 0) === v.gate);
check("same trip flown IFR (B) needs more: 475 / 352", eq(gates(P.computeTrip({ ...tV, scen: ["B", "B"] })), [475, 352]));
check("VFR is offered for every destination, PinS sites included", P.stopSites().every((s) => P.profilesFor(s).allowed.includes("VFR")));
check("a VFR sector into a PinS site is accepted (not forced back to C)", P.computeTrip({ ...f.freshTrip(), scen: ["VFR", null, null] }).sec[0].sc === "VFR");
const rV4 = P.computeTrip(withSector(trip(), "EGKK", "VFR"));
check("default trip + VFR leg to Gatwick: 759 / 565 / 365 / 140 (VFR = VMC 260 − 70 approach − 50 reserve)", eq(gates(rV4), [759, 565, 365, 140]));
const dV = clone(f.DATA); dV.aircraft.final_reserve_vfr_day_kg = 120;
check("VFR reserve read from the dataset (120 → +20)", f.makePlanner(dV).computeTrip(tV).sec[1].own === v.own + 20);
check("six profiles in order, VFR hint NO ALTN / NO APP", eq(f.SCENARIO_ORDER, ["VMC", "A", "B", "C", "D", "VFR"]) && f.SCENARIO_HINT.VFR.join(" ") === "NO ALTN NO APP");

// ── trip normalisation (stored trips) ──
check("garbage / unknown stops → default trip", eq(P.normalizeTrip(null).stops, f.DEFAULT_TRIP.stops) && eq(P.normalizeTrip({ stops: ["EGKR", "XXXX"] }).stops, f.DEFAULT_TRIP.stops));
check("short arrays are padded; non-digits stripped", (() => { const n = P.normalizeTrip({ stops: ["EGKR", "EGKK", "EGKC"], actual: ["8a20"] }); return n.actual.length === 3 && n.actual[0] === "820" && n.scen.length === 2 && n.refuel.length === 3; })());

// ── dataset integrity ──
const stops = ids(P.stopSites());
check("stops = every IFR airfield and PinS site (incl. Stansted, Redhill)", f.DATA.sites.filter((s) => s.type === "airfield_ifr" || s.type === "pins_site").every((s) => stops.includes(s.id)) && stops.includes("EGSS") && stops.includes("EGKR"));
check("other hospitals and VFR refuel points are not stops", f.DATA.sites.filter((s) => s.type === "hospital" || s.type === "refuel_vfr").every((s) => !stops.includes(s.id)));
check("every hospital and PinS site has a short map label (≤ 5 chars)", f.DATA.sites.filter((s) => s.type === "hospital" || s.type === "pins_site").every((s) => s.short && s.short.length <= 5));
check("PinS sites have no fuel; every airfield does", f.DATA.sites.filter((s) => s.type === "pins_site").every((s) => s.fuel === false) && f.DATA.sites.filter((s) => s.type === "airfield_ifr").every((s) => s.fuel === true));
check("all sites have numeric lat/lon", f.DATA.sites.every((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)));
check("profile hints: D now reads FARTHER (not CHAIN)", f.SCENARIO_HINT.D.join(" ") === "2 ALTN FARTHER" && /farther/i.test(f.SCENARIO_TEXT.D));

let fail = 0;
for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
