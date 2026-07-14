const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");

const rows = (flt) => [
  { fltTime: flt, shtdwn: "1030", fuel: "380", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" },
  ...Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })),
];
const cur = { date: "11.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4800", plannedFuel: "650", hoursAvail: "8:00", sunriseSet: "", rows: rows("45"), misc: "", powerChecks: [] };
const old = { ...cur, date: "10.07.2026", srp: "1200", rows: rows("30") };

const html = fs.readFileSync("./index.html", "utf8");
const dom = new JSDOM(html, {
  runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.localStorage.setItem("daily-flight-card", JSON.stringify(cur));
    w.localStorage.setItem("card-history", JSON.stringify([old]));
  },
});
const w = dom.window, d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
const findBtn = (txt) => [...d.querySelectorAll("button")].find((b) => b.textContent.includes(txt));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(2500);
  // history controls live on the A/C DATA page now
  click([...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="A/C DATA")); await sleep(300);
  const results = [];
  const check = (name, ok) => { results.push([name, ok]); };

  // Open the previous card
  const hist = findBtn("10.07.2026");
  check("history button exists", !!hist);
  click(hist); await sleep(300);
  let t = d.getElementById("root").textContent;
  check("banner shows", t.includes("PREVIOUS CARD 1 OF 1"));
  check("old card loaded (SRP 1200)", [...d.querySelectorAll("input")].some((i) => i.value === "1200"));
  check("export-only button", !!findBtn("EXPORT PDF (THIS CARD)"));
  check("no NEW CARD in history mode", ![...d.querySelectorAll("button")].some((b) => b.textContent.trim() === "NEW CARD"));

  // Edit the old card's SRP
  const srpInput = [...d.querySelectorAll("input")].find((i) => i.value === "1200");
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  setter.call(srpInput, "1201");
  srpInput.dispatchEvent(new w.Event("input", { bubbles: true }));
  await sleep(900); // let debounce save

  // Back to today
  click(findBtn("CURRENT CARD")); await sleep(400);
  t = d.getElementById("root").textContent;
  check("back on current (SRP 1234)", [...d.querySelectorAll("input")].some((i) => i.value === "1234"));
  const savedHist = JSON.parse(w.localStorage.getItem("card-history"));
  check("edit persisted to history", savedHist[0].srp === "1201");
  const savedCur = JSON.parse(w.localStorage.getItem("daily-flight-card"));
  check("current card untouched", savedCur.srp === "1234");

  // NEW CARD archives current
  click(findBtn("NEW CARD")); await sleep(200);
  click(findBtn("CLEAR WITHOUT PDF")); await sleep(900);
  const h2 = JSON.parse(w.localStorage.getItem("card-history"));
  check("archive: 2 cards now", h2.length === 2);
  check("newest first (SRP 1234)", h2[0].srp === "1234");
  t = d.getElementById("root").textContent;
  check("fresh card on screen", t.includes("PREVIOUS CARDS"));

  let fail = 0;
  for (const [n, ok] of results) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
