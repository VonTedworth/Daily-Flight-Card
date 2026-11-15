// IFR FUEL — multi-sector screen, UI tests against the built index.html (brief §4–§6).
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyRows = () => Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }));
const CARD = JSON.stringify({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "4550",
  plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

function open(storedTrip) {
  let net = 0;
  const errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", CARD);
      if (storedTrip !== undefined) w.localStorage.setItem("ifr-fuel-trip", storedTrip);
      w.fetch = () => { net++; return Promise.reject(new Error("network")); };
      w.XMLHttpRequest = function () { net++; throw new Error("network"); };
      w.WebSocket = function () { net++; throw new Error("network"); };
    } });
  const w = dom.window, d = w.document;
  const q = (sel) => d.querySelector(sel);
  const qa = (sel) => [...d.querySelectorAll(sel)];
  const tx = (sel) => (q(sel) ? q(sel).textContent : "");
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const btn = (t) => qa("button").find((b) => b.textContent.trim() === t);
  const setSelect = async (el, v) => { el.value = v; el.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(60); };
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  const type = async (el, v) => { setter.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(60); };
  const mins = () => qa("[data-min]").map((e) => e.textContent.trim());
  const stopSel = (i) => q(`select[aria-label="stop ${i + 1}"]`);
  return { w, d, q, qa, tx, click, btn, setSelect, type, mins, stopSel, net: () => net, errors, store: () => w.localStorage.getItem("ifr-fuel-trip"), card: () => w.localStorage.getItem("daily-flight-card") };
}

(async () => {
  const A = open();
  await sleep(2500);
  const { q, qa, tx, click, btn, setSelect, type, mins, stopSel } = A;
  click(btn("IFR FUEL")); await sleep(200);

  // ── default trip ──
  check("default trip: 4 stop cards EGKR · EGKD · EGKC · EGKR", qa("[data-stop]").length === 4 && [0, 1, 2, 3].map((i) => stopSel(i).value).join() === "EGKR,EGKD,EGKC,EGKR");
  check("3 collapsed sector lines between the cards", qa("[data-sector-line]").length === 3);
  check("headline: REQUIRED TO LIFT EGKR 759 KG", tx("[data-headline]").includes("REQUIRED TO LIFT EGKR") && tx("[data-headline]").includes("759 KG"));
  check("no fuel entered yet: calm 'ENTER FUEL AT EGKR', no ENOUGH/SHORT", tx("[data-verdict]") === "ENTER FUEL AT EGKR");
  check("MIN TO LIFT 759 · 565 · 365", mins().join() === "759,565,365");
  check("first stop shows no margin until fuel is entered", tx('[data-margin="0"]') === "—");
  check("last stop shows only PLANNED ON LANDING", !q('[data-stop="3"] [data-min]') && !!q("[data-landing]"));
  check("collapsed view: exactly three numbers per stop (min, actual, margin)", [0, 1, 2].every((i) => qa(`[data-stop="${i}"] [data-min], [data-stop="${i}"] [data-actual], [data-stop="${i}"] [data-margin]`).length === 3 && qa(`[data-stop="${i}"] input`).length === 1));
  check("sector line: → EGKD · 39 nm · C · ALTN EGMD · 194 KG", tx('[data-sector-line="0"]').includes("→ EGKD · 39 nm · C · ALTN EGMD") && tx('[data-sector-line="0"]').includes("194 KG"));
  check("sector lines 2 and 3 name EGLC and EGKK; burns 200 and 136", tx('[data-sector-line="1"]').includes("ALTN EGLC") && tx('[data-sector-line="1"]').includes("200 KG") && tx('[data-sector-line="2"]').includes("ALTN EGKK") && tx('[data-sector-line="2"]').includes("136 KG"));
  check("PLANNED tag on Redhill; CONFIRM on William Harvey and King's", tx('[data-stop="0"] [data-status]') === "PLANNED" && tx('[data-stop="1"] [data-status]') === "CONFIRM" && tx('[data-stop="2"] [data-status]') === "CONFIRM");
  check("tagged sites remain selectable", stopSel(0).value === "EGKR" && [...stopSel(1).options].some((o) => o.value === "EGKR"));
  check("stop list = IFR airfields + PinS sites only (no plain hospitals or VFR refuel points)", (() => { const v = [...stopSel(0).options].map((o) => o.value); return v.includes("EGSS") && v.includes("EGGB") && v.includes("EGKD") && !v.some((x) => /^H_/.test(x)) && !v.includes("EGMH") && !v.includes("EGTO"); })());
  check("no REFUEL HERE at William Harvey (no fuel there yet)", !q('[data-stop="1"] [data-refuel]'));
  check("no 'what if fuel at William Harvey' control shipped", !A.d.getElementById("root").textContent.toUpperCase().includes("WHAT IF"));
  check("disclaimer shown", A.d.getElementById("root").textContent.includes("Planning cross-check only — not a certified flight-planning tool"));

  // ── fuel entered ──
  await type(q('[data-actual="0"]'), "820");
  check("820 kg at EGKR: ENOUGH +61 KG", tx("[data-verdict]") === "ENOUGH +61 KG");
  check("planned figures flow forward (placeholders 'plan 626', 'plan 426')", q('[data-actual="1"]').placeholder === "plan 626" && q('[data-actual="2"]').placeholder === "plan 426");
  check("planned landing fuel 290 KG", tx("[data-landing]") === "290 KG");
  check("margins +61 at EGKD and EGKC", tx('[data-margin="1"]') === "+61" && tx('[data-margin="2"]') === "+61");
  await type(q('[data-actual="1"]'), "400");
  check("400 at EGKD (min 565): margin −165 and the amber BELOW MINIMUM message", tx('[data-margin="1"]') === "-165" && tx('[data-warn="1"]').includes("BELOW MINIMUM — IFR DEPARTURE NOT AVAILABLE. REFUEL BEFORE CONTINUING, OR HOLD FOR WEATHER."));
  check("later planned figures follow the entered value (EGKC plan 200, landing 64 KG)", q('[data-actual="2"]').placeholder === "plan 200" && tx("[data-landing]") === "64 KG");
  await type(q('[data-actual="0"]'), "700");
  check("start fuel below the requirement: SHORT -59 KG", tx("[data-verdict]") === "SHORT -59 KG");
  await type(q('[data-actual="1"]'), ""); await type(q('[data-actual="0"]'), "820");

  // ── sector details ──
  click(q('[data-sector-line="0"]')); await sleep(80);
  const det = q('[data-detail="0"]');
  check("tapping a sector line opens its details", !!det);
  const chip = (i, c) => q(`[data-chip="${i}:${c}"]`);
  check("PinS destination: only C and D offered (VMC, A, B disabled); C selected", ["VMC", "A", "B"].every((c) => chip(0, c).disabled) && !chip(0, "C").disabled && !chip(0, "D").disabled && chip(0, "C").getAttribute("aria-pressed") === "true");
  check("profile chips carry their hints (C: 1 ALTN +800M, D: 2 ALTN FARTHER)", chip(0, "C").textContent.includes("1 ALTN") && chip(0, "C").textContent.includes("+800M") && chip(0, "D").textContent.includes("FARTHER"));
  check("description explains why VMC/A/B are not offered for PinS", det.textContent.includes("PinS destination: VMC, A and B not offered (OMA 8.3.2.7.7"));
  check("approaches lines for the destination and the alternate", tx('[data-detail="0"] [data-approaches="EGKD"]').includes("PinS (CONFIRM)") && tx('[data-detail="0"] [data-approaches="EGMD"]').includes("ILS 21 · RNP 21 · NDB 03"));
  const pick = q('[data-detail="0"] select[data-alt-picker="alt"]');
  check("alternate picker shows EGMD marked 'nearest'", pick.value === "EGMD" && det.textContent.includes("nearest"));
  check("PinS destination: Shoreham is not in the alternate list", ![...pick.options].some((o) => o.value === "EGKA"));
  const kgSum = qa('[data-detail="0"] [data-row]').reduce((a, r) => a + (+r.lastElementChild.textContent || 0), 0);
  check(`table sums to the minimum to lift (${kgSum} = 759)`, kgSum === 759 && q('[data-row-total="0"]').textContent.includes("759"));
  check("onward chain governs: table ends 'Onward — Min to lift EGKD'", qa('[data-detail="0"] [data-row]').pop().textContent.includes("Min to lift EGKD"));
  await setSelect(pick, "EGKK");
  check("choosing an alternate marks it 'chosen'; the minimum stays 759 (onward chain governs)", q('[data-detail="0"]').textContent.includes("chosen") && mins()[0] === "759" && tx('[data-sector-line="0"]').includes("ALTN EGKK"));

  // ── a fourth sector ──
  click(q("[data-add-sector]")); await sleep(80);
  check("+ ADD SECTOR adds a stop (EGKK) and a sector line", qa("[data-stop]").length === 5 && stopSel(4).value === "EGKK" && qa("[data-sector-line]").length === 4);
  check("Gatwick destination defaults to B", tx('[data-sector-line="3"]').includes("· B ·"));
  click(q('[data-sector-line="3"]')); await sleep(80);
  check("Gatwick destination offers all five profiles", ["VMC", "A", "B", "C", "D"].every((c) => !chip(3, c).disabled));
  check("Gatwick destination: Shoreham IS in the alternate list", [...q('[data-detail="3"] select[data-alt-picker="alt"]').options].some((o) => o.value === "EGKA"));
  // sector 0 still has a chosen alternate (EGKK); set it back so the brief's numbers apply
  await setSelect(q('[data-detail="0"] select[data-alt-picker="alt"]'), "EGMD");
  for (const [c, want] of [["VMC", "790,596,396,260"], ["A", "930,736,536,400"], ["D", "901,707,507,371"]]) {
    click(chip(3, c)); await sleep(60);
    check(`profile ${c} on EGKR→EGKK: ${want}`, mins().join() === want);
  }
  check("D shows a 2nd alternate picker (EGKB + EGKA)", q('[data-detail="3"] select[data-alt-picker="alt"]').value === "EGKB" && q('[data-detail="3"] select[data-alt-picker="alt2"]').value === "EGKA" && tx('[data-sector-line="3"]').includes("ALTN EGKB+EGKA"));
  await setSelect(stopSel(4), "EGKA");
  check("changing a destination resets that sector's profile to its default (Shoreham → B)", tx('[data-sector-line="3"]').includes("· B ·"));
  check("Shoreham destination: A not offered", chip(3, "A").disabled && !chip(3, "B").disabled);
  await setSelect(stopSel(4), "EGKK");

  // ── refuel stop ──
  check("REFUEL HERE offered at a mid-trip stop with fuel (Redhill, stop 4)", !!q('[data-stop="3"] [data-refuel]') && !q('[data-stop="0"] [data-refuel]') && !q('[data-stop="4"] [data-refuel]'));
  const before = mins()[2];
  click(q('[data-stop="3"] [data-refuel]')); await sleep(80);
  check("REFUEL HERE on: input becomes AFTER REFUEL KG", q('[data-stop="3"]').textContent.includes("AFTER REFUEL KG"));
  check("…and shows ARRIVE WITH n KG plus the uplift (or no uplift needed)", /FUEL STOP — ARRIVE WITH \d+ KG · (UPLIFT AT LEAST \d+ KG|NO UPLIFT NEEDED TO CONTINUE)/.test(tx("[data-refuel-msg]")));
  check("…and breaks the chain: EGKC's minimum drops to its own requirement", +mins()[2] < +before);
  click(q('[data-stop="3"] [data-refuel]')); await sleep(80);
  check("REFUEL HERE off restores the chain", mins()[2] === before);

  // ── remove stops ──
  click(q('[data-remove="4"]')); await sleep(80);
  check("✕ removes a stop", qa("[data-stop]").length === 4 && mins().join() === "759,565,365");
  click(q('[data-remove="3"]')); await sleep(60); click(q('[data-remove="2"]')); await sleep(60);
  check("minimum two stops: no ✕ when only two remain", qa("[data-stop]").length === 2 && qa("[data-remove]").length === 0);

  // ── persistence + RESET TRIP ──
  const stored = JSON.parse(A.store());
  check("trip persisted under its own key (ifr-fuel-trip)", Array.isArray(stored.stops) && stored.stops.length === 2 && stored.actual[0] === "820");
  check("the flight card's storage is untouched", A.card() === CARD);
  const B = open(A.store());
  await sleep(2500);
  B.click(B.btn("IFR FUEL")); await sleep(200);
  check("reopening the app restores the stored trip", B.qa("[data-stop]").length === 2 && B.q('[data-actual="0"]').value === "820");
  click(q("[data-reset]")); await sleep(60);
  check("RESET TRIP asks first", !!q("[data-reset-confirm]") && qa("[data-stop]").length === 2);
  click(q("[data-reset-cancel]")); await sleep(60);
  check("cancel keeps the trip", qa("[data-stop]").length === 2);
  click(q("[data-reset]")); await sleep(60); click(q("[data-reset-confirm]")); await sleep(80);
  check("RESET restores the default trip with nothing entered", mins().join() === "759,565,365" && q('[data-actual="0"]').value === "" && JSON.parse(A.store()).stops.join() === "EGKR,EGKD,EGKC,EGKR");
  check("RESET leaves the flight card's storage untouched", A.card() === CARD);

  // ── robustness ──
  const C = open("{not json");
  await sleep(2500);
  C.click(C.btn("IFR FUEL")); await sleep(200);
  check("corrupt stored trip: falls back to the default trip, no crash", C.mins().join() === "759,565,365" && C.errors.length === 0);
  const D = open(JSON.stringify({ stops: ["EGKR", "NOPE"] }));
  await sleep(2500);
  D.click(D.btn("IFR FUEL")); await sleep(200);
  check("stored trip naming an unknown site: falls back to the default trip", D.mins().join() === "759,565,365");

  // ── other tabs + offline ──
  click(btn("FLIGHTS")); await sleep(150);
  check("FLIGHTS tab unaffected", A.d.getElementById("root").textContent.includes("FLT MIN"));
  click(btn("A/C DATA")); await sleep(150);
  check("A/C DATA tab unaffected", A.d.getElementById("root").textContent.includes("VERT TOW KG"));
  click(btn("UPLIFT")); await sleep(150);
  check("UPLIFT tab unaffected", A.d.getElementById("root").textContent.includes("FUEL UPLIFT"));
  check("no runtime network calls", A.net() === 0 && B.net() === 0);
  check("no script errors", A.errors.length === 0 && B.errors.length === 0);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
