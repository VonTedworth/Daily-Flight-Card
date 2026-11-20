// Audit F2 (v32): jsPDF imports fast-png only to read PNG images for addImage(). This app embeds a
// single JPEG (the RFM chart page) and never a PNG, so the build aliases "fast-png" to this stub
// (package.json, --alias:fast-png=…), leaving fast-png, pako and iobuffer (≈ 66 KB) out of the
// bundle. A PNG given to a PDF would stop here with this message — and domtest31 says why.
const unsupported = () => {
  throw new Error("PNG images are not supported in this build: fast-png is stubbed (src/stubs/fast-png.js)");
};
export const decode = unsupported;
export const encode = unsupported;
export default { decode, encode };
