// FLIGHTS — HEMS patient on the NEXT flight, and refuel confirmation (optional hand-entered figure).
// Worked example: GW DEP 4400, planned 650, VAR TOW 4700, VERT TOW 4550, density 0.79.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (o = {}) => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "", ...o });
const card = (rows, extra = {}) => ({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4700", vertField: "4550", plannedFuel: "650",
  hoursAvail: "9:00", sunriseSet: "", rows: [...rows, ...Array.from({ length: 7 - rows.length }, () => mk())], misc: "", powerChecks: [], ...extra });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

function open(c) {
  const errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(c));
      w.navigator.canShare = () => true;
      let shared = null;
      w.navigator.share = async (d) => { shared = d.files[0]; };
      w.__shared = () => shared;
    } });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s), qa = (s) => [...d.querySelectorAll(s)];
  const tx = (s) => (q(s) ? q(s).textContent : "");
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const btn = (t) => qa("button").find((b) => b.textContent.trim() === t);
  const btnIncl = (t) => qa("button").find((b) => b.textContent.includes(t));
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  const type = async (el, v) => { setter.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(60); };
  const gw = (i) => tx(`[data-depgw="${i}"]`);
  const saved = () => JSON.parse(w.localStorage.getItem("daily-flight-card"));
  const flightInputs = (i) => { const n = qa("input").filter((x) => x.getAttribute("inputmode") === "numeric"); return n; };
  return { w, d, q, qa, tx, click, btn, btnIncl, type, gw, saved, errors, flightInputs };
}
const box = (X, kind, i) => X.q(`[data-${kind}-box="${i}"] button`);
const fuelInput = (X, i) => X.q(`[data-depgw="${i}"]`) && null; // (not used)

(async () => {
  // ════════════ Part A — patient on the next flight ════════════
  const A = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" })]));
  await sleep(2500);
  check("flight 1: DEP GW 4400KG · VAR +300 · VERT +150", A.gw(0) === "DEP GW 4400KG · VAR +300 · VERT +150");
  check("no PATIENT KG input on the HEMS row any more", !A.d.getElementById("root").textContent.includes("PATIENT KG"));
  A.click(box(A, "hems", 0)); await sleep(150);
  await sleep(700);   check("HEMS on flight 1 flags flight 2 (patient line, ticked) — not flight 1", !!A.q('[data-patient-line="1"]') && box(A, "patient", 1).getAttribute("aria-pressed") === "true" && !A.q('[data-patient-line="0"]') && A.saved().rows[1].patient === true && !A.saved().rows[0].patient);
  check("flight 1 stays 4400 (no patient on board on the way to the scene)", A.gw(0).startsWith("DEP GW 4400KG ·"));
  check("patient line has no hint text", A.tx('[data-patient-line="1"]').replace(/[✓\s]/g, "") === "PATIENTONBOARDKG");
  // flight 2 data
  const row2 = () => A.qa("input").filter((x) => x.getAttribute("inputmode") === "numeric");
  await A.type(A.q('[data-patient-kg="1"]'), "85");
  // flight 2's FLT MIN / FUEL KG: the numeric inputs after row 1's three (flt, shtdwn, fuel)
  const r2 = row2();
  check(`flight 2 with patient 85: "${A.gw(1)}"`, A.gw(1) === "DEP GW 4395KG (PT 85) · VAR +305 · VERT +155");
  check("(PT 85) in the white text colour", /232, 238, 242|#e8eef2/i.test(A.q('[data-pt="1"]').style.color));
  A.click(box(A, "patient", 1)); await sleep(100);
  check("untick PATIENT ON BOARD → 4310, KG box hidden", A.gw(1).startsWith("DEP GW 4310KG ·") && !A.q('[data-patient-kg="1"]'));
  A.click(box(A, "patient", 1)); await sleep(100);
  check("tick again → 4395 (weight kept)", A.gw(1).startsWith("DEP GW 4395KG (PT 85)"));
  // flight 2 lands 480 → flight 3
  const fuelOf = (i) => A.qa("input").filter((x) => x.getAttribute("inputmode") === "numeric" && x.closest("label") && x.closest("label").textContent.includes("FUEL KG"))[i];
  await A.type(fuelOf(1), "480");
  check(`flight 3 after flight 2 lands 480: "${A.gw(2)}", no patient`, A.gw(2) === "DEP GW 4230KG · VAR +470 · VERT +320" && !A.q('[data-patient-line="2"]'));
  // unticking HEMS keeps the next row's patient when a weight is entered
  A.click(box(A, "hems", 0)); await sleep(100);
  await sleep(700);   check("untick HEMS on flight 1 with 85 kg entered on flight 2: flight 2 keeps its patient", A.saved().rows[1].patient === true && !!A.q('[data-patient-line="1"]') && A.gw(1).includes("(PT 85)"));
  // …and clears it when the weight is empty
  A.click(box(A, "hems", 1)); await sleep(100);
  await sleep(700);   check("HEMS on flight 2 flags flight 3", A.saved().rows[2].patient === true && !!A.q('[data-patient-line="2"]'));
  A.click(box(A, "hems", 1)); await sleep(100);
  await sleep(700);   check("untick HEMS on flight 2 (flight 3 weight empty): flight 3's flag cleared", A.saved().rows[2].patient === false && !A.q('[data-patient-line="2"]'));
  check("no script errors (part A)", A.errors.length === 0);

  // patient alone never makes a row "used"
  const V = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" }), mk(), mk(), mk({ patient: true, patientKg: "80" })]));
  await sleep(2500);
  const fltMinCount = (X) => (X.d.getElementById("root").textContent.match(/FLT MIN/g) || []).length;
  check("a row holding only a patient flag/weight stays hidden (2 rows shown: flight 1 + the working row)", fltMinCount(V) === 2);

  // HEMS on the last sector → next-card line; carry-over flags new flight 1
  const full = Array.from({ length: 7 }, (_, k) => mk({ fltTime: "20", shtdwn: "1000", fuel: String(600 - k * 10) }));
  const H = open(card(full));
  await sleep(2500);
  H.click(box(H, "hems", 6)); await sleep(150);
  check("HEMS on sector 7: 'PATIENT GOES ON FLIGHT 1 OF THE NEXT CARD'", H.tx("[data-patient-next-card]") === "PATIENT GOES ON FLIGHT 1 OF THE NEXT CARD");
  H.click(H.btn("A/C DATA")); await sleep(300);
  H.click(H.btnIncl("NEW CARD")); await sleep(200);
  H.click(H.btnIncl("CARRY OVER A/C DATA")); await sleep(100);
  H.click(H.btn("CLEAR WITHOUT PDF")); await sleep(1200);
  await sleep(700);   check("carry-over: new card's flight 1 carries the patient (patient = true)", H.saved().rows[0].patient === true);

  // ════════════ Part B — refuel confirmation ════════════
  const B = open(card([
    mk({ fltTime: "20", shtdwn: "1000", fuel: "560", hems: true, hemsGrid: "N/A" }),
    mk({ fltTime: "25", shtdwn: "1100", fuel: "480", patient: true, patientKg: "85" }),
    mk({ fltTime: "30", shtdwn: "1200", fuel: "536" }),
  ]));
  await sleep(2500);
  const P = () => B.q('[data-refuel-panel="2"]');
  check("before refuel: flight 4 = 4400 + (536 − 650) = 4286", B.gw(3).startsWith("DEP GW 4286KG"));
  B.click(box(B, "refuel", 2)); await sleep(120);
  check(`tick REFUEL: box ticked, panel "${P() && P().textContent}"`, box(B, "refuel", 2).getAttribute("aria-pressed") === "true" && P() &&
    P().textContent.includes("Refuel to planned fuel, 650 kg?") && P().textContent.includes("Uplift 114 kg = 144 L at 0.79") && B.tx('[data-refuel-confirm="2"]').trim() === "CONFIRM 650 KG" && !!B.q('[data-refuel-other="2"]'));
  await sleep(700);   check("nothing saved until CONFIRM", B.saved().rows[2].refuel === false && B.gw(3).startsWith("DEP GW 4286KG"));
  B.click(B.q('[data-refuel-other="2"]')); await sleep(100);
  await B.type(B.q('[data-refuel-to="2"]'), "950");
  check("950 → CONFIRM disabled, ABOVE USABLE FUEL 904 KG", B.q('[data-refuel-confirm="2"]').disabled && B.tx('[data-refuel-problem="2"]') === "ABOVE USABLE FUEL 904 KG");
  await B.type(B.q('[data-refuel-to="2"]'), "500");
  check("500 → CONFIRM disabled, BELOW FUEL ALREADY ON BOARD", B.q('[data-refuel-confirm="2"]').disabled && B.tx('[data-refuel-problem="2"]') === "BELOW FUEL ALREADY ON BOARD");
  B.click(B.q('[data-refuel-cancel="2"]')); await sleep(120);
  check("CANCEL: REFUEL unticked, fields clear, panel gone", !P() && box(B, "refuel", 2).getAttribute("aria-pressed") === "false" &&
    (() => { const r = B.saved().rows[2]; return r.refuel === false && !r.refuelTo && !r.refuelNote && !r.upliftL; })());
  B.click(box(B, "refuel", 2)); await sleep(120);
  B.click(B.q('[data-refuel-confirm="2"]')); await sleep(150);
  await sleep(700);   check("CONFIRM 650 → refuelTo 650, 144 L, flight 4 DEP GW 4400", (() => { const r = B.saved().rows[2]; return r.refuel && r.refuelTo === "650" && r.upliftL === "144" && r.refuelNote === ""; })() && B.gw(3).startsWith("DEP GW 4400KG ·"));
  check("confirmed line: 'REFUELLED TO 650 KG · ↑ 144 L', no NOT PLANNED FUEL", B.tx('[data-refuel-done="2"]') === "REFUELLED TO 650 KG · ↑ 144 L");
  B.click(B.q('[data-refuel-done="2"]')); await sleep(120);
  check("tapping the line reopens the panel", !!P());
  B.click(B.q('[data-refuel-other="2"]')); await sleep(100);
  await B.type(B.q('[data-refuel-to="2"]'), "700");
  const note = B.q('[data-refuel-note="2"]'); B.w.HTMLInputElement.prototype && (await B.type(note, "long transit to Southampton"));
  check("OTHER FIGURE 700: litres update to ↑ 208 L, CONFIRM 700 KG", B.tx('[data-refuel-litres="2"]') === "↑ 208 L" && B.tx('[data-refuel-confirm="2"]').trim() === "CONFIRM 700 KG" && !B.q('[data-refuel-confirm="2"]').disabled);
  B.click(B.q('[data-refuel-confirm="2"]')); await sleep(150);
  check(`flight 4 after refuel to 700: "${B.gw(3)}"`, B.gw(3) === "DEP GW 4450KG · VAR +250 · VERT +100");
  check("row shows REFUELLED TO 700 KG · ↑ 208 L · NOT PLANNED FUEL (amber) and the note",
    B.tx('[data-refuel-done="2"]').startsWith("REFUELLED TO 700 KG · ↑ 208 L · NOT PLANNED FUEL") && B.tx('[data-refuel-done="2"]').includes("long transit to Southampton") &&
    [...B.q('[data-refuel-done="2"]').querySelectorAll("span")].some((s) => s.textContent.includes("NOT PLANNED FUEL") && /255, 179, 71|#ffb347/i.test(s.style.color)));
  await sleep(700);   check("saved: refuelTo 700, upliftL 208, note kept", (() => { const r = B.saved().rows[2]; return r.refuelTo === "700" && r.upliftL === "208" && r.refuelNote === "long transit to Southampton"; })());
  check("flight 2 still 4395 (PT 85)", B.gw(1).startsWith("DEP GW 4395KG (PT 85)"));
  // PDF
  await B.type(B.qa("input").filter((x) => x.closest("label") && x.closest("label").textContent.includes("FLT MIN"))[3], "20");
  B.click(B.btn("A/C DATA")); await sleep(300);
  B.click(B.btnIncl("NEW CARD")); await sleep(200);
  B.click(B.btnIncl("CARRY OVER A/C DATA")); await sleep(100);
  B.click(B.btnIncl("EXPORT PDF & NEW CARD")); await sleep(1800);
  const pdf = B.w.__shared() ? await B.w.__shared().text() : "";
  check("PDF: PT 85, 4395, REFUEL TO 700 KG 208 L (+ note), 4450; HEMS row without PT",
    pdf.includes("PT 85 KG") && pdf.includes("DEP GW 4395KG \\(PT 85\\)") && pdf.includes("REFUEL TO 700 KG 208 L - LONG TRANSIT TO SOUTHAMPTON") && pdf.includes("DEP GW 4450KG") && !/HEMS[^)]*PT 85/.test(pdf.split("DEP GW 4400KG")[1] ? pdf.split("\n").find((l) => l.includes("HEMS")) || "" : ""));
  check("no script errors (part B)", B.errors.length === 0);

  // old saved row: refuel true, no refuelTo → planned
  const O = open(card([mk({ fltTime: "30", shtdwn: "1200", fuel: "536", refuel: true, upliftL: "144" })]));
  await sleep(2500);
  check("old saved row (refuel, no refuelTo) → treated as planned: flight 2 DEP GW 4400", O.gw(1).startsWith("DEP GW 4400KG ·"));
  check("…and still shows its old ↑ 144 L, no confirmed line", O.d.getElementById("root").textContent.includes("↑ 144 L") && !O.q('[data-refuel-done="0"]'));

  // carry-over after a 700 kg refuel on the last flight
  const R = open(card([mk({ fltTime: "30", shtdwn: "1200", fuel: "536", refuel: true, refuelTo: "700", upliftL: "208" })]));
  await sleep(2500);
  R.click(R.btn("A/C DATA")); await sleep(300);
  R.click(R.btnIncl("NEW CARD")); await sleep(200);
  R.click(R.btnIncl("CARRY OVER A/C DATA")); await sleep(100);
  R.click(R.btn("CLEAR WITHOUT PDF")); await sleep(1200);
  check("carry-over after a 700 kg refuel on the last flight: new card startFuel 700, flight 1 DEP GW 4450", R.saved().startFuel === "700");
  R.click(R.btn("FLIGHTS")); await sleep(200);
  check("…and the new card's flight 1 departs at 4400 + (700 − 650) = 4450", R.gw(0).startsWith("DEP GW 4450KG"));

  // carry-over after a planned refuel leaves startFuel empty
  const Q = open(card([mk({ fltTime: "30", shtdwn: "1200", fuel: "536", refuel: true, refuelTo: "650", upliftL: "144" })]));
  await sleep(2500);
  Q.click(Q.btn("A/C DATA")); await sleep(300);
  Q.click(Q.btnIncl("NEW CARD")); await sleep(200);
  Q.click(Q.btnIncl("CARRY OVER A/C DATA")); await sleep(100);
  Q.click(Q.btn("CLEAR WITHOUT PDF")); await sleep(1200);
  await sleep(700);   check("carry-over after a refuel to planned: startFuel stays empty", Q.saved().startFuel === "");

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
