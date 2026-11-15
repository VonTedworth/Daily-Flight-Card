// IFR FUEL wireframe map: geometry alignment, label declutter, and the multi-sector route display.
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
// Alignment: sites and boundaries share one projection, so each site must land in its real county.
// (Southend Airport is in Rochford District, Essex. Rochester is omitted: within ~200 m of the Medway/Kent
// line, inside the map's simplification tolerance.)
const expect = { EGKR: "Surrey", EGKK: "West Sussex", EGKB: "Bromley", EGKA: "West Sussex", EGMD: "Kent", EGMC: "Essex",
  EGLL: "Hillingdon", EGLC: "Newham", EGHI: "Hampshire", EGMH: "Kent", EGSS: "Essex",
  EGRS: "Brighton and Hove", EGGB: "Brighton and Hove", EGKD: "Kent",
  H_MAID: "Kent", H_STM: "Isle of Wight", H_FPH: "Surrey", H_SGEN: "Southampton", H_QA: "Portsmouth",
  H_EDGH: "East Sussex", H_CONQ: "East Sussex", H_MMH: "Medway", H_DVH: "Kent", H_BROOM: "Essex" };
for (const [id, county] of Object.entries(expect)) check(`alignment: ${id} plots inside ${county} (got ${countyOf(id)})`, countyOf(id) === county);

// ── label placement: every site is labelled, nothing overlaps ──
const small = (s) => s.type === "hospital" || s.type === "pins_site";
const all = f.DATA.sites.map((s) => ({ id: s.id, text: small(s) ? s.short : s.icao, fs: small(s) ? 5.3 : 6.5, must: true, ...f.project(s.lat, s.lon) }));
const lab = f.placeLabels(all);
check(`every one of the ${all.length} sites gets a label`, all.every((i) => lab[i.id]));
const boxes = all.map((i) => {
  const p = lab[i.id], w = i.text.length * i.fs * 0.62;
  const x = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
  return { id: i.id, x, y: p.y - i.fs * 0.8, w, h: i.fs };
});
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let clash = 0; boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => { if (overlap(a, b)) clash++; }));
check(`labels never overlap each other (${clash} clashes)`, clash === 0);
check("labels never cover another site's marker",
  boxes.every((b) => !all.some((m) => m.id !== b.id && m.x > b.x - 2 && m.x < b.x + b.w + 2 && m.y > b.y - 2 && m.y < b.y + b.h + 2)));
check("labels stay inside the map frame", boxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= f.MAP.meta.w && b.y + b.h <= f.MAP.meta.h));
check("a lone non-must label with no room is dropped, a must label is kept",
  Object.keys(f.placeLabels([{ id: "a", x: 1, y: 1, text: "WIDELABEL", must: false }, { id: "b", x: 1, y: 1, text: "X", must: true }])).includes("b"));

// ── UI: the route on the map ──
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
const btn = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
const marker = (id) => d.querySelector(`g[data-site="${id}"]`);
const isSel = (id) => marker(id).getAttribute("aria-label").includes("selected");
const text = () => d.getElementById("root").textContent;
const svg = () => d.querySelector('svg[role="img"]');
const lines = (kind) => [...svg().querySelectorAll(`line[data-route="${kind}"]`)];
const near = (a, b) => Math.abs(a - b) < 0.01;
const joins = (l, a, b) => { const A = f.project(f.siteById(a).lat, f.siteById(a).lon), B = f.project(f.siteById(b).lat, f.siteById(b).lon);
  return near(+l.getAttribute("x1"), A.x) && near(+l.getAttribute("y1"), A.y) && near(+l.getAttribute("x2"), B.x) && near(+l.getAttribute("y2"), B.y); };

(async () => {
  await sleep(2500);
  click(btn("IFR FUEL")); await sleep(200);
  check("map renders on the IFR FUEL tab", !!svg() && svg().getAttribute("viewBox") === `0 0 ${f.MAP.meta.w} ${f.MAP.meta.h}`);
  check("county outlines drawn from bundled geometry", svg().querySelectorAll("path").length === f.MAP.counties.length);
  check(`all ${f.DATA.sites.length} dataset sites plotted as markers`, d.querySelectorAll("g[data-site]").length === f.DATA.sites.length);
  check("every hospital and PinS site carries its short label on the map", f.DATA.sites.filter(small).every((x) => d.querySelector(`text[data-label="${x.id}"]`)?.textContent === x.short));

  // default trip EGKR → EGKD → EGKC → EGKR, alternates EGMD, EGLC, EGKK
  check("route drawn through all stops: 3 solid sector lines", lines("sector").length === 3 && joins(lines("sector")[0], "EGKR", "EGKD") && joins(lines("sector")[1], "EGKD", "EGKC") && joins(lines("sector")[2], "EGKC", "EGKR"));
  check("each sector's alternate drawn dashed from its destination (EGKD→EGMD, EGKC→EGLC, EGKR→EGKK)",
    lines("alternate").length === 3 && joins(lines("alternate")[0], "EGKD", "EGMD") && joins(lines("alternate")[1], "EGKC", "EGLC") && joins(lines("alternate")[2], "EGKR", "EGKK"));
  check("stops and alternates highlighted; uninvolved fields not", ["EGKR", "EGKD", "EGKC", "EGMD", "EGLC", "EGKK"].every(isSel) && !isSel("EGSS") && !isSel("EGKA"));

  // a sector switched to VMC drops its alternate from the map (no stale highlight)
  click(d.querySelector("[data-add-sector]")); await sleep(80);
  click(d.querySelector('[data-sector-line="3"]')); await sleep(80);
  click(d.querySelector('[data-chip="3:D"]')); await sleep(80);
  check("profile D draws both alternates (Gatwick → Biggin Hill and → Shoreham)", lines("alternate").some((l) => joins(l, "EGKK", "EGKB")) && lines("alternate").some((l) => joins(l, "EGKK", "EGKA")) && isSel("EGKA"));
  click(d.querySelector('[data-chip="3:VMC"]')); await sleep(80);
  check("switching that sector to VMC removes its alternate lines and highlight", !lines("alternate").some((l) => joins(l, "EGKK", "EGKB") || joins(l, "EGKK", "EGKA")) && !isSel("EGKA"));
  check("…while other sectors' alternates stay (EGKK as alternate for the leg into Redhill)", lines("alternate").some((l) => joins(l, "EGKR", "EGKK")));

  // tapping is informational only
  const before = JSON.stringify(w.localStorage.getItem("ifr-fuel-trip"));
  click(marker("H_PEM")); await sleep(80);
  check("tapping a hospital shows what it is", text().includes("Tunbridge Wells (Pembury) — hospital (map only)"));
  click(marker("EGKD")); await sleep(80);
  check("tapping a PinS site shows its type and fuel (no status word)", text().includes("EGKD William Harvey, Ashford — PinS site · no fuel"));
  click(marker("EGKR")); await sleep(80);
  check("tapping Redhill shows its type and fuel", text().includes("EGKR Redhill — IFR airfield · fuel"));
  check("taps never change the trip", JSON.stringify(w.localStorage.getItem("ifr-fuel-trip")) === before);

  check("map makes no network calls", net === 0);
  click(btn("FLIGHTS")); await sleep(150);
  check("FLIGHTS tab unaffected", text().includes("FLT MIN"));

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
