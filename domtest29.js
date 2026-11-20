// B1 (v29) + the B1 cases of T4: typing then switching DAY/NIGHT within the 600 ms save delay must
// not lose the edit. The toggle remounts every tab; the pending save is written on unmount, so the
// new screen shows the edit, storage holds it, and the next keystroke appends to it.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (o = {}) => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "", ...o });
const card = (extra = {}) => ({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4700", vertField: "4550", plannedFuel: "650",
  hoursAvail: "9:00", sunriseSet: "", rows: [mk({ fltTime: "20", shtdwn: "1000", fuel: "560" }), ...Array.from({ length: 6 }, () => mk())], misc: "", powerChecks: [], duties: {}, ...extra });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

function open(c, history) {
  const errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(c));
      if (history) w.localStorage.setItem("card-history", JSON.stringify(history));
    } });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s), qa = (s) => [...d.querySelectorAll(s)];
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const tab = (t) => [...q("[data-tabbar]").children].find((b) => b.textContent.trim() === t);
  const toggle = () => click(q('[aria-label="toggle day/night mode"]'));
  const setV = (el, v) => {
    const proto = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const misc = () => qa("textarea")[0];
  const fuelIn = (i) => qa("input").filter((x) => x.previousElementSibling?.textContent?.trim() === "FUEL KG")[i];
  const saved = () => JSON.parse(w.localStorage.getItem("daily-flight-card"));
  const hist = () => JSON.parse(w.localStorage.getItem("card-history"));
  return { w, d, q, qa, click, tab, toggle, setV, misc, fuelIn, saved, hist, errors };
}

(async () => {
  // ── MISC ──
  const A = open(card());
  await sleep(2500);
  A.click(A.tab("A/C DATA")); await sleep(150);
  A.setV(A.misc(), "oil checked");
  await sleep(100); // inside the 600 ms save delay
  A.toggle(); await sleep(1500);
  check(`MISC typed then DAY/NIGHT within 0.6 s: screen keeps it ("${A.misc().value}")`, A.misc().value === "oil checked");
  check(`…and storage keeps it ("${A.saved().misc}")`, A.saved().misc === "oil checked");
  A.setV(A.misc(), A.misc().value + " X"); await sleep(900);
  check(`…the next keystroke appends to it ("${A.saved().misc}")`, A.saved().misc === "oil checked X" && A.misc().value === "oil checked X");

  // ── a flight row field (flight 1 FUEL KG) ──
  const B = open(card());
  await sleep(2500);
  B.click(B.tab("FLIGHTS")); await sleep(150);
  B.setV(B.fuelIn(0), "555");
  await sleep(100);
  B.toggle(); await sleep(1500);
  check(`flight 1 FUEL KG typed then toggle: screen keeps 555 ("${B.fuelIn(0).value}")`, B.fuelIn(0).value === "555");
  check(`…storage keeps it ("${B.saved().rows[0].fuel}")`, B.saved().rows[0].fuel === "555");
  B.setV(B.fuelIn(0), B.fuelIn(0).value + "1"); await sleep(900);
  check(`…the next keystroke appends ("${B.saved().rows[0].fuel}")`, B.saved().rows[0].fuel === "5551" && B.fuelIn(0).value === "5551");

  // ── a DUTIES tick ──
  const D = open(card());
  await sleep(2500);
  D.click(D.tab("DUTIES")); await sleep(150);
  D.click(D.q('[data-duty-toggle="winter"]')); await sleep(60);
  D.click(D.q('[data-duty="w.salt"] button[aria-pressed]'));
  await sleep(100);
  D.toggle(); await sleep(1500);
  D.click(D.q('[data-duty-toggle="night"]')); await sleep(60);
  D.click(D.q('[data-duty-toggle="winter"]')); await sleep(60);
  check("DUTIES tick then toggle: still ticked on screen", D.q('[data-duty="w.salt"] button[aria-pressed]').getAttribute("aria-pressed") === "true");
  check(`…storage keeps it (${JSON.stringify(D.saved().duties)})`, D.saved().duties["w.salt"] === true);
  D.click(D.q('[data-duty="notam"] button[aria-pressed]')); await sleep(900);
  check(`…the next tick adds to it (${JSON.stringify(D.saved().duties)})`, JSON.stringify(D.saved().duties) === JSON.stringify({ "w.salt": true, notam: true }));

  // ── an edit on a previous card: saved to that card ──
  const P = open(card({ misc: "current" }), [card({ misc: "previous", srp: "1233" })]);
  await sleep(2500);
  P.click(P.tab("A/C DATA")); await sleep(150);
  P.click(P.qa("button").find((b) => b.textContent.includes("SRP 1233"))); await sleep(300);
  P.setV(P.misc(), "previous edited");
  await sleep(100);
  P.toggle(); await sleep(1500);
  check(`previous card edited then toggle: the edit is saved to that card ("${P.hist()[0].misc}"), current card untouched ("${P.saved().misc}")`,
    P.hist()[0].misc === "previous edited" && P.saved().misc === "current");

  // ── unchanged: no pending save → nothing extra written ──
  const N = open(card({ misc: "steady" }));
  await sleep(2500);
  let writes = 0;
  const orig = N.w.Storage.prototype.setItem;
  N.w.Storage.prototype.setItem = function (k, v) { if (k === "daily-flight-card") writes++; return orig.call(this, k, v); };
  N.toggle(); await sleep(1200);
  check(`toggle with no edit pending writes nothing to the card (${writes} writes)`, writes === 0 && N.saved().misc === "steady");

  check("no script errors", [A, B, D, P, N].every((x) => x.errors.length === 0));
  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
