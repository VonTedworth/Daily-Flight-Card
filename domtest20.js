// Offline launch — build artefacts: service-worker.js stamped, relative everywhere,
// guarded registration, manifest, and the app unaffected when SW is missing or fails.
const fs = require("fs");
const crypto = require("crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const res = [];
const check = (n, ok) => res.push([n, !!ok]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const html = fs.readFileSync("./index.html", "utf8");
const sw = fs.existsSync("./service-worker.js") ? fs.readFileSync("./service-worker.js", "utf8") : "";
const src = fs.readFileSync("./src/service-worker.src.js", "utf8");

// ── service-worker.js emitted and stamped ──
check("build emits service-worker.js at the repo root", sw.length > 0);
const m = sw.match(/const BUILD_STAMP = "([^"]+)";/);
check("cache name is stamped: flightcard-YYYYMMDD-<10 hex>", !!m && /^\d{8}-[0-9a-f]{10}$/.test(m[1]));
check("no unreplaced __BUILD_STAMP__ placeholder anywhere in the built worker", !sw.includes("__BUILD_STAMP__"));
check("the template still carries the placeholder (so builds can stamp it)", src.includes('"__BUILD_STAMP__"'));
const date = html.match(/__BUILD_DATE__ = "(\d{2})\.(\d{2})\.(\d{4})"/);
check("stamp date = the app's build date", !!m && !!date && m[1].startsWith(date[3] + date[2] + date[1]));
check("stamp fingerprint = SHA-256 of this exact index.html (changes whenever the page changes)",
  !!m && m[1].endsWith(crypto.createHash("sha256").update(html, "utf8").digest("hex").slice(0, 10)));
check("built worker is the template with only the stamp substituted", sw === src.replace(/__BUILD_STAMP__/g, m && m[1]));
try { new Function(sw); check("built service-worker.js is valid JavaScript", true); } catch (e) { check("built service-worker.js is valid JavaScript (" + e.message + ")", false); }

// ── relative URLs only (GitHub Pages project subpath) ──
const code = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // strip comments
check("no absolute root-relative URL string in the worker (\"/...\")", !/["'`]\/(?!\/)/.test(code));
check("precache list is relative: ./ and ./index.html", /SHELL = \["\.\/", "\.\/index\.html"\]/.test(code));
check("manifest precached by relative path", /OPTIONAL = \["\.\/manifest\.json"\]/.test(code));
check("URLs resolved against the registration scope", /new URL\(rel, SCOPE\)/.test(code) && /self\.registration\.scope/.test(code));

// ── never disrupt a session ──
check("worker never reloads, navigates or messages pages", !/reload\(|\.navigate\(|postMessage|matchAll/.test(code));
check("skipWaiting + clients.claim present (installs in background, takes over next launch)", /self\.skipWaiting\(\)/.test(code) && /clients\.claim\(\)/.test(code));
check("activate purges every cache except this build's (and the font cache)", /k !== CACHE && k !== FONT_CACHE/.test(code) && /caches\.delete/.test(code));
check("page has no controllerchange / reload-on-update listener", !/controllerchange|location\.reload/.test(html));

// ── registration in index.html ──
check("registration is guarded by 'serviceWorker' in navigator", html.includes("if ('serviceWorker' in navigator)"));
check("registration waits for window load", /window\.addEventListener\('load',[\s\S]{0,80}navigator\.serviceWorker\.register/.test(html));
check("registration path is RELATIVE ./service-worker.js", html.includes("navigator.serviceWorker.register('./service-worker.js')") && !/register\(['"]\//.test(html));
check("registration failure is swallowed (.catch)", /register\('\.\/service-worker\.js'\)\.catch\(\(\) => \{\}\)/.test(html));

// ── manifest ──
const man = JSON.parse(fs.readFileSync("./manifest.json", "utf8"));
check("manifest linked relatively", html.includes('<link rel="manifest" href="./manifest.json">'));
check("manifest: name, short_name, start_url ./, scope ./, standalone", man.name && man.short_name === "Flight Card" && man.start_url === "./" && man.scope === "./" && man.display === "standalone");
check("manifest colours match the app's theme colour", man.theme_color === "#05080b" && man.background_color === "#05080b");
const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
check("manifest icon is the SAME icon as the apple-touch-icon (icon unchanged)", !!touch && man.icons.length === 1 && man.icons[0].src === touch[1]);
check("apple-mobile-web-app standalone meta tags kept", html.includes('name="apple-mobile-web-app-capable" content="yes"') && html.includes('name="apple-mobile-web-app-title" content="Flight Card"'));

// ── the app itself is unaffected by the worker being absent, failing, or present ──
(async () => {
  const card = { date: "14.07.2026", acReg: "G-KSST", srp: "1", gwDep: "4600", varField: "4650", vertField: "", plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "",
    rows: Array.from({ length: 7 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" })), misc: "", powerChecks: [] };
  const run = async (sw) => {
    const errors = [];
    const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errors.push(e.message));
    let registered = null;
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://vontedworth.github.io/Daily-Flight-Card/", pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) {
        w.localStorage.setItem("daily-flight-card", JSON.stringify(card));
        if (sw) Object.defineProperty(w.navigator, "serviceWorker", { value: { register: (u) => { registered = u; return sw(); } } });
        w.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));
      } });
    await sleep(2500);
    dom.window.dispatchEvent(new dom.window.Event("load"));
    await sleep(200);
    return { text: dom.window.document.getElementById("root").textContent, errors, registered };
  };
  const none = await run(null);
  check("no service worker support: app renders normally, no errors", none.text.includes("FLT MIN") && none.errors.length === 0 && /v\d+ · /.test(none.text));
  const fail = await run(() => Promise.reject(new Error("blocked")));
  check("registration rejected (e.g. private mode): app renders, error swallowed", fail.text.includes("FLT MIN") && fail.errors.length === 0 && fail.registered === "./service-worker.js");
  const ok = await run(() => Promise.resolve({}));
  check("registration succeeds: registers ./service-worker.js after load, app unchanged", ok.registered === "./service-worker.js" && ok.text.includes("FLT MIN") && ok.errors.length === 0);

  let fail2 = 0;
  for (const [n, k] of res) { console.log((k ? "PASS" : "FAIL") + "  " + n); if (!k) fail2++; }
  process.exit(fail2 ? 1 : 0);
})();
