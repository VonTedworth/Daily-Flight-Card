// Offline launch — RUNS the built service-worker.js against a simulated browser (Cache Storage,
// network, events) to exercise its behaviour. jsdom cannot run a real service worker; this is
// the next best thing. Real proof is still the on-device airplane-mode test (README §6).
const fs = require("fs");
const vm = require("vm");
const SW = fs.readFileSync("./service-worker.js", "utf8");
const STAMP = SW.match(/const BUILD_STAMP = "([^"]+)";/)[1];
const CACHE = "flightcard-" + STAMP, FONTS = "flightcard-fonts-v1";
const SCOPE = "https://vontedworth.github.io/Daily-Flight-Card/";
const INDEX = SCOPE + "index.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

function makeWorld(opts = {}) {
  const net = { mode: "online", body: "BUILD-A", status: 200, delay: 0, guideStatus: 200 };
  const log = [];
  const urlOf = (r) => (typeof r === "string" ? r : r.url);
  const strip = (u) => u.split("?")[0];
  const fetch = async (input, init = {}) => {
    const url = urlOf(input);
    log.push({ url, cache: init.cache || (typeof input === "object" ? input.cache : undefined) });
    if (net.delay) await sleep(net.delay);
    if (net.mode === "offline") throw new TypeError("Failed to fetch");
    if (url.endsWith("crew-guide-v1.pdf")) return new Response(net.guideStatus === 200 ? "%PDF-GUIDE" : "not found", { status: net.guideStatus, headers: { "Content-Type": "application/pdf" } });
    const body = url.endsWith("manifest.json") ? '{"name":"x"}' : url.includes("fonts.") ? "font-" + net.body : net.body;
    return new Response(body, { status: net.status, headers: { "Content-Type": "text/html" } });
  };
  class MockCache {
    constructor() { this.m = new Map(); }
    async match(r, o = {}) { const u = urlOf(r); for (const [k, v] of this.m) if (k === u || (o.ignoreSearch && strip(k) === strip(u))) return v.clone(); return undefined; }
    async put(r, resp) { this.m.set(urlOf(r), resp.clone()); }
    async add(r) { const resp = await fetch(r); if (!resp.ok) throw new TypeError("bad status"); await this.put(r, resp); }
    async addAll(rs) { const out = await Promise.all(rs.map((r) => fetch(r))); if (out.some((x) => !x.ok)) throw new TypeError("bad status"); for (let i = 0; i < rs.length; i++) await this.put(rs[i], out[i]); }
  }
  const store = new Map();
  const caches = {
    async open(n) { if (opts.brokenCaches) throw new Error("storage unavailable"); if (!store.has(n)) store.set(n, new MockCache()); return store.get(n); },
    async keys() { return [...store.keys()]; },
    async delete(n) { return store.delete(n); },
    async match(r, o) { for (const c of store.values()) { const x = await c.match(r, o); if (x) return x; } return undefined; },
  };
  const handlers = {};
  const flags = { skip: 0, claim: 0 };
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (t, f) => (handlers[t] = f),
    skipWaiting: async () => { flags.skip++; },
    clients: { claim: async () => { flags.claim++; } },
  };
  vm.runInNewContext(SW, { self, caches, fetch, Request, Response, URL, setTimeout, clearTimeout, Promise, console });

  const ext = () => { const waits = []; return { waits, waitUntil(p) { waits.push(Promise.resolve(p)); } }; };
  const settle = async (e) => { for (let i = 0; i < e.waits.length; i++) await e.waits[i].catch(() => {}); };
  return {
    net, log, store, flags, handlers,
    async install() { const e = ext(); handlers.install(e); await Promise.all(e.waits); },
    async activate() { const e = ext(); handlers.activate(e); await Promise.all(e.waits); },
    // returns { resp, ms, intercepted, done() } ; done() waits for background work
    async request(req) {
      const e = { ...ext(), request: req, responded: null, respondWith(p) { this.responded = Promise.resolve(p); } };
      const t0 = Date.now();
      handlers.fetch(e);
      if (!e.responded) return { intercepted: false };
      const resp = await e.responded;
      return { intercepted: true, resp, ms: Date.now() - t0, done: () => settle(e) };
    },
    seed: (name) => caches.open(name),
    async cached(name, url) { const c = store.get(name); const r = c && (await c.match(url)); return r ? r.text() : null; },
  };
}
const nav = (url = SCOPE) => ({ url, method: "GET", mode: "navigate", destination: "document" });

(async () => {
  // ── install ──
  let W = makeWorld();
  await W.install();
  check("install precaches ./ and ./index.html into this build's cache", (await W.cached(CACHE, SCOPE)) === "BUILD-A" && (await W.cached(CACHE, INDEX)) === "BUILD-A");
  check("install precaches the manifest (best effort)", (await W.cached(CACHE, SCOPE + "manifest.json")) !== null);
  check("install bypasses the HTTP cache (cache: 'reload') so the shell is truly this build", W.log.filter((l) => l.url === INDEX || l.url === SCOPE).every((l) => l.cache === "reload"));
  check("install calls skipWaiting", W.flags.skip === 1);
  const W2 = makeWorld(); W2.net.mode = "offline";
  let failed = false; try { await W2.install(); } catch { failed = true; }
  check("install with no signal fails cleanly (browser retries later; old worker keeps serving)", failed);

  // ── activate ──
  await W.seed("flightcard-20261101-aaaaaaaaaa");
  await W.seed(FONTS);
  await W.seed("something-else");
  await W.activate();
  check("activate deletes every old build cache", !W.store.has("flightcard-20261101-aaaaaaaaaa") && !W.store.has("something-else"));
  check("activate keeps this build's cache and the font cache", W.store.has(CACHE) && W.store.has(FONTS));
  check("activate claims clients (no reload, no message)", W.flags.claim === 1);

  // ── navigation: good signal ──
  W.net.body = "BUILD-B";
  let r = await W.request(nav());
  check("online: serves the fresh network page", r.intercepted && (await r.resp.text()) === "BUILD-B");
  await r.done();
  check("online: refreshes the cached shell for next time", (await W.cached(CACHE, INDEX)) === "BUILD-B" && (await W.cached(CACHE, SCOPE)) === "BUILD-B");
  check("online: page fetch revalidates (cache: 'no-cache'), never served stale from the HTTP cache", W.log.some((l) => l.url === INDEX && l.cache === "no-cache"));

  // ── navigation: no signal ──
  W.net.mode = "offline";
  r = await W.request(nav());
  check(`no signal: launches from cache immediately (${r.ms} ms)`, (await r.resp.text()) === "BUILD-B" && r.ms < 300);
  r = await W.request(nav(SCOPE + "?v=6"));
  check("no signal, URL with ?query: still launches from cache", (await r.resp.text()) === "BUILD-B");
  r = await W.request(nav(INDEX));
  check("no signal, /index.html: launches from cache", (await r.resp.text()) === "BUILD-B");

  // ── navigation: flaky signal (network hangs) ──
  W.net.mode = "online"; W.net.delay = 4000; W.net.body = "BUILD-C";
  r = await W.request(nav());
  const flakyText = await r.resp.text();
  check(`flaky signal: gives up on the network after ~3 s and serves the cached app (${r.ms} ms)`, flakyText === "BUILD-B" && r.ms >= 2900 && r.ms < 3600);
  await r.done();
  check("flaky signal: the slow network reply still lands and refreshes the cache for next launch", (await W.cached(CACHE, INDEX)) === "BUILD-C");
  W.net.delay = 0;

  // ── navigation: server error ──
  W.net.status = 500; W.net.body = "ERROR PAGE";
  r = await W.request(nav());
  check("server error (500): serves the cached app, not the error", (await r.resp.text()) === "BUILD-C");
  await r.done();
  check("server error is never written into the cache", (await W.cached(CACHE, INDEX)) === "BUILD-C");
  W.net.status = 200;

  // ── first ever launch ──
  let F = makeWorld(); F.net.mode = "offline";
  r = await F.request(nav());
  const offlineText = await r.resp.text();
  check("first launch with no signal and nothing cached: calm offline notice (503), no throw", r.resp.status === 503 && offlineText.includes("OFFLINE") && offlineText.includes("Open it once with signal"));
  F = makeWorld(); F.net.delay = 3500; F.net.body = "BUILD-FIRST";
  r = await F.request(nav());
  check(`first launch, slow signal: waits for the network (no cache to fall back on) (${r.ms} ms)`, (await r.resp.text()) === "BUILD-FIRST" && r.ms >= 3400);

  // ── static assets / fonts ──
  W.net.mode = "online"; W.net.body = "X";
  r = await W.request({ url: SCOPE + "manifest.json", method: "GET", mode: "cors", destination: "manifest" });
  check("manifest: cache-first", r.intercepted && (await r.resp.text()).includes("name"));
  W.net.mode = "offline";
  r = await W.request({ url: SCOPE + "missing.png", method: "GET", mode: "no-cors", destination: "image" });
  check("uncached asset with no signal: network-error response, no throw", r.intercepted && r.resp.type === "error");
  W.net.mode = "online"; W.net.body = "PLEX";
  const fontUrl = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono";
  r = await W.request({ url: fontUrl, method: "GET", mode: "no-cors", destination: "style" });
  await r.done();
  W.net.mode = "offline";
  r = await W.request({ url: fontUrl, method: "GET", mode: "no-cors", destination: "style" });
  check("fonts cached once online are served offline (app looks the same with no signal)", (await r.resp.text()) === "font-PLEX");
  check("font cache survives deploys (separate, unversioned cache)", W.store.has(FONTS));

  // ── not intercepted ──
  r = await W.request({ url: "https://example.com/x", method: "GET", mode: "cors", destination: "" });
  check("other sites are not intercepted", r.intercepted === false);
  r = await W.request({ url: SCOPE, method: "POST", mode: "navigate", destination: "document" });
  check("non-GET requests are not intercepted", r.intercepted === false);

  // ── storage broken (e.g. private mode / eviction) ──
  const B = makeWorld({ brokenCaches: true }); B.net.body = "LIVE";
  r = await B.request(nav());
  check("Cache Storage unavailable + signal: serves the network page", (await r.resp.text()) === "LIVE");
  B.net.mode = "offline";
  r = await B.request(nav());
  check("Cache Storage unavailable + no signal: offline notice, no throw", r.resp.status === 503);

  // ── crew guide (own cache, kept across deploys) ──
  const GUIDE_URL = SCOPE + "crew-guide-v1.pdf", GUIDES = "flightcard-guide-v1";
  const guideReq = () => ({ url: GUIDE_URL, method: "GET", mode: "navigate", destination: "document" });
  const guideFetches = (X) => X.log.filter((l) => l.url === GUIDE_URL).length;
  let G = makeWorld();
  await G.install();
  check("install caches the guide in its own cache (cache: 'reload')", (await G.cached(GUIDES, GUIDE_URL)) === "%PDF-GUIDE" && G.log.some((l) => l.url === GUIDE_URL && l.cache === "reload"));
  check("…after the shell (shell fetched first)", G.log.findIndex((l) => l.url === INDEX) < G.log.findIndex((l) => l.url === GUIDE_URL));
  await G.store.get(GUIDES); (await G.seed("flightcard-guide-v0")); (await G.seed("flightcard-20261101-bbbbbbbbbb"));
  await G.activate();
  check("activate keeps the guide cache; drops older flightcard-guide-* and old build caches", G.store.has(GUIDES) && !G.store.has("flightcard-guide-v0") && !G.store.has("flightcard-20261101-bbbbbbbbbb") && G.store.has(CACHE));
  // a deploy: a new worker installs over the same Cache Storage — the guide is NOT fetched again
  const before = guideFetches(G);
  G.handlers.install && (await G.install());
  check("a new install with the guide already cached does not download it again", guideFetches(G) === before);
  G.net.mode = "offline";
  r = await G.request(guideReq());
  check("guide offline: served from its cache (200, the PDF)", r.intercepted && r.resp.status === 200 && (await r.resp.text()) === "%PDF-GUIDE");
  G.net.mode = "online";
  const n0 = guideFetches(G);
  r = await G.request(guideReq()); await r.done();
  check("guide cached + online: no background refresh (immutable under its name)", guideFetches(G) === n0);
  // install where the guide can't be fetched: the install still succeeds
  const G2 = makeWorld(); G2.net.guideStatus = 404;
  let g2ok = true; try { await G2.install(); } catch { g2ok = false; }
  check("guide missing on the server: install still succeeds, shell cached, guide not cached", g2ok && (await G2.cached(CACHE, INDEX)) === "BUILD-A" && (await G2.cached(GUIDES, GUIDE_URL)) === null);
  G2.net.guideStatus = 200;
  r = await G2.request(guideReq()); await r.done();
  check("guide not cached yet + online: fetched from the network and stored", (await r.resp.text()) === "%PDF-GUIDE" && (await G2.cached(GUIDES, GUIDE_URL)) === "%PDF-GUIDE");
  const G3 = makeWorld(); G3.net.mode = "offline";
  r = await G3.request(guideReq());
  const gtext = await r.resp.text();
  check("guide not cached + no signal: calm 503 notice, no throw", r.resp.status === 503 && gtext.includes("Crew guide not saved on this phone yet. Open it once with signal."));
  const G4 = makeWorld({ brokenCaches: true });
  r = await G4.request(guideReq());
  check("Cache Storage unavailable + signal: guide served from the network", (await r.resp.text()) === "%PDF-GUIDE");
  G4.net.mode = "offline";
  r = await G4.request(guideReq());
  check("Cache Storage unavailable + no signal: guide notice (503), no throw", r.resp.status === 503);
  r = await G.request({ url: SCOPE + "manifest.json", method: "GET", mode: "no-cors", destination: "manifest" });
  check("other same-origin assets still go through the normal cache-first path", r.intercepted && (await r.resp.text()).includes("name"));

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
