// Departure-weight accuracy: (1) first sector of a carried-over card starts from the previous
// card's landed fuel, not planned; (2) a 0-minute ground run is never a "flight over 4600".
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const row = (o = {}) => ({ fltTime: "30", shtdwn: "1030", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "", ...o });
const blank = () => row({ fltTime: "", shtdwn: "" });
const card = (G, P, rows) => ({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: String(G), varField: "4800", vertField: "4800",
  plannedFuel: String(P), hoursAvail: "20:00", sunriseSet: "", rows: [...rows, ...Array.from({ length: Math.max(0, 7 - rows.length) }, blank)], misc: "", powerChecks: [] });

function load(c) {
  let shared = null;
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(c)); w.navigator.canShare = () => true; w.navigator.share = async (d) => { shared = d.files[0]; }; } });
  const w = dom.window, d = w.document;
  return {
    w, d, shared: () => shared,
    click: (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })),
    btn: (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.includes(t)),
    gws: () => [...d.getElementById("root").textContent.matchAll(/DEP GW (-?\d+)KG/g)].map((m) => +m[1]),
    stored: () => JSON.parse(w.localStorage.getItem("daily-flight-card")),
  };
}
// carry the card over (or start a plain new one) and open FLIGHTS
async function newCard(c, carry) {
  const a = load(c); await sleep(2200);
  a.click(a.btn("A/C DATA")); await sleep(200);
  a.click(a.btn("NEW CARD")); await sleep(150);
  if (carry) { a.click(a.btn("CARRY OVER A/C DATA")); await sleep(100); }
  a.click([...a.d.querySelectorAll("button")].find((b) => b.textContent.trim() === "CLEAR WITHOUT PDF")); await sleep(700);
  a.click([...a.d.querySelectorAll("button")].find((b) => b.textContent.trim() === "FLIGHTS")); await sleep(300);
  return a;
}
async function pdfNote(c) {
  const a = load(c); await sleep(2200);
  a.click(a.btn("A/C DATA")); await sleep(200); a.click(a.btn("NEW CARD")); await sleep(150); a.click(a.btn("EXPORT PDF & NEW CARD")); await sleep(1200);
  const bytes = await a.shared().text();
  const m = bytes.match(/NOTE ON SRP[^)]*?GW OVER 4600 KG: ([^)]*?)\)/) // the em dash is stored as a non-UTF8 byte in the PDF;
  return { note: m ? m[1] : null, hasNote: bytes.includes("NOTE ON SRP") };
}

(async () => {
  const res = [];
  const check = (n, ok) => res.push([n, !!ok]);

  // ── 1. carry-over: sector 1 departs with the previous card's landed fuel ──
  const seven = Array.from({ length: 7 }, (_, i) => row({ fuel: String(650 - 70 * (i + 1)) })); // lands 580 … 160, no refuel
  let a = await newCard(card(4600, 650, seven), true);
  check("carry-over: sector 1 = 4600 + (160 − 650) = 4110, not 4600", a.gws()[0] === 4110);
  check("carry-over: startFuel recorded on the new card (160)", a.stored().startFuel === "160");
  check("carry-over: GW DEP and PLANNED FUEL still copied", a.stored().gwDep === "4600" && a.stored().plannedFuel === "650");
  // later sectors on the new card are unaffected by startFuel
  const fuelIn = [...a.d.querySelectorAll("input")].find((i) => i.previousElementSibling?.textContent?.trim() === "FUEL KG");
  const set = Object.getOwnPropertyDescriptor(a.w.HTMLInputElement.prototype, "value").set;
  set.call(fuelIn, "100"); fuelIn.dispatchEvent(new a.w.Event("input", { bubbles: true })); await sleep(150);
  check("carry-over: sector 2 follows sector 1's landed fuel (4600 + 100 − 650 = 4050)", a.gws()[1] === 4050);

  // last sector refuelled → back to planned
  const refuelled = [...seven.slice(0, 6), row({ fuel: "160", refuel: true, upliftL: "620" })];
  a = await newCard(card(4600, 650, refuelled), true);
  check("carry-over after a refuelled last sector: planned fuel (4600), startFuel blank", a.gws()[0] === 4600 && a.stored().startFuel === "");

  // only three sectors flown, last landed 400
  a = await newCard(card(4600, 650, [row({ fuel: "560" }), row({ fuel: "480" }), row({ fuel: "400" })]), true);
  check("carry-over uses the last FLOWN sector (3rd, landed 400 → 4350)", a.gws()[0] === 4350 && a.stored().startFuel === "400");

  // a trailing notes-only row must not hide the real last landing
  a = await newCard(card(4600, 650, [row({ fuel: "560" }), row({ fuel: "300" }), row({ fltTime: "", shtdwn: "", notes: "CREW CHANGE" })]), true);
  check("trailing notes-only row ignored: last landing (300) still used → 4250", a.gws()[0] === 4250);

  // last flown sector has no fuel entered → can't know; fall back to planned
  a = await newCard(card(4600, 650, [row({ fuel: "560" }), row({ fuel: "" })]), true);
  check("last flown sector missing its FUEL KG: falls back to planned (4600)", a.gws()[0] === 4600 && a.stored().startFuel === "");

  // no flights at all
  a = await newCard(card(4600, 650, []), true);
  check("carry-over of an empty card: planned fuel (4600)", a.gws()[0] === 4600 && a.stored().startFuel === "");

  // a plain NEW CARD (no carry-over) never inherits it
  a = await newCard(card(4600, 650, seven), false);
  check("plain NEW CARD: no startFuel, blank GW DEP", a.stored().startFuel === "" && a.stored().gwDep === "");

  // old cards without the field still load and behave as before
  const legacy = card(4600, 650, [row({ fuel: "560" }), row({ fuel: "470" })]); // no startFuel property
  a = load(legacy); await sleep(2200);
  check("card saved before this change (no startFuel) loads and uses planned fuel", a.gws()[0] === 4600 && a.gws()[1] === 4510);

  // ── 2. ground runs are not flights for the SRP 4600 note ──
  let r = await pdfNote(card(4700, 650, [row({ fuel: "560" }), row({ fltTime: "0", fuel: "560", notes: "GROUND RUN" }), row({ fuel: "470" })]));
  check("PDF note lists the two real flights, not the ground run (FLT 1, FLT 3)", r.note === "FLT 1, FLT 3");
  r = await pdfNote(card(4650, 650, [row({ fltTime: "0", fuel: "650", notes: "GROUND RUN" })]));
  check("a lone ground run over 4600 produces no SRP note at all", r.hasNote === false);
  r = await pdfNote(card(4650, 650, [row({ fuel: "650" })]));
  check("a real flight at the same weight still produces the note (FLT 1)", r.note === "FLT 1");
  r = await pdfNote(card(4650, 650, [row({ fltTime: "", shtdwn: "", fuel: "650" })]));
  check("flight time not yet entered is NOT treated as a ground run (still FLT 1)", r.note === "FLT 1");
  a = load(card(4700, 650, [row({ fuel: "560" }), row({ fltTime: "0", fuel: "560", notes: "GROUND RUN" })])); await sleep(2200);
  check("on screen the ground-run row still shows its DEP GW (4610)", a.gws()[1] === 4610);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
