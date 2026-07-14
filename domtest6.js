const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const rows = [
  { fltTime: "45", shtdwn: "1030", fuel: "380", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" },
  ...Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })),
];
const cur = { date: "11.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4800", plannedFuel: "650", hoursAvail: "", sunriseSet: "", rows, misc: "", powerChecks: [] };
const html = fs.readFileSync("./index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(cur)); } });
const w = dom.window, d = w.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setter = () => Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
(async () => {
  await sleep(2500);
  const res = []; const check = (n, ok) => res.push([n, ok]);

  // NOW hidden on row 1 (has shtdwn), visible on row 2 (empty)
  const nowBtns = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "NOW");
  check("exactly one NOW (row with time hides it)", nowBtns.length === 1);

  // hours field + power check now on A/C DATA page
  [...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="A/C DATA")
    .dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  await sleep(300);
  const inputs = [...d.querySelectorAll("input")];
  // hours field is the one with inputmode numeric whose sanitised "934" becomes "9:34"
  let hoursOk = false;
  for (const inp of inputs) {
    setter().call(inp, "934");
    inp.dispatchEvent(new w.Event("input", { bubbles: true }));
    await sleep(50);
    if (inp.value === "9:34") { hoursOk = true; check("hours input is numeric pad", inp.getAttribute("inputmode") === "numeric"); break; }
    setter().call(inp, ""); inp.dispatchEvent(new w.Event("input", { bubbles: true }));
  }
  check("934 formats to 9:34", hoursOk);
  await sleep(200);
  check("AVAILABLE shows 9:34", d.getElementById("root").textContent.includes("9:34"));

  // open power check panel → OAT numeric + ± toggle
  const pcBtn = [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "POWER CHECK");
  pcBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(400);
  const pm = [...d.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "toggle temperature sign");
  check("± toggle exists", !!pm);
  const oatInput = pm && pm.parentElement.querySelector("input");
  check("OAT numeric pad", oatInput && oatInput.getAttribute("inputmode") === "numeric");
  setter().call(oatInput, "15"); oatInput.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(50);
  pm.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(100);
  check("sign flips to -15", oatInput.value === "-15");
  setter().call(oatInput, "-12"); oatInput.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(50);
  check("typing keeps sign (-12)", oatInput.value === "-12");
  pm.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(100);
  check("flips back to 12", oatInput.value === "12");

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
