const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const seedRows = [
  { fltTime: "45", shtdwn: "1030", fuel: "380", notes: "", refuel: false, upliftL: "", hems: true, hemsGrid: "TQ301476", patientKg: "85" },
  ...Array.from({ length: 6 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })),
];
const seedCard = { date: "11.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4800",
  plannedFuel: "650", hoursAvail: "8:00", sunriseSet: "", rows: seedRows, misc: "", powerChecks: [] };
const histCard = { ...seedCard, date: "10.07.2026", srp: "1200" };
const html = fs.readFileSync("./index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
  beforeParse(window) {
    window.localStorage.setItem("daily-flight-card", JSON.stringify(seedCard));
    window.localStorage.setItem("card-history", JSON.stringify([histCard]));
  },
});
setTimeout(() => {
  const d = dom.window.document;
  let t = d.getElementById("root").textContent;
  const flightsChecks = [
    ["flights page renders rows", t.includes("FLT MIN")],
    ["dep GW 4485 (planned fuel basis)", t.includes("DEP GW 4485KG")],
    ["VAR margin +315, no old DEP PERF wording", t.includes("VAR +315") && !t.includes("DEP PERF")],
    ["VERT margin em-dash (vertField unset)", t.includes("VERT —")],
    ["NOW button", t.includes("NOW")],
    ["context bar SRP", t.includes("SRP 1234")],
  ];
  [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "A/C DATA")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  setTimeout(() => {
    t = d.getElementById("root").textContent;
    const acChecks = [
      ["ac page renders", t.includes("AIRCRAFT DATA")],
      ["prev cards section", t.includes("PREVIOUS CARDS (TAP TO VIEW / EDIT)")],
      ["history entry 10.07.2026", t.includes("10.07.2026")],
      ["history flight count", t.includes("1 FLT")],
      ["power check", t.includes("POWER CHECK")],
    ];
    let fail = 0;
    for (const [name, ok] of [...flightsChecks, ...acChecks]) { console.log((ok ? "PASS" : "FAIL") + "  " + name); if (!ok) fail++; }
    process.exit(fail ? 1 : 0);
  }, 400);
}, 3000);
