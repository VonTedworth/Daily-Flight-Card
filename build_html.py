import datetime

js = open('build/app.js').read()
# escape closing script tags just in case
js = js.replace('</script>', '<\\/script>')

# Stamped fresh on every build (dd.mm.yyyy, matching the app's own date
# convention) so the version footer can never show a stale date even if
# the version number itself isn't bumped for a given change.
build_date = datetime.date.today().strftime('%d.%m.%Y')

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
<link rel="apple-touch-icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Crect width='180' height='180' rx='40' fill='%2310161d'/%3E%3Ctext x='90' y='84' text-anchor='middle' font-family='monospace' font-size='30' font-weight='700' fill='%2339d0e8'%3EFLT%3C/text%3E%3Ctext x='90' y='124' text-anchor='middle' font-family='monospace' font-size='30' font-weight='700' fill='%234ade80'%3ECARD%3C/text%3E%3C/svg%3E">
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
</body>
</html>
'''
open('./index.html', 'w').write(html)
print("written", len(html), "bytes")
