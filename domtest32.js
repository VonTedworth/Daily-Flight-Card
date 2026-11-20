// T6 (v35): how each PDF leaves the app, for all three PDFs (card, IFR plan, power check).
//  - share sheet (navigator.canShare true): file name, type, and the title/text passed to share();
//  - download fallback (no share sheet): an <a download> link with the same file name, clicked once,
//    pointing at a blob: URL of the PDF, and that URL released afterwards.
// Pins the exact names and subjects before the three share functions are merged (audit F4).
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (o = {}) => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "", ...o });
const card = (extra = {}) => ({ date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4400", varField: "4700", vertField: "4550", plannedFuel: "650", hoursAvail: "9:00",
  sunriseSet: "", rows: [mk({ fltTime: "20", shtdwn: "1000", fuel: "560" }), ...Array.from({ length: 6 }, () => mk())], misc: "", powerChecks: [], duties: {}, ...extra });
const TRIP = { stops: ["EGKR", "EGKD", "EGKC", "EGKR"], actual: ["820", "", "", ""], refuel: [false, false, false, false], scen: [null, null, null], alt: [null, null, null], alt2: [null, null, null] };
const res = [];
const check = (n, ok) => res.push([n, !!ok]);
const p2 = (n) => String(n).padStart(2, "0");

// mode "share": the share sheet is available; mode "download": it is not (canShare false / missing)
function open(c, mode, opts = {}) {
  const log = { shares: [], clicks: [], urls: [], revoked: [] };
  const errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("daily-flight-card", JSON.stringify(c));
      w.localStorage.setItem("ifr-fuel-trip", JSON.stringify(TRIP));
      if (mode === "share") {
        w.navigator.canShare = () => true;
        w.navigator.share = async (d) => { log.shares.push({ name: d.files[0].name, type: d.files[0].type, title: d.title, text: d.text, bytes: Buffer.from(await d.files[0].arrayBuffer()).toString("latin1") }); };
      } else if (opts.noCanShare) {
        delete w.navigator.canShare;
      } else {
        w.navigator.canShare = () => false;
      }
      let n = 0;
      w.URL.createObjectURL = (blob) => { const u = `blob:https://x.github.io/pdf-${++n}`; log.urls.push({ u, blob }); return u; };
      w.URL.revokeObjectURL = (u) => log.revoked.push(u);
      w.HTMLAnchorElement.prototype.click = function () { log.clicks.push({ download: this.download, href: this.href, inDoc: this.isConnected }); };
    } });
  const w = dom.window, d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const tab = (t) => [...d.querySelector("[data-tabbar]").children].find((b) => b.textContent.trim() === t);
  const btn = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  const pc = async (k, v) => { const el = d.querySelector(`[data-pc="${k}"]`); set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(40); };
  return { w, d, click, tab, btn, pc, log, errors };
}
const blobText = async (b) => Buffer.from(await b.arrayBuffer()).toString("latin1");

async function exportCard(X) { X.click(X.tab("A/C DATA")); await sleep(150); X.click(X.btn("NEW CARD")); await sleep(150); X.click(X.btn("EXPORT PDF & NEW CARD")); await sleep(1500); }
async function exportIfr(X) { X.click(X.tab("IFR FUEL")); await sleep(200); X.click(X.d.querySelector("[data-export-pdf]")); await sleep(1500); }
async function exportPc(X, reg) {
  X.click(X.tab("PWR CHK")); await sleep(300);
  for (const [k, v] of Object.entries({ acReg: reg, dateZ: "14.07.2026", timeZ: "09:52", oat: "12", qnh: "996", e0itt: "745", e0ng: "89.7", e1itt: "750", e1ng: "89.9" })) await X.pc(k, v);
  X.click(X.d.querySelector("[data-pc-export]")); await sleep(1500);
}

(async () => {
  const nowName = () => { const n = new Date(); return { date: `${p2(n.getDate())}.${p2(n.getMonth() + 1)}.${n.getFullYear()}` }; };
  const cases = [
    { what: "card PDF", c: card(), run: exportCard, name: "G-KSST SRP 1234 14.07.2026.pdf", subject: "G-KSST SRP 1234 14.07.2026" },
    { what: "card PDF, no reg / SRP / date", c: card({ acReg: "", srp: "", date: "" }), run: exportCard, name: "AC UNDATED.pdf", subject: "AC UNDATED" },
    { what: "IFR plan PDF", c: card(), run: exportIfr, re: /^IFR FUEL EGKR-EGKD-EGKC-EGKR (\d{2}\.\d{2}\.\d{4}) \d{4}\.pdf$/ },
    { what: "power check PDF", c: card(), run: (X) => exportPc(X, "G-KSST"), name: "PC_G-KSST_14.07.2026_0952Z.pdf", subject: "PC_G-KSST_14.07.2026_0952Z" },
    { what: "power check PDF, no reg", c: card(), run: (X) => exportPc(X, ""), name: "PC_AC_14.07.2026_0952Z.pdf", subject: "PC_AC_14.07.2026_0952Z" },
  ];
  const all = [];
  for (const k of cases) {
    // ── share sheet ──
    const S = open(k.c, "share"); all.push(S);
    await sleep(2500);
    await k.run(S);
    const sh = S.log.shares[0];
    const nameOk = sh && (k.re ? k.re.test(sh.name) && sh.name.match(k.re)[1] === nowName().date : sh.name === k.name);
    const subj = sh && sh.name.replace(/\.pdf$/, "");
    check(`${k.what} · share sheet: one share, file "${sh && sh.name}", application/pdf, title = text = "${sh && sh.title}"`,
      S.log.shares.length === 1 && nameOk && sh.type === "application/pdf" && sh.bytes.startsWith("%PDF") && sh.title === (k.subject || subj) && sh.text === (k.subject || subj) && S.log.clicks.length === 0);

    // ── download fallback ──
    for (const noCanShare of [false, true]) {
      if (noCanShare && k !== cases[0]) continue; // canShare missing altogether: once is enough
      const D = open(k.c, "download", { noCanShare }); all.push(D);
      await sleep(2500);
      await k.run(D);
      const ck = D.log.clicks[0], url = D.log.urls[0];
      const dlOk = ck && (k.re ? k.re.test(ck.download) && ck.download.match(k.re)[1] === nowName().date : ck.download === k.name);
      const pdf = url ? await blobText(url.blob) : "";
      check(`${k.what} · ${noCanShare ? "no navigator.canShare at all" : "canShare false"}: one download link "${ck && ck.download}" clicked, href = the blob URL of the PDF, URL released`,
        D.log.clicks.length === 1 && dlOk && D.log.urls.length === 1 && ck.href === url.u && url.blob.type === "application/pdf" && pdf.startsWith("%PDF") &&
        D.log.revoked.length === 1 && D.log.revoked[0] === url.u && D.log.shares.length === 0);
      if (k === cases[0]) check(`${k.what} · download fallback: the card still moves on to a new card afterwards (same as after the share sheet)`,
        JSON.parse(D.w.localStorage.getItem("card-history") || "[]").length === 1 && JSON.parse(D.w.localStorage.getItem("daily-flight-card")).srp === "");
    }
  }
  check("no script errors", all.every((x) => x.errors.length === 0));

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
