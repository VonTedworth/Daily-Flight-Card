// PWR CHK tab — screen, flows, RFM logic and wording, overlay, PDFs, legacy compatibility.
// Example: G-KSST SRP 1234, OAT 12, QNH 996, ELEV 222 → PA 695 FT; TQ 95 → max ITT 775, max NG 91.5.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const JPG = fs.readFileSync("./assets/rfm-fig-s3-13-v1.jpg");
const { LEGACY_CARD, exportCardPdf, normalisePdf, mk } = require("./test-fixtures/legacy-card.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (rows = [], extra = {}) => ({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4700", vertField: "4550", plannedFuel: "650",
  hoursAvail: "9:00", sunriseSet: "", rows: [...rows, ...Array.from({ length: 7 - rows.length }, () => mk())], misc: "", powerChecks: [], ...extra });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

// opts.image: serve the RFM jpeg to fetch (as the service worker does); otherwise there is no fetch at all
function open(c, opts = {}) {
  const errors = [];
  let fetches = 0;
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/Daily-Flight-Card/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(c));
      w.navigator.canShare = () => true;
      let shared = null;
      w.navigator.share = async (d) => { shared = d.files[0]; };
      w.__shared = () => shared;
      if (opts.image) w.fetch = async (u) => { fetches++; return String(u).endsWith("rfm-fig-s3-13-v1.jpg") ? { ok: true, arrayBuffer: async () => JPG.buffer.slice(JPG.byteOffset, JPG.byteOffset + JPG.length) } : { ok: false }; };
    } });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s), qa = (s) => [...d.querySelectorAll(s)];
  const tx = (s) => (q(s) ? q(s).textContent : "");
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const btn = (t) => qa("button").find((b) => b.textContent.trim() === t);
  const tab = (t) => q("[data-tabbar]") && [...q("[data-tabbar]").children].find((b) => b.textContent.trim() === t);
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  const type = async (el, v) => { setter.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(40); };
  const pc = (k) => q(`[data-pc="${k}"]`);
  const fill = async (vals) => { for (const [k, v] of Object.entries(vals)) await type(pc(k), v); };
  const shown = (el) => { for (let e = el; e && e !== d.body; e = e.parentElement) if (e.style && e.style.display === "none") return false; return !!el; };
  const onPwr = () => shown(q("[data-pc-for]"));
  const onAc = () => shown(qa("span").find((s) => s.textContent.trim() === "MISC"));
  const onFlights = () => shown(qa("input").find((i) => i.previousElementSibling?.textContent?.trim() === "FLT MIN"));
  const saved = () => JSON.parse(w.localStorage.getItem("daily-flight-card"));
  const shared = async () => { const f = w.__shared(); return f ? { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()).toString("latin1") } : null; };
  return { w, d, q, qa, tx, click, btn, tab, type, pc, fill, onPwr, onAc, onFlights, saved, shared, errors, fetches: () => fetches };
}
const EX = { oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "750", e1ng: "89.9" };
const zuluNow = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return { date: `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`, hh: p(d.getUTCHours()) }; };

(async () => {
  // ════════ tab bar ════════
  const A = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" })]));
  await sleep(2500);
  const bar = A.q("[data-tabbar]");
  const labels = [...bar.children].map((b) => b.textContent.trim());
  check(`tab order: ${labels.slice(0, 5).join(" · ")} then the theme toggle`, labels.slice(0, 5).join("|") === "A/C DATA|FLIGHTS|UPLIFT|PWR CHK|IFR FUEL" && bar.children[5].getAttribute("aria-label") === "toggle day/night mode");
  const tb = bar.children[0].style;
  check("tabs: flex 1 1 auto, padding 12px 4px, one line (nowrap); gap 6; toggle 36 px", tb.flex === "1 1 auto" && tb.padding === "12px 4px" && tb.whiteSpace === "nowrap" && bar.style.gap === "6px" && bar.children[5].style.width === "36px");
  check("tab text 10.5 px (11 px measured too wide at 375 px)", tb.fontSize === "10.5px");

  // ════════ UPLIFT is fuel only ════════
  A.click(A.tab("UPLIFT")); await sleep(150);
  check("UPLIFT no longer shows POWER CHECK DETAILS", !A.d.getElementById("root").textContent.includes("POWER CHECK DETAILS") && !A.btn("CONFIRM → MISC"));

  // ════════ flow 1: ground run → YES → PWR CHK for flight 2 → RECORD → FLIGHTS ════════
  A.click(A.tab("FLIGHTS")); await sleep(150);
  const flt = A.qa("input").filter((i) => i.previousElementSibling?.textContent?.trim() === "FLT MIN");
  await A.type(flt[1], "0"); await sleep(100);
  check("0-minute entry asks GROUND RUN — POWER CHECK?", A.d.getElementById("root").textContent.includes("GROUND RUN — POWER CHECK?"));
  A.click(A.btn("YES")); await sleep(200);
  check("YES opens PWR CHK for FLIGHT 2", A.onPwr() && A.tx("[data-pc-for]") === "FOR: FLIGHT 2" && A.tab("PWR CHK").style.color.length > 0);
  check("header POWER CHECK · HOVER · FIG S3-13 EAPS OFF; amber trial note", A.d.getElementById("root").textContent.includes("HOVER · FIG S3-13 EAPS OFF") && A.tx("[data-pc-trial]") === "PERSONAL TRIAL — THE COMPANY POWER CHECK METHOD GOVERNS.");
  const z = zuluNow();
  check(`prefilled: G-KSST, SRP 1234, EGKR, ELEV 222, TQ 95 / 95, date ${z.date} and time now in UTC`,
    A.pc("acReg").value === "G-KSST" && A.pc("srp").value === "1234" && A.pc("site").value === "EGKR" && A.pc("elev").value === "222" && A.pc("e0tq").value === "95" && A.pc("e1tq").value === "95" &&
    A.pc("dateZ").value === z.date && /^\d{2}:\d{2}$/.test(A.pc("timeZ").value) && A.pc("timeZ").value.slice(0, 2) === z.hh);
  check("inputs: number pads (ITT/QNH/ELEV numeric, TQ/NG/OAT decimal), 16 px text (no iOS zoom)",
    ["e0itt", "qnh", "elev", "srp"].every((k) => A.pc(k).getAttribute("inputmode") === "numeric") && ["e0tq", "e0ng", "oat"].every((k) => A.pc(k).getAttribute("inputmode") === "decimal") &&
    A.qa("[data-pc]").every((i) => parseFloat(i.style.fontSize) >= 16));
  await A.fill({ dateZ: "01.01.2020", timeZ: "00:00" });
  A.click(A.q("[data-pc-now]")); await sleep(60);
  check("NOW Z resets DATE and TIME Z to now (UTC)", A.pc("dateZ").value === z.date && A.pc("timeZ").value.slice(0, 2) === z.hh);
  check("RECORD ON CARD disabled until conditions and both engines are entered", A.q("[data-pc-record]").disabled);
  check("summary before entry: ENTER CONDITIONS AND READINGS", A.tx("[data-pc-summary]") === "ENTER CONDITIONS AND READINGS");
  await A.fill(EX);
  check(`pressure altitude line: "${A.tx("[data-pc-pa]")}"`, A.tx("[data-pc-pa]") === "PRESSURE ALT 695 FT FROM QNH + ELEV");
  check(`ENG 1: "${A.tx('[data-pc-res="0-first"]')}"`, A.tx('[data-pc-res="0-first"]') === "MAX ITT · PAM775 +30MAX NG · PAM91.5 +1.8");
  check("PAMs green when positive", A.qa('[data-pc-res="0-first"] [data-pc-pam]').every((e) => /74, 222, 128/.test(e.style.color)));
  check("both engines WITHIN LIMITS (green); summary BOTH ENGINES WITHIN LIMITS (green)",
    A.tx('[data-pc-state="0"]') === "WITHIN LIMITS" && A.tx('[data-pc-state="1"]') === "WITHIN LIMITS" && A.tx("[data-pc-summary]") === "BOTH ENGINES WITHIN LIMITS" && /74, 222, 128/.test(A.q("[data-pc-summary]").style.color));
  check("RECORD ON CARD enabled", !A.q("[data-pc-record]").disabled);
  A.click(A.q("[data-pc-record]")); await sleep(800);
  check("RECORD returns to FLIGHTS", A.onFlights() && !A.onPwr());
  const s1 = A.saved();
  const e1 = s1.powerChecks[0];
  check("saved as a v2 entry for row 1 (flight 2), inputs as typed", s1.powerChecks.length === 1 && e1.v === 2 && e1.row === 1 && e1.acReg === "G-KSST" && e1.srp === "1234" && e1.site === "EGKR" &&
    e1.oat === "12" && e1.qnh === "996" && e1.elev === "222" && e1.paIn === "" && e1.eng[0].itt === "745" && e1.eng[0].ng === "89.7" && e1.eng[1].tq === "95" && e1.eng[0].rep === null);
  check("result snapshot: PA 695 from QNH, chart S3-13 Issue 3 Rev 1, max/PAM/chart values, state met",
    e1.result.paFt === 695 && e1.result.paSource === "QNH" && e1.result.chart === "S3-13 Issue 3 Rev 1" && e1.result.eng[0].state === "met" &&
    e1.result.eng[0].first.maxItt === 775 && e1.result.eng[0].first.maxNg === 91.5 && e1.result.eng[0].first.ittMargin === 30 && e1.result.eng[0].first.ngMargin === 1.8 &&
    e1.result.eng[0].first.chartItt === 775.72 && e1.result.eng[0].first.chartNg === 91.571 && e1.result.eng[1].first.ittMargin === 25 && e1.result.eng[0].rep === null);
  check("FLIGHTS: row 2 tagged GROUND RUN – POWER CHECK", s1.rows[1].notes === "GROUND RUN – POWER CHECK");
  const flt2 = A.qa("input").filter((i) => i.previousElementSibling?.textContent?.trim() === "FLT MIN");
  await A.type(flt2[2], "0"); await sleep(100);
  check("one per card: a second ground run does not ask again", !A.d.getElementById("root").textContent.includes("GROUND RUN — POWER CHECK?"));
  await A.type(flt2[2], ""); await sleep(50);
  A.click(A.tab("A/C DATA")); await sleep(150);
  const ent = A.q('[data-pc-entry="1"]');
  const lines = ent ? [...ent.children].map((x) => x.textContent) : [];
  check(`A/C DATA line 1: "${lines[0]}"`, /^FLT 2 POWER CHECK · \d{2}:\d{2}Z · PA 695 FT · OAT 12°C$/.test(lines[0] || ""));
  check(`A/C DATA line 2: "${lines[1]}"`, lines[1] === "ENG1 TQ 95 ITT 745/775 (+30) NG 89.7/91.5 (+1.8)");
  check(`A/C DATA line 3: "${lines[2]}"`, lines[2] === "ENG2 TQ 95 ITT 750/775 (+25) NG 89.9/91.5 (+1.6)");
  check(`A/C DATA line 4 (state) and green: "${lines[3]}"`, lines[3] === "BOTH ENGINES WITHIN LIMITS" && /74, 222, 128/.test(ent.style.color));
  check("REDO POWER CHECK button and ✕ remove still there", !!A.btn("REDO POWER CHECK") && !!A.q('button[aria-label="remove power check"]'));

  // ════════ tapping a v2 entry reopens it loaded ════════
  A.click(ent); await sleep(200);
  check("tapping the entry opens PWR CHK for FLIGHT 2 with it loaded", A.onPwr() && A.tx("[data-pc-for]") === "FOR: FLIGHT 2" && A.pc("e0itt").value === "745" && A.pc("e1ng").value === "89.9" && A.pc("qnh").value === "996");
  // change and re-record: replaces that row's entry
  await A.type(A.pc("e1itt"), "760");
  A.click(A.q("[data-pc-record]")); await sleep(800);
  check("re-recording replaces the row's entry (still one)", A.saved().powerChecks.length === 1 && A.saved().powerChecks[0].eng[1].itt === "760" && A.saved().powerChecks[0].result.eng[1].first.ittMargin === 15);

  // ════════ flow 2: A/C DATA button → THIS SRP → RECORD → A/C DATA ════════
  A.click(A.tab("A/C DATA")); await sleep(150);
  A.click(A.btn("REDO POWER CHECK")); await sleep(200);
  check("A/C DATA POWER CHECK button → PWR CHK FOR: THIS SRP, a fresh check", A.onPwr() && A.tx("[data-pc-for]") === "FOR: THIS SRP" && A.pc("e0itt").value === "" && A.pc("oat").value === "");
  await A.fill({ ...EX, paIn: "700" });
  check(`PFD pressure altitude used: "${A.tx("[data-pc-pa]")}"`, A.tx("[data-pc-pa]") === "USING PRESSURE ALT 700 FT FROM PFD");
  A.click(A.q("[data-pc-record]")); await sleep(800);
  check("RECORD returns to A/C DATA", A.onAc() && !A.onPwr());
  const srpE = A.saved().powerChecks.find((p) => p.row === null);
  check("SRP-level entry saved (row null) with paIn 700 / PFD, alongside the flight 2 entry", A.saved().powerChecks.length === 2 && srpE && srpE.paIn === "700" && srpE.result.paSource === "PFD" && srpE.result.paFt === 700);
  check("its A/C DATA line names SRP and PA 700", /^SRP POWER CHECK · \d{2}:\d{2}Z · PA 700 FT · OAT 12°C$/.test(A.q('[data-pc-entry="srp"]').children[0].textContent));

  // ════════ CANCEL records nothing ════════
  const before = JSON.stringify(A.saved().powerChecks);
  A.click(A.btn("REDO POWER CHECK")); await sleep(200);
  check("reopening an SRP v2 entry loads it", A.pc("paIn").value === "700" && A.pc("e0itt").value === "745");
  await A.type(A.pc("e0itt"), "770");
  A.click(A.q("[data-pc-cancel]")); await sleep(800);
  check("CANCEL returns to A/C DATA and records nothing", A.onAc() && JSON.stringify(A.saved().powerChecks) === before);

  // ════════ tab bar with no context = SRP-level ════════
  A.click(A.tab("PWR CHK")); await sleep(200);
  check("tab bar with no check open → FOR: THIS SRP (its v2 entry loaded)", A.onPwr() && A.tx("[data-pc-for]") === "FOR: THIS SRP" && A.pc("paIn").value === "700");
  A.click(A.tab("IFR FUEL")); await sleep(100);
  A.click(A.tab("PWR CHK")); await sleep(100);
  check("…and switching tabs keeps the check as it was", A.onPwr() && A.tx("[data-pc-for]") === "FOR: THIS SRP");
  A.click(A.q("[data-pc-cancel]")); await sleep(200);

  // ════════ RFM logic (steps 7, 11, 12) and wording ════════
  const B = open(card());
  await sleep(2500);
  B.click(B.tab("PWR CHK")); await sleep(200);
  await B.fill({ oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "775", e1ng: "89.7" });
  check("ITT equal to max on the 1-minute reading → repeat (amber) + ENTER 3-MIN REPEAT",
    B.tx('[data-pc-state="1"]') === "PAM ZERO OR NEGATIVE — REPEAT HOLDING FIXED COLLECTIVE FOR 3 MIN" && /255, 179, 71/.test(B.q('[data-pc-state="1"]').style.color) && !!B.q('[data-pc-addrep="1"]'));
  check("a zero PAM on the 1-minute reading shows red ±0", B.tx('[data-pc-res="1-first"] [data-pc-pam="itt"]') === "±0" && /255, 107, 107/.test(B.q('[data-pc-res="1-first"] [data-pc-pam="itt"]').style.color));
  check("summary REPEAT REQUIRED: HOLD FIXED COLLECTIVE 3 MIN AND RE-ENTER (amber)", B.tx("[data-pc-summary]") === "REPEAT REQUIRED: HOLD FIXED COLLECTIVE 3 MIN AND RE-ENTER" && /255, 179, 71/.test(B.q("[data-pc-summary]").style.color));
  check("RECORD allowed with a repeat outstanding (inputs complete)", !B.q("[data-pc-record]").disabled);
  B.click(B.q('[data-pc-addrep="1"]')); await sleep(100);
  check("repeat block: 3-MIN REPEAT, TQ prefilled 95, REMOVE REPEAT; state ENTER 3-MIN REPEAT READINGS",
    !!B.q('[data-pc-repblock="1"]') && B.pc("e1rtq").value === "95" && B.pc("e1ritt").value === "" && !!B.q('[data-pc-removerep="1"]') && B.tx('[data-pc-state="1"]') === "ENTER 3-MIN REPEAT READINGS");
  await B.fill({ e1ritt: "775", e1rng: "89.8" });
  check("repeat with ITT equal to max → WITHIN LIMITS ON 3-MIN REPEAT (zero PAM acceptable, green)",
    B.tx('[data-pc-state="1"]') === "WITHIN LIMITS ON 3-MIN REPEAT" && B.tx('[data-pc-res="1-rep"] [data-pc-pam="itt"]') === "±0" && /74, 222, 128/.test(B.q('[data-pc-res="1-rep"] [data-pc-pam="itt"]').style.color) && B.tx("[data-pc-summary]") === "BOTH ENGINES WITHIN LIMITS");
  await B.type(B.pc("e1ritt"), "776");
  check("repeat with ITT one above max → exceeds (red), summary names ENG 2",
    B.tx('[data-pc-state="1"]') === "PAM STILL NEGATIVE ON 3-MIN REPEAT — RFM PERFORMANCE MAY NOT BE ACHIEVED. REFER TO MM" &&
    B.tx("[data-pc-summary]") === "ENG 2: PAM STILL NEGATIVE ON 3-MIN REPEAT — RFM PERFORMANCE MAY NOT BE ACHIEVED. REFER TO MM" && /255, 107, 107/.test(B.q("[data-pc-summary]").style.color));
  // the chart shows the final (repeat) reading for ENG 2
  check("chart draws the repeat reading when entered (same TQ → same path)", B.qa("[data-pc-path]").length === 2);
  B.click(B.q("[data-pc-record]")); await sleep(800);
  B.click(B.tab("A/C DATA")); await sleep(150);
  const exE = B.q('[data-pc-entry="srp"]');
  check(`exceeds: A/C DATA entry red, ENG2 shown from the 3-MIN repeat ("${exE && exE.children[2].textContent}")`,
    exE && /255, 107, 107/.test(exE.style.color) && exE.children[2].textContent === "ENG2 3-MIN TQ 95 ITT 776/775 (−1) NG 89.8/91.5 (+1.7)" && B.saved().powerChecks[0].result.eng[1].state === "exceeds" && B.saved().powerChecks[0].result.eng[1].rep.ittMargin === -1);
  B.click(exE); await sleep(200);
  B.click(B.q('[data-pc-removerep="1"]')); await sleep(100);
  check("REMOVE REPEAT → back to repeat required", B.tx('[data-pc-state="1"]').startsWith("PAM ZERO OR NEGATIVE") && !B.q('[data-pc-repblock="1"]'));
  // NG on its own
  await B.fill({ e1itt: "745", e1ng: "91.5" });
  check("NG alone equal to max → repeat", B.tx('[data-pc-state="1"]').startsWith("PAM ZERO OR NEGATIVE"));
  B.click(B.q('[data-pc-addrep="1"]')); await sleep(100);
  await B.fill({ e1ritt: "745", e1rng: "91.5" });
  check("NG alone equal to max on the repeat → within limits on repeat", B.tx('[data-pc-state="1"]') === "WITHIN LIMITS ON 3-MIN REPEAT");
  await B.type(B.pc("e1rng"), "91.6");
  check("NG alone 0.1 above max on the repeat → exceeds", B.tx('[data-pc-state="1"]').startsWith("PAM STILL NEGATIVE"));
  B.click(B.q('[data-pc-removerep="1"]')); await sleep(100);
  // repeat pending recorded → amber on A/C DATA
  B.click(B.q('[data-pc-addrep="1"]')); await sleep(100);
  B.click(B.q("[data-pc-record]")); await sleep(800);
  B.click(B.tab("A/C DATA")); await sleep(150);
  const pend = B.q('[data-pc-entry="srp"]');
  check("repeat pending recorded: A/C DATA amber, state REPEAT REQUIRED…", pend && /255, 179, 71/.test(pend.style.color) && pend.children[3].textContent === "REPEAT REQUIRED: HOLD FIXED COLLECTIVE 3 MIN AND RE-ENTER" && B.saved().powerChecks[0].result.eng[1].state === "repeatPending");

  // advisories, errors, QNH
  B.click(B.tab("PWR CHK")); await sleep(150);
  B.click(B.q("[data-pc-cancel]")); await sleep(150);
  B.click(B.tab("PWR CHK")); await sleep(150);
  await B.fill({ oat: "12", qnh: "996", e0tq: "91", e0itt: "931", e0ng: "89", e1itt: "745", e1ng: "89.7" });
  check("TQ below 92 → amber TQ BELOW 92 % COMPANY MINIMUM", B.tx('[data-pc-res="0-first"] [data-pc-lowtq]') === "TQ BELOW 92 % COMPANY MINIMUM");
  check("ITT above 930 → red ABOVE CHART LIMIT: 930 °C ITT / 98.2 % NG", B.tx('[data-pc-res="0-first"] [data-pc-overlimit]') === "ABOVE CHART LIMIT: 930 °C ITT / 98.2 % NG" && /255, 107, 107/.test(B.q("[data-pc-overlimit]").style.color));
  await B.type(B.pc("qnh"), "1090");
  check("QNH outside 900–1080 → message, no result, RECORD disabled", B.tx("[data-pc-pa]") === "QNH OUTSIDE 900–1080 HPA" && B.tx("[data-pc-summary]") === "QNH OUTSIDE 900–1080 HPA" && B.tx('[data-pc-res="0-first"]') === "—" && B.q("[data-pc-record]").disabled);
  await B.fill({ qnh: "996", oat: "55" });
  check("OAT outside the chart → error text (amber), summary OUTSIDE CHART — NO RESULT. CHECK INPUTS.",
    B.tx('[data-pc-res="0-first"]') === "OAT OUTSIDE CHART (-40 TO +50 °C)" && B.tx("[data-pc-summary]") === "OUTSIDE CHART — NO RESULT. CHECK INPUTS." && B.qa("[data-pc-path]").length === 0);
  B.click(B.btn("±")); await sleep(60); // first ± is OAT's
  check("OAT ± makes it -55 (still outside)", B.pc("oat").value === "-55");
  await B.fill({ oat: "12" });
  check("typing keeps the minus sign (-12), as the old OAT field did", B.pc("oat").value === "-12");
  B.click(B.btn("±")); await sleep(60);
  await B.fill({ e0tq: "95", e0itt: "745", e0ng: "89.7" });
  check("± again → 12", B.pc("oat").value === "12");

  // ════════ overlay ════════
  const paths = B.qa("[data-pc-path] path");
  check("chart: SVG viewBox 0 0 707 511 at 1000 px, inside a sideways-scrolling box",
    B.q("[data-pc-chart]").getAttribute("viewBox") === "0 0 707 511" && B.q("[data-pc-chart]").getAttribute("width") === "1000" && B.q("[data-pc-chartwrap]").style.overflowX === "auto");
  check("two reading paths: ENG 1 red #e0201b solid 1.6 (no dasharray); ENG 2 magenta #b000d0 dotted 2.2, dasharray 0.01 4.4, round caps",
    paths.length === 2 && paths[0].getAttribute("stroke") === "#e0201b" && !paths[0].getAttribute("stroke-dasharray") && paths[0].getAttribute("stroke-width") === "1.6" &&
    paths[1].getAttribute("stroke") === "#b000d0" && paths[1].getAttribute("stroke-dasharray") === "0.01 4.4" && paths[1].getAttribute("stroke-linecap") === "round" && paths[1].getAttribute("stroke-width") === "2.2");
  const all = B.qa("[data-pc-chart] path, [data-pc-chart] circle");
  const g1 = all.filter((x) => x.closest('[data-pc-path="0"]')), g2 = all.filter((x) => x.closest('[data-pc-path="1"]'));
  check("ENG 2's path and rings come after ENG 1's in document order (drawn on top)", g1.length && g2.length && all.indexOf(g2[0]) > all.indexOf(g1[g1.length - 1]));
  check("ENG 2 rings: dotted (0.01 4.4, round), radius 9.5, no centre dot", B.qa('[data-pc-path="1"] circle').length === 3 && B.qa('[data-pc-path="1"] circle').every((c) => c.getAttribute("r") === "9.5" && c.getAttribute("stroke-dasharray") === "0.01 4.4" && c.getAttribute("stroke-linecap") === "round" && c.getAttribute("fill") === "none"));
  check(`path geometry (95 %, 695 ft, 12 °C): ${paths[0] && paths[0].getAttribute("d")}`,
    paths[0] && paths[0].getAttribute("d") === "M207.09,426.02L207.09,307.05L577.96,307.05M361.71,307.05L361.71,426.02M577.96,307.05L577.96,426.02");
  check("3 rings (r 7) + 3 dots (r 1.6) per engine at xt, xi, xn", B.qa('[data-pc-path="0"] circle').length === 6 && B.qa('[data-pc-path="0"] circle[r="7"]').map((c) => c.getAttribute("cx")).join() === "207.09,361.71,577.96");
  check("image not saved (no fetch) → grey box RFM CHART IMAGE NOT SAVED ON THIS PHONE YET — OPEN ONCE WITH SIGNAL", B.tx("[data-pc-noimg]") === "RFM CHART IMAGE NOT SAVED ON THIS PHONE YET — OPEN ONCE WITH SIGNAL" && !B.q("[data-pc-img]"));
  check("caption under the chart", B.d.getElementById("root").textContent.includes("RFM Supp 3 page S3-32 (Fig S3-13), with the readings drawn over it. ENG 1 red solid; ENG 2 magenta dotted, drawn on top. Scrolls sideways."));
  check("footnote (RFM steps 11–12, rounding, never extended)", B.d.getElementById("root").textContent.includes("PAM = max − indicated. 1-minute check: both PAMs must be positive. 3-minute repeat: zero or positive is acceptable (RFM Supp 3 steps 11–12). Max ITT and NG are read from Fig S3-13 only and rounded down; the chart is never extended."));

  // ════════ cross-check ════════
  await B.fill({ x0itt: "776", x0ng: "91.5" });
  check(`cross-check agrees: "${B.tx('[data-pc-xres="0"]')}"`, B.tx('[data-pc-xres="0"]') === "AGREES: ITT −1 °C · NG ±0.0 %THIS APP − OTHER APP" && /74, 222, 128/.test(B.q('[data-pc-xres="0"] span').style.color));
  await B.fill({ x1ng: "91.3" });
  check(`cross-check differs (NG 0.2): "${B.tx('[data-pc-xres="1"]')}"`, B.tx('[data-pc-xres="1"]') === "DIFFERS: NG +0.2 %THIS APP − OTHER APP" && /255, 179, 71/.test(B.q('[data-pc-xres="1"] span').style.color));
  await B.fill({ x1ng: "", x1itt: "772" });
  check("cross-check ITT 3 °C apart → DIFFERS", B.tx('[data-pc-xres="1"]').startsWith("DIFFERS: ITT +3 °C"));

  // ════════ standalone PDF (no image saved) ════════
  await B.fill({ acReg: "G-KSST", srp: "1234", dateZ: "18.11.2026", timeZ: "09:29" });
  B.click(B.q("[data-pc-export]")); await sleep(1200);
  const P = await B.shared();
  const b = P ? P.bytes : "";
  check(`PDF shared: ${P && P.name}`, P && P.type === "application/pdf" && P.name === "PC_G-KSST_18.11.2026_0929Z.pdf" && b.startsWith("%PDF"));
  check("PDF title and source line", b.includes("(POWER ASSURANCE CHECK - HOVER) Tj") && b.includes("(AW169 RFM 169F0290X001 SUPP 3, FIG S3-13 P&WC 210A HOVER POWER CHECK - EAPS OFF) Tj"));
  check("PDF reg / SRP / date / time / site line", b.includes("(G-KSST   SRP 1234   18.11.2026   09:29Z   EGKR) Tj"));
  check("PDF conditions line (from QNH)", b.includes("(OAT 12 C   QNH 996 HPA   ELEV 222 FT   PRESS ALT 695 FT \\(FROM QNH\\)) Tj"));
  check("PDF table header and 1-MIN rows with PAMs", ["ENG", "READING", "TQ %", "ITT", "MAX", "PAM", "NG %"].every((h) => b.includes(`(${h}) Tj`)) && b.includes("(1-MIN) Tj") && b.includes("(+30) Tj") && b.includes("(+1.8) Tj") && b.includes("(775) Tj") && b.includes("(91.5) Tj") && b.includes("(95.0) Tj"));
  check("PDF state lines", b.includes("(ENG 1: WITHIN LIMITS) Tj") && b.includes("(ENG 2: WITHIN LIMITS) Tj"));
  check("PDF cross-check lines", b.includes("(CROSS-CHECK: OTHER APP \\(THIS APP - OTHER APP\\)) Tj") && b.includes("(ENG 1: MAX ITT 776 \\(DIFF -1\\)   MAX NG 91.5 \\(DIFF 0.0\\)) Tj") && b.includes("(ENG 2: MAX ITT 772 \\(DIFF +3\\)   MAX NG - \\(DIFF -\\)) Tj"));
  check("PDF: no image saved → grey box text in its place", b.includes("(RFM CHART IMAGE NOT SAVED ON THIS PHONE YET - OPEN ONCE WITH SIGNAL) Tj") && !b.includes("/DCTDecode"));
  check("PDF legend, PIC line, footer", b.includes("(ENG 1 RED SOLID, ENG 2 MAGENTA DOTTED ON TOP, DRAWN OVER RFM SUPP 3 PAGE S3-32 FIG S3-13.) Tj") && b.includes("(PIC ______________________________) Tj") &&
    /\(CALCULATED BY DAILY FLIGHT CARD v\d+\. PERSONAL TRIAL - THE COMPANY POWER CHECK METHOD GOVERNS\.\) Tj/.test(b) &&
    b.includes("(MAX ITT / NG READ FROM FIG S3-13 ONLY, ROUNDED DOWN. NO EXTRAPOLATION BEYOND THE CHART.) Tj") &&
    b.includes("(PAM = MAX - INDICATED. 1-MIN: PAM MUST BE POSITIVE. 3-MIN REPEAT: ZERO OR POSITIVE \\(RFM SUPP 3 STEPS 11-12\\).) Tj") && /\(GENERATED \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}Z\.\) Tj/.test(b));
  check("PDF: no degree sign or unicode minus (Courier is WinAnsi)", !b.includes("°") && !b.includes("−") && !b.includes("—"));
  check("PDF overlay: engine colours, ENG 2 dotted with round caps, then dash and cap reset", b.includes("0.88 0.13 0.11 RG") && b.includes("0.69 0. 0.82 RG") && /\[[0-9.]+ [0-9.]+\] 0\. d/.test(b) && b.includes("[] 0. d") && b.includes("1 J") && b.includes("0 J"));
  check("PDF: ENG 1 drawn before ENG 2", b.indexOf("0.88 0.13 0.11 RG") < b.indexOf("0.69 0. 0.82 RG"));
  check("export does not record anything", B.saved().powerChecks.length === 1 && B.saved().powerChecks[0].eng[0].itt === "745" && B.saved().powerChecks[0].result.eng[1].state === "repeatPending");

  // ════════ standalone PDF with the RFM image (as served by the asset cache) ════════
  const G = open(card(), { image: true });
  await sleep(2500);
  check("the RFM image is not fetched until PWR CHK is opened", G.fetches() === 0);
  G.click(G.tab("PWR CHK")); await sleep(400);
  check("PWR CHK opened → image fetched once, shown on screen (relative URL)", G.fetches() === 1 && !!G.q("[data-pc-img]") && G.q("[data-pc-img]").getAttribute("href") === "./assets/rfm-fig-s3-13-v1.jpg" && !G.q("[data-pc-noimg]"));
  await G.fill({ oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "775", e1ng: "89.7" });
  G.click(G.q('[data-pc-addrep="1"]')); await sleep(80);
  await G.fill({ e1ritt: "776", e1rng: "89.8" });
  G.click(G.q("[data-pc-export]")); await sleep(1500);
  const Q = await G.shared();
  const qb = Q ? Q.bytes : "";
  check(`PDF with the RFM page embedded (${qb.length} bytes > 400 KB, JPEG stream)`, qb.length > 400000 && qb.includes("/DCTDecode") && !qb.includes("NOT SAVED ON THIS PHONE"));
  check("PDF: 3-MIN row and labels for exceeds", qb.includes("(3-MIN) Tj") && qb.includes("(-1) Tj") && qb.includes("(ENG 2: PAM NEGATIVE ON 3-MIN REPEAT - REFER TO MM) Tj") && !qb.includes("CROSS-CHECK"));
  check(`filename PC_<REG>_<DD.MM.YYYY>_<HHMM>Z.pdf (${Q && Q.name})`, Q && /^PC_G-KSST_\d{2}\.\d{2}\.\d{4}_\d{4}Z\.pdf$/.test(Q.name));
  check("PFD conditions line in the PDF", await (async () => {
    await G.fill({ paIn: "700" }); G.click(G.q("[data-pc-export]")); await sleep(1500);
    const R2 = await G.shared(); return R2 && R2.bytes.includes("(OAT 12 C   PRESS ALT 700 FT \\(PFD, 1013 SET\\)) Tj");
  })());

  // ════════ card PDF: v2 compact block ════════
  const H = open(card([mk({ fltTime: "0", shtdwn: "0905", fuel: "640", notes: "GROUND RUN – POWER CHECK" })], { powerChecks: [] }));
  await sleep(2500);
  H.click(H.tab("A/C DATA")); await sleep(150);
  H.click(H.btn("POWER CHECK")); await sleep(200);
  await H.fill({ ...EX, timeZ: "09:29", e1itt: "775" });
  H.click(H.q('[data-pc-addrep="1"]')); await sleep(80);
  await H.fill({ e1ritt: "774", e1rng: "89.8" });
  H.click(H.q("[data-pc-record]")); await sleep(800);
  H.click(H.btn("NEW CARD")); await sleep(150);
  H.click(H.btn("EXPORT PDF & NEW CARD")); await sleep(1500);
  const cb = (await H.shared()).bytes;
  check("card PDF: POWER CHECKS heading and the v2 header line", cb.includes("(POWER CHECKS) Tj") && cb.includes("(SRP POWER CHECK 09:29Z  OAT 12 C  PA 695 FT) Tj"));
  check("card PDF: ENG1 line", cb.includes("(ENG1 TQ 95.0 ITT 745 MAX 775 PAM +30  NG 89.7 MAX 91.5 PAM +1.8  WITHIN LIMITS) Tj"));
  check("card PDF: ENG2 1-minute and 3-minute lines", cb.includes("(ENG2 TQ 95.0 ITT 775 MAX 775 PAM 0  NG 89.9 MAX 91.5 PAM +1.6  REPEAT REQUIRED) Tj") && cb.includes("(ENG2 3-MIN TQ 95.0 ITT 774 MAX 775 PAM +1  NG 89.8 MAX 91.5 PAM +1.7  WITHIN LIMITS ON 3-MIN REPEAT) Tj"));
  check("card PDF: no N1 wording for a v2 entry", !cb.includes("N1"));

  // ════════ legacy entries: unchanged display and PDF ════════
  const L = open(LEGACY_CARD);
  await sleep(2500);
  L.click(L.tab("A/C DATA")); await sleep(150);
  const lt = L.d.getElementById("root").textContent;
  check("legacy entries keep the old two-line display (N1 / ITT)", lt.includes("FLT 1 POWER CHECK  ·  OAT 12°C  ·  QNH 1013 HPA") && lt.includes("ENG1 N1 88.5% ITT 745°C  ·  ENG2 N1 88.9% ITT 752°C") && lt.includes("SRP POWER CHECK  ·  OAT -3°C  ·  QNH 998 HPA") && !L.q("[data-pc-entry]"));
  L.click(L.tab("PWR CHK")); await sleep(200);
  check("a legacy SRP entry is not loaded into PWR CHK (fresh check)", L.tx("[data-pc-for]") === "FOR: THIS SRP" && L.pc("oat").value === "" && L.pc("e0itt").value === "");
  const legacyNow = await exportCardPdf(html, LEGACY_CARD);
  const legacyV19 = fs.readFileSync("./test-fixtures/legacy-card-v19.pdf").toString("latin1");
  check(`legacy card PDF byte-identical to v19's output (apart from jsPDF's date / file ID) — ${legacyNow.length} vs ${legacyV19.length} bytes`, legacyNow.length > 1000 && normalisePdf(legacyNow) === normalisePdf(legacyV19));
  check("legacy PDF line printed as before", legacyNow.includes("(FLT 1: OAT 12 C  QNH 1013 HPA  ENG1 N1 88.5% ITT 745 C  ENG2 N1 88.9% ITT 752 C) Tj"));

  // ════════ v21: A/C REG + SRP follow the A/C DATA page; CHART and CROSS-CHECK drop-downs ════════
  const M = open(card([], { acReg: "", srp: "" }));
  await sleep(2500);
  M.click(M.tab("PWR CHK")); await sleep(200);
  check("blank card: A/C REG and SRP empty", M.pc("acReg").value === "" && M.pc("srp").value === "");
  M.click(M.tab("A/C DATA")); await sleep(150);
  const srpIn = () => M.qa("input").find((i) => i.previousElementSibling?.textContent?.trim() === "SRP" || i.closest("label")?.firstChild?.textContent?.trim() === "SRP");
  const regSel = M.qa("select").find((x) => [...x.options].some((o) => o.value === "G-KSSC"));
  regSel.value = "G-KSSC"; regSel.dispatchEvent(new M.w.Event("change", { bubbles: true })); await sleep(80);
  await M.type(srpIn(), "3007575");
  M.click(M.tab("PWR CHK")); await sleep(150);
  check(`filled in on A/C DATA afterwards → PWR CHK follows (${M.pc("acReg").value} / ${M.pc("srp").value})`, M.pc("acReg").value === "G-KSSC" && M.pc("srp").value === "3007575");
  await M.type(M.pc("srp"), "3007576");
  M.click(M.tab("A/C DATA")); await sleep(100);
  await M.type(srpIn(), "3007577");
  M.click(M.tab("PWR CHK")); await sleep(150);
  check("once typed in on PWR CHK, the SRP stays as typed (REG still follows)", M.pc("srp").value === "3007576" && M.pc("acReg").value === "G-KSSC");
  // drop-downs
  const fold = (n) => M.q(`[data-pc-fold="${n}"]`);
  check("CHART is a drop-down with the purple arrow, open by default", fold("chart") && fold("chart").tagName === "DETAILS" && fold("chart").open && M.q('[data-pc-fold-toggle="chart"] [data-arrow]').dataset.arrow === "open" && fold("chart").contains(M.q("[data-pc-chart]")));
  check("CROSS-CHECK is a drop-down with the purple arrow, closed by default", fold("xcheck") && !fold("xcheck").open && M.q('[data-pc-fold-toggle="xcheck"] [data-arrow]').dataset.arrow === "closed" && fold("xcheck").contains(M.pc("x0itt")));
  check("arrows are the shared purple ExpandArrow (22 px)", /181, 124, 255|#b57cff/i.test(M.q('[data-pc-fold-toggle="chart"] [data-arrow]').style.border) && M.q('[data-pc-fold-toggle="chart"] [data-arrow]').style.width === "22px");
  M.click(M.q('[data-pc-fold-toggle="chart"]')); await sleep(80);
  check("tap CHART → minimised (arrow closed), chart still in the page", !fold("chart").open && M.q('[data-pc-fold-toggle="chart"] [data-arrow]').dataset.arrow === "closed" && !!M.q("[data-pc-chart]"));
  M.click(M.q('[data-pc-fold-toggle="xcheck"]')); await sleep(80);
  check("tap CROSS-CHECK → opens", fold("xcheck").open && M.q('[data-pc-fold-toggle="xcheck"] [data-arrow]').dataset.arrow === "open");
  await M.fill({ oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "750", e1ng: "89.9", x0itt: "776" });
  M.click(M.q("[data-pc-record]")); await sleep(800);
  check("recorded check keeps the SRP typed on PWR CHK", M.saved().powerChecks[0].srp === "3007576" && M.saved().powerChecks[0].acReg === "G-KSSC");
  M.click(M.tab("PWR CHK")); await sleep(200);
  check("reopening a check with cross-check figures opens that drop-down", fold("xcheck").open && M.pc("x0itt").value === "776");
  check("CHART stays minimised for the session (a new check doesn't reopen it)", !fold("chart").open);
  M.click(M.q("[data-pc-export]")); await sleep(1200);
  const mb = (await M.shared()).bytes;
  check("PDF with CHART and CROSS-CHECK minimised still has the chart overlay and the cross-check", mb.includes("CROSS-CHECK: OTHER APP") && mb.includes("0.88 0.13 0.11 RG") && mb.includes("(PIC ______________________________) Tj"));

  // ════════ v23: DAY/NIGHT toggle keeps a check that hasn't been recorded ════════
  const T = open(card());
  await sleep(2500);
  T.click(T.btn("A/C DATA")); await sleep(100);
  T.click(T.btn("POWER CHECK")); await sleep(200);
  await T.fill({ oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "775", e1ng: "89.7", srp: "5555" });
  T.click(T.q('[data-pc-addrep="1"]')); await sleep(80);
  await T.fill({ e1ritt: "774", e1rng: "89.8", x0itt: "776" });
  T.click(T.q('[data-pc-fold-toggle="chart"]')); await sleep(60);
  const snap = () => ["oat", "qnh", "e0itt", "e0ng", "e1itt", "e1ng", "e1ritt", "e1rng", "x0itt", "srp", "acReg"].map((k) => (T.pc(k) ? T.pc(k).value : "∅")).join(",");
  const snap0 = snap();
  for (const mode of ["day", "night"]) {
    T.click(T.q('[aria-label="toggle day/night mode"]')); await sleep(300);
    check(`switch to ${mode}: still on PWR CHK FOR: THIS SRP with every figure kept (${snap()})`, T.onPwr() && T.tx("[data-pc-for]") === "FOR: THIS SRP" && snap() === snap0 && T.w.localStorage.getItem("theme") === mode);
    check(`…3-min repeat open, chart still minimised, summary unchanged (${mode})`, !!T.q('[data-pc-repblock="1"]') && !T.q('[data-pc-fold="chart"]').open && T.tx('[data-pc-state="1"]') === "WITHIN LIMITS ON 3-MIN REPEAT");
  }
  check("a typed-over SRP is still kept after the toggle (not overwritten from A/C DATA)", T.pc("srp").value === "5555");
  T.click(T.q("[data-pc-record]")); await sleep(800);
  check("…and RECORD after the toggle saves those figures", T.saved().powerChecks[0].eng[1].rep.itt === "774" && T.saved().powerChecks[0].srp === "5555" && T.onAc());

  check("no script errors in any run", [A, B, G, H, L, M, T].every((X) => X.errors.length === 0));

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
