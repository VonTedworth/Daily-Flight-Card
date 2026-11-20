// FLIGHTS — v28: a departure weight over 4600 kg (SRP notation) is underlined in cyan; not amber,
// because it is a paperwork note, not a fault. Same rule as the PDF's NOTE ON SRP line.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (o = {}) => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "", ...o });
const card = (rows, extra = {}) => ({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4700", varField: "4800", vertField: "4750", plannedFuel: "650",
  hoursAvail: "9:00", sunriseSet: "", rows: [...rows, ...Array.from({ length: 7 - rows.length }, () => mk())], misc: "", powerChecks: [], ...extra });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);
const CYAN_N = /57, 208, 232|#39d0e8/i, CYAN_D = /7, 91, 109|#075b6d/i, AMBER = /255, 179, 71|#ffb347/i, GREY = /143, 163, 179|#8fa3b3/i;

function open(c, theme) {
  const errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(c));
      if (theme) w.localStorage.setItem("theme", theme);
    } });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s);
  const fig = (i) => q(`[data-depgw="${i}"]`) && q(`[data-depgw="${i}"]`).firstElementChild;
  const line = (i) => (q(`[data-depgw="${i}"]`) ? q(`[data-depgw="${i}"]`).textContent : "");
  return { w, d, q, fig, line, errors };
}
const underlined = (el) => !!el && el.style.textDecoration.includes("underline");

(async () => {
  // GW DEP 4700, planned 650.  F1 departs on planned → 4700.  F2 is a 0-minute ground run departing
  // on 560 → 4610 (no takeoff → no note).  F3 departs on 540 → 4590 (not over).
  const A = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" }), mk({ fltTime: "0", shtdwn: "1030", fuel: "540" }), mk({ fltTime: "30", shtdwn: "1200", fuel: "500" })]));
  await sleep(2500);
  check(`flight 1 at 4700: underlined, cyan, marked for the SRP ("${A.line(0)}")`, A.line(0).startsWith("DEP GW 4700KG") && underlined(A.fig(0)) && CYAN_N.test(A.fig(0).style.color) && A.fig(0).getAttribute("data-srp-note") === "0");
  check("the sideways-scroll box leaves 4 px below the line, so the underline is not clipped (seen clipped in Chrome without it)", A.q('[data-depgw="0"]').parentElement.style.paddingBottom === "4px");
  check("…not amber, and the line wording is unchanged (no extra text)", !AMBER.test(A.fig(0).style.color) && A.line(0) === "DEP GW 4700KG · VAR +100 · VERT +50");
  check(`flight 2, a 0-minute ground run at 4610: not underlined, grey ("${A.line(1)}")`, A.line(1).startsWith("DEP GW 4610KG") && !underlined(A.fig(1)) && GREY.test(A.fig(1).style.color) && !A.fig(1).hasAttribute("data-srp-note"));
  check(`flight 3 at 4590: not underlined, grey ("${A.line(2)}")`, A.line(2).startsWith("DEP GW 4590KG") && !underlined(A.fig(2)) && GREY.test(A.fig(2).style.color));

  const B = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" })], { gwDep: "4600" }));
  await sleep(2500);
  check("exactly 4600: not underlined (strictly over 4600, as the PDF)", B.line(0).startsWith("DEP GW 4600KG") && !underlined(B.fig(0)) && GREY.test(B.fig(0).style.color));

  const P = open(card([], { gwDep: "4650" })); // nothing flown yet: the first flight's planned departure
  await sleep(2500);
  check(`planned first flight (FLT MIN still empty) at 4650: underlined before departure (${P.line(0) || "no line"})`, P.line(0).startsWith("DEP GW 4650KG") && underlined(P.fig(0)));

  const C = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" })], { gwDep: "4870" }));
  await sleep(2500);
  check(`over AUM (4870): stays bold amber — OVER AUM, and underlined too (also over 4600) ("${C.line(0)}")`, C.line(0).startsWith("DEP GW 4870KG — OVER AUM") && AMBER.test(C.fig(0).style.color) && C.fig(0).style.fontWeight === "700" && underlined(C.fig(0)));

  const D = open(card([mk({ fltTime: "20", shtdwn: "1000", fuel: "560" })]), "day");
  await sleep(2500);
  check("day theme: the day cyan", underlined(D.fig(0)) && CYAN_D.test(D.fig(0).style.color));

  check("no script errors", [A, B, P, C, D].every((x) => x.errors.length === 0));
  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
