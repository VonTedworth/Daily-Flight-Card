// Shared by domtest25 and the one-off fixture capture: a card holding OLD-SHAPE power checks
// (pre-v20: {row, oat, qnh, e1n1, e1itt, e2n1, e2itt}), exported through the app's own
// "EXPORT PDF & NEW CARD" path in jsdom. Returns the PDF bytes (latin1 string).
const { JSDOM, VirtualConsole } = require("jsdom");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (o = {}) => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "", ...o });
const LEGACY_CARD = {
  date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4700", vertField: "4550", plannedFuel: "650",
  hoursAvail: "9:00", sunriseSet: "0459 / 2113",
  rows: [mk({ fltTime: "0", shtdwn: "0905", fuel: "640", notes: "GROUND RUN – POWER CHECK" }), mk({ fltTime: "35", shtdwn: "1010", fuel: "520" }),
    ...Array.from({ length: 5 }, () => mk())],
  misc: "oil checked",
  powerChecks: [
    { row: 0, oat: "12", qnh: "1013", e1n1: "88.5", e1itt: "745", e2n1: "88.9", e2itt: "752" },
    { row: null, oat: "-3", qnh: "998", e1n1: "87.1", e1itt: "731", e2n1: "87.4", e2itt: "736" },
  ],
};
async function exportCardPdf(html, card) {
  let shared = null;
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(card));
      w.navigator.canShare = () => true;
      w.navigator.share = async (d) => { shared = d.files[0]; };
    } });
  const w = dom.window, d = w.document;
  await sleep(2500);
  const btn = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  click(btn("A/C DATA")); await sleep(200);
  click(btn("NEW CARD")); await sleep(150);
  click(btn("EXPORT PDF & NEW CARD")); await sleep(1500);
  const bytes = shared ? Buffer.from(await shared.arrayBuffer()).toString("latin1") : "";
  w.close();
  return bytes;
}
// jsPDF stamps a creation date and a random file ID into every PDF; nothing else varies.
const normalisePdf = (b) => b.replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate (X)").replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID [X]");
module.exports = { LEGACY_CARD, exportCardPdf, normalisePdf, mk };
