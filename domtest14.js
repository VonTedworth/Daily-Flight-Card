const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cur = { date: "24.07.2026", acReg: "", srp: "", gwDep: "", varField: "", vertField: "",
  plannedFuel: "", hoursAvail: "", sunriseSet: "",
  rows: Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })),
  misc: "", powerChecks: [] };
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
  beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(cur)); } });
const w = dom.window, d = w.document;

(async () => {
  await sleep(2500);
  const res = [];
  const check = (n, ok) => res.push([n, ok]);

  check("__BUILD_DATE__ injected by build_html.py", typeof w.__BUILD_DATE__ === "string" && /^\d{2}\.\d{2}\.\d{4}$/.test(w.__BUILD_DATE__));
  const t = d.getElementById("root").textContent;
  check("version stamp (vN) visible on page", /v\d+/.test(t));
  check("build date visible on page", t.includes(w.__BUILD_DATE__));
  // stamp should be present regardless of which tab is showing
  [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "A/C DATA")
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  const t2 = d.getElementById("root").textContent;
  check("version stamp still visible on A/C DATA tab", /v\d+/.test(t2) && t2.includes(w.__BUILD_DATE__));

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
