/* Flight Card — service worker (offline launch).
 *
 * TEMPLATE: build_html.py stamps the cache name and writes ./service-worker.js at the
 * repo root. Do not edit the built copy; edit this file and run `npm run build`.
 *
 * Rules (see HANDOVER.md "Offline / service worker"):
 *  - Every URL is RELATIVE to the registration scope. The site lives at a GitHub Pages
 *    project subpath (/Daily-Flight-Card/); an absolute "/..." URL would 404.
 *  - The cache name changes with every build that changes the page, so a deploy always
 *    installs a fresh cache and purges the old one — nobody is stranded on an old build.
 *  - Never reloads or messages the page. A new version installs in the background and the
 *    next launch picks it up; a session in progress is never interrupted.
 *  - Never throws into the page: every network failure falls back to the cache, and if
 *    nothing is cached either, a small plain offline notice is served.
 */
const BUILD_STAMP = "20261119-2aef8bc654";
const CACHE = "flightcard-" + BUILD_STAMP;
// Web fonts (IBM Plex Mono) are kept across deploys so the offline app looks and measures
// exactly as it does online (layouts such as the one-line flight-row margins depend on it).
const FONT_CACHE = "flightcard-fonts-v1";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
// The crew guide (PDF, ~4 MB) has its own cache, kept across deploys like the fonts, so a deploy
// never downloads it again. The file is immutable under its name: a new guide is
// crew-guide-v2.pdf — bump GUIDE and GUIDE_CACHE together (and GUIDE_URL in app.jsx).
const GUIDE = "./crew-guide-v1.pdf";
const GUIDE_CACHE = "flightcard-guide-v1"; // bump together with GUIDE
const NAV_TIMEOUT_MS = 3000;

const SCOPE = self.registration.scope; // e.g. https://vontedworth.github.io/Daily-Flight-Card/
const abs = (rel) => new URL(rel, SCOPE).href;
const INDEX = abs("./index.html");
const ROOT = abs("./");
const SHELL = ["./", "./index.html"]; // must cache, or install fails and is retried later
const OPTIONAL = ["./manifest.json"]; // best effort

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: "reload" bypasses the browser's HTTP cache so the shell is truly this build.
      await cache.addAll(SHELL.map((u) => new Request(abs(u), { cache: "reload" })));
      await Promise.all(OPTIONAL.map((u) => cache.add(new Request(abs(u), { cache: "reload" })).catch(() => {})));
      // Crew guide: best effort, after the shell is cached; never fails the install.
      try {
        const gc = await caches.open(GUIDE_CACHE);
        if (!(await gc.match(abs(GUIDE)))) await gc.add(new Request(abs(GUIDE), { cache: "reload" })).catch(() => {});
      } catch {}
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE && k !== GUIDE_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim(); // control open pages for future fetches — no reload, no message
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  const scopePath = new URL(SCOPE).pathname;
  const isShell = url.origin === new URL(SCOPE).origin && (url.pathname === scopePath || url.pathname === scopePath + "index.html");

  if (isShell && (req.mode === "navigate" || req.destination === "document" || req.destination === "")) {
    event.respondWith(navigation(event));
  } else if (url.href === abs(GUIDE)) {
    event.respondWith(guideResponse(event));
  } else if (url.href.startsWith(SCOPE)) {
    event.respondWith(cacheFirst(event, CACHE, false));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event, FONT_CACHE, true));
  }
  // anything else: not intercepted, the browser handles it exactly as without a worker
});

// App page: network first (fresh build when there is signal), but never wait more than
// NAV_TIMEOUT_MS on a flaky connection if a cached copy exists. No signal = cache at once.
async function navigation(event) {
  let cache;
  try {
    cache = await caches.open(CACHE);
  } catch {
    return fetch(event.request).catch(offlinePage);
  }
  const cached = (await cache.match(INDEX)) || (await cache.match(ROOT)) || (await caches.match(event.request, { ignoreSearch: true }));

  const network = fetch(INDEX, { cache: "no-cache" }).then((resp) => {
    if (resp && resp.ok) {
      const copy = resp.clone();
      event.waitUntil(Promise.all([cache.put(INDEX, copy.clone()), cache.put(ROOT, copy)]).catch(() => {}));
    }
    return resp;
  });

  if (!cached) {
    // First ever launch: nothing to fall back to, so wait for the network.
    try {
      const resp = await network;
      return resp && resp.ok ? resp : resp || offlinePage();
    } catch {
      return offlinePage();
    }
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const winner = await Promise.race([network.catch(() => null), timeout]);
  if (winner && winner.ok) return winner;
  event.waitUntil(network.catch(() => {})); // slow network: let it finish and refresh the cache
  return cached;
}

// Static assets (manifest, fonts): serve from cache at once, refresh in the background.
async function cacheFirst(event, cacheName, allowOpaque) {
  const req = event.request;
  let cache;
  try {
    cache = await caches.open(cacheName);
  } catch {
    return fetch(req).catch(() => Response.error());
  }
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((resp) => {
      if (resp && (resp.ok || (allowOpaque && resp.type === "opaque"))) {
        const copy = resp.clone();
        event.waitUntil(cache.put(req, copy).catch(() => {}));
      }
      return resp;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const resp = await network;
  return resp || Response.error();
}

// Crew guide: cache first, no background refresh (immutable under its name). Not cached yet:
// network, stored if OK. Neither: a calm notice — never throws into the page.
async function guideResponse(event) {
  const key = abs(GUIDE);
  let cache = null;
  try {
    cache = await caches.open(GUIDE_CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {}
  try {
    const resp = await fetch(event.request);
    if (resp && resp.ok && cache) {
      const copy = resp.clone();
      event.waitUntil(cache.put(key, copy).catch(() => {}));
    }
    if (resp) return resp;
  } catch {}
  return guideOffline();
}

function guideOffline() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Crew guide — offline</title>' +
      '<body style="margin:0;background:#05080b;color:#8fa3b3;font:14px ui-monospace,monospace;padding:40px 24px;line-height:1.6">' +
      "<p>Crew guide not saved on this phone yet. Open it once with signal.</p></body>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Flight Card — offline</title>' +
      '<body style="margin:0;background:#05080b;color:#8fa3b3;font:14px ui-monospace,monospace;padding:40px 24px;line-height:1.6">' +
      "<p>FLIGHT CARD IS OFFLINE AND HAS NOT BEEN SAVED ON THIS DEVICE YET.</p>" +
      "<p>Open it once with signal; after that it will launch with no connection.</p></body>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
