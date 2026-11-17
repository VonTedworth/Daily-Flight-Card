// IFR FUEL — EXPORT PLAN (PDF), and the README link on the UPLIFT tab.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARD = JSON.stringify({ date: "14.07.2026", acReg: "G-KSST", srp: "1", gwDep: "4600", varField: "4650", vertField: "", plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "",
  rows: Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })), misc: "", powerChecks: [] });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

async function exportWith(trip, opts = {}) {
  let shared = null, net = 0;
  const errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", CARD);
      w.localStorage.setItem("ifr-fuel-trip", JSON.stringify(trip));
      w.navigator.canShare = () => true;
      w.navigator.share = opts.cancel ? async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); } : async (d) => { shared = d.files[0]; };
      w.fetch = () => { net++; return Promise.reject(new Error("network")); };
      w.XMLHttpRequest = function () { net++; throw new Error("network"); };
    } });
  const w = dom.window, d = w.document;
  await sleep(2500);
  [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "IFR FUEL").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(200);
  const tripBefore = w.localStorage.getItem("ifr-fuel-trip");
  d.querySelector("[data-export-pdf]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(1500);
  return { w, d, file: shared, bytes: shared ? await shared.text() : "", net, errors, tripBefore, tripAfter: w.localStorage.getItem("ifr-fuel-trip"), card: w.localStorage.getItem("daily-flight-card") };
}
const def = (patch = {}) => Object.assign({ stops: ["EGKR", "EGKD", "EGKC", "EGKR"], actual: ["820", "", "", ""], refuel: [false, false, false, false], scen: [null, null, null], alt: [null, null, null], alt2: [null, null, null] }, patch);

(async () => {
  // ── default trip, 820 kg ──
  const A = await exportWith(def());
  const order = [...A.d.querySelectorAll("[data-add-sector], [data-export-pdf], [data-reset]")].map((e) => Object.keys(e.dataset)[0]);
  check("EXPORT PLAN (PDF) sits between + ADD SECTOR and RESET TRIP", order.join() === "addSector,exportPdf,reset" && A.d.querySelector("[data-export-pdf]").textContent.trim() === "EXPORT PLAN (PDF)");
  check("export produces a PDF through the share sheet", !!A.file && A.file.type === "application/pdf" && A.bytes.startsWith("%PDF"));
  check(`file named 'IFR FUEL <route> <date> <time>.pdf' (${A.file && A.file.name})`, A.file && /^IFR FUEL EGKR-EGKD-EGKC-EGKR \d{2}\.\d{2}\.\d{4} \d{4}\.pdf$/.test(A.file.name));
  const b = A.bytes;
  check("PDF header: IFR FUEL PLAN, AW169 (OMB34)", b.includes("IFR FUEL PLAN") && b.includes("AW169") && b.includes("OMB34"));
  check("PDF carries the disclaimer", b.includes("Planning cross-check only") && b.includes("Verify against the OFP and current") && b.includes("plates."));
  check("PDF records the app version and the figures used (for error checking)", /App v\d+/.test(b) && b.includes("130 kt") && b.includes("280 kg/hr") && b.includes("contingency 10%") && b.includes("density 0.79"));
  check("PDF route: EGKR > EGKD > EGKC > EGKR", b.includes("ROUTE  EGKR > EGKD > EGKC > EGKR"));
  check("PDF headline: REQUIRED TO LIFT EGKR 759 KG, fuel 820, ENOUGH +61 KG", b.includes("REQUIRED TO LIFT EGKR: 759 KG") && b.includes("FUEL AT EGKR: 820 KG") && b.includes("ENOUGH +61 KG"));
  check("PDF stops: minimums 759 / 565 / 365, no PLANNED/CONFIRM tags", b.includes("EGKR Redhill") && b.includes("EGKD William Harvey, Ashford") && !b.includes("[PLANNED]") && !b.includes("[CONFIRM]") && /\(565\) Tj/.test(b) && /\(365\) Tj/.test(b) && /\(759\) Tj/.test(b));
  check("PDF stops: 820 actual, planned figures, 290 planned on landing", b.includes("820 actual") && b.includes("626 planned") && b.includes("290 planned on landing"));
  check("PDF sectors: profile, alternate (nearest), burn", b.includes("SECTOR 1  EGKR > EGKD") && b.includes("PROFILE C") && b.includes("ALTN EGMD") && b.includes("nearest") && b.includes("BURN 194 KG") && b.includes("BURN 200 KG") && b.includes("BURN 136 KG"));
  check("PDF sector tables: requirement lines down to Onward / min to lift", b.includes("Start & Taxi") && b.includes("Contingency") && b.includes("This leg \\(OMA\\)") && b.includes("Onward legs") && b.includes("min to lift EGKD 565") && b.includes("Final Reserve") && b.includes("Discretionary") && b.includes("commander's discretion") && b.includes("(+61) Tj"));
  check("PDF lists approaches at destination and alternate", b.includes("Approaches") && b.includes("ILS 21") && b.includes("NDB 03"));
  check("PDF lists the open items", b.includes("OPEN ITEMS") && b.includes("East Brighton Park") && b.includes("Contingency \\(confirmed\\)") && b.includes("treated as burnt on that sector") && !b.includes("planned as used"));
  check("contingency row says it is burnt on that leg", b.includes("burnt this leg"));
  check("PDF page footer with version and page count", /GENERATED BY DAILY FLIGHT CARD APP v\d+/.test(b) && b.includes("PAGE 1 OF"));
  check("no characters Courier can't print (arrows) leak into the PDF", !b.includes("→") && !b.includes("≥"));
  check("export does not change the trip or the flight card", A.tripAfter === A.tripBefore && A.card === CARD);
  check("export makes no network calls, no script errors", A.net === 0 && A.errors.length === 0);

  // ── below minimum + refuel stop + 2 alternates ──
  const B = await exportWith(def({ stops: ["EGKR", "EGKD", "EGKC", "EGKR", "EGKK"], actual: ["820", "400", "", "", ""], refuel: [false, false, false, true, false], scen: [null, null, null, "D"], alt: [null, null, null, null], alt2: [null, null, null, null] }));
  check("below-minimum stops are flagged in the PDF", B.bytes.includes("BELOW MINIMUM") && B.bytes.includes("IFR DEPARTURE NOT AVAILABLE"));
  check("a refuel stop is shown with arrival fuel and uplift", B.bytes.includes("REFUEL HERE") && B.bytes.includes("arrive with") && B.bytes.includes("after refuel"));
  check("profile D shows both alternates", B.bytes.includes("PROFILE D") && B.bytes.includes("ALTN EGKB + EGKA"));
  check("long plans run onto more pages with a page count", B.bytes.includes("OF 2") || B.bytes.includes("OF 3"));

  // ── share cancelled ──
  const C = await exportWith(def(), { cancel: true });
  await sleep(100);
  check("cancelling the share sheet: no error, button ready again", C.errors.length === 0 && C.d.querySelector("[data-export-pdf]").textContent.trim() === "EXPORT PLAN (PDF)" && !C.d.querySelector("[data-export-pdf]").disabled);

  // ── blank trip: nothing to export ──
  const E = await exportWith({ stops: ["EGKR", ""], actual: ["", ""], refuel: [false, false], scen: [null], alt: [null], alt2: [null] });
  check("blank / part-filled trip: EXPORT PLAN (PDF) disabled, nothing shared, no errors", E.d.querySelector("[data-export-pdf]").disabled && !E.file && E.errors.length === 0);

  // ── README link on the UPLIFT tab ──
  const w = A.w, d = A.d;
  [...d.querySelectorAll("button")].find((x) => x.textContent.trim() === "UPLIFT").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(200);
  const a = d.querySelector("a[data-readme]");
  check("UPLIFT tab has a README link at the bottom", !!a && a.textContent.includes("README") && a.offsetParent !== undefined);
  check("README link points at the repo README on GitHub and opens in a new tab", a && a.getAttribute("href") === "https://github.com/VonTedworth/Daily-Flight-Card/blob/main/README.md" && a.getAttribute("target") === "_blank" && /noopener/.test(a.getAttribute("rel")));
  check("README link is the last thing on the UPLIFT tab", (() => { const all = [...a.parentElement.children]; return all[all.length - 1] === a; })());

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
