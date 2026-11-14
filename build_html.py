import datetime
import hashlib
import json

js = open('build/app.js').read()
# escape closing script tags just in case
js = js.replace('</script>', '<\\/script>')

# Stamped fresh on every build (dd.mm.yyyy, matching the app's own date
# convention) so the version footer can never show a stale date even if
# the version number itself isn't bumped for a given change.
today = datetime.date.today()
build_date = today.strftime('%d.%m.%Y')

# The one definition of the app icon — used by the apple-touch-icon link AND the
# web app manifest, so the two can never drift apart. (Do not change the icon.)
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E"
        "%3Crect width='180' height='180' rx='40' fill='%2310161d'/%3E"
        "%3Ctext x='90' y='84' text-anchor='middle' font-family='monospace' font-size='30' font-weight='700' fill='%2339d0e8'%3EFLT%3C/text%3E"
        "%3Ctext x='90' y='124' text-anchor='middle' font-family='monospace' font-size='30' font-weight='700' fill='%234ade80'%3ECARD%3C/text%3E"
        "%3C/svg%3E")

# Offline launch: register the service worker after load, RELATIVE path (the site is
# served from a GitHub Pages project subpath). If unsupported or it fails, nothing
# changes — the app behaves exactly as it does without one.
SW_REGISTER = """if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}"""

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Flight Card</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Flight Card">
<meta name="theme-color" content="#05080b">
<link rel="apple-touch-icon" href="{ICON}">
<link rel="manifest" href="./manifest.json">
<style>
  html, body {{ margin: 0; padding: 0; background: #05080b; }}
  #root {{ min-height: 100vh; }}
</style>
</head>
<body>
<div id="root"></div>
<script>window.__BUILD_DATE__ = "{build_date}";</script>
<script>
{js}
</script>
<script>
{SW_REGISTER}
</script>
</body>
</html>
'''
open('./index.html', 'w').write(html)
print("written", len(html), "bytes")

# ── web app manifest (generated; same icon, relative start_url/scope) ──
manifest = {
    "name": "GAMA KSS Daily Flight Card",
    "short_name": "Flight Card",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#05080b",
    "theme_color": "#05080b",
    "icons": [{"src": ICON, "sizes": "any", "type": "image/svg+xml", "purpose": "any"}],
}
open('./manifest.json', 'w').write(json.dumps(manifest, indent=2) + "\n")

# ── service worker: stamp the cache name ──
# Build date + a fingerprint of the page that was just built. The date alone is not
# enough: two deploys on the same day would share a cache name and strand users on the
# earlier one. The fingerprint changes whenever the page changes (and only then), so
# every real deploy gets a new cache and the old one is purged.
stamp = today.strftime('%Y%m%d') + "-" + hashlib.sha256(html.encode("utf-8")).hexdigest()[:10]
sw = open('src/service-worker.src.js').read().replace("__BUILD_STAMP__", stamp)
assert "__BUILD_STAMP__" not in sw, "service worker cache name was not stamped"
open('./service-worker.js', 'w').write(sw)
print("service worker cache: flightcard-" + stamp)
