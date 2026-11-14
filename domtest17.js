// IFR FUEL wireframe map (Stage 2): geometry alignment, tap selector, declutter, UI.
const f = require("./build/fuelcalc.cjs");
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

// ── geometry: parse the generated path data back into rings ──
const ringsOf = (d) => d.split("M").filter(Boolean).map((seg) => {
  const n = seg.replace("Z", "").match(/-?\d+\.?\d*/g).map(Number);
  const r = []; for (let i = 0; i < n.length; i += 2) r.push([n[i], n[i + 1]]); return r;
});
const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const countyOf = (id) => {
  const s = f.siteById(id), p = f.project(s.lat, s.lon);
  return (f.MAP.counties.find((c) => ringsOf(c.d).some((r) => inRing(p, r))) || {}).n;
};

check("map geometry present (≥ 40 counties, ONS source recorded)", f.MAP.counties.length >= 40 && /ONS/.test(f.MAP.meta.source));
check("inline path data is small (< 80 KB)", JSON.stringify(f.MAP).length < 80000);
check("every site projects inside the viewBox", f.DATA.sites.every((s) => { const p = f.project(s.lat, s.lon); return p.x > 0 && p.x < f.MAP.meta.w && p.y > 0 && p.y < f.MAP.meta.h; }));
// Alignment: sites and boundaries use the identical projection, so each field must land in its real county.
// (Southend Airport is in Rochford District, Essex — just outside the Southend-on-Sea UA. Rochester
// is omitted: it sits within ~200 m of the Medway/Kent line, inside the map's simplification tolerance.)
const expect = { EGKR: "Surrey", EGKK: "West Sussex", EGKB: "Bromley", EGKA: "West Sussex", EGMD: "Kent",
  EGMC: "Essex", EGLL: "Hillingdon", EGLC: "Newham", EGHI: "Hampshire", EGMH: "Kent", EGSS: "Essex" };
for (const [id, county] of Object.entries(expect)) check(`alignment: ${id} plots inside ${county} (got ${countyOf(id)})`, countyOf(id) === county);
const hexpect = { H_RSCH: "Brighton and Hove", H_MAID: "Kent", H_STM: "Isle of Wight", H_FPH: "Surrey", H_SGEN: "Southampton", H_QA: "Portsmouth",
  H_EDGH: "East Sussex", H_CONQ: "East Sussex", H_MMH: "Medway", H_DVH: "Kent", H_BROOM: "Essex" };
for (const [id, county] of Object.entries(hexpect)) check(`hospital sanity: ${id} plots inside ${county} (got ${countyOf(id)})`, countyOf(id) === county);

// ── tap selector rules ──
const empty = { origin: "", dest: "", alt1: "", alt2: "" };
let r = f.tapSite(empty, "EGKR", 1);
check("tap 1: first airfield becomes origin", r.sel.origin === "EGKR");
r = f.tapSite(r.sel, "EGKA", 1);
check("tap 2: next becomes destination", r.sel.dest === "EGKA");
r = f.tapSite(r.sel, "EGKK", 1);
check("tap 3: next becomes alternate", r.sel.alt1 === "EGKK");
r = f.tapSite(r.sel, "EGLL", 1);
check("tap 4 with all roles set: no change + caption", r.sel.alt1 === "EGKK" && r.sel.dest === "EGKA" && /tap a selected field to clear/.test(r.note));
r = f.tapSite(r.sel, "EGKA", 1);
check("tapping a selected destination clears it", r.sel.dest === "" && r.sel.origin === "EGKR" && r.sel.alt1 === "EGKK");
check("scenario with no alternate (A/VMC): third tap does nothing", f.tapSite({ origin: "EGKR", dest: "EGKA", alt1: "", alt2: "" }, "EGKK", 0).sel.alt1 === "");
const d2 = f.tapSite({ origin: "EGKR", dest: "EGKA", alt1: "EGKK", alt2: "" }, "EGMD", 2);
check("scenario D: fourth tap fills alternate 2", d2.sel.alt2 === "EGMD");
const red = f.tapSite({ origin: "EGKK", dest: "", alt1: "", alt2: "" }, "EGKR", 1);
check("Redhill (no approaches) refused as destination, origin-only caption", red.sel.dest === "" && /origin only/.test(red.note));
check("Redhill tapped first is a valid origin", f.tapSite(empty, "EGKR", 1).sel.origin === "EGKR");
const hosp = f.tapSite(empty, "H_KCH", 1);
check("hospital: display-only caption, selection unchanged", JSON.stringify(hosp.sel) === JSON.stringify(empty) && /hospital \(display only\)/.test(hosp.note));
check("refuel point: display-only caption", /refuel point \(display only\)/.test(f.tapSite(empty, "EGMH", 1).note) && f.tapSite(empty, "EGMH", 1).sel.origin === "");

// ── label placement: every site (airfields, refuel points AND hospitals) is labelled ──
const all = f.DATA.sites.map((s) => ({ id: s.id, text: s.type === "hospital" ? s.short : s.icao, fs: s.type === "hospital" ? 5.3 : 6.5, must: true, ...f.project(s.lat, s.lon) }));
const lab = f.placeLabels(all);
check(`every one of the ${all.length} sites gets a label`, all.every((i) => lab[i.id]));
check(`all ${f.DATA.sites.filter((s) => s.type === "hospital").length} hospitals are labelled with their short name`, f.DATA.sites.filter((s) => s.type === "hospital").every((s) => lab[s.id]));
const boxes = all.map((i) => {
  const p = lab[i.id], w = i.text.length * i.fs * 0.62;
  const x = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
  return { id: i.id, x, y: p.y - i.fs * 0.8, w, h: i.fs };
});
const overlap = (a2, b2) => a2.x < b2.x + b2.w && b2.x < a2.x + a2.w && a2.y < b2.y + b2.h && b2.y < a2.y + a2.h;
let clash = 0; boxes.forEach((a2, i) => boxes.slice(i + 1).forEach((b2) => { if (overlap(a2, b2)) clash++; }));
check(`labels never overlap each other (${clash} clashes)`, clash === 0);
check("labels never cover another site's marker",
  boxes.every((b2) => !all.some((m) => m.id !== b2.id && m.x > b2.x - 2 && m.x < b2.x + b2.w + 2 && m.y > b2.y - 2 && m.y < b2.y + b2.h + 2)));
check("labels stay inside the map frame", boxes.every((b2) => b2.x >= 0 && b2.y >= 0 && b2.x + b2.w <= f.MAP.meta.w && b2.y + b2.h <= f.MAP.meta.h));
check("a lone non-must label with no room is dropped, a must label is kept",
  Object.keys(f.placeLabels([{ id: "a", x: 1, y: 1, text: "WIDELABEL", must: false }, { id: "b", x: 1, y: 1, text: "X", must: true }])).includes("b"));

// ── UI ──
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((rr) => setTimeout(rr, ms));
const emptyRows = () => Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }));
let net = 0;
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.localStorage.setItem("daily-flight-card", JSON.stringify({ date: "14.07.2026", acReg: "G-KSST", srp: "1", gwDep: "4600", varField: "4650", vertField: "", plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] }));
    w.fetch = () => { net++; return Promise.reject(new Error("network")); };
    w.XMLHttpRequest = function () { net++; throw new Error("network"); };
  } });
const w = dom.window, d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
const scen = (id) => d.querySelector(`button[data-scenario="${id}"]`);
const btn = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
const marker = (id) => d.querySelector(`g[data-site="${id}"]`);
const sel = (lab2) => [...d.querySelectorAll("label")].find((l) => l.querySelector("span > span")?.textContent === lab2)?.querySelector("select");
const text = () => d.getElementById("root").textContent;

(async () => {
  await sleep(2500);
  click(btn("IFR FUEL")); await sleep(200);
  const svg = d.querySelector('svg[role="img"]');
  check("map renders on the IFR FUEL tab", !!svg && svg.getAttribute("viewBox") === `0 0 ${f.MAP.meta.w} ${f.MAP.meta.h}`);
  check("county outlines drawn from bundled geometry", svg.querySelectorAll("path").length === f.MAP.counties.length);
  check(`all ${f.DATA.sites.length} dataset sites plotted as markers`, d.querySelectorAll("g[data-site]").length === f.DATA.sites.length);
  check("hospital short names are drawn on the map (all of them)", f.DATA.sites.filter((x) => x.type === "hospital").every((x) => d.querySelector(`text[data-label="${x.id}"]`)?.textContent === x.short));
  check("map legend shown", text().includes("ORIGIN") && text().includes("HOSPITAL") && text().includes("REFUEL"));

  click(marker("EGKR")); await sleep(80);
  click(marker("EGKA")); await sleep(80);
  click(marker("EGKK")); await sleep(80);
  check("map taps set the dropdowns: Redhill / Shoreham / Gatwick", sel("ORIGIN").value === "EGKR" && sel("DESTINATION").value === "EGKA" && sel("ALTERNATE").value === "EGKK");
  check("distances appear after map selection (23 NM, 19 NM)", text().includes("23 NM") && text().includes("19 NM"));
  check("fuel table computed from map selection (trip line present)", !!d.querySelector('[data-line="trip"]'));
  check("selected markers labelled as selected", marker("EGKR").getAttribute("aria-label").includes("selected") && marker("EGKA").getAttribute("aria-label").includes("selected"));
  const lines = svg.querySelectorAll("line");
  check("route lines drawn: origin→dest (solid) and dest→alternate (dashed)", lines.length === 2 && [...lines].some((l) => l.getAttribute("stroke-dasharray")));

  click(marker("H_KCH")); await sleep(80);
  check("tapping a hospital shows a caption and changes no selection", text().includes("hospital (display only)") && sel("ORIGIN").value === "EGKR");
  click(marker("EGKA")); await sleep(80);
  check("tapping the selected destination clears it (dropdown mirrors)", sel("DESTINATION").value === "");
  check("route line to cleared destination removed", svg.querySelectorAll("line").length === 0);
  sel("ORIGIN").value = "EGKB"; sel("ORIGIN").dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(80);
  check("dropdown change is reflected on the map", marker("EGKB").getAttribute("aria-label").includes("selected") && !marker("EGKR").getAttribute("aria-label").includes("selected"));

  click(scen("D")); await sleep(120);
  click(marker("EGKA")); await sleep(80);   // dest
  click(marker("EGMD")); await sleep(80);   // alt2? first unset alternate is alt1 (Gatwick already)
  check("scenario D: two alternates assignable from the map", sel("ALTERNATE 1").value === "EGKK" && sel("ALTERNATE 2").value === "EGMD");
  check("scenario D: both diversion legs drawn", svg.querySelectorAll("line").length === 3);
  const near = (a2, b2) => Math.abs(a2 - b2) < 0.01;
  const pk = f.project(f.siteById("EGKK").lat, f.siteById("EGKK").lon), pm = f.project(f.siteById("EGMD").lat, f.siteById("EGMD").lon);
  check("scenario D: second alternate leg runs FROM alternate 1 (Gatwick → Lydd), not from the destination",
    [...svg.querySelectorAll("line")].some((l) => near(+l.getAttribute("x1"), pk.x) && near(+l.getAttribute("y1"), pk.y) && near(+l.getAttribute("x2"), pm.x) && near(+l.getAttribute("y2"), pm.y)));
  click(scen("A")); await sleep(120);
  check("scenario A: alternate legs hidden from the map", svg.querySelectorAll("line").length === 1);

  check("map added no network calls", net === 0);
  click(btn("FLIGHTS")); await sleep(150);
  check("FLIGHTS tab unaffected", text().includes("FLT MIN"));

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
