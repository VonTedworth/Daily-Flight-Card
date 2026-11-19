// src/powercheck.js — AW169 hover power assurance check (RFM 169F0290X001 Supplement 3,
// Fig S3-13 P&WC 210A Hover Power Check Chart - EAPS OFF, page S3-32 Issue 3 Rev 1).
//
// DO NOT EDIT THE CHART DATA BY HAND. PC_CHART holds the RFM PDF's own vector paths for the
// 17 pressure-altitude lines and the 10 + 10 OAT lines, extracted from the PDF file (page
// coordinates in pt). Validated: the same method on Fig S3-12 (EAPS ON) reproduces the RFM
// worked example (3000 ft, 0 C, TQ 91 % -> 761.7 C / 90.20 % vs RFM 760 / 90.2).
//
export const PC_CHART = {"pa":[[-1000,[472.016,585.111,455.984,581.32,386.823,565.192,317.694,548.916,248.556,532.686,232.633,529.002]],[0,[472.016,597.026,455.984,593.451,386.869,577.677,317.675,562.202,248.556,546.441,232.633,542.866]],[1000,[472.016,608.616,455.984,605.042,386.817,590.085,317.717,574.857,248.556,559.873,232.633,556.407]],[2000,[472.016,619.773,455.984,616.415,386.864,601.78,317.693,587.416,248.556,572.871,232.633,569.513]],[3000,[472.016,630.713,455.984,627.464,386.832,613.507,317.712,599.381,248.556,585.436,232.633,582.187]],[4000,[472.016,641.328,455.984,638.187,386.847,624.659,317.708,611.13,248.556,597.676,232.633,594.535]],[5000,[472.016,651.51,455.984,648.586,386.861,635.458,317.675,622.628,248.556,609.483,232.633,606.558]],[6000,[472.016,661.476,455.984,658.66,386.85,646.101,317.711,633.516,248.556,621.073,232.633,618.149]],[7000,[472.016,671.224,455.984,668.408,386.854,656.289,317.701,644.267,248.556,632.229,232.633,629.413]],[8000,[472.016,680.539,455.984,677.831,386.83,666.335,317.712,654.547,248.556,643.061,232.633,640.353]],[9000,[472.016,689.638,455.984,687.039,386.833,675.952,317.717,664.594,248.556,653.568,232.633,650.969]],[10000,[472.016,698.412,455.984,695.92,386.818,685.317,317.699,674.399,248.556,663.641,232.633,661.258]],[11000,[472.016,706.969,455.984,704.587,386.843,694.249,317.699,683.936,248.556,673.607,232.633,671.116]],[12000,[472.016,715.201,455.984,712.927,386.834,703.057,317.712,692.964,248.556,683.139,232.633,680.864]],[13000,[472.016,723.216,455.984,721.05,386.845,711.449,317.696,701.938,248.556,692.345,232.633,690.179]],[14000,[472.016,731.015,455.984,728.849,386.833,719.74,317.704,710.466,248.556,701.336,232.633,699.17]],[15000,[472.016,738.49,455.984,736.432,386.833,727.706,317.7,718.794,248.556,710.002,232.633,707.944]]],"itt":[[-40,[472.016,515.679,455.984,514.487,386.837,509.653,317.692,504.743,248.556,499.756,232.633,498.673]],[-30,[472.016,500.84,455.984,499.648,386.856,494.316,317.696,489.132,248.556,483.942,232.633,482.75]],[-20,[472.016,485.783,455.984,484.483,386.846,478.982,317.698,473.588,248.556,468.127,232.633,466.827]],[-10,[472.016,469.427,455.984,468.127,386.842,462.489,317.699,456.864,248.556,451.229,232.633,449.93]],[0,[472.016,453.937,455.984,452.529,386.839,446.682,317.699,440.756,248.556,434.873,232.633,433.573]],[10,[472.016,438.015,455.984,436.607,386.837,430.713,317.692,424.659,248.556,418.626,232.633,417.218]],[20,[472.016,421.009,455.984,419.601,386.842,413.493,317.699,407.398,248.556,401.296,232.633,399.887]],[30,[472.016,404.436,455.984,403.028,386.843,396.846,317.709,390.675,248.556,384.614,232.633,383.098]],[40,[472.016,387.538,455.984,386.13,386.847,379.979,317.691,374.12,248.556,367.933,232.633,366.525]],[50,[472.016,372.916,455.984,371.509,386.849,365.457,317.686,359.643,248.556,353.527,232.633,352.227]]],"ng":[[-40,[472.016,308.791,455.984,307.924,386.843,304.341,317.694,300.555,248.556,296.875,232.633,296.009]],[-30,[472.016,290.27,455.984,289.511,386.85,285.818,317.691,282.408,248.556,278.679,232.633,277.921]],[-20,[472.016,272.072,455.984,271.205,386.839,267.679,317.701,263.992,248.556,260.482,232.633,259.615]],[-10,[472.016,253.982,455.984,253.116,386.843,249.521,317.691,245.797,248.556,242.067,232.633,241.2]],[0,[472.016,234.702,455.984,233.835,386.842,230.077,317.699,226.325,248.556,222.57,232.633,221.703]],[10,[472.016,217.695,455.984,216.829,386.832,213.154,317.705,209.169,248.556,205.455,232.633,204.589]],[20,[472.016,201.989,455.984,201.123,386.845,197.235,317.691,193.491,248.556,189.532,232.633,188.666]],[30,[472.016,184.984,455.984,184.117,386.851,180.156,317.695,176.411,248.556,172.527,232.633,171.66]],[40,[472.016,168.303,455.984,167.328,386.838,163.411,317.7,159.297,248.556,155.304,232.633,154.438]],[50,[472.016,157.58,455.984,156.604,386.841,152.505,317.699,148.372,248.556,144.255,232.633,143.281]]]};
// Power check calculator — AW169 RFM 169F0290X001 Supplement 3, Fig S3-13
// "P&WC 210A Hover Power Check Chart - EAPS OFF" (Page S3-32, Issue 3 Rev 1).
// The chart lines are the RFM PDF's own vector paths (page coordinates, pt). Nothing is
// hand-digitised. The page is printed rotated, so:
//   chart reading direction (left -> right) = page y decreasing (741.31 -> 129.74)
//   chart height (bottom -> top)            = page x decreasing (472.02 -> 232.63)
// Method = the RFM's own: enter at TQ, up to pressure altitude, right to OAT, down to max
// ITT / max NG. Between drawn lines the value is interpolated linearly, as a finger would.
// Never extrapolates: outside the drawn lines the result is null.

export const PC_AXES = {
  tq: { p0: 741.31, v0: 50, p1: 524.78, v1: 110 }, // page y -> TQ %
  itt: { p0: 522.07, v0: 600, p1: 327.31, v1: 950 }, // page y -> ITT °C
  ng: { p0: 324.61, v0: 82, p1: 129.74, v1: 98 }, // page y -> NG %
  hBottom: 472.02,
  hTop: 232.63,
};
export const PC_LIMITS = { ittMax: 930, ngMax: 98.2 }; // chart note: do not exceed
export const PC_RANGE = { paMin: -1000, paMax: 15000, oatMin: -40, oatMax: 50 };

function pcPoly(a) {
  const pts = [[a[0], a[1]]];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const b = (k) => u * u * u * a[2 + k] + 3 * u * u * t * a[4 + k] + 3 * u * t * t * a[6 + k] + t * t * t * a[8 + k];
    pts.push([b(0), b(1)]);
  }
  pts.push([a[10], a[11]]);
  return pts;
}
export const PC_FAM = {
  pa: PC_CHART.pa.map(([k, a]) => [k, pcPoly(a)]),
  itt: PC_CHART.itt.map(([k, a]) => [k, pcPoly(a)]),
  ng: PC_CHART.ng.map(([k, a]) => [k, pcPoly(a)]),
};

export const toPage = (ax, v) => ax.p0 + ((v - ax.v0) * (ax.p1 - ax.p0)) / (ax.v1 - ax.v0);
export const fromPage = (ax, p) => ax.v0 + ((p - ax.p0) * (ax.v1 - ax.v0)) / (ax.p1 - ax.p0);

function xAtY(pts, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, ya] = pts[i], [xb, yb] = pts[i + 1];
    if ((ya - y) * (yb - y) <= 0 && ya !== yb) return xa + ((y - ya) * (xb - xa)) / (yb - ya);
  }
  return null;
}
function yAtX(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, ya] = pts[i], [xb, yb] = pts[i + 1];
    if ((xa - x) * (xb - x) <= 0 && xa !== xb) return ya + ((x - xa) * (yb - ya)) / (xb - xa);
  }
  return null;
}
function interpFamily(fam, key, f) {
  for (let i = 0; i < fam.length - 1; i++) {
    const [k0, p0] = fam[i], [k1, p1] = fam[i + 1];
    if (key >= k0 && key <= k1) {
      const a = f(p0), b = f(p1);
      if (a === null || b === null) return null;
      return a + ((key - k0) * (b - a)) / (k1 - k0);
    }
  }
  return null;
}

// Pressure altitude (ft) from QNH (hPa) and elevation (ft), ISA (the QNH definition).
export function pressureAltitude(qnh, elevFt) {
  const elevM = elevFt * 0.3048;
  const p = qnh * Math.pow(1 - 2.25577e-5 * elevM, 5.25588); // station pressure
  return (1 - Math.pow(p / 1013.25, 0.190263)) * 145366.45;
}

// Raw chart read. Returns null (with reason) outside the chart; never extrapolates.
export function readChart(tq, pa, oat) {
  if (!(pa >= PC_RANGE.paMin && pa <= PC_RANGE.paMax)) return { error: "PRESSURE ALT OUTSIDE CHART (-1000 TO 15000 FT)" };
  if (!(oat >= PC_RANGE.oatMin && oat <= PC_RANGE.oatMax)) return { error: "OAT OUTSIDE CHART (-40 TO +50 °C)" };
  if (!(tq >= 50 && tq <= 110)) return { error: "TQ OUTSIDE CHART (50 TO 110 %)" };
  const yTq = toPage(PC_AXES.tq, tq);
  const h = interpFamily(PC_FAM.pa, pa, (pts) => xAtY(pts, yTq));
  if (h === null) return { error: "TQ / PRESSURE ALT OUTSIDE CHART LINES" };
  const yItt = interpFamily(PC_FAM.itt, oat, (pts) => yAtX(pts, h));
  const yNg = interpFamily(PC_FAM.ng, oat, (pts) => yAtX(pts, h));
  if (yItt === null || yNg === null) return { error: "RESULT OUTSIDE CHART" };
  const chartItt = fromPage(PC_AXES.itt, yItt), chartNg = fromPage(PC_AXES.ng, yNg);
  if (chartItt < 600 || chartItt > 950 || chartNg < 82 || chartNg > 98) return { error: "RESULT OUTSIDE CHART" };
  return { h, yTq, yItt, yNg, chartItt, chartNg };
}

// Max allowable values rounded DOWN, so a reading error can only make the check stricter.
export function maxAllowable(tq, pa, oat) {
  const r = readChart(tq, pa, oat);
  if (r.error) return r;
  return { ...r, maxItt: Math.floor(r.chartItt + 1e-9), maxNg: Math.floor(r.chartNg * 10 + 1e-9) / 10 };
}

// One engine reading against the chart. Per the RFM note: indicated >= max = not met.
export function assess(reading, pa, oat) {
  const { tq, itt, ng } = reading;
  const m = maxAllowable(tq, pa, oat);
  if (m.error) return { error: m.error };
  const ittMargin = m.maxItt - itt;
  const ngMargin = Math.round((m.maxNg - ng) * 10) / 10;
  return {
    ...m,
    tq,
    itt,
    ng,
    ittMargin,
    ngMargin,
    met: itt < m.maxItt && ng < m.maxNg,
    overLimit: itt > PC_LIMITS.ittMax || ng > PC_LIMITS.ngMax,
  };
}


// The RFM page image (assets/rfm-fig-s3-13-v1.jpg, 2121 x 1533 px) is page S3-32 rotated
// 90 deg clockwise and cropped. RFM page pt (px, py) -> image pt (u, v):
//   u = 842 - py - 56,  v = px - 46;  the image is 707 x 511 pt (3 px per pt).
export const PC_IMAGE = { file: "./assets/rfm-fig-s3-13-v1.jpg", w: 707, h: 511 };
export const pcU = (py) => 842 - py - 56;
export const pcV = (px) => px - 46;

// Reading path of one assessed reading in image pt, for drawing over the RFM page.
export function pcPath(r) {
  return { xt: pcU(r.yTq), y: pcV(r.h), xi: pcU(r.yItt), xn: pcU(r.yNg), yb: pcV(PC_AXES.hBottom) };
}
