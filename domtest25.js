// PWR CHK — unit tests of the calculator itself. Imports src/powercheck.js (the very file the app
// bundles), not a copy. Golden values: RFM Supp 3 Fig S3-13 (EAPS OFF) as extracted into PC_CHART.
const fs = require("fs");
const crypto = require("crypto");
const res = [];
const check = (n, ok) => res.push([n, !!ok]);
const near = (a, b, tol) => typeof a === "number" && Math.abs(a - b) <= tol;

(async () => {
  // src/powercheck.js is an ES module in a CommonJS package: Node says so once; that note is noise here.
  process.removeAllListeners("warning");
  const pc = await import("./src/powercheck.js");
  const { pressureAltitude, maxAllowable, assess, pcPath, PC_IMAGE, PC_LIMITS, PC_RANGE } = pc;

  // ── the delivered file, unaltered ──
  const sha = crypto.createHash("sha256").update(fs.readFileSync("./src/powercheck.js")).digest("hex");
  // Delivered a5cf093b… (9,938 bytes); fix 1 (exact-line reading in interpFamily) → f4466e8e… (10,088 bytes).
  check(`src/powercheck.js is the delivered file + fix 1 (sha256 ${sha.slice(0, 12)}…)`, sha === "f4466e8e164783fd3153f07aefc6da73110071e3fd538622e78cd29cae018c8a" && fs.statSync("./src/powercheck.js").size === 10088);
  const jpg = fs.readFileSync("./assets/rfm-fig-s3-13-v1.jpg");
  const sof = (() => { for (let i = 2; i < jpg.length - 9; i++) if (jpg[i] === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2)) return { h: jpg.readUInt16BE(i + 5), w: jpg.readUInt16BE(i + 7) }; return null; })();
  check(`assets/rfm-fig-s3-13-v1.jpg is a 2121 x 1533 JPEG (${jpg.length} bytes)`, jpg[0] === 0xff && jpg[1] === 0xd8 && sof && sof.w === 2121 && sof.h === 1533 && jpg.length > 500000 && jpg.length < 700000);
  check("PC_IMAGE: ./assets/rfm-fig-s3-13-v1.jpg, 707 x 511 pt", PC_IMAGE.file === "./assets/rfm-fig-s3-13-v1.jpg" && PC_IMAGE.w === 707 && PC_IMAGE.h === 511);
  check("chart limits 930 °C / 98.2 %, range -1000..15000 ft, -40..50 °C", PC_LIMITS.ittMax === 930 && PC_LIMITS.ngMax === 98.2 && PC_RANGE.paMin === -1000 && PC_RANGE.paMax === 15000 && PC_RANGE.oatMin === -40 && PC_RANGE.oatMax === 50);

  // ── pressure altitude (ISA), ±0.05 ft ──
  for (const [q, e, want] of [[996, 222, 695.3], [1021, 222, 11.31], [1013.25, 0, 0], [980, 222, 1140.38]]) {
    const v = pressureAltitude(q, e);
    check(`pressureAltitude(${q}, ${e}) = ${want.toFixed(2)} (got ${v.toFixed(2)})`, near(v, want, 0.05));
  }

  // ── golden values: chart ±0.01, max exact (rounded down) ──
  const PA696 = pressureAltitude(996, 222);
  for (const [tq, pa, oat, ci, cn, mi, mn] of [
    [95, PA696, 12, 775.72, 91.571, 775, 91.5],
    [95, 0, 0, 734.73, 89.739, 734, 89.7],
    [95, 1400, 10, 775.87, 91.496, 775, 91.4],
    [92, 1000, -5, 721.48, 88.971, 721, 88.9],
    [60, 12000, -30, 647.69, 85.114, 647, 85.1],
  ]) {
    const r = maxAllowable(tq, pa, oat);
    check(`maxAllowable(${tq}, ${pa.toFixed(2)}, ${oat}): chart ${r.chartItt && r.chartItt.toFixed(2)} / ${r.chartNg && r.chartNg.toFixed(3)}, max ${r.maxItt} / ${r.maxNg}`,
      !r.error && near(r.chartItt, ci, 0.01) && near(r.chartNg, cn, 0.01) && r.maxItt === mi && r.maxNg === mn);
  }

  // ── fix 1: a reading exactly on a drawn line reads that line alone ──
  const on1 = maxAllowable(91, 1000, 10), on2 = maxAllowable(92, 0, 10);
  check(`maxAllowable(91, 1000, 10) → max ITT 761 (${on1.error || on1.maxItt})`, !on1.error && on1.maxItt === 761);
  check(`maxAllowable(92, 0, 10) → max ITT 756 (was "TQ / PRESSURE ALT OUTSIDE CHART LINES": ${on2.error || on2.maxItt})`, !on2.error && on2.maxItt === 756);

  // (105, -1000, 40) was an error case before fix 1 only because of the bug: the -1000 ft line is drawn
  // up to TQ 108.83, so a reading exactly on it is inside the chart and gives a result.
  const onEdge = maxAllowable(105, -1000, 40);
  check(`maxAllowable(105, -1000, 40) → on the drawn -1000 ft line: max ITT 870 / NG 95.6 (${onEdge.error || onEdge.maxItt + " / " + onEdge.maxNg})`, !onEdge.error && onEdge.maxItt === 870 && onEdge.maxNg === 95.6);

  // ── never extrapolates ──
  for (const [tq, pa, oat, why] of [
    [100, 3000, 25, "TQ / pressure-altitude outside the chart lines"],
    [105, -999, 40, "TQ / pressure-altitude outside the chart lines (the 0 ft line ends at TQ 104.99)"],
    [109, -1000, 40, "beyond the end of the drawn -1000 ft line (it meets the chart top at TQ 108.83)"],
    [105, -500, 40, "TQ / pressure-altitude outside the chart lines"],
    [70, 5000, -20, "TQ / pressure-altitude outside the chart lines"],
    [95, 16000, 10, "pressure altitude outside the chart"],
    [95, 700, 55, "OAT outside the chart"],
  ]) {
    const r = maxAllowable(tq, pa, oat);
    check(`(${tq}, ${pa}, ${oat}) → error, no result (${why}): "${r.error}"`, !!r.error && r.maxItt === undefined && r.maxNg === undefined);
  }
  check("error texts name the cause", /LINES/.test(maxAllowable(100, 3000, 25).error) && /PRESSURE ALT OUTSIDE CHART/.test(maxAllowable(95, 16000, 10).error) && /OAT OUTSIDE CHART/.test(maxAllowable(95, 700, 55).error));

  // ── overlay geometry ──
  const a = assess({ tq: 95, itt: 745, ng: 89.7 }, PA696, 12);
  const p = pcPath(a);
  check(`pcPath(95, 695.30, 12): xt ${p.xt.toFixed(2)} y ${p.y.toFixed(2)} xi ${p.xi.toFixed(2)} xn ${p.xn.toFixed(2)} yb ${p.yb.toFixed(2)}`,
    near(p.xt, 207.09, 0.05) && near(p.y, 307.05, 0.05) && near(p.xi, 361.71, 0.05) && near(p.xn, 577.96, 0.05) && near(p.yb, 426.02, 0.05));

  // ── assess: PAM = rounded max − indicated; 1-minute "met" only when both PAMs are positive ──
  check("745 / 89.7 → met, PAM +30 / +1.8", a.met === true && a.ittMargin === 30 && a.ngMargin === 1.8 && a.maxItt === 775 && a.maxNg === 91.5);
  const eqI = assess({ tq: 95, itt: 775, ng: 89.7 }, PA696, 12);
  check("ITT equal to max on the 1-minute reading → not met (PAM 0 → repeat)", eqI.met === false && eqI.ittMargin === 0);
  const overI = assess({ tq: 95, itt: 776, ng: 89.7 }, PA696, 12);
  check("ITT one above max → PAM −1 (a repeat with this is 'exceeds'; with PAM 0 it is acceptable)", overI.ittMargin === -1 && overI.met === false);
  const eqN = assess({ tq: 95, itt: 745, ng: 91.5 }, PA696, 12);
  const overN = assess({ tq: 95, itt: 745, ng: 91.6 }, PA696, 12);
  check("NG on its own: equal to max → PAM 0, not met; 0.1 above → PAM −0.1", eqN.met === false && eqN.ngMargin === 0 && overN.ngMargin === -0.1 && overN.met === false);
  check("overLimit: ITT above 930 or NG above 98.2", assess({ tq: 95, itt: 931, ng: 89 }, PA696, 12).overLimit === true && assess({ tq: 95, itt: 700, ng: 98.3 }, PA696, 12).overLimit === true && a.overLimit === false);

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness crashed: " + e.stack); process.exit(1); });
