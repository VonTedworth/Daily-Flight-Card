// Real-browser offline check (manual; NOT part of `npm test` — needs Google Chrome installed).
//   npm run build && npm run check:offline
// Drives headless Chrome via the DevTools protocol against a COPY of the built site served
// under /Daily-Flight-Card/ (the GitHub Pages layout): first visit, no signal, flaky signal
// (page hangs 10 s), a deploy while the app is open (no reload), and the next launch.
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
for (const f of ["index.html", "service-worker.js", "manifest.json"]) fs.copyFileSync(path.join(REPO, f), path.join(APP, f));

const serverPy = path.join(SP, "serve.py");
fs.writeFileSync(serverPy, `
import http.server, socketserver, time, sys, os
os.chdir(sys.argv[1]); delay = float(sys.argv[3])
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if delay and self.path.split('?')[0] in ('/Daily-Flight-Card/', '/Daily-Flight-Card/index.html'):
            time.sleep(delay)
        return super().do_GET()
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', int(sys.argv[2])), H) as s: s.serve_forever()
`);
let server = null;
const startServer = async (delay = 0) => { server = spawn("python3", ["-I", serverPy, SITE, String(PORT), String(delay)], { stdio: "ignore" }); await sleep(600); };
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

    // ── B. no signal at all ──
    await stopServer();
    await send("Page.reload", { ignoreCache: false });
    let b = await waitApp();
    check(`NO SIGNAL (server dead): app launches from cache in ${b.ms} ms`, b.text.includes("FLT MIN") && b.ms < 3000);
    await js(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'IFR FUEL'); btn && btn.click(); return true; })()`);
    await sleep(300);
    check("no signal: app fully usable (IFR FUEL tab + map render offline)", (await appText()).includes("AW169 CROSS-CHECK") && (await js(`!!document.querySelector('svg[role="img"] path')`)));

    // ── C. flaky signal: server hangs 10 s on the page ──
    await startServer(10);
    await send("Page.reload", {});
    let c = await waitApp(15000);
    check(`FLAKY SIGNAL (page hangs 10 s): cached app shown after ~3 s, not 10 s (${c.ms} ms)`, c.text.includes("FLT MIN") && c.ms >= 2500 && c.ms < 6000);
    await stopServer();

    // ── D. a new deploy while the app is open ──
    const idx = path.join(APP, "index.html"), swf = path.join(APP, "service-worker.js");
    const before = fs.readFileSync(idx, "utf8");
    if (before.split('"v8"').length !== 2) throw new Error("expected exactly one quoted \"v8\" (APP_VERSION) in index.html");
    fs.writeFileSync(idx, before.replace('"v8"', '"v9"')); // only the APP_VERSION literal
    // a real deploy rebuilds: new page → new fingerprint → new cache name
    fs.writeFileSync(swf, fs.readFileSync(swf, "utf8").replace(/const BUILD_STAMP = "([^"]+)";/, 'const BUILD_STAMP = "$1-deploy2";'));
    const newIdx = fs.readFileSync(idx, "utf8");
    check("(test setup) simulated deploy changes only the version literal to \"v9\"", newIdx.split('"v9"').length === 2 && !newIdx.includes('"v8"'));
    await startServer(0);
    await js(`window.__session = 'entering data'; true`);
    await js(`navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => true)`);
    await sleep(3500);
    const midText = await appText();
    check("mid-session deploy: NO reload — the open page keeps its state", (await js(`window.__session`)) === "entering data");
    check("mid-session deploy: open page is not swapped under the user (still v8)", /v8 · /.test(midText));
    const keysMid = await js(`caches.keys()`);
    check("new version installed in the background (new cache, old purged)", keysMid.some((k) => k.endsWith("-deploy2")) && !keysMid.includes(firstCache));

    // ── E. next launch picks it up ──
    await send("Page.reload", {});
    let e = await waitApp();
    check("next launch (online): shows the new version v9 — nobody stranded", /v9 · /.test(e.text));
    await stopServer();
    await send("Page.reload", {});
    let f = await waitApp();
    check("next launch with NO signal: still v9 from the new cache", /v9 · /.test(f.text) && f.text.includes("FLT MIN"));
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
