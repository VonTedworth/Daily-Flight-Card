// IFR FUEL — purple expand arrows, the explanatory sentence, and the collapsible FUEL WORKINGS.
// Presentation only: no figure here is calculated by the UI.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const src = fs.readFileSync("./src/app.jsx", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyRows = () => Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }));
const CARD = JSON.stringify({ date: "14.07.2026", acReg: "G-KSST", srp: "1", gwDep: "4600", varField: "4650", vertField: "", plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "", rows: emptyRows(), misc: "", powerChecks: [] });
const EXAMPLE = JSON.stringify({ stops: ["EGKR", "EGKD", "EGKC", "EGKR"], actual: ["820", "", "", ""], refuel: [false, false, false, false], scen: [null, null, null], alt: [null, null, null], alt2: [null, null, null] });
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

function open(theme) {
  const errors = [];
  let net = 0;
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", CARD);
      w.localStorage.setItem("ifr-fuel-trip", EXAMPLE);
      if (theme) w.localStorage.setItem("theme", theme);
      w.fetch = () => { net++; return Promise.reject(new Error("network")); };
    } });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s), qa = (s) => [...d.querySelectorAll(s)];
  const tx = (s) => (q(s) ? q(s).textContent : "");
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const btn = (t) => qa("button").find((b) => b.textContent.trim() === t);
  const setSelect = async (el, v) => { el.value = v; el.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(80); };
  return { w, d, q, qa, tx, click, btn, setSelect, errors, net: () => net };
}
// Relative luminance / contrast (WCAG) for the palette check.
const lum = (hex) => { const c = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const pal = (name) => { const m = src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`)); return Object.fromEntries([...m[1].matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)].map((x) => [x[1], x[2]])); };

(async () => {
  // ── palettes ──
  const N = pal("NIGHT"), D = pal("DAY");
  check("night palette defines purple #B57CFF, day palette #6A2FC0", N.purple === "#B57CFF" && D.purple === "#6A2FC0");
  check(`purple holds contrast on its panel (night ${contrast(N.purple, N.panel).toFixed(1)}:1, day ${contrast(D.purple, D.panel).toFixed(1)}:1, both ≥ 4.5)`, contrast(N.purple, N.panel) >= 4.5 && contrast(D.purple, D.panel) >= 4.5);
  check("purple is used only by the expand arrow (ExpandArrow) in the source", (() => { const fn = src.match(/\nfunction ExpandArrow[\s\S]*?\n}\n/)[0]; const all = (src.match(/C\.purple/g) || []).length, inFn = (fn.match(/C\.purple/g) || []).length; return all > 0 && all === inFn; })());

  // ── the sentence, every case (pure helper; the 'no valid alternate' case cannot be reached with the current dataset) ──
  const { explainSector } = await import("./src/ifr-explain.mjs");
  const say = (s, o) => { const e = explainSector(s, { fromName: "EGKR REDHILL", toName: "EGKD WILLIAM HARVEY, ASHFORD", ...o }); return e.text || e.pre + e.total + e.after; };
  check("onward: 'Leaving X needs G kg: B kg for this sector, then N kg to leave Y.'",
    say({ own: 500, gate: 759, burn: 194, useOnward: true, vfr: false, needAlts: 1, sc: "C" }, { nextGate: 565 }) === "Leaving EGKR REDHILL needs 759 kg: 194 kg for this sector, then 565 kg to leave EGKD WILLIAM HARVEY, ASHFORD.");
  check("VFR: '…then 100 kg final reserve.'", say({ own: 240, gate: 240, burn: 140, useOnward: false, vfr: true, needAlts: 0, sc: "VFR" }) === "Leaving EGKR REDHILL needs 240 kg: 140 kg for this sector, then 100 kg final reserve.");
  check("VMC: '…then 150 kg for reserve.'", say({ own: 344, gate: 344, burn: 194, useOnward: false, vfr: false, needAlts: 0, sc: "VMC" }) === "Leaving EGKR REDHILL needs 344 kg: 194 kg for this sector, then 150 kg for reserve.");
  check("A: '…for reserve and the extra approach (incl. 15 min added to trip).'", say({ own: 484, gate: 484, burn: 194, useOnward: false, vfr: false, needAlts: 0, sc: "A" }, { addMin: 15 }) === "Leaving EGKR REDHILL needs 484 kg: 194 kg for this sector, then 290 kg for reserve and the extra approach (incl. 15 min added to trip).");
  check("B/C/D: '…then N kg for the alternate and reserve.'", say({ own: 500, gate: 500, burn: 194, useOnward: false, vfr: false, needAlts: 1, sc: "C" }) === "Leaving EGKR REDHILL needs 500 kg: 194 kg for this sector, then 306 kg for the alternate and reserve.");
  check("no valid alternate: 'No valid alternate for Y, so the minimum to leave X can't be worked out.'", say({ own: null, gate: null, burn: 194, error: "NO VALID ALTERNATE" }) === "No valid alternate for EGKD WILLIAM HARVEY, ASHFORD, so the minimum to leave EGKR REDHILL can't be worked out.");
  check("later stop missing: 'Select every stop to see what leaving X needs.'", say({ own: 500, gate: null, burn: 194 }) === "Select every stop to see what leaving EGKR REDHILL needs.");

  // ── the screen ──
  const A = open();
  await sleep(2500);
  const { w, q, qa, tx, click, btn, setSelect } = A;
  click(btn("IFR FUEL")); await sleep(200);
  const root = () => A.d.getElementById("root").textContent;
  check("no ▾ / ▴ characters left in the IFR FUEL tab", !/[▾▴]/.test(root()));
  check("every sector line ends with the purple arrow (aria-hidden), closed", [0, 1, 2].every((i) => { const a = q(`[data-sector-line="${i}"] [data-arrow]`); return a && a.getAttribute("aria-hidden") === "true" && a.dataset.arrow === "closed"; }));
  const arrow0 = q('[data-sector-line="0"] [data-arrow]');
  check("arrow: 24 px box, 1.5 px purple border, radius 6, purple tint, purple SVG chevron M6 9l6 6 6-6",
    arrow0.style.width === "24px" && arrow0.style.height === "24px" && arrow0.style.borderRadius === "6px" && /1\.5px solid/.test(arrow0.style.border) &&
    /181, 124, 255|#b57cff/i.test(arrow0.style.border) && /181, 124, 255|#b57cff/i.test(arrow0.style.background) &&
    q('[data-sector-line="0"] [data-arrow] path').getAttribute("d") === "M6 9l6 6 6-6" && /#b57cff/i.test(q('[data-sector-line="0"] [data-arrow] path').getAttribute("stroke")) && q('[data-sector-line="0"] [data-arrow] path').getAttribute("stroke-width") === "3");
  check("sector burn sits left of the arrow, in the same centred row", (() => { const box = arrow0.parentElement; return box.style.alignItems === "center" && box.firstElementChild.textContent === "194 KG" && box.lastElementChild === arrow0; })());
  check("reduced motion: no chevron animation; native disclosure marker hidden", /prefers-reduced-motion: reduce[^}]*\.exp-chev \{ transition: none/.test(A.d.querySelector("style:not([id])") ? [...A.d.querySelectorAll("style")].map((s) => s.textContent).join(" ") : "") && [...A.d.querySelectorAll("style")].some((s) => /\.ifr-sum::-webkit-details-marker \{ display: none/.test(s.textContent)));

  check("sector closed: aria-expanded false", q('[data-sector-line="0"]').getAttribute("aria-expanded") === "false");
  click(q('[data-sector-line="0"]')); await sleep(100);
  check("tapping the line opens it: aria-expanded true, arrow rotated (open)", q('[data-sector-line="0"]').getAttribute("aria-expanded") === "true" && q('[data-sector-line="0"] [data-arrow]').dataset.arrow === "open" && /rotate\(180deg\)/.test(q('[data-sector-line="0"] [data-arrow] svg').style.transform));
  check("opened sector still shows chips, scenario text, approaches and alternate picker", !!q('[data-chip="0:C"]') && !!q('[data-detail="0"] [data-approaches="EGKD"]') && !!q('[data-detail="0"] select[data-alt-picker="alt"]'));
  check(`sentence: "${tx('[data-explain="0"]')}"`, tx('[data-explain="0"]').includes("needs 759 kg") && tx('[data-explain="0"]').includes("565 kg to leave") && tx('[data-explain="0"]').startsWith("Leaving EGKR REDHILL"));
  check("only the total is bold", qa('[data-explain="0"] b').length === 1 && q('[data-explain="0"] b').textContent === "759 kg");
  check("sentence in the white text colour (not grey)", /232, 238, 242|#e8eef2/i.test(q('[data-explain="0"]').style.color));
  const det = () => q('details[data-workings="0"]');
  check("FUEL WORKINGS toggle: purple 22 px arrow then the label, above a rule", !!q('[data-workings-toggle="0"] [data-arrow]') && q('[data-workings-toggle="0"] [data-arrow]').style.width === "22px" &&
    q('[data-workings-toggle="0"]').textContent.trim() === "FUEL WORKINGS" && /1px solid/.test(q('[data-workings-toggle="0"]').style.borderBottom));
  check("workings closed by default when the sector opens", det() && !det().open && q('[data-workings-toggle="0"] [data-arrow]').dataset.arrow === "closed");
  check("…but the whole table is still there behind it (rows, subtotal, onward, MIN TO LIFT, fuel, discretionary)",
    ["[data-row]", "[data-subtotal]", "[data-extra]", "[data-row-total]", "[data-fuel-at]", "[data-disc]"].every((s) => det().querySelector(s)));
  click(q('[data-workings-toggle="0"]')); await sleep(120);
  check("tapping FUEL WORKINGS opens it (arrow turns)", det().open && q('[data-workings-toggle="0"] [data-arrow]').dataset.arrow === "open");
  click(q('[data-chip="0:D"]')); await sleep(120);
  check("workings stay open after changing that sector's profile (C → D)", det() && det().open && tx('[data-sector-line="0"]').includes("· D ·"));
  await setSelect(q('[data-detail="0"] select[data-alt-picker="alt"]'), "EGKK");
  const actual = q('[data-actual="0"]');
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(actual, "900"); actual.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(100);
  check("…and after changing the alternate and the fuel figure", det() && det().open && tx('[data-fuel-at="0"]').includes("900"));
  click(q('[data-chip="0:C"]')); await sleep(80);
  click(q('[data-workings-toggle="0"]')); await sleep(120);
  check("tapping FUEL WORKINGS again closes it", !det().open);

  // ── sentences on screen: no-alternate profiles, VFR, alternate profiles, missing stop ──
  click(q("[data-add-sector]")); await sleep(80);
  await setSelect(q('select[aria-label="stop 5"]'), "EGKK");
  click(q('[data-sector-line="3"]')); await sleep(80);
  const s3 = () => tx('[data-explain="3"]');
  check(`B on the last leg: "…for the alternate and reserve." (${s3()})`, /^Leaving EGKR REDHILL needs \d+ kg: \d+ kg for this sector, then \d+ kg for the alternate and reserve\.$/.test(s3()));
  click(q('[data-chip="3:VMC"]')); await sleep(80);
  check(`VMC: "…for reserve." (${s3()})`, /then 150 kg for reserve\.$/.test(s3()));
  click(q('[data-chip="3:A"]')); await sleep(80);
  check(`A: "…for reserve and the extra approach…" (${s3()})`, /then 290 kg for reserve and the extra approach \(incl\. 15 min added to trip\)\.$/.test(s3()));
  click(q('[data-chip="3:VFR"]')); await sleep(80);
  check(`VFR: "…then 100 kg final reserve." (${s3()})`, /then 100 kg final reserve\.$/.test(s3()));
  await setSelect(q('select[aria-label="stop 3"]'), "");
  check(`a later stop blank: "Select every stop to see what leaving … needs." (${tx('[data-explain="0"]')})`, tx('[data-explain="0"]') === "Select every stop to see what leaving EGKR REDHILL needs.");
  await setSelect(q('select[aria-label="stop 3"]'), "EGKC");

  // ── reset where the sector open state resets ──
  click(q('[data-workings-toggle="0"]')); await sleep(100);
  click(q('[data-remove="4"]')); await sleep(100);
  check("removing a stop closes sectors and their workings", !q('[data-detail="0"]') && (() => true)());
  click(q('[data-sector-line="0"]')); await sleep(80);
  check("…reopening the sector: workings closed again", !det().open);
  click(q('[data-workings-toggle="0"]')); await sleep(100);
  click(q("[data-reset]")); await sleep(60); click(q("[data-reset-confirm]")); await sleep(100);
  await setSelect(q('select[aria-label="stop 1"]'), "EGKR"); await setSelect(q('select[aria-label="stop 2"]'), "EGKK");
  click(q('[data-sector-line="0"]')); await sleep(80);
  check("RESET TRIP: workings closed for the new trip", !det().open);

  // ── day mode ──
  const B = open("day");
  await sleep(2500);
  B.click(B.btn("IFR FUEL")); await sleep(200);
  const da = B.q('[data-sector-line="0"] [data-arrow]');
  check("day mode: arrow uses the day purple #6A2FC0", da && /106, 47, 192|#6a2fc0/i.test(da.style.border) && /#6a2fc0/i.test(B.q('[data-sector-line="0"] [data-arrow] path').getAttribute("stroke")));
  check("no network, no script errors", A.net() === 0 && B.net() === 0 && A.errors.length === 0 && B.errors.length === 0);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
