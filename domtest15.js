// IFR FUEL engine — unit tests against build/fuelcalc.cjs (built by `npm run build`).
const f = require("./build/fuelcalc.cjs");
const res = [];
const check = (n, ok) => res.push([n, !!ok]);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const line = (r, key) => r.lines.find((l) => l.key === key);
const base = { origin: "EGKR", dest: "EGKA", alts: ["EGKK"], scenario: "B", fob: 500 };

// ── Distances and leg fuel ──
const nm1 = f.haversineNm(f.siteById("EGKR"), f.siteById("EGKA"));
const nm2 = f.haversineNm(f.siteById("EGKA"), f.siteById("EGKK"));
check(`haversine Redhill→Shoreham ≈ 23 nm (${nm1.toFixed(1)})`, near(nm1, 23, 1));
check(`haversine Shoreham→Gatwick ≈ 19 nm (${nm2.toFixed(1)})`, near(nm2, 19, 1));
check("leg_kg 23 nm → 50 kg", near(f.legKg(23), 50, 1));
check("leg_kg 19 nm → 41 kg", near(f.legKg(19), 41, 1));
check("kg → L at 0.79", f.kgToL(79) === 100 && f.kgToL(150) === 190);

// ── Scenario B worked example ──
const b = f.computeFuel(base);
check(`Scenario B REQUIRED ≈ 415 (${b.required})`, near(b.required, 415, 2));
check(`Scenario B margin ≈ +85 at 500 kg (${b.margin})`, near(b.margin, 85, 2));
check("Scenario B has an Alternate line (41 kg)", line(b, "alternate") && line(b, "alternate").kg === 41);
check("Scenario B approaches default 2 (140 kg)", line(b, "approaches").count === 2 && line(b, "approaches").kg === 140);
check("Scenario B: no PinS line", !line(b, "pins"));
check("fixed lines: start&taxi 30, reserve 150, contingency 10% of trip",
  line(b, "startTaxi").kg === 30 && line(b, "finalReserve").kg === 150 && line(b, "contingency").kg === Math.round(0.1 * line(b, "trip").kg));
check("serials run 1..n in order", b.lines.every((l, i) => l.serial === i + 1));
check("REQUIRED is the sum of the lines", b.required === b.lines.reduce((s, l) => s + l.kg, 0));
check("verdict ENOUGH when margin ≥ 0", b.verdict === "ENOUGH");
const c = f.computeFuel({ ...base, scenario: "C" });
check("Scenario C fuel identical to B", c.required === b.required);

// ── Other scenarios ──
const a = f.computeFuel({ ...base, scenario: "A", alts: [] });
check("Scenario A: no Alternate line", !line(a, "alternate"));
check("Scenario A: PinS/2-app line = 70 kg", line(a, "pins") && line(a, "pins").kg === 70);
check("Scenario A: approaches default 2", line(a, "approaches").count === 2);
const v = f.computeFuel({ ...base, scenario: "VMC", alts: [] });
check("Scenario VMC: no Alternate line, no PinS line", !line(v, "alternate") && !line(v, "pins"));
check("Scenario VMC: approaches default 1 (70 kg)", line(v, "approaches").count === 1 && line(v, "approaches").kg === 70);
// Scenario D: alternates are planned IN SEQUENCE — dest → alt1, then alt1 → alt2.
// Ed's example: Redhill → Lydd, alternate 1 Biggin Hill, alternate 2 Gatwick.
const dEx = { origin: "EGKR", dest: "EGMD", alts: ["EGKB", "EGKK"], scenario: "D", fob: 600 };
const d = f.computeFuel(dEx);
const nm = (a, b2) => Math.round(f.haversineNm(f.siteById(a), f.siteById(b2)));
const l1 = nm("EGMD", "EGKB"), l2 = nm("EGKB", "EGKK");
check(`Scenario D: trip is Redhill→Lydd (${d.tripNm} nm)`, d.tripNm === nm("EGKR", "EGMD"));
check(`Scenario D: leg 1 = Lydd→Biggin Hill (${l1} nm), leg 2 = Biggin Hill→Gatwick (${l2} nm)`, d.altLegs[0] === l1 && d.altLegs[1] === l2);
check("Scenario D: alternate 2 is measured from alternate 1, NOT from the destination", d.altLegs[1] !== nm("EGMD", "EGKK") && d.altLegs[1] === l2);
check("Scenario D: Alternate line covers the whole chain (legs summed)", d.altnNm === l1 + l2 && line(d, "alternate").kg === f.legKg(l1 + l2));
check("Scenario D: Alternate line names the route and both legs", line(d, "alternate").sub === `EGMD → EGKB → EGKK · ${l1} + ${l2} NM`);
check("Scenario D: approaches default 3", line(d, "approaches").count === 3);
const dSwap = f.computeFuel({ ...dEx, alts: ["EGKK", "EGKB"] });
check("Scenario D: order matters — swapping the alternates re-plans the legs",
  dSwap.altLegs[0] === nm("EGMD", "EGKK") && dSwap.altLegs[1] === nm("EGKK", "EGKB") && dSwap.altLegs[0] !== d.altLegs[0]);
const dHalf = f.computeFuel({ ...dEx, alts: ["EGKB"] });
check("Scenario D: leg 1 is reported as soon as alternate 1 is chosen (plan still incomplete)", dHalf.altLegs.length === 1 && dHalf.altLegs[0] === l1 && dHalf.incomplete === "alternate" && dHalf.required === null);
check("B/C: single leg destination→alternate reported", f.computeFuel(base).altLegs.length === 1 && f.computeFuel(base).altLegs[0] === 19);

// ── Verdict, flags ──
const short = f.computeFuel({ ...base, fob: b.required - 10 });
check("SHORT when FOB < REQUIRED, margin negative", short.verdict === "SHORT" && short.margin === -10);
const zero = f.computeFuel({ ...base, fob: b.required });
check("margin exactly 0 is ENOUGH", zero.verdict === "ENOUGH" && zero.margin === 0);
check("engine-failure note when 0 ≤ margin < 75", zero.flags.some((x) => /engine-failure 15-min hold \(75 kg\)/.test(x)));
const m74 = f.computeFuel({ ...base, fob: b.required + 74 });
const m75 = f.computeFuel({ ...base, fob: b.required + 75 });
check("engine-failure note at margin 74, not at 75", m74.flags.length === 1 && m75.flags.length === 0);
check("no engine-failure note when SHORT (shortfall is the message)", short.flags.length === 0);
check("no FOB → no verdict, no margin", f.computeFuel({ ...base, fob: null }).verdict === null && f.computeFuel({ ...base, fob: null }).margin === null);
check("usable-fuel flag when REQUIRED > 904", f.computeFuel({ ...base, discretionary: 900 }).flags.some((x) => /usable fuel \(904 kg\)/.test(x)));

// ── Editable inputs ──
check("approach stepper: +1 approach adds 70 kg", f.computeFuel({ ...base, approaches: 3 }).required === b.required + 70);
check("0 approaches allowed", f.computeFuel({ ...base, approaches: 0 }).required === b.required - 140);
check("start & taxi editable", f.computeFuel({ ...base, startTaxi: 50 }).required === b.required + 20);
check("discretionary editable", f.computeFuel({ ...base, discretionary: 40 }).required === b.required + 40);

// ── Calm incomplete states (never throw) ──
const none = f.computeFuel({ scenario: "B", alts: [] });
check("no route → incomplete 'route', no REQUIRED", none.incomplete === "route" && none.required === null);
check("origin only → incomplete 'route'", f.computeFuel({ ...base, dest: "" }).incomplete === "route");
const noAlt = f.computeFuel({ ...base, alts: [] });
check("B with no alternate → incomplete 'alternate', lines shown, no REQUIRED", noAlt.incomplete === "alternate" && noAlt.lines.length > 0 && noAlt.required === null);
check("D with one alternate → still incomplete", f.computeFuel({ ...base, scenario: "D", alts: ["EGKK"] }).incomplete === "alternate");
check("origin = destination → incomplete 'same'", f.computeFuel({ ...base, dest: "EGKR" }).incomplete === "same");
check("unknown scenario → incomplete, no throw", f.computeFuel({ ...base, scenario: "Z" }).incomplete === "scenario");

// ── Scenario hints (printed inside the buttons) ──
check("every scenario has a two-line hint", f.SCENARIO_ORDER.every((k) => Array.isArray(f.SCENARIO_HINT[k]) && f.SCENARIO_HINT[k].length === 2));
check("hints state the plan type (alternates / approaches)", /NO ALTN/.test(f.SCENARIO_HINT.A[0]) && /2 APPS/.test(f.SCENARIO_HINT.A[1]) && /1 ALTN/.test(f.SCENARIO_HINT.B[0]) && /2 ALTN/.test(f.SCENARIO_HINT.D[0]));
check("D descriptor describes the sequence", /alternate 1 → alternate 2/.test(f.SCENARIO_TEXT.D));

// ── Approaches: info line text + where the 70 kg per approach is allocated ──
const ap = (id) => f.approachSummary(id).join(" · ");
check("approach list: Biggin Hill ILS 21 · RNP 21 · RNP 03 (RF, new 2026)", ap("EGKB") === "ILS 21 · RNP 21 · RNP 03 (RF, NEW 2026)");
check("approach list: Shoreham is RNP only (no ILS, no NDB)", ap("EGKA") === "RNP 02/20");
check("approach list: Lydd ILS · RNP · NDB", ap("EGMD") === "ILS 21 · RNP 21 · NDB 03");
check("approach list: Heathrow runways 'all' reads ALL RWYS", ap("EGLL") === "ILS ALL RWYS · RNP ALL RWYS");
check("approach list: London City carries its steep-approach note", /ILS 09\/27 \(5\.5° STEEP — AW169 APPROVED\)/.test(ap("EGLC")));
check("approach list: Redhill / hospitals / unknown ids list nothing", ap("EGKR") === "" && ap("H_KCH") === "" && ap("NOPE") === "");
check("approach list length matches the dataset for every selectable field", f.destSites().every((x) => f.approachSummary(x.id).length === x.approaches.length));
const appD = line(f.computeFuel(dEx), "approaches");
check("D: 3 approaches = one 70 kg allowance at EACH airfield (210 kg)", appD.kg === 210 && appD.sub === "EGMD 1 · EGKB 1 · EGKK 1");
check("A: two approaches at the destination", line(f.computeFuel({ ...base, scenario: "A", alts: [] }), "approaches").sub === "EGKA 2");
check("VMC: one approach at the destination", line(f.computeFuel({ ...base, scenario: "VMC", alts: [] }), "approaches").sub === "EGKA 1");
check("B before an alternate is chosen: destination + placeholder", line(f.computeFuel({ ...base, alts: [] }), "approaches").sub === "EGKA 1 · ALTN 1");
check("B with alternate chosen: names both fields (2 × 70 = 140)", line(b, "approaches").sub === "EGKA 1 · EGKK 1" && line(b, "approaches").kg === 140);
check("stepper change is flagged as adjusted from the default", line(f.computeFuel({ ...dEx, approaches: 4 }), "approaches").sub === "ADJUSTED · DEFAULT 3");

// ── Dataset integrity ──
const ifr = f.DATA.sites.filter((s) => s.type === "airfield_ifr");
const dests = f.destSites().map((s) => s.id);
const origins = f.originSites().map((s) => s.id);
check("every airfield_ifr with approaches is selectable as dest/alt", ifr.filter((s) => (s.approaches || []).length).every((s) => dests.includes(s.id)));
check("Redhill is origin-only (no approaches)", origins.includes("EGKR") && !dests.includes("EGKR"));
check("every airfield_ifr is selectable as origin", ifr.every((s) => origins.includes(s.id)));
check("refuel points and hospitals are display-only (not selectable)",
  f.DATA.sites.filter((s) => s.type !== "airfield_ifr").every((s) => !origins.includes(s.id) && !dests.includes(s.id)));
check("every hospital has a short label (≤ 5 chars) for the map", f.DATA.sites.filter((x) => x.type === "hospital").every((x) => x.short && x.short.length <= 5));
const ss = f.siteById("EGSS");
check("Stansted (EGSS) present as an IFR airfield at the published ARP 51.8850 N 0.2350 E", ss && ss.type === "airfield_ifr" && ss.lat === 51.885 && ss.lon === 0.235);
check("Stansted selectable as ORIGIN", f.originSites().some((x) => x.id === "EGSS"));
check("Stansted selectable as DESTINATION and ALTERNATE (has approaches)", f.destSites().some((x) => x.id === "EGSS"));
check("Stansted approaches listed: ILS 04 · ILS 22 · RNP 04/22", f.approachSummary("EGSS").join(" · ") === "ILS 04 · ILS 22 · RNP 04/22");
check("Stansted plans like any field (e.g. Redhill → Stansted, altn Southend, B)", (() => { const r = f.computeFuel({ origin: "EGKR", dest: "EGSS", alts: ["EGMC"], scenario: "B", fob: 600 }); return r.incomplete === null && r.tripNm > 40 && r.required > 0; })());
check("all sites have numeric lat/lon", f.DATA.sites.every((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)));
check("all five scenarios present with defaults", f.SCENARIO_ORDER.every((k) => f.defaultApproaches(k) >= 1) && f.defaultApproaches("D") === 3);

let fail = 0;
for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
