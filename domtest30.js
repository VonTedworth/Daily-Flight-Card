// T1 (v30): golden TEXT snapshots of every PDF the app makes. Any change to a PDF's text — a line
// added, dropped, reworded or reordered — fails here. Only the app version and the "now" stamps
// (today's date / time, the build date) are normalised.
//   card-modern        test-fixtures/modern-card.json via EXPORT PDF & NEW CARD
//   ifr-reference      the reference trip EGKR-EGKD-EGKC-EGKR, profile C, 820 kg (EXPORT PLAN)
//   powercheck-image   the power check PDF with the RFM page saved on the phone
//   powercheck-noimage the same with the image not saved (grey box text instead)
// To accept a DELIBERATE PDF change: GOLDEN_UPDATE=1 node domtest30.js, review the diff, commit.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync("./index.html", "utf8");
const JPG = fs.readFileSync("./assets/rfm-fig-s3-13-v1.jpg");
const { exportCardPdf } = require("./test-fixtures/legacy-card.js");
const GOLD = path.join(__dirname, "test-fixtures", "golden");
const UPDATE = process.env.GOLDEN_UPDATE === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

// The text a PDF shows: every "(…) Tj" string, in drawing order, as jsPDF wrote it (escapes such as
// \( kept; WinAnsi bytes such as the en dash kept as they are). Key lines below are written the same way.
const pdfLines = (bytes) => [...bytes.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]);
const BUILD_DATE = (html.match(/window\.__BUILD_DATE__ = "([^"]*)"/) || [])[1] || "";
const p2 = (n) => String(n).padStart(2, "0");
const dmy = (d, utc) => utc ? `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}` : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
function normalise(lines) {
  const now = new Date();
  const dates = [...new Set([BUILD_DATE, dmy(now), dmy(now, true)].filter(Boolean))];
  return lines.map((s) => {
    let t = s.replace(/\bv\d+\b/g, "v<N>");
    for (const dt of dates) t = t.split(dt).join("<DATE>");
    return t.replace(/<DATE>(\s+)\d{2}:?\d{2}(Z?)/g, "<DATE>$1<TIME>$2"); // "now" times follow "now" dates
  });
}
function compare(name, bytes, mustHave) {
  const lines = normalise(pdfLines(bytes));
  const file = path.join(GOLD, `${name}.txt`);
  if (UPDATE) {
    fs.mkdirSync(GOLD, { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n");
    console.log(`(golden written: ${name}.txt, ${lines.length} lines)`);
  }
  const want = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\n$/, "").split("\n") : null;
  let diff = "";
  if (!want) diff = "no golden file";
  else if (want.length !== lines.length || want.some((l, i) => l !== lines[i])) {
    const i = want.findIndex((l, k) => l !== lines[k]);
    diff = `first difference at line ${i + 1}: golden ${JSON.stringify(want[i])} / now ${JSON.stringify(lines[i])} (${want.length} → ${lines.length} lines)`;
  }
  check(`${name}: PDF text identical to the golden snapshot (${lines.length} lines)${diff ? " — " + diff : ""}`, !diff);
  const missing = mustHave.filter((m) => !lines.some((l) => l.includes(m)));
  check(`${name}: snapshot covers ${mustHave.length} key lines${missing.length ? " — missing " + missing.join(" | ") : ""}`, missing.length === 0);
}

function open(card, opts = {}) {
  let shared = null;
  const vc = new VirtualConsole();
  const errors = []; vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(card));
      if (opts.trip) w.localStorage.setItem("ifr-fuel-trip", JSON.stringify(opts.trip));
      w.navigator.canShare = () => true;
      w.navigator.share = async (d) => { shared = d.files[0]; };
      if (opts.image) w.fetch = async (u) => (String(u).endsWith("rfm-fig-s3-13-v1.jpg") ? { ok: true, arrayBuffer: async () => JPG.buffer.slice(JPG.byteOffset, JPG.byteOffset + JPG.length) } : { ok: false });
    } });
  const w = dom.window, d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const tab = (t) => [...d.querySelector("[data-tabbar]").children].find((b) => b.textContent.trim() === t);
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  const pc = async (k, v) => { const el = d.querySelector(`[data-pc="${k}"]`); set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(40); };
  const bytes = async () => (shared ? Buffer.from(await shared.arrayBuffer()).toString("latin1") : "");
  return { w, d, click, tab, pc, bytes, errors };
}

(async () => {
  // ── modern card ──
  const MODERN = JSON.parse(fs.readFileSync("./test-fixtures/modern-card.json", "utf8"));
  delete MODERN._about;
  const cardBytes = await exportCardPdf(html, MODERN);
  compare("card-modern", cardBytes, ["GAMA KSS DAILY FLIGHT CARD", "DEP GW 4700KG", "DEP GW 4950KG \\(PT 250\\)", "OVER AUM", "NOTES: GROUND RUN",
    "NOTE ON SRP", "POWER CHECKS", "ENG2 3-MIN", "DUTIES DONE", "HANDOVER: COMPRESSOR WASH NOT DONE", "MISC", "OIL CHECKED"]);

  // ── IFR reference trip ──
  const MIN = { date: "14.07.2026", acReg: "G-KSST", srp: "1", gwDep: "4600", varField: "4650", vertField: "", plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "",
    rows: Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })), misc: "", powerChecks: [] };
  const TRIP = { stops: ["EGKR", "EGKD", "EGKC", "EGKR"], actual: ["820", "", "", ""], refuel: [false, false, false, false], scen: [null, null, null], alt: [null, null, null], alt2: [null, null, null] };
  const I = open(MIN, { trip: TRIP });
  await sleep(2500);
  I.click(I.tab("IFR FUEL")); await sleep(200);
  I.click(I.d.querySelector("[data-export-pdf]")); await sleep(1500);
  compare("ifr-reference", await I.bytes(), ["IFR FUEL PLAN", "REQUIRED TO LIFT EGKR: 759 KG", "ENOUGH +61 KG", "SECTOR 1  EGKR > EGKD", "BURN 194 KG", "OPEN ITEMS", "GENERATED BY DAILY FLIGHT CARD APP v<N>"]);

  // ── power check PDF, with and without the RFM image ──
  for (const image of [true, false]) {
    const P = open(MIN, { image });
    await sleep(2500);
    P.click(P.tab("PWR CHK")); await sleep(300);
    for (const [k, v] of Object.entries({ dateZ: "14.07.2026", timeZ: "09:52", oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "775", e1ng: "89.9" })) await P.pc(k, v);
    P.click(P.d.querySelector('[data-pc-addrep="1"]')); await sleep(80);
    for (const [k, v] of Object.entries({ e1ritt: "774", e1rng: "89.8", x0itt: "776", x0ng: "91.5" })) await P.pc(k, v);
    P.click(P.d.querySelector("[data-pc-export]")); await sleep(1500);
    const b = await P.bytes();
    compare(image ? "powercheck-image" : "powercheck-noimage", b, ["POWER ASSURANCE CHECK - HOVER", "G-KSST   SRP 1   14.07.2026   09:52Z   EGKR", "3-MIN", "CROSS-CHECK: OTHER APP",
      "PIC ______________________________", "GENERATED <DATE> <TIME>Z.", ...(image ? [] : ["RFM CHART IMAGE NOT SAVED ON THIS PHONE YET"])]);
    check(`powercheck-${image ? "image" : "noimage"}: the RFM page is ${image ? "embedded" : "not embedded"}`, image ? b.includes("/DCTDecode") : !b.includes("/DCTDecode"));
    check(`powercheck-${image ? "image" : "noimage"}: no script errors`, P.errors.length === 0);
  }
  check("IFR export: no script errors", I.errors.length === 0);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
