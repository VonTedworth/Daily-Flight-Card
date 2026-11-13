"""Generate src/map-geometry.json for the IFR FUEL wireframe map.

Input : ONS "Counties and Unitary Authorities (December 2024) UK BGC" GeoJSON,
        WGS84, clipped to the south-east box (Open Government Licence).
        Fetched once with an ArcGIS FeatureServer query (see README §3A / HANDOVER);
        the raw file is NOT committed — only the simplified output is.
Output: inline-SVG path data in the exact projection the sites are plotted in.
Run   : python3 -I tools/gen_map.py path/to/counties.geojson
"""
import json, math, sys

LON_MIN, LON_MAX = -1.60, 1.55
LAT_MIN, LAT_MAX = 50.60, 51.68
LAT0 = (LAT_MIN + LAT_MAX) / 2
K = math.cos(math.radians(LAT0))      # longitude correction at mean latitude
W = 300.0                             # viewBox width; ~1 unit = 1 CSS px on a phone
SCALE = W / ((LON_MAX - LON_MIN) * K)  # units per degree of latitude
H = round((LAT_MAX - LAT_MIN) * SCALE, 1)
TOL = 0.3                             # Douglas-Peucker tolerance, SVG units

def project(lon, lat):
    return ((lon - LON_MIN) * K * SCALE, (LAT_MAX - lat) * SCALE)

def clip(poly, w, h):
    """Sutherland–Hodgman against the viewBox rectangle."""
    def edge(pts, inside, inter):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]
            if inside(cur):
                if not inside(prev): out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out
    def ix(x):  # intersection with vertical line
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)
    pts = poly
    for inside, inter in (
        (lambda p: p[0] >= 0, ix(0)), (lambda p: p[0] <= w, ix(w)),
        (lambda p: p[1] >= 0, iy(0)), (lambda p: p[1] <= h, iy(h))):
        if not pts: return []
        pts = edge(pts, inside, inter)
    return pts

def dp(pts, tol):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / norm
        if d > dmax: dmax, idx = d, i
    if dmax > tol:
        return dp(pts[:idx + 1], tol)[:-1] + dp(pts[idx:], tol)
    return [pts[0], pts[-1]]

def ring_path(ring):
    pts = [project(lon, lat) for lon, lat in ring]
    if pts[0] == pts[-1]: pts = pts[:-1]
    pts = clip(pts, W, H)
    if len(pts) < 3: return ""
    # DP is degenerate on a closed ring (start == end): split at the farthest point.
    far = max(range(1, len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    pts = dp(pts[:far + 1], TOL)[:-1] + dp(pts[far:] + [pts[0]], TOL)[:-1]
    if len(pts) < 3: return ""
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z"

def main(src):
    gj = json.load(open(src))
    counties = []
    for f in gj["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        d = "".join(ring_path(r) for poly in polys for r in poly[:1])  # outer rings only
        if d:
            counties.append({"n": f["properties"]["CTYUA24NM"], "d": d})
    out = {
        "meta": {"lonMin": LON_MIN, "latMax": LAT_MAX, "k": K, "scale": SCALE, "w": W, "h": H,
                 "source": "ONS Counties and Unitary Authorities (Dec 2024) UK BGC, OGL v3; simplified"},
        "counties": counties,
    }
    json.dump(out, open("src/map-geometry.json", "w"), separators=(",", ":"))
    print(len(counties), "counties,", sum(len(c["d"]) for c in counties), "path chars, viewBox", W, "x", H)

main(sys.argv[1])
