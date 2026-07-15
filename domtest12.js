const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyRow = () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" });
const emptyRows = () => Array.from({ length: 7 }, emptyRow);

function makeDom(card) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://x.github.io/",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(card)); },
  });
  return dom;
}

const goToAcData = async (d, w) => {
  [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "A/C DATA")
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(300);
};

// span whose trimmed text exactly matches `label`, then its value sibling
const marginValue = (d, label) => {
  const span = [...d.querySelectorAll("span")].find((s) => s.textContent.trim() === label);
  return span ? span.nextElementSibling : null;
};

(async () => {
  const res = [];
  const check = (n, ok) => res.push([n, ok]);

  // ── A: worked example — GW DEP 4600, VAR TOW 4650, VERT TOW 4550 ──
  {
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "4550",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] };
    const dom = makeDom(cur);
    await sleep(2500);
    const d = dom.window.document, w = dom.window;
    await goToAcData(d, w);
    const varVal = marginValue(d, "VAR");
    const vertVal = marginValue(d, "VERT");
    check("VAR margin shows +50", !!varVal && varVal.textContent.trim() === "+50");
    check("VERT margin shows -50", !!vertVal && vertVal.textContent.trim() === "-50");
    check("VAR is green, VERT is amber (different colours)", !!varVal && !!vertVal && varVal.style.color !== vertVal.style.color);
  }

  // ── B: VERT TOW empty — VAR margin shows, VERT is an em-dash, no crash ──
  {
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] };
    const dom = makeDom(cur);
    await sleep(2500);
    const d = dom.window.document, w = dom.window;
    await goToAcData(d, w);
    const varVal = marginValue(d, "VAR");
    const vertVal = marginValue(d, "VERT");
    check("no crash: AC DATA page still renders", d.getElementById("root").textContent.includes("AIRCRAFT DATA"));
    check("VAR margin still shows +50 with VERT TOW empty", !!varVal && varVal.textContent.trim() === "+50");
    check("VERT margin is an em-dash when VERT TOW empty", !!vertVal && vertVal.textContent.trim() === "—");
  }

  // ── C: carry-over copies vertField and still increments SRP ──
  {
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "4550",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "0459 / 2113",
      rows: [{ ...emptyRow(), fltTime: "40", shtdwn: "1030", fuel: "500" }, ...emptyRows().slice(1)],
      misc: "", powerChecks: [] };
    const dom = makeDom(cur);
    await sleep(2500);
    const d = dom.window.document, w = dom.window;
    const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    const btn = (txt) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === txt);
    const btnIncl = (txt) => [...d.querySelectorAll("button")].find((b) => b.textContent.includes(txt));
    await goToAcData(d, w);
    click(btnIncl("NEW CARD")); await sleep(200);
    click(btnIncl("CARRY OVER A/C DATA")); await sleep(100);
    click(btn("CLEAR WITHOUT PDF")); await sleep(900);
    const inputs = [...d.querySelectorAll("input")];
    check("SRP incremented to 1235", inputs.some((i) => i.value === "1235"));
    check("VERT TOW carried (4550)", inputs.some((i) => i.value === "4550"));
    check("VAR TOW still carried too (4650)", inputs.some((i) => i.value === "4650"));
  }

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
