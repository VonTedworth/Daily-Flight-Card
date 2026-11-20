// Real-browser offline check (manual; NOT part of `npm test` — needs Google Chrome installed).
//   npm run build && npm run check:offline
// Drives headless Chrome via the DevTools protocol against a COPY of the built site served
// under /Daily-Flight-Card/ (the GitHub Pages layout): first visit, no signal, flaky signal
// (page hangs 10 s), a deploy while the app is open (no reload), and the next launch.
// Also the crew guide PDF: cached once in its own cache, served with no signal, kept (and not
// re-downloaded) across a deploy, and a calm 503 notice when it was never saved.
// And the PWR CHK tab (v20): the RFM chart image cached in flightcard-assets-v1, shown and embedded
// in the power check PDF with no signal, kept across a deploy; the five-tab bar fits at 375 px.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const SP = fs.mkdtempSync(path.join(require("os").tmpdir(), "flightcard-offline-"));
const SITE = path.join(SP, "site"), APP = path.join(SITE, "Daily-Flight-Card");
const PORT = 8761, CDP = 9333, URL0 = `http://127.0.0.1:${PORT}/Daily-Flight-Card/`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const check = (n, ok) => { res.push([n, !!ok]); console.log((ok ? "PASS" : "FAIL") + "  " + n); };

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
for (const f of ["index.html", "service-worker.js", "manifest.json", "crew-guide-v2.pdf"]) fs.copyFileSync(path.join(REPO, f), path.join(APP, f));
const GUIDE_BYTES = fs.statSync(path.join(REPO, "crew-guide-v2.pdf")).size;
const GUIDE_LOG = path.join(SP, "guide-requests.log");
fs.mkdirSync(path.join(APP, "assets"), { recursive: true });
fs.copyFileSync(path.join(REPO, "assets", "rfm-fig-s3-13-v1.jpg"), path.join(APP, "assets", "rfm-fig-s3-13-v1.jpg"));
const IMG_BYTES = fs.statSync(path.join(REPO, "assets", "rfm-fig-s3-13-v1.jpg")).size;

const serverPy = path.join(SP, "serve.py");
fs.writeFileSync(serverPy, `
import http.server, socketserver, time, sys, os
os.chdir(sys.argv[1]); delay = float(sys.argv[3]); glog = sys.argv[4]
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0].endswith('/crew-guide-v2.pdf'):
            with open(glog, 'a') as f: f.write('GUIDE ')
        if self.path.split('?')[0].endswith('/rfm-fig-s3-13-v1.jpg'):
            with open(glog, 'a') as f: f.write('IMG ')
        if delay and self.path.split('?')[0] in ('/Daily-Flight-Card/', '/Daily-Flight-Card/index.html'):
            time.sleep(delay)
        return super().do_GET()
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', int(sys.argv[2])), H) as s: s.serve_forever()
`);
let server = null;
const startServer = async (delay = 0) => { server = spawn("python3", ["-I", serverPy, SITE, String(PORT), String(delay), GUIDE_LOG], { stdio: "ignore" }); await sleep(600); };
const logCount = (tag) => (fs.existsSync(GUIDE_LOG) ? fs.readFileSync(GUIDE_LOG, "utf8").split(tag).length - 1 : 0);
const guideGets = () => logCount("GUIDE"), imgGets = () => logCount("IMG");
const IMG_CACHED = `caches.has('flightcard-assets-v1').then(h => h ? caches.open('flightcard-assets-v1').then(c => c.match(new URL('./assets/rfm-fig-s3-13-v1.jpg', location.href).href)).then(m => !!m) : false)`;
// Open PWR CHK, enter a check, export the power check PDF through a stubbed share sheet; report what the page shows.
const PWR_EXPORT = `(async () => {
  const sl = (ms) => new Promise(r => setTimeout(r, ms));
  [...document.querySelectorAll('[data-tabbar] button')].find(b => b.textContent.trim() === 'PWR CHK').click();
  await sl(800);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (const [k, v] of [['oat','12'],['qnh','996'],['e0itt','745'],['e0ng','89.7'],['e1itt','750'],['e1ng','89.9']]) {
    const el = document.querySelector('[data-pc="' + k + '"]'); set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); await sl(30); }
  window.__pdf = null;
  navigator.canShare = () => true; navigator.share = async (d) => { window.__pdf = { size: d.files[0].size, name: d.files[0].name }; };
  document.querySelector('[data-pc-export]').click();
  for (let i = 0; i < 50 && !window.__pdf; i++) await sl(100);
  const img = new Image(); img.src = './assets/rfm-fig-s3-13-v1.jpg';
  let natural = 0; try { await img.decode(); natural = img.naturalWidth; } catch {}
  return { shown: !!document.querySelector('[data-pc-img]'), notSaved: !!document.querySelector('[data-pc-noimg]'), natural, pdf: window.__pdf,
    summary: (document.querySelector('[data-pc-summary]') || {}).textContent };
})()`;
// fetch the guide from the page (as the app's link would): status, size, and the notice text if any
const GUIDE_FETCH = `fetch('./crew-guide-v2.pdf').then(async r => { const b = await r.arrayBuffer(); return { status: r.status, size: b.byteLength,
  text: r.status === 200 ? '' : new TextDecoder().decode(b) }; }).catch(e => ({ status: -1, error: String(e) }))`;
const stopServer = async () => { if (server) { server.kill("SIGKILL"); server = null; await sleep(400); } };

(async () => {
  const profile = path.join(SP, "chrome-profile");
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); break; } catch { await sleep(250); } }
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expression) => { const d = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return d.result && d.result.result ? d.result.result.value : undefined; };
  const appText = () => js(`(document.getElementById('root')||{}).textContent||''`).catch(() => "");
  const waitApp = async (timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { const t = await appText(); if (t && t.includes("FLT MIN")) return { ms: Date.now() - t0, text: t }; await sleep(100); } return { ms: Date.now() - t0, text: await appText() }; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }); // iPhone width

  try {
    // ── A. first visit with signal ──
    await startServer(0);
    await send("Page.navigate", { url: URL0 });
    let a = await waitApp();
    check("first visit online: app renders (" + (a.text.match(/v\d+ · [\d.]+/) || ["?"])[0] + ")", a.text.includes("FLT MIN"));
    await sleep(2500);
    let st = await js(`(async () => { const reg = await navigator.serviceWorker.ready; const keys = await caches.keys();
      const c = await caches.open(keys.find(k => /^flightcard-\\d{8}/.test(k))); const ent = (await c.keys()).map(r => r.url);
      return { scope: reg.scope, active: reg.active && reg.active.state, keys, ent }; })()`);
    check("service worker registered at the SUBPATH scope " + (st && st.scope), st && st.scope === URL0 && st.active === "activated");
    check("this build's cache holds ./, ./index.html, ./manifest.json", st && st.ent.includes(URL0) && st.ent.includes(URL0 + "index.html") && st.ent.includes(URL0 + "manifest.json"));
    const firstCache = st && st.keys.find((k) => /^flightcard-\d{8}/.test(k));
    let guideOk = false;
    for (let i = 0; i < 60 && !guideOk; i++) {
      guideOk = await js(`caches.has('flightcard-guide-v2').then(h => h ? caches.open('flightcard-guide-v2').then(c => c.match(new URL('./crew-guide-v2.pdf', location.href).href)).then(m => !!m) : false)`);
      if (!guideOk) await sleep(250);
    }
    check("crew guide cached in its own cache flightcard-guide-v2", guideOk);
    let imgOk = false;
    for (let i = 0; i < 60 && !imgOk; i++) { imgOk = await js(IMG_CACHED); if (!imgOk) await sleep(250); }
    check("RFM chart image cached in its own cache flightcard-assets-v1 after the first load", imgOk);
    const bar = await js(`document.fonts.ready.then(() => { const bs = [...document.querySelector('[data-tabbar]').children];
      return { w: innerWidth, labels: bs.map(b => b.textContent.trim()), over: bs.filter(b => b.scrollWidth > b.clientWidth).map(b => b.textContent),
        rows: new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size, barOver: document.querySelector('[data-tabbar]').scrollWidth > document.querySelector('[data-tabbar]').clientWidth,
        pageOver: document.documentElement.scrollWidth > innerWidth }; })`);
    check(`375 px: six tabs on two rows + toggle, no tab clipped (${bar && bar.labels.slice(0, 6).join(" · ")})`, bar && bar.w === 375 && bar.over.length === 0 && bar.rows === 2 && !bar.barOver && !bar.pageOver && bar.labels.slice(0, 6).join("|") === "A/C DATA|FLIGHTS|UPLIFT|DUTIES|PWR CHK|IFR FUEL");

    // ── B. no signal at all ──
    await stopServer();
    await send("Page.reload", { ignoreCache: false });
    let b = await waitApp();
    check(`NO SIGNAL (server dead): app launches from cache in ${b.ms} ms`, b.text.includes("FLT MIN") && b.ms < 3000);
    await js(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'IFR FUEL'); btn && btn.click(); return true; })()`);
    await sleep(300);
    const gOff = await js(GUIDE_FETCH);
    check(`NO SIGNAL: the crew guide opens from the phone (200, ${gOff && gOff.size} bytes = file on disk ${GUIDE_BYTES})`, gOff && gOff.status === 200 && gOff.size === GUIDE_BYTES);
    check("no signal: app fully usable (IFR FUEL tab + map render offline)", (await appText()).includes("Planning cross-check only") && (await js(`!!document.querySelector('svg[role="img"][aria-label="Map of the trip"] path')`)));
    const pw = await js(PWR_EXPORT);
    check(`NO SIGNAL: PWR CHK shows the RFM page (decoded ${pw && pw.natural} px wide) — not the 'not saved' box`, pw && pw.shown && !pw.notSaved && pw.natural === 2121 && pw.summary === "BOTH ENGINES WITHIN LIMITS");
    check(`NO SIGNAL: power check PDF builds with the image embedded (${pw && pw.pdf && pw.pdf.size} bytes > 400 KB, ${pw && pw.pdf && pw.pdf.name})`, pw && pw.pdf && pw.pdf.size > 400000 && /^PC_.*Z\.pdf$/.test(pw.pdf.name));
    check(`(image on disk is ${IMG_BYTES} bytes)`, IMG_BYTES > 500000);

    // ── C. flaky signal: server hangs 10 s on the page ──
    await startServer(10);
    await send("Page.reload", {});
    let c = await waitApp(15000);
    check(`FLAKY SIGNAL (page hangs 10 s): cached app shown after ~3 s, not 10 s (${c.ms} ms)`, c.text.includes("FLT MIN") && c.ms >= 2500 && c.ms < 6000);
    await stopServer();

    // ── D. a new deploy while the app is open ──
    const idx = path.join(APP, "index.html"), swf = path.join(APP, "service-worker.js");
    const before = fs.readFileSync(idx, "utf8");
    const vm = before.match(/"v(\d+)"/g) || [];
    if (vm.length !== 1) throw new Error("expected exactly one quoted \"vN\" (APP_VERSION) in index.html, found " + vm.length);
    const V0 = vm[0].slice(1, -1), V1 = "v" + (+V0.slice(1) + 1);
    fs.writeFileSync(idx, before.replace(`"${V0}"`, `"${V1}"`)); // only the APP_VERSION literal
    const guideGetsBeforeDeploy = guideGets(), imgGetsBeforeDeploy = imgGets();
    // a real deploy rebuilds: new page → new fingerprint → new cache name
    fs.writeFileSync(swf, fs.readFileSync(swf, "utf8").replace(/const BUILD_STAMP = "([^"]+)";/, 'const BUILD_STAMP = "$1-deploy2";'));
    const newIdx = fs.readFileSync(idx, "utf8");
    check(`(test setup) simulated deploy changes only the version literal ${V0} → ${V1}`, newIdx.split(`"${V1}"`).length === 2 && !newIdx.includes(`"${V0}"`));
    await startServer(0);
    await js(`window.__session = 'entering data'; true`);
    await js(`navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => true)`);
    await sleep(3500);
    const midText = await appText();
    check("mid-session deploy: NO reload — the open page keeps its state", (await js(`window.__session`)) === "entering data");
    check(`mid-session deploy: open page is not swapped under the user (still ${V0})`, new RegExp(V0 + " · ").test(midText));
    const keysMid = await js(`caches.keys()`);
    check("new version installed in the background (new cache, old purged)", keysMid.some((k) => k.endsWith("-deploy2")) && !keysMid.includes(firstCache));
    check("deploy: crew guide cache kept (flightcard-guide-v2)", keysMid.includes("flightcard-guide-v2"));
    check(`deploy: crew guide NOT downloaded again (${guideGets() - guideGetsBeforeDeploy} requests)`, guideGets() === guideGetsBeforeDeploy);
    check("deploy: RFM image cache kept (flightcard-assets-v1)", keysMid.includes("flightcard-assets-v1"));
    check(`deploy: RFM image NOT downloaded again (${imgGets() - imgGetsBeforeDeploy} requests)`, imgGets() === imgGetsBeforeDeploy);

    // ── E. next launch picks it up ──
    await send("Page.reload", {});
    let e = await waitApp();
    check(`next launch (online): shows the new version ${V1} — nobody stranded`, new RegExp(V1 + " · ").test(e.text));
    await stopServer();
    await send("Page.reload", {});
    let f = await waitApp();
    check(`next launch with NO signal: still ${V1} from the new cache`, new RegExp(V1 + " · ").test(f.text) && f.text.includes("FLT MIN"));

    // ── F. guide never saved on this phone, no signal ──
    await js(`caches.delete('flightcard-guide-v2')`);
    const gNone = await js(GUIDE_FETCH);
    check("guide not saved + NO signal: calm 503 notice", gNone && gNone.status === 503 && gNone.text.includes("Crew guide not saved on this phone yet. Open it once with signal."));
    check("…and the app page is unaffected", (await appText()).includes("FLT MIN"));

    // ── G. RFM image never saved on this phone, no signal ──
    await js(`caches.delete('flightcard-assets-v1')`);
    await send("Page.reload", {});
    await waitApp();
    const pn = await js(PWR_EXPORT);
    check("image not saved + NO signal: PWR CHK shows the grey 'not saved yet' box", pn && pn.notSaved && !pn.shown && pn.summary === "BOTH ENGINES WITHIN LIMITS");
    check(`…and the power check PDF still builds, without the image (${pn && pn.pdf && pn.pdf.size} bytes)`, pn && pn.pdf && pn.pdf.size > 1000 && pn.pdf.size < 100000);
  } catch (err) {
    check("harness crashed: " + err.stack, false);
  } finally {
    await stopServer();
    ws.close(); chrome.kill("SIGKILL");
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(SP, { recursive: true, force: true });
    const fails = res.filter((r) => !r[1]).length;
    console.log(`\n${res.length - fails}/${res.length} passed in real Chrome`);
    process.exit(fails ? 1 : 0);
  }
})();
