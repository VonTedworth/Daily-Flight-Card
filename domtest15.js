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
const d = f.computeFuel({ ...base, scenario: "D", alts: ["EGKK", "EGMD"] });
const dFar = Math.round(f.haversineNm(f.siteById("EGKA"), f.siteById("EGMD")));
check("Scenario D: alternate = FARTHER of the two (Lydd, not Gatwick)", d.altnNm === dFar && dFar > Math.round(nm2) && line(d, "alternate").kg === f.legKg(dFar));
check("Scenario D: label names the farther field", /EGMD/.test(line(d, "alternate").label));
check("Scenario D: approaches default 3", line(d, "approaches").count === 3);
const dSwap = f.computeFuel({ ...base, scenario: "D", alts: ["EGMD", "EGKK"] });
check("Scenario D: alternate order does not matter", dSwap.required === d.required);

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

// ── Dataset integrity ──
const ifr = f.DATA.sites.filter((s) => s.type === "airfield_ifr");
const dests = f.destSites().map((s) => s.id);
const origins = f.originSites().map((s) => s.id);
check("every airfield_ifr with approaches is selectable as dest/alt", ifr.filter((s) => (s.approaches || []).length).every((s) => dests.includes(s.id)));
check("Redhill is origin-only (no approaches)", origins.includes("EGKR") && !dests.includes("EGKR"));
check("every airfield_ifr is selectable as origin", ifr.every((s) => origins.includes(s.id)));
check("refuel points and hospitals are display-only (not selectable)",
  f.DATA.sites.filter((s) => s.type !== "airfield_ifr").every((s) => !origins.includes(s.id) && !dests.includes(s.id)));
check("all sites have numeric lat/lon", f.DATA.sites.every((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)));
check("all five scenarios present with defaults", f.SCENARIO_ORDER.every((k) => f.defaultApproaches(k) >= 1) && f.defaultApproaches("D") === 3);

let fail = 0;
for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
