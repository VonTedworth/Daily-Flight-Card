// T5 (v31): bundle size budget. Fails if build/app.js grows past the budget, or if jsPDF's optional
// libraries come back into the bundle (e.g. after a jsPDF upgrade). Reads build/app.js and the
// esbuild metafile build/meta.json written by `npm run build`.
// Budget = the size after the last deliberate change + 2 %. Raise it only for a deliberate, recorded
// change (version entry in HANDOVER.md), never to make a test pass.
const fs = require("fs");
const res = [];
const check = (n, ok) => res.push([n, !!ok]);

const BUDGET = 813967; // v31 after F1: 798,007 bytes + 2 % (was 1,220,643 = 1,196,709 + 2 % before F1)
const app = fs.readFileSync("./build/app.js", "utf8");
const size = Buffer.byteLength(app);
check(`build/app.js ${size.toLocaleString("en-GB")} bytes ≤ budget ${BUDGET.toLocaleString("en-GB")}`, size <= BUDGET);

// F1 (v31): jsPDF's html2canvas, canvg (with core-js etc.) and DOMPurify are only for doc.html() and
// SVG, which the app never uses. They are --external in the build: left as unreached import("…") calls.
const meta = JSON.parse(fs.readFileSync("./build/meta.json", "utf8"));
const inputs = Object.keys(Object.values(meta.outputs)[0].inputs);
const OUT = { html2canvas: /node_modules\/html2canvas\//, "canvg tree": /node_modules\/(canvg|core-js|svg-pathdata|rgbcolor|stackblur-canvas|raf|performance-now)\//, dompurify: /node_modules\/dompurify\// };
for (const [name, re] of Object.entries(OUT)) {
  const hit = inputs.filter((i) => re.test(i));
  check(`no ${name} input in the bundle (metafile: ${hit.length})`, hit.length === 0);
}
// the same, read from the bundle text itself: a string literal unique to each library
const SIG = { html2canvas: "Unable to find iframe window", canvg: "SVGPathData", rgbcolor: "RGBColor", dompurify: "data-tt-policy-suffix" };
for (const [name, sig] of Object.entries(SIG)) check(`no ${name} code in build/app.js ("${sig}" absent)`, !app.includes(sig));
const dyn = (app.match(/import\("[^"]*"\)/g) || []).sort();
check(`the only module imports left are the three unreached ones (${dyn.join(", ")})`, dyn.join() === 'import("canvg"),import("dompurify"),import("html2canvas")');

const html = fs.readFileSync("./index.html", "utf8");
check("index.html inlines this build/app.js", html.includes(app.replace(/<\/script>/g, "<\\/script>")));

let fail = 0;
for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
