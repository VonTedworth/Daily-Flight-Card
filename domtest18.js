// IFR FUEL — switching scenario must reset alternates the new scenario doesn't use
// (no stale selections, no stale colours on the map).
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyRows = () => Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }));
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.localStorage.setItem("daily-flight-card", JSON.stringify({ date: "14.07.2026", acReg: "G-KSST", srp: "1", gwDep: "4600", varField: "4650", vertField: "", plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] }));
  } });
const w = dom.window, d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
const scen = (id) => d.querySelector(`button[data-scenario="${id}"]`);
const marker = (id) => d.querySelector(`g[data-site="${id}"]`);
const selBy = (lab) => [...d.querySelectorAll("label")].find((l) => l.querySelector("span > span")?.textContent === lab)?.querySelector("select");
const svg = () => d.querySelector('svg[role="img"]');
const isSel = (id) => marker(id).getAttribute("aria-label").includes("selected");
const ring = (id) => marker(id).querySelectorAll("circle")[1]; // the visible airfield circle (index 0 is the tap target)
const labelFill = (id) => d.querySelector(`text[data-label="${id}"]`).getAttribute("fill");
const tap = async (id) => { click(marker(id)); await sleep(80); };
const text = () => d.getElementById("root").textContent;

(async () => {
  await sleep(2500);
  const res = [];
  const check = (n, ok) => res.push([n, !!ok]);
  click([...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "IFR FUEL")); await sleep(200);

  // Ed's sequence: D, Redhill → Biggin Hill, alternate 1 Shoreham, alternate 2 Southend
  click(scen("D")); await sleep(120);
  await tap("EGKR"); await tap("EGKB"); await tap("EGKA"); await tap("EGMC");
  check("D: all four fields selected (Redhill, Biggin Hill, Shoreham, Southend)",
    selBy("ORIGIN").value === "EGKR" && selBy("DESTINATION").value === "EGKB" && selBy("ALTERNATE 1").value === "EGKA" && selBy("ALTERNATE 2").value === "EGMC");
  check("D: Southend is highlighted on the map", isSel("EGMC") && ring("EGMC").getAttribute("fill") !== "none");
  const unselectedLabel = labelFill("EGLL");
  check("D: Southend's label is in the selected colour", labelFill("EGMC") !== unselectedLabel);
  check("D: three route legs drawn", svg().querySelectorAll("line").length === 3);

  // → B: Southend must reset
  click(scen("B")); await sleep(120);
  check("B: the second-alternate dropdown is gone", !selBy("ALTERNATE 2") && !!selBy("ALTERNATE"));
  check("B: alternate 1 (Shoreham) is kept", selBy("ALTERNATE").value === "EGKA" && isSel("EGKA"));
  check("B: Southend is no longer highlighted (no selected state)", !isSel("EGMC"));
  check("B: Southend's marker is back to a hollow airfield circle", ring("EGMC").getAttribute("fill") === "none");
  check("B: Southend's label is back to the unselected colour", labelFill("EGMC") === unselectedLabel);
  check("B: only the two legs drawn (origin→dest, dest→alternate)", svg().querySelectorAll("line").length === 2);
  check("B: Origin and destination colours untouched", isSel("EGKR") && isSel("EGKB"));

  // tapping Southend now must not be hijacked by a stale hidden selection
  await tap("EGMC");
  check("B: tapping Southend (all roles full) just explains, changes nothing", /All roles set/.test(text()) && !isSel("EGMC") && selBy("ALTERNATE").value === "EGKA");

  // → back to D: alternate 2 comes back empty, not Southend
  click(scen("D")); await sleep(120);
  check("D again: alternate 2 starts empty (reset, not resurrected)", selBy("ALTERNATE 2").value === "" && !isSel("EGMC"));
  check("D again: alternate 1 still Shoreham", selBy("ALTERNATE 1").value === "EGKA");
  await tap("EGMC");
  check("D again: tapping Southend refills alternate 2", selBy("ALTERNATE 2").value === "EGMC" && isSel("EGMC"));

  // → C keeps alternate 1, drops alternate 2
  click(scen("C")); await sleep(120);
  check("C: keeps alternate 1, drops alternate 2", selBy("ALTERNATE").value === "EGKA" && !selBy("ALTERNATE 2") && !isSel("EGMC"));

  // → A: no alternates at all
  click(scen("A")); await sleep(120);
  check("A: no alternate dropdowns", !selBy("ALTERNATE") && !selBy("ALTERNATE 1"));
  check("A: Shoreham no longer highlighted either", !isSel("EGKA") && ring("EGKA").getAttribute("fill") === "none");
  check("A: only the origin→destination leg remains", svg().querySelectorAll("line").length === 1);
  check("A: origin and destination still selected", isSel("EGKR") && isSel("EGKB") && selBy("ORIGIN").value === "EGKR" && selBy("DESTINATION").value === "EGKB");
  check("A: no Alternate line in the table", !d.querySelector('[data-line="alternate"]'));

  // → B again: asks for an alternate (calm), nothing pre-filled
  click(scen("B")); await sleep(120);
  check("A → B: alternate dropdown is empty and the verdict asks for it", selBy("ALTERNATE").value === "" && d.querySelector("[data-verdict]").textContent.includes("SELECT ALTERNATE"));
  check("no approaches info line for an unselected alternate", !d.querySelector('[data-approaches="EGKA"]') || d.querySelector('[data-approaches="EGKA"]') === null);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
