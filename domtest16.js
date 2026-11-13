// IFR FUEL tab — UI tests against the built index.html.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyRows = () => Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }));
const card = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "4550",
  plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] };

let netCalls = 0;
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.localStorage.setItem("daily-flight-card", JSON.stringify(card));
    // any network attempt by the app is a failure of the offline-first invariant
    w.fetch = () => { netCalls++; return Promise.reject(new Error("network")); };
    w.XMLHttpRequest = function () { netCalls++; throw new Error("network"); };
    w.WebSocket = function () { netCalls++; throw new Error("network"); };
    w.navigator.sendBeacon = () => { netCalls++; return false; };
  } });
const w = dom.window, d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
const scen = (id) => d.querySelector(`button[data-scenario="${id}"]`);
const btn = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
const text = () => d.getElementById("root").textContent;
// IFR FUEL site dropdowns all start with a "SELECT" placeholder (the AC REG select does not)
const selects = () => [...d.querySelectorAll("select")].filter((s) => s.options[0] && s.options[0].textContent === "SELECT");
const selBy = (lab) => [...d.querySelectorAll("label")].find((l) => l.querySelector("span > span")?.textContent === lab)?.querySelector("select");
const setSelect = async (sel, v) => { sel.value = v; sel.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(80); };
const inputSetter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
const setInput = async (el, v) => { inputSetter.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(80); };
const fobInput = () => [...d.querySelectorAll("input")].find((i) => i.previousElementSibling?.textContent?.trim() === "FUEL ON BOARD KG");
const lineEl = (k) => d.querySelector(`[data-line="${k}"]`);
const verdictEl = () => d.querySelector("[data-verdict]");

(async () => {
  await sleep(2500);
  const res = [];
  const check = (n, ok) => res.push([n, !!ok]);

  // ── tab bar ──
  const labels = [...d.querySelectorAll("button")].slice(0, 5).map((b) => b.textContent.trim());
  check("tab bar: A/C DATA · FLIGHTS · UPLIFT · IFR FUEL", labels.slice(0, 4).join("|") === "A/C DATA|FLIGHTS|UPLIFT|IFR FUEL");
  check("tab labels never wrap (nowrap)", [...d.querySelectorAll("button")].slice(0, 4).every((b) => b.style.whiteSpace === "nowrap"));

  // ── empty state ──
  click(btn("IFR FUEL")); await sleep(200);
  check("empty state: calm 'select origin and destination'", verdictEl().textContent.includes("SELECT ORIGIN AND DESTINATION"));
  check("empty state: no breakdown table yet", !lineEl("trip"));
  check("disclaimer shown", text().includes("Planning cross-check only — not a certified flight-planning tool. Verify against the OFP and current plates."));
  let [selO, selD, selA] = selects();
  check("three dropdowns: origin, destination, alternate", !!selO && !!selD && !!selA);
  check("Redhill selectable as origin only", [...selO.options].some((o) => o.value === "EGKR") && ![...selD.options, ...selA.options].some((o) => o.value === "EGKR"));
  check("scenario strip VMC · A · B · C · D", ["VMC", "A", "B", "C", "D"].every((s) => !!scen(s)));
  check("scenario buttons carry a plan-type hint (A: NO ALTN / 2 APPS, B: 1 ALTN, D: 2 ALTN)", scen("A").textContent.includes("NO ALTN") && scen("A").textContent.includes("2 APPS") && scen("B").textContent.includes("1 ALTN") && scen("D").textContent.includes("2 ALTN"));
  check("scenario descriptor shown (default B)", text().includes("One alternate."));

  // ── worked example: Redhill → Shoreham, altn Gatwick, B, 500 kg ──
  await setSelect(selO, "EGKR");
  [selO, selD, selA] = selects();
  await setSelect(selD, "EGKA");
  [selO, selD, selA] = selects();
  check("origin hidden from destination list", ![...selD.options].some((o) => o.value === "EGKR"));
  await setSelect(selA, "EGKK");
  await setInput(fobInput(), "500");
  const t = text();
  check("distances shown: trip 23 NM, diversion 19 NM", t.includes("23 NM") && t.includes("19 NM"));
  check("table lines present: start, trip, alternate, contingency, reserve, approaches, discretionary",
    ["startTaxi", "trip", "alternate", "contingency", "finalReserve", "approaches", "discretionary"].every((k) => !!lineEl(k)));
  const kgOf = (k) => parseInt([...lineEl(k).children].pop().textContent || [...lineEl(k).children].pop().querySelector("input")?.value, 10);
  check("trip 50 kg, alternate 41 kg", kgOf("trip") === 50 && kgOf("alternate") === 41);
  const req = parseInt(lineEl("required").lastElementChild.textContent, 10);
  check(`REQUIRED ≈ 415 (${req})`, Math.abs(req - 415) <= 2);
  check("verdict ENOUGH +margin (≈ +85)", /ENOUGH \+8[3-7] KG/.test(verdictEl().textContent));
  const greenColor = verdictEl().style.color;
  check("table headings SERIAL/REQUIREMENT/L/KG order", ["#", "REQUIREMENT", "L", "KG"].every((h) => t.includes(h)));
  check("L column = kg ÷ 0.79 (trip 63 L)", lineEl("trip").textContent.includes("63"));

  // ── SHORT ──
  await setInput(fobInput(), "300");
  check("SHORT with negative margin", /SHORT -\d+ KG/.test(verdictEl().textContent));
  check("SHORT is amber, ENOUGH was green (different colours)", verdictEl().style.color !== greenColor);
  // ── engine-failure note ──
  await setInput(fobInput(), String(req + 40));
  check("engine-failure amber note when margin 0–74", text().includes("ENGINE-FAILURE 15-MIN HOLD (75 KG)"));
  await setInput(fobInput(), "500");

  // ── stepper ──
  const inc = [...d.querySelectorAll('button[aria-label="more approaches"]')][0];
  click(inc); await sleep(80);
  check("approach stepper +: 3 approaches, 210 kg", kgOf("approaches") === 210);
  const dec = [...d.querySelectorAll('button[aria-label="fewer approaches"]')][0];
  click(dec); click(dec); await sleep(80);
  check("approach stepper −: 1 approach, 70 kg", kgOf("approaches") === 70);

  // ── scenario A ──
  click(scen("A")); await sleep(120);
  check("A: no Alternate line and no alternate dropdown", !lineEl("alternate") && selects().length === 2);
  check("A: PinS / 2-app 70 kg line present", !!lineEl("pins") && kgOf("pins") === 70);
  check("A: approaches reset to scenario default 2", kgOf("approaches") === 140);
  // ── scenario VMC ──
  click(scen("VMC")); await sleep(120);
  check("VMC: no Alternate, no PinS, approaches default 1", !lineEl("alternate") && !lineEl("pins") && kgOf("approaches") === 70);
  // ── scenario D ──
  click(scen("D")); await sleep(120);
  check("D: two alternate dropdowns (4 selects incl. origin/dest), approaches default 3", selects().length === 4 && kgOf("approaches") === 210);
  check("D with no alternates chosen: asks for both", verdictEl().textContent.includes("SELECT BOTH ALTERNATES"));
  check("D: ALTERNATE 1 / ALTERNATE 2 labels", !!selBy("ALTERNATE 1") && !!selBy("ALTERNATE 2"));
  await setSelect(selBy("ALTERNATE 1"), "EGKK");
  await setSelect(selBy("ALTERNATE 2"), "EGMD");
  check("D: alternate line names the chain EGKA → EGKK → EGMD", lineEl("alternate").textContent.includes("EGKA → EGKK → EGMD"));
  check("D: ALTERNATE 2 distance is quoted FROM alternate 1", text().includes("NM FROM EGKK"));
  // ── back to B, alternate missing → asks ──
  click(scen("B")); await sleep(120);
  check("back to B: single ALTERNATE dropdown, Gatwick kept (41 kg)", selects().length === 3 && selBy("ALTERNATE").value === "EGKK" && kgOf("alternate") === 41);

  // ── other tabs unaffected ──
  click(btn("FLIGHTS")); await sleep(200);
  check("FLIGHTS tab still renders after visiting IFR FUEL", text().includes("FLT MIN") && text().includes("DEP GW 4600KG"));
  click(btn("A/C DATA")); await sleep(200);
  check("A/C DATA tab still renders (VERT TOW present)", text().includes("VERT TOW KG"));
  click(btn("UPLIFT")); await sleep(200);
  check("UPLIFT tab still renders", text().includes("FUEL UPLIFT"));
  check("version stamp still shown", /v\d+ · \d{2}\.\d{2}\.\d{4}/.test(text()));

  // ── offline invariant ──
  check("IFR FUEL made no network calls (fetch/XHR/WebSocket/beacon)", netCalls === 0);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
