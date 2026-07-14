import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";

// ═══════════════════════════════════════════════════════════
// Fuel Uplift + Daily Flight Card — v9 (deployable build)
// Changes:
//  1. Standalone build for GitHub Pages: localStorage instead
//     of the artifact storage API (also unblocks geolocation
//     for the HEMS grid).
//  2. NEW CARD offers EXPORT PDF first: generates the full
//     card as a PDF on-device and opens the iOS share sheet
//     (Mail one tap away, PDF attached). Send-to email is a
//     per-device setting, default edward.worsley@gamaaviation.com,
//     printed on the PDF. iOS does not allow pre-addressing
//     mail from the share sheet.
//  3. PLANNED FUEL header box: seeds the uplift REQUIRED FUEL
//     automatically. Per-flight gross weight = GW DEP +
//     (landed fuel − planned fuel) + patient weight; flights
//     over 4600 kg get an amber OVER 4600 record on the row
//     and on the PDF. HEMS tick reveals a PATIENT KG box.
// ═══════════════════════════════════════════════════════════

// localStorage shim matching the async storage API shape the
// rest of the code uses, so the logic is unchanged.
const storage = {
  async get(key) {
    const v = localStorage.getItem(key);
    if (v === null) throw new Error("not found");
    return { key, value: v };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
};

const C = {
  bg: "#05080b",
  panel: "#10161d",
  edge: "#1c2733",
  inputBg: "#0a0f14",
  checkboxBg: "#050a0e",
  cyan: "#39d0e8",
  green: "#4ade80",
  grey: "#8fa3b3",
  amber: "#ffb347",
  white: "#e8eef2",
};

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const NUM_ROWS = 8;

// Redhill Aerodrome
const REDHILL = { lat: 51.2136, lng: -0.1386 };
const AC_REGS = ["G-LNAC", "G-MGPS", "G-KSSC", "G-KSST", "G-ICER"];

// ── Shared helpers ─────────────────────────────────────────

function parseNum(v) {
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

function parseMinutes(t) {
  const s = String(t).trim();
  if (!s) return null;
  const n = parseNum(s);
  return n === null || n < 0 ? null : n;
}

// HOURS AVAILABLE accepts "6:30" (h:mm) or "6.5" (decimal hours)
function parseAvailMinutes(t) {
  const s = String(t).trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [h, m] = s.split(":");
    const hh = parseFloat(h), mm = parseFloat(m);
    if (isNaN(hh) || isNaN(mm) || mm >= 60) return null;
    return hh * 60 + mm;
  }
  const n = parseNum(s);
  return n === null ? null : n * 60;
}

function formatMinutes(mins) {
  const m = Math.round(mins);
  const sign = m < 0 ? "-" : "";
  const a = Math.abs(m);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

function todayString() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// "DD.MM.YYYY" → Date (or null if not valid)
function parseCardDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

// Is the UK on British Summer Time for the given date?
function isBST(date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "short" })
    .formatToParts(date)
    .some((p) => p.type === "timeZoneName" && p.value === "BST");
}

// Local shutdown time → Zulu. Accepts "1420", "14:20" or "920".
// Returns e.g. "1320z", or null if the text isn't a time.
function zuluFromLocal(text, bst) {
  const m = String(text).trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  let total = h * 60 + min - (bst ? 60 : 0);
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}z`;
}

// ── WGS84 → OSGB36 six-figure grid reference ──────────────
// Full conversion done locally: WGS84 lat/lon → cartesian →
// Helmert transform to OSGB36 → Airy 1830 lat/lon → transverse
// Mercator → easting/northing → grid letters + 100 m digits.
// Accurate to ~5 m, plenty for a six-figure (100 m) reference.
function latLonToOSGrid(latDeg, lonDeg) {
  const rad = Math.PI / 180;

  // 1. WGS84 lat/lon → cartesian (h = 0)
  let a = 6378137.0, b = 6356752.3142; // WGS84
  let e2 = 1 - (b * b) / (a * a);
  let lat = latDeg * rad, lon = lonDeg * rad;
  let nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  let x = nu * Math.cos(lat) * Math.cos(lon);
  let y = nu * Math.cos(lat) * Math.sin(lon);
  let z = nu * (1 - e2) * Math.sin(lat);

  // 2. Helmert transform WGS84 → OSGB36
  const tx = -446.448, ty = 125.157, tz = -542.06;
  const s = 20.4894e-6;
  const rx = (-0.1502 / 3600) * rad, ry = (-0.247 / 3600) * rad, rz = (-0.8421 / 3600) * rad;
  const x2 = tx + x * (1 + s) - y * rz + z * ry;
  const y2 = ty + x * rz + y * (1 + s) - z * rx;
  const z2 = tz - x * ry + y * rx + z * (1 + s);

  // 3. Cartesian → lat/lon on Airy 1830
  a = 6377563.396; b = 6356256.909; // Airy 1830
  e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  lat = Math.atan2(z2, p * (1 - e2));
  for (let i = 0; i < 8; i++) {
    nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z2 + e2 * nu * Math.sin(lat), p);
  }
  lon = Math.atan2(y2, x2);

  // 4. Transverse Mercator projection (National Grid)
  const F0 = 0.9996012717, lat0 = 49 * rad, lon0 = -2 * rad, N0 = -100000, E0 = 400000;
  const n = (a - b) / (a + b);
  nu = a * F0 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * Math.sin(lat) ** 2, 1.5);
  const eta2 = nu / rho - 1;

  const dLat = lat - lat0, sLat = lat + lat0;
  const Ma = (1 + n + (5 / 4) * n * n + (5 / 4) * n * n * n) * dLat;
  const Mb = (3 * n + 3 * n * n + (21 / 8) * n * n * n) * Math.sin(dLat) * Math.cos(sLat);
  const Mc = ((15 / 8) * n * n + (15 / 8) * n * n * n) * Math.sin(2 * dLat) * Math.cos(2 * sLat);
  const Md = (35 / 24) * n * n * n * Math.sin(3 * dLat) * Math.cos(3 * sLat);
  const M = b * F0 * (Ma - Mb + Mc - Md);

  const cosLat = Math.cos(lat), sinLat = Math.sin(lat), tanLat = Math.tan(lat);
  const I = M + N0;
  const II = (nu / 2) * sinLat * cosLat;
  const III = (nu / 24) * sinLat * cosLat ** 3 * (5 - tanLat ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * sinLat * cosLat ** 5 * (61 - 58 * tanLat ** 2 + tanLat ** 4);
  const IV = nu * cosLat;
  const V = (nu / 6) * cosLat ** 3 * (nu / rho - tanLat ** 2);
  const VI =
    (nu / 120) * cosLat ** 5 * (5 - 18 * tanLat ** 2 + tanLat ** 4 + 14 * eta2 - 58 * tanLat ** 2 * eta2);

  const dLon = lon - lon0;
  const N = I + II * dLon ** 2 + III * dLon ** 4 + IIIA * dLon ** 6;
  const E = E0 + IV * dLon + V * dLon ** 3 + VI * dLon ** 5;

  // 5. Easting/northing → grid letters + six figures (100 m)
  if (E < 0 || E >= 700000 || N < 0 || N >= 1300000) return null; // off the grid
  const e100k = Math.floor(E / 100000), n100k = Math.floor(N / 100000);
  let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = (((19 - n100k) * 5) % 25) + (e100k % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  const letters = String.fromCharCode(65 + l1) + String.fromCharCode(65 + l2);
  const e3 = String(Math.floor((E % 100000) / 100)).padStart(3, "0");
  const n3 = String(Math.floor((N % 100000) / 100)).padStart(3, "0");
  return `${letters}${e3}${n3}`;
}

// ── Sunrise/sunset (NOAA-style algorithm, runs offline) ────
// Returns times as "HHMM" strings in UK local time (handles
// BST/GMT automatically via the Europe/London timezone).
function sunTimes(date, lat, lng) {
  const rad = Math.PI / 180;
  const dayOfYear = Math.ceil((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);

  const calc = (isSunrise) => {
    const lngHour = lng / 15;
    const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH =
      (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // sun never rises/sets (not at Redhill)
    let H = isSunrise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad;
    H /= 15;
    const T = H + RA - 0.06571 * t - 6.622;
    let UT = T - lngHour;
    UT = ((UT % 24) + 24) % 24;
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    utc.setUTCMinutes(Math.round(UT * 60));
    return utc;
  };

  const fmt = (d) =>
    d === null
      ? "----"
      : new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(d)
          .replace(":", "");

  return `${fmt(calc(true))} / ${fmt(calc(false))}`;
}


// ── Numeric input control ──────────────────────────────────
// Each field kind strips disallowed characters as you type and
// picks the right phone keyboard via inputMode.
const SAN = {
  int: (v) => v.replace(/[^0-9]/g, ""),          // whole numbers
  dec: (v) => v.replace(/[^0-9.]/g, ""),         // decimals
  time: (v) => v.replace(/[^0-9:]/g, ""),        // 1420 or 14:20
  date: (v) => v.replace(/[^0-9.]/g, ""),        // 11.07.2026
  signed: (v) => v.replace(/[^0-9.\-]/g, ""),    // OAT can be negative
};
const KIND_MODE = { int: "numeric", dec: "decimal", time: "numeric", date: "decimal", signed: "text" };
// Header field kinds; anything not listed stays free text.
const HEADER_KIND = {
  date: "date",
  srp: "int",
  gwDep: "int",
  varField: "int",
  plannedFuel: "int",
  hoursAvail: "dec",
};

const label = {
  display: "block",
  fontSize: 11,
  letterSpacing: "0.14em",
  color: C.grey,
  textTransform: "uppercase",
  marginBottom: 6,
  fontFamily: mono,
};

const inputWell = {
  display: "flex",
  alignItems: "baseline",
  background: C.inputBg,
  border: `1px solid ${C.edge}`,
  borderRadius: 6,
  padding: "10px 14px",
};

const inputStyle = (size = 30) => ({
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: C.cyan,
  fontSize: size,
  fontWeight: 500,
  fontFamily: mono,
  width: "100%",
  minWidth: 0,
  textTransform: "uppercase",
});

function PanelHeader({ title, subtitle }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        borderBottom: `1px solid ${C.edge}`,
        paddingBottom: 12,
        marginBottom: 22,
      }}
    >
      <span style={{ color: C.white, fontSize: 14, fontWeight: 600, letterSpacing: "0.18em", fontFamily: mono }}>
        {title}
      </span>
      <span style={{ color: C.grey, fontSize: 11, letterSpacing: "0.1em", fontFamily: mono }}>{subtitle}</span>
    </div>
  );
}

function RefuelBox({ checked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={checked}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        background: C.checkboxBg,
        border: `1px solid ${checked ? C.green : C.edge}`,
        color: C.green,
        fontSize: 16,
        fontWeight: 700,
        fontFamily: mono,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB — Fuel uplift calculator (unchanged from v4)
// ═══════════════════════════════════════════════════════════

function FuelCalc({
  current,
  setCurrent,
  target,
  setTarget,
  density,
  setDensity,
  sourceRow,
  onConfirm,
  powerCheckRow,
  onPowerCheckConfirm,
  onPowerCheckCancel,
}) {
  const c = parseNum(current), t = parseNum(target), d = parseNum(density);

  // Power check entry fields — cleared whenever a new power
  // check begins (powerCheckRow changes).
  const [pc, setPc] = useState({ oat: "", qnh: "", e1n1: "", e1itt: "", e2n1: "", e2itt: "" });
  useEffect(() => {
    setPc({ oat: "", qnh: "", e1n1: "", e1itt: "", e2n1: "", e2itt: "" });
  }, [powerCheckRow]);

  // CONFIRM only unlocks once all six figures are entered.
  const pcComplete = Object.values(pc).every((v) => String(v).trim() !== "");

  const result = useMemo(() => {
    if (c === null || t === null || d === null) return { state: "incomplete" };
    if (d < 0.7 || d > 0.9) return { state: "badDensity" };
    const upliftKg = t - c;
    if (upliftKg < 0) return { state: "overTarget", upliftKg };
    return { state: "ok", upliftKg, litres: upliftKg / d };
  }, [c, t, d]);

  const field = (lab, value, setter, unit, step, note) => (
    <label style={{ display: "block", marginBottom: 18 }}>
      <span style={label}>
        {lab}
        {note && <span style={{ color: C.green, marginLeft: 8, letterSpacing: "0.05em" }}>{note}</span>}
      </span>
      <div style={inputWell}>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setter(SAN.dec(e.target.value))}
          style={inputStyle()}
        />
        <span style={{ color: C.grey, fontSize: 14, marginLeft: 8, fontFamily: mono }}>{unit}</span>
      </div>
    </label>
  );

  // Compact labelled field for the power check grid.
  // OAT is "signed" (can be negative → full keyboard for the
  // minus sign); everything else gets the numeric/decimal pad.
  const PC_KIND = { oat: "signed", qnh: "int", e1n1: "dec", e1itt: "int", e2n1: "dec", e2itt: "int" };
  const pcField = (key, lab, unit) => (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={{ ...label, fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>{lab}</span>
      <div style={{ ...inputWell, padding: "8px 10px" }}>
        <input
          inputMode={KIND_MODE[PC_KIND[key]]}
          value={pc[key]}
          onChange={(e) => setPc({ ...pc, [key]: SAN[PC_KIND[key]](e.target.value) })}
          style={inputStyle(16)}
        />
        <span style={{ color: C.grey, fontSize: 11, marginLeft: 6, fontFamily: mono }}>{unit}</span>
      </div>
    </label>
  );

  return (
    <>
      <PanelHeader title="FUEL UPLIFT" subtitle="JET A-1 · KG → L" />
      {field(
        "FUEL ON BOARD",
        current,
        setCurrent,
        "kg",
        "10",
        sourceRow !== null ? `← FLIGHT ${sourceRow + 1} LANDED FUEL` : null
      )}
      {field("REQUIRED FUEL", target, setTarget, "kg", "10")}
      {field("DENSITY (SG)", density, setDensity, "kg/L", "0.005")}

      <div style={{ background: C.inputBg, border: `1px solid ${C.edge}`, borderRadius: 8, padding: "18px 16px" }}>
        {result.state === "ok" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ color: C.grey, fontSize: 12, letterSpacing: "0.12em", fontFamily: mono }}>UPLIFT</span>
              <span style={{ color: C.white, fontSize: 20, fontWeight: 500, fontFamily: mono }}>
                {result.upliftKg.toFixed(0)} KG
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ color: C.grey, fontSize: 12, letterSpacing: "0.12em", fontFamily: mono }}>ORDER</span>
              <span style={{ color: C.green, fontSize: 44, fontWeight: 600, lineHeight: 1, fontFamily: mono }}>
                {result.litres.toFixed(0)}
                <span style={{ fontSize: 18, color: C.grey, marginLeft: 6 }}>L</span>
              </span>
            </div>
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: `1px dashed ${C.edge}`,
                color: C.grey,
                fontSize: 11,
                lineHeight: 1.5,
                fontFamily: mono,
              }}
            >
              {result.upliftKg.toFixed(0)} KG ÷ {d} KG/L = {result.litres.toFixed(1)} L
            </div>
          </>
        )}
        {result.state === "overTarget" && (
          <div style={{ color: C.amber, fontSize: 14, lineHeight: 1.5, fontFamily: mono }}>
            FUEL ON BOARD EXCEEDS REQUIRED FUEL BY {Math.abs(result.upliftKg).toFixed(0)} KG. NO UPLIFT NEEDED —
            DEFUEL OR REVISE THE FIGURE.
          </div>
        )}
        {result.state === "badDensity" && (
          <div style={{ color: C.amber, fontSize: 14, lineHeight: 1.5, fontFamily: mono }}>
            DENSITY OUTSIDE THE PLAUSIBLE JET A-1 RANGE (0.70–0.90 KG/L). CHECK THE FIGURE.
          </div>
        )}
        {result.state === "incomplete" && (
          <div style={{ color: C.grey, fontSize: 14, fontFamily: mono }}>
            ENTER FUEL ON BOARD, REQUIRED FUEL, AND DENSITY.
          </div>
        )}
      </div>

      {sourceRow !== null && result.state === "ok" && (
        <button
          onClick={() => onConfirm(result.litres, result.upliftKg)}
          style={{
            marginTop: 16,
            width: "100%",
            background: "transparent",
            border: `1px solid ${C.green}80`,
            borderRadius: 8,
            color: C.green,
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.15em",
            padding: "12px 0",
            cursor: "pointer",
          }}
        >
          CONFIRM UPLIFT → FLIGHT {sourceRow + 1}
        </button>
      )}

      {/* ── POWER CHECK DETAILS ─────────────────────────────
          Appears when YES was answered to the power-check
          question on the flight card. All six figures must be
          entered before CONFIRM unlocks. */}
      {powerCheckRow !== null && (
        <div style={{ marginTop: 20, border: `1px solid ${C.green}60`, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <span
              style={{ color: C.green, fontSize: 12, fontWeight: 600, letterSpacing: "0.15em", fontFamily: mono }}
            >
              POWER CHECK DETAILS
            </span>
            <span style={{ color: C.grey, fontSize: 11, fontFamily: mono }}>FLIGHT {powerCheckRow + 1}</span>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {pcField("oat", "TEMP", "°C")}
            {pcField("qnh", "PRESSURE", "HPA")}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, border: `1px solid ${C.edge}`, borderRadius: 6, padding: 10 }}>
              <span style={{ ...label, fontSize: 10, marginBottom: 8 }}>ENG 1</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pcField("e1n1", "N1", "%")}
                {pcField("e1itt", "ITT", "°C")}
              </div>
            </div>
            <div style={{ flex: 1, border: `1px solid ${C.edge}`, borderRadius: 6, padding: 10 }}>
              <span style={{ ...label, fontSize: 10, marginBottom: 8 }}>ENG 2</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pcField("e2n1", "N1", "%")}
                {pcField("e2itt", "ITT", "°C")}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onPowerCheckConfirm(pc)}
              disabled={!pcComplete}
              style={{
                ...btnStyle(pcComplete ? C.green : C.grey),
                opacity: pcComplete ? 1 : 0.5,
                cursor: pcComplete ? "pointer" : "not-allowed",
              }}
            >
              CONFIRM → MISC
            </button>
            <button onClick={onPowerCheckCancel} style={btnStyle(C.grey)}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      <p style={{ marginTop: 16, marginBottom: 0, color: C.grey, fontSize: 10.5, lineHeight: 1.6, fontFamily: mono }}>
        USE THE ACTUAL DENSITY FROM THE FUEL RECEIPT OR BOWSER WHEN AVAILABLE — 0.79 IS NOMINAL AND VARIES WITH
        TEMPERATURE (TYPICALLY 0.775–0.81 KG/L).
      </p>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB — Daily flight card
// ═══════════════════════════════════════════════════════════

// Gross-weight recording threshold (kg): flights computed above
// this get an amber OVER record on the row and on the PDF.
const GW_LIMIT = 4600;

// Header layout (PERF KG is calculated, not typed):
//   DATE            | AC REG
//   SRP             | GW DEP KG
//   VAR TOW KG      | PERF KG      (= VAR TOW − GW DEP, auto)
//   PLANNED FUEL KG | HOURS AVAILABLE
//   SUNRISE / SUNSET (full width)
const HEADER_FIELDS = [
  ["date", "DATE"],
  ["acReg", "AC REG"],
  ["srp", "SRP"],
  ["gwDep", "GW DEP KG"],
  ["varField", "VAR TOW KG"],
  ["perfKg", "PERF KG"], // rendered as a computed cell, see below
  ["plannedFuel", "PLANNED FUEL KG"],
  ["hoursAvail", "HOURS AVAILABLE"],
  ["sunriseSet", "SUNRISE / SUNSET"],
];

function freshCard() {
  const date = todayString();
  const d = parseCardDate(date);
  return {
    date,
    acReg: "",
    srp: "",
    gwDep: "",
    varField: "",
    plannedFuel: "",
    hoursAvail: "",
    sunriseSet: d ? sunTimes(d, REDHILL.lat, REDHILL.lng) : "",
    rows: Array.from({ length: NUM_ROWS }, () => ({
      fltTime: "",
      shtdwn: "",
      fuel: "",
      notes: "",
      refuel: false,
      upliftL: "",
      hems: false,
      hemsGrid: "",
      pwr: false,
      patientKg: "",
    })),
    misc: "",
    powerChecks: [], // [{row, oat, qnh, e1n1, e1itt, e2n1, e2itt}]
  };
}

const STORAGE_KEY = "daily-flight-card";
const LAST_REG_KEY = "last-ac-reg";
const GROUND_RUN = "GROUND RUN";
const GR_POWER_CHECK = "GROUND RUN – POWER CHECK";
const PWR_ONLY = "POWER CHECK";
const AUTO_NOTES = ["", GROUND_RUN, GR_POWER_CHECK, PWR_ONLY];

// What the auto-note should say for a given row state.
function autoNoteFor(isZeroTime, pwr) {
  if (isZeroTime && pwr) return GR_POWER_CHECK;
  if (isZeroTime) return GROUND_RUN;
  if (pwr) return PWR_ONLY;
  return "";
}


// ── PDF export ─────────────────────────────────────────────
// Renders the whole card to an A4 PDF entirely on-device.
function makeCardPdf(card, rowGW, bst, email) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 14;
  let y = 16;

  const line = (txt, size = 9, style = "normal", color = [20, 20, 20]) => {
    doc.setFont("courier", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(String(txt), M, y);
    y += size * 0.55;
  };

  doc.setFont("courier", "bold");
  doc.setFontSize(13);
  doc.text("GAMA KSS DAILY FLIGHT CARD", M, y);
  doc.setFontSize(10);
  doc.text(card.date || "", W - M, y, { align: "right" });
  y += 4;
  doc.setLineWidth(0.4);
  doc.line(M, y, W - M, y);
  y += 7;

  const gw = parseNum(card.gwDep), vt = parseNum(card.varField);
  const perf = gw !== null && vt !== null ? vt - gw : null;
  const hdr = [
    ["AC REG", card.acReg.trim()],
    ["SRP", card.srp],
    ["GW DEP KG", card.gwDep],
    ["VAR TOW KG", card.varField],
    ["PERF KG", perf === null ? "" : `${perf > 0 ? "+" : ""}${perf.toFixed(0)}`],
    ["PLANNED FUEL KG", card.plannedFuel],
    ["HOURS AVAILABLE", card.hoursAvail],
    ["SUNRISE / SUNSET", card.sunriseSet],
  ];
  doc.setFontSize(9);
  hdr.forEach(([k, v], idx) => {
    const col = idx % 2, rowN = Math.floor(idx / 2);
    const x = M + col * ((W - 2 * M) / 2);
    const yy = y + rowN * 6;
    doc.setFont("courier", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text(k + ":", x, yy);
    doc.setFont("courier", "bold");
    doc.setTextColor(20, 20, 20);
    doc.text(String(v || "-"), x + 38, yy);
  });
  y += Math.ceil(hdr.length / 2) * 6 + 4;
  doc.line(M, y, W - M, y);
  y += 6;

  // Flights
  card.rows.forEach((r, i) => {
    const used =
      r.fltTime || r.shtdwn || r.fuel || r.notes || r.refuel || r.hems || r.pwr;
    if (!used) return;
    const zulu = bst ? zuluFromLocal(r.shtdwn, true) : null;
    const w = rowGW(r);
    const flags = [];
    if (r.refuel) flags.push(r.upliftL ? `REFUEL ${r.upliftL} L` : "REFUEL");
    if (r.pwr) flags.push("PWR CHECK");
    if (r.hems)
      flags.push(
        `HEMS${r.hemsGrid && r.hemsGrid !== "N/A" && r.hemsGrid !== "…" ? " " + r.hemsGrid : ""}${
          r.patientKg ? ` PT ${r.patientKg} KG` : ""
        }`
      );

    doc.setFont("courier", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    doc.text(
      `${i + 1}.  ${String(r.fltTime || "-").padStart(3)} MIN   SHTDWN ${r.shtdwn || "-"}${
        zulu ? ` (${zulu.toUpperCase()})` : ""
      }   FUEL ${r.fuel || "-"} KG`,
      M,
      y
    );
    y += 4.6;

    if (w !== null) {
      const over = w > GW_LIMIT;
      doc.setFont("courier", over ? "bold" : "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...(over ? [200, 120, 0] : [110, 110, 110]));
      doc.text(`    GW ${w.toFixed(0)} KG${over ? ` — OVER ${GW_LIMIT} KG` : ""}`, M, y);
      y += 4.2;
    }
    if (flags.length) {
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(0, 130, 60);
      doc.text("    " + flags.join("  ·  "), M, y);
      y += 4.2;
    }
    if (r.notes) {
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(60, 60, 60);
      const wrapped = doc.splitTextToSize("    NOTES: " + r.notes, W - 2 * M);
      doc.text(wrapped, M, y);
      y += wrapped.length * 3.9;
    }
    y += 2.2;
    if (y > 265) {
      doc.addPage();
      y = 16;
    }
  });

  // Power checks
  if (card.powerChecks.length) {
    y += 2;
    doc.setFont("courier", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(0, 130, 60);
    doc.text("POWER CHECKS", M, y);
    y += 5;
    doc.setFontSize(8.5);
    card.powerChecks.forEach((p) => {
      doc.setFont("courier", "normal");
      doc.text(
        `FLT ${p.row + 1}: OAT ${p.oat} C  QNH ${p.qnh} HPA  ENG1 N1 ${p.e1n1}% ITT ${p.e1itt} C  ENG2 N1 ${p.e2n1}% ITT ${p.e2itt} C`,
        M,
        y
      );
      y += 4.4;
    });
  }

  // Misc
  if (card.misc) {
    y += 3;
    doc.setFont("courier", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    doc.text("MISC", M, y);
    y += 5;
    doc.setFont("courier", "normal");
    doc.setFontSize(8.5);
    const wrapped = doc.splitTextToSize(card.misc, W - 2 * M);
    doc.text(wrapped, M, y);
    y += wrapped.length * 3.9;
  }

  // Footer
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(`SUBMIT TO: ${email}`, M, 290);
  doc.text("GENERATED BY DAILY FLIGHT CARD APP", W - M, 290, { align: "right" });

  return doc;
}

function FlightCard({
  onRefuel,
  onPowerCheckStart,
  onPlannedFuel,
  pendingUplift,
  onPendingApplied,
  pendingPowerCheck,
  onPowerCheckApplied,
}) {
  const [card, setCard] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [powerCheckAsk, setPowerCheckAsk] = useState(null);
  const [lastReg, setLastReg] = useState(null); // most recently flown aircraft
  const [email, setEmail] = useState("edward.worsley@gamaaviation.com"); // per-device
  const [exporting, setExporting] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      // Last-used aircraft (for pick-list ordering); ignore if unset.
      try {
        const lr = await storage.get(LAST_REG_KEY);
        if (lr && AC_REGS.includes(lr.value)) setLastReg(lr.value);
      } catch {}
      // Per-device send-to email for the PDF.
      try {
        const em = await storage.get("send-email");
        if (em && em.value) setEmail(em.value);
      } catch {}
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res) {
          const saved = JSON.parse(res.value);
          saved.rows = saved.rows
            .slice(0, NUM_ROWS)
            .map((r) => ({ refuel: false, upliftL: "", hems: false, hemsGrid: "", pwr: false, patientKg: "", ...r }));
          while (saved.rows.length < NUM_ROWS)
            saved.rows.push({
              fltTime: "",
              shtdwn: "",
              fuel: "",
              notes: "",
              refuel: false,
              upliftL: "",
              hems: false,
              hemsGrid: "",
              pwr: false,
              patientKg: "",
            });
          if (!saved.powerChecks) saved.powerChecks = [];
          // Migrate older cards: TDP–WAT value carries over to GW DEP.
          if (saved.gwDep === undefined) saved.gwDep = saved.tdpWat || "";
          if (saved.plannedFuel === undefined) saved.plannedFuel = "";
          if (saved.plannedFuel) onPlannedFuel(saved.plannedFuel);
          // Fill sunrise/sunset if the saved card doesn't have it.
          if (!saved.sunriseSet) {
            const d = parseCardDate(saved.date);
            if (d) saved.sunriseSet = sunTimes(d, REDHILL.lat, REDHILL.lng);
          }
          setCard(saved);
        } else {
          setCard(freshCard());
        }
      } catch {
        setCard(freshCard());
      }
    })();
  }, []);

  const scheduleSave = useCallback((next) => {
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(next));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
  }, []);

  const update = (patch) => {
    const next = { ...card, ...patch };
    setCard(next);
    scheduleSave(next);
  };

  const updateRow = (i, patch, extraPatch = {}) => {
    const rows = card.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    update({ rows, ...extraPatch });
  };

  // Async-safe variant for callbacks that fire later (e.g. the
  // geolocation result) — works from the latest state rather
  // than a stale snapshot.
  const updateRowAsync = (i, patch) => {
    setCard((prev) => {
      if (!prev) return prev;
      const next = { ...prev, rows: prev.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) };
      scheduleSave(next);
      return next;
    });
  };

  // DATE edited: if it parses as a real date, recompute
  // Redhill sunrise/sunset for that date automatically.
  const setDate = (value) => {
    const v = SAN.date(value).toUpperCase();
    const d = parseCardDate(v);
    if (d) {
      update({ date: v, sunriseSet: sunTimes(d, REDHILL.lat, REDHILL.lng) });
    } else {
      update({ date: v });
    }
  };

  // True once any power check exists or is ticked anywhere on
  // the card — only one is required per card, so the 0-minute
  // prompt stops asking after that.
  const cardHasPowerCheck = () =>
    card.powerChecks.length > 0 || card.rows.some((r) => r.pwr);

  const setFltTime = (i, value) => {
    const row = card.rows[i];
    const v = value.toUpperCase();
    const isZero = v.trim() === "0";
    const noteIsAuto = AUTO_NOTES.includes(row.notes);

    // Auto-notes track the row state; typed notes are never touched.
    // Power check records are KEPT even if the time changes from 0 —
    // it just stops being a ground run.
    const patch = { fltTime: v };
    if (noteIsAuto) patch.notes = autoNoteFor(isZero, row.pwr);
    updateRow(i, patch);

    if (isZero && !row.pwr && !cardHasPowerCheck()) {
      setPowerCheckAsk(i);
    } else if (!isZero && powerCheckAsk === i) {
      setPowerCheckAsk(null);
    }
  };

  const answerPowerCheck = (i, yes) => {
    setPowerCheckAsk(null);
    if (yes) togglePwr(i); // same path as ticking the PWR box
  };

  // PWR checkbox: ticking opens the details panel on the uplift
  // tab; unticking removes that row's record from MISC.
  const togglePwr = (i) => {
    const row = card.rows[i];
    const next = !row.pwr;
    const isZero = row.fltTime.trim() === "0";
    const noteIsAuto = AUTO_NOTES.includes(row.notes);
    const patch = { pwr: next };
    if (noteIsAuto) patch.notes = autoNoteFor(isZero, next);
    updateRow(i, patch, next ? {} : { powerChecks: card.powerChecks.filter((p) => p.row !== i) });
    if (next) onPowerCheckStart(i);
  };

  // HEMS checkbox: ticking grabs the phone's position and stores
  // the six-figure OS grid reference; unticking clears it.
  const toggleHems = (i) => {
    const row = card.rows[i];
    const next = !row.hems;
    if (!next) {
      updateRow(i, { hems: false, hemsGrid: "" });
      return;
    }
    updateRow(i, { hems: true, hemsGrid: "…" });
    if (!navigator.geolocation) {
      updateRowAsync(i, { hemsGrid: "N/A" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const grid = latLonToOSGrid(pos.coords.latitude, pos.coords.longitude);
        updateRowAsync(i, { hemsGrid: grid || "N/A" });
      },
      () => updateRowAsync(i, { hemsGrid: "N/A" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  useEffect(() => {
    if (pendingUplift && card) {
      updateRow(pendingUplift.row, { upliftL: pendingUplift.litres.toFixed(0) });
      onPendingApplied();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUplift, card === null]);

  // Apply confirmed power check details — one record per row,
  // so re-doing a power check replaces the old figures.
  useEffect(() => {
    if (pendingPowerCheck && card) {
      const others = card.powerChecks.filter((p) => p.row !== pendingPowerCheck.row);
      update({ powerChecks: [...others, pendingPowerCheck].sort((a, b) => a.row - b.row) });
      onPowerCheckApplied();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPowerCheck, card === null]);

  const toggleRefuel = (i) => {
    const row = card.rows[i];
    const next = !row.refuel;
    updateRow(i, { refuel: next, ...(next ? {} : { upliftL: "" }) });
    if (next) onRefuel(row.fuel, i);
  };

  const newCard = () => {
    const next = freshCard();
    setCard(next);
    scheduleSave(next);
    setConfirming(false);
    setPowerCheckAsk(null);
    onPlannedFuel("");
  };

  // Generate the PDF and hand it to the iOS share sheet (Mail is
  // one tap away with the PDF attached — iOS doesn't allow the
  // recipient to be pre-filled from the share sheet). Falls back
  // to a straight download on desktop browsers. Only clears the
  // card once the share/download actually went ahead.
  const exportAndClear = async () => {
    setExporting(true);
    try {
      const doc = makeCardPdf(card, rowGrossWeight, bst, email);
      // The filename is what Mail uses as the draft subject when
      // sharing a file from the share sheet, so build it as:
      // "G-KSST SRP 1234 11.07.2026".
      const subject = [
        card.acReg.trim() || "AC",
        card.srp ? `SRP ${card.srp}` : null,
        card.date || "UNDATED",
      ]
        .filter(Boolean)
        .join(" ");
      const name = `${subject}.pdf`;
      const blob = doc.output("blob");
      const file = new File([blob], name, { type: "application/pdf" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: subject, text: subject });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }
      newCard();
    } catch (err) {
      // Share sheet dismissed or failed — keep the card intact.
      setConfirming(false);
    }
    setExporting(false);
  };

  const totalMins = useMemo(
    () =>
      card
        ? card.rows.map((r) => parseMinutes(r.fltTime)).filter((v) => v !== null).reduce((a, b) => a + b, 0)
        : 0,
    [card]
  );
  const availMins = card ? parseAvailMinutes(card.hoursAvail) : null;
  const remaining = availMins !== null ? availMins - totalMins : null;

  if (!card) return <div style={{ color: C.grey, fontFamily: mono, fontSize: 14 }}>LOADING CARD…</div>;

  // ── AC REG dropdown (with OTHER → manual entry) ──────────
  // card.acReg stays the single stored value. If it matches a
  // listed reg the dropdown shows it; anything else shows as
  // OTHER with the manual box underneath. A single space is
  // used as the "OTHER selected but nothing typed yet" state.
  const regIsListed = AC_REGS.includes(card.acReg);
  const regSelectValue = regIsListed ? card.acReg : card.acReg === "" ? "" : "OTHER";

  // Last-flown aircraft floats to the top of the pick list.
  const orderedRegs = lastReg ? [lastReg, ...AC_REGS.filter((r) => r !== lastReg)] : AC_REGS;

  const rememberReg = (reg) => {
    if (!AC_REGS.includes(reg)) return;
    setLastReg(reg);
    storage.set(LAST_REG_KEY, reg).catch(() => {});
  };

  const acRegField = (
    <label key="acReg" style={{ flex: 1, minWidth: 0 }}>
      <span style={{ ...label, fontSize: 10, marginBottom: 4 }}>AC REG</span>
      <select
        value={regSelectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v !== "OTHER") rememberReg(v);
          update({ acReg: v === "OTHER" ? (regIsListed || card.acReg === "" ? " " : card.acReg) : v });
        }}
        style={{
          ...inputStyle(16),
          ...inputWell,
          display: "block",
          padding: "8px 10px",
          appearance: "none",
          WebkitAppearance: "none",
          cursor: "pointer",
        }}
      >
        <option value="" disabled></option>
        {orderedRegs.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value="OTHER">OTHER</option>
      </select>
      {regSelectValue === "OTHER" && (
        <input
          value={card.acReg.trim()}
          placeholder="ENTER REG"
          onChange={(e) => update({ acReg: e.target.value.toUpperCase() || " " })}
          style={{ ...inputStyle(16), ...inputWell, display: "block", padding: "8px 10px", marginTop: 6 }}
        />
      )}
    </label>
  );

  const smallField = (key, lab) =>
    key === "acReg" ? (
      acRegField
    ) : key === "perfKg" ? (
      perfField
    ) : (
      <label key={key} style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...label, fontSize: 10, marginBottom: 4 }}>{lab}</span>
        <input
          value={card[key]}
          inputMode={HEADER_KIND[key] ? KIND_MODE[HEADER_KIND[key]] : undefined}
          onChange={(e) => {
            const kind = HEADER_KIND[key];
            const v = (kind ? SAN[kind](e.target.value) : e.target.value).toUpperCase();
            if (key === "date") return setDate(v);
            update({ [key]: v });
            // Planned fuel drives the uplift REQUIRED FUEL box.
            if (key === "plannedFuel") onPlannedFuel(v);
          }}
          style={{ ...inputStyle(16), ...inputWell, display: "block", padding: "8px 10px" }}
        />
      </label>
    );

  const saveLabel = { saving: "SAVING…", saved: "SAVED", error: "SAVE FAILED", idle: "" }[saveState];

  // ── PERF KG: computed, not typed. VAR TOW − GW DEP. ──────
  // Positive (green) = margin in hand; negative (amber) = over.
  const gw = parseNum(card.gwDep);
  const vt = parseNum(card.varField);
  const perf = gw !== null && vt !== null ? vt - gw : null;

  const perfField = (
    <div key="perfKg" style={{ flex: 1, minWidth: 0 }}>
      <span style={{ ...label, fontSize: 10, marginBottom: 4 }}>PERF KG</span>
      <div
        style={{
          ...inputWell,
          padding: "8px 10px",
          justifyContent: "flex-start",
        }}
      >
        <span
          style={{
            color: perf === null ? C.grey : perf < 0 ? C.amber : C.green,
            fontSize: 16,
            fontWeight: 600,
            fontFamily: mono,
          }}
        >
          {perf === null ? "—" : `${perf > 0 ? "+" : ""}${perf.toFixed(0)} KG`}
        </span>
      </div>
    </div>
  );

  // Card date drives whether shutdown times get a Zulu line.
  const cardDateObj = parseCardDate(card.date);
  const bst = cardDateObj ? isBST(cardDateObj) : isBST(new Date());

  // ── Per-flight gross weight ──────────────────────────────
  // GW = GW DEP + (landed fuel − planned fuel) + patient (HEMS).
  // Needs GW DEP, PLANNED FUEL and the row's landed fuel; the
  // patient weight only counts on HEMS flights. Over GW_LIMIT
  // is recorded in amber on the row (and carried to the PDF).
  const rowGrossWeight = (row) => {
    const gwd = parseNum(card.gwDep);
    const planned = parseNum(card.plannedFuel);
    const landed = parseNum(row.fuel);
    if (gwd === null || planned === null || landed === null) return null;
    const patient = row.hems ? parseNum(row.patientKg) || 0 : 0;
    return gwd + (landed - planned) + patient;
  };

  return (
    <>
      <PanelHeader title="DAILY FLIGHT CARD" subtitle="REDHILL EGKR" />

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
        {[0, 2, 4, 6].map((i) => (
          <div key={i} style={{ display: "flex", gap: 12 }}>
            {smallField(...HEADER_FIELDS[i])}
            {smallField(...HEADER_FIELDS[i + 1])}
          </div>
        ))}
        <div style={{ display: "flex", gap: 12 }}>{smallField(...HEADER_FIELDS[8])}</div>
      </div>

      {/* AVAILABLE / FLOWN / REMAINING — hours to maintenance,
          counting down in h:mm as flight minutes are entered */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          background: C.inputBg,
          border: `1px solid ${C.edge}`,
          borderRadius: 8,
          padding: 14,
          marginBottom: 18,
        }}
      >
        <div>
          <span style={{ ...label, fontSize: 10, marginBottom: 2 }}>AVAILABLE</span>
          <span style={{ color: C.grey, fontSize: 22, fontWeight: 600, fontFamily: mono }}>
            {availMins === null ? "—" : formatMinutes(availMins)}
          </span>
        </div>
        <div style={{ textAlign: "center" }}>
          <span style={{ ...label, fontSize: 10, marginBottom: 2 }}>FLOWN</span>
          <span style={{ color: C.white, fontSize: 22, fontWeight: 600, fontFamily: mono }}>
            {formatMinutes(totalMins)}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ ...label, fontSize: 10, marginBottom: 2 }}>REMAINING</span>
          <span
            style={{
              color: remaining === null ? C.grey : remaining < 0 ? C.amber : C.green,
              fontSize: 22,
              fontWeight: 600,
              fontFamily: mono,
            }}
          >
            {remaining === null ? "—" : formatMinutes(remaining)}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {card.rows.map((row, i) => (
          <div
            key={i}
            style={{
              background: C.inputBg,
              border: `1px solid ${row.refuel ? C.green + "60" : C.edge}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                style={{
                  color: C.grey,
                  fontFamily: mono,
                  fontSize: 14,
                  fontWeight: 600,
                  width: 18,
                  paddingTop: 16,
                }}
              >
                {i + 1}
              </span>

              <label style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>FLT MIN</span>
                <input
                  value={row.fltTime}
                  inputMode="numeric"
                  onChange={(e) => setFltTime(i, SAN.int(e.target.value))}
                  style={{ ...inputStyle(15), display: "block", width: "100%" }}
                />
              </label>

              <label style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>SHTDWN</span>
                <input
                  value={row.shtdwn}
                  inputMode="numeric"
                  onChange={(e) => updateRow(i, { shtdwn: SAN.time(e.target.value) })}
                  style={{ ...inputStyle(15), display: "block", width: "100%" }}
                />
                {/* In BST, the Zulu equivalent appears in green
                    underneath (in GMT local time IS Zulu). */}
                {bst && zuluFromLocal(row.shtdwn, true) && (
                  <span
                    style={{
                      display: "block",
                      color: C.green,
                      fontFamily: mono,
                      fontSize: 12,
                      fontWeight: 600,
                      marginTop: 3,
                    }}
                  >
                    {zuluFromLocal(row.shtdwn, true)}
                  </span>
                )}
              </label>

              <label style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>FUEL KG</span>
                <input
                  value={row.fuel}
                  inputMode="numeric"
                  onChange={(e) => updateRow(i, { fuel: SAN.int(e.target.value) })}
                  style={{ ...inputStyle(15), display: "block", width: "100%" }}
                />
                {row.upliftL && (
                  <span
                    style={{
                      display: "block",
                      color: C.green,
                      fontFamily: mono,
                      fontSize: 12,
                      fontWeight: 600,
                      marginTop: 3,
                    }}
                  >
                    ↑ {row.upliftL} L
                  </span>
                )}
              </label>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>REFUEL</span>
                <RefuelBox checked={row.refuel} onToggle={() => toggleRefuel(i)} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-start" }}>
              <span style={{ width: 18 }} />
              <label style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>NOTES</span>
                <input
                  value={row.notes}
                  onChange={(e) => updateRow(i, { notes: e.target.value.toUpperCase() })}
                  style={{ ...inputStyle(15), display: "block", width: "100%" }}
                />
                {/* Six-figure OS grid from the HEMS checkbox —
                    green when captured, amber if unavailable */}
                {row.hems && row.hemsGrid && (
                  <span
                    style={{
                      display: "block",
                      color: row.hemsGrid === "N/A" ? C.amber : C.green,
                      fontFamily: mono,
                      fontSize: 12,
                      fontWeight: 600,
                      marginTop: 3,
                    }}
                  >
                    {row.hemsGrid === "N/A"
                      ? "HEMS · GRID UNAVAILABLE"
                      : row.hemsGrid === "…"
                      ? "HEMS · FIXING…"
                      : `HEMS · ${row.hemsGrid.slice(0, 2)} ${row.hemsGrid.slice(2, 5)} ${row.hemsGrid.slice(5)}`}
                  </span>
                )}
              </label>

              {/* Patient weight — only relevant on HEMS flights */}
              {row.hems && (
                <label style={{ width: 84 }}>
                  <span style={{ ...label, fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>PATIENT KG</span>
                  <input
                    value={row.patientKg}
                    inputMode="numeric"
                    onChange={(e) => updateRow(i, { patientKg: SAN.int(e.target.value) })}
                    style={{ ...inputStyle(15), display: "block", width: "100%" }}
                  />
                </label>
              )}

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>HEMS</span>
                <RefuelBox checked={row.hems} onToggle={() => toggleHems(i)} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ ...label, fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>PWR</span>
                <RefuelBox checked={row.pwr} onToggle={() => togglePwr(i)} />
              </div>
            </div>

            {/* Computed gross weight for this flight */}
            {rowGrossWeight(row) !== null && (
              <div
                style={{
                  marginTop: 8,
                  paddingLeft: 28,
                  fontFamily: mono,
                  fontSize: 12,
                  fontWeight: 600,
                  color: rowGrossWeight(row) > GW_LIMIT ? C.amber : C.grey,
                }}
              >
                GW {rowGrossWeight(row).toFixed(0)} KG
                {rowGrossWeight(row) > GW_LIMIT ? ` — OVER ${GW_LIMIT} KG` : ""}
              </div>
            )}

            {powerCheckAsk === i && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 10,
                  padding: "8px 10px",
                  border: `1px solid ${C.amber}60`,
                  borderRadius: 6,
                }}
              >
                <span style={{ color: C.amber, fontFamily: mono, fontSize: 12, flex: 1 }}>
                  GROUND RUN — POWER CHECK?
                </span>
                <button onClick={() => answerPowerCheck(i, true)} style={miniBtn(C.green)}>
                  YES
                </button>
                <button onClick={() => answerPowerCheck(i, false)} style={miniBtn(C.grey)}>
                  NO
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18 }}>
        <span style={label}>MISC</span>

        {/* Power check records — neat green, one per flight */}
        {card.powerChecks.length > 0 && (
          <div
            style={{
              border: `1px solid ${C.green}50`,
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {card.powerChecks.map((p) => (
              <div key={p.row} style={{ color: C.green, fontFamily: mono, fontSize: 12, lineHeight: 1.7 }}>
                <span style={{ fontWeight: 700 }}>FLT {p.row + 1} POWER CHECK</span>
                {"  ·  "}OAT {p.oat}°C{"  ·  "}QNH {p.qnh} HPA
                <br />
                ENG1 N1 {p.e1n1}% ITT {p.e1itt}°C{"  ·  "}ENG2 N1 {p.e2n1}% ITT {p.e2itt}°C
              </div>
            ))}
          </div>
        )}

        <textarea
          value={card.misc}
          onChange={(e) => update({ misc: e.target.value.toUpperCase() })}
          rows={3}
          style={{
            ...inputStyle(15),
            display: "block",
            width: "100%",
            background: C.inputBg,
            border: `1px solid ${C.edge}`,
            borderRadius: 8,
            padding: 12,
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Per-device send-to email — printed on the PDF footer */}
      <label style={{ display: "block", marginBottom: 14 }}>
        <span style={{ ...label, fontSize: 10 }}>SEND PDF TO (THIS DEVICE)</span>
        <input
          value={email}
          inputMode="email"
          autoCapitalize="none"
          onChange={(e) => {
            const v = e.target.value.toLowerCase();
            setEmail(v);
            storage.set("send-email", v).catch(() => {});
          }}
          style={{
            ...inputStyle(14),
            ...inputWell,
            display: "block",
            padding: "8px 10px",
            textTransform: "lowercase",
          }}
        />
      </label>

      {confirming ? (
        <div style={{ border: `1px solid ${C.amber}`, borderRadius: 8, padding: 14, fontFamily: mono }}>
          <p style={{ color: C.amber, fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
            NEW CARD: EXPORT THE PDF FIRST (SHARE SHEET → MAIL, THEN SEND TO {email.toUpperCase()}), OR CLEAR
            WITHOUT EXPORTING. CLEARING WIPES EVERY FIELD.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={exportAndClear} disabled={exporting} style={btnStyle(C.green)}>
              {exporting ? "EXPORTING…" : "EXPORT PDF & NEW CARD"}
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={newCard} style={btnStyle(C.amber)}>
                CLEAR WITHOUT PDF
              </button>
              <button onClick={() => setConfirming(false)} style={btnStyle(C.grey)}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} style={btnStyle(C.amber)}>
          NEW CARD
        </button>
      )}

      <div
        style={{
          marginTop: 10,
          textAlign: "right",
          color: saveState === "error" ? C.amber : C.grey,
          fontSize: 10,
          fontFamily: mono,
          letterSpacing: "0.1em",
          minHeight: 12,
        }}
      >
        {saveLabel}
      </div>
    </>
  );
}

function btnStyle(color) {
  return {
    flex: 1,
    background: "transparent",
    border: `1px solid ${color}80`,
    borderRadius: 8,
    color,
    fontFamily: mono,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.15em",
    padding: "12px 0",
    cursor: "pointer",
    width: "100%",
  };
}

function miniBtn(color) {
  return {
    background: "transparent",
    border: `1px solid ${color}80`,
    borderRadius: 6,
    color,
    fontFamily: mono,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.1em",
    padding: "6px 14px",
    cursor: "pointer",
  };
}

// ═══════════════════════════════════════════════════════════
// App shell
// ═══════════════════════════════════════════════════════════

function App() {
  const [tab, setTab] = useState("card");

  const [current, setCurrent] = useState("300");
  const [target, setTarget] = useState("650");
  const [density, setDensity] = useState("0.79");
  const [sourceRow, setSourceRow] = useState(null);
  const [pendingUplift, setPendingUplift] = useState(null);

  // Power check: which row's details are being entered on the
  // uplift tab, and confirmed details waiting to land in MISC.
  const [powerCheckRow, setPowerCheckRow] = useState(null);
  const [pendingPowerCheck, setPendingPowerCheck] = useState(null);

  const handleRefuel = (fuelKg, rowIndex) => {
    setCurrent(String(fuelKg).trim());
    setSourceRow(rowIndex);
    setTab("uplift");
  };

  const handleConfirm = (litres) => {
    setPendingUplift({ row: sourceRow, litres });
    setSourceRow(null);
    setTab("card");
  };

  const handlePowerCheckStart = (rowIndex) => {
    setPowerCheckRow(rowIndex);
    setTab("uplift");
  };

  const handlePowerCheckConfirm = (pc) => {
    setPendingPowerCheck({ row: powerCheckRow, ...pc });
    setPowerCheckRow(null);
    setTab("card");
  };

  const handlePowerCheckCancel = () => {
    setPowerCheckRow(null);
    setTab("card");
  };

  const setCurrentManual = (v) => {
    setCurrent(v);
    setSourceRow(null);
  };

  const tabBtn = (id, text) => (
    <button
      onClick={() => setTab(id)}
      style={{
        flex: 1,
        background: tab === id ? C.panel : "transparent",
        border: `1px solid ${tab === id ? C.edge : "transparent"}`,
        borderRadius: 8,
        color: tab === id ? C.cyan : C.grey,
        fontFamily: mono,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.15em",
        padding: "12px 0",
        cursor: "pointer",
      }}
    >
      {text}
    </button>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        justifyContent: "center",
        padding: 16,
        fontFamily: mono,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${C.cyan}; outline-offset: 2px; border-radius: 2px; }
        select option { background: ${C.inputBg}; color: ${C.cyan}; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {tabBtn("card", "FLIGHT CARD")}
          {tabBtn("uplift", "UPLIFT")}
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.edge}`,
            borderRadius: 12,
            padding: "24px 22px 22px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ display: tab === "card" ? "block" : "none" }}>
            <FlightCard
              onRefuel={handleRefuel}
              onPowerCheckStart={handlePowerCheckStart}
              onPlannedFuel={(v) => setTarget(v)}
              pendingUplift={pendingUplift}
              onPendingApplied={() => setPendingUplift(null)}
              pendingPowerCheck={pendingPowerCheck}
              onPowerCheckApplied={() => setPendingPowerCheck(null)}
            />
          </div>
          <div style={{ display: tab === "uplift" ? "block" : "none" }}>
            <FuelCalc
              current={current}
              setCurrent={setCurrentManual}
              target={target}
              setTarget={setTarget}
              density={density}
              setDensity={setDensity}
              sourceRow={sourceRow}
              onConfirm={handleConfirm}
              powerCheckRow={powerCheckRow}
              onPowerCheckConfirm={handlePowerCheckConfirm}
              onPowerCheckCancel={handlePowerCheckCancel}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Mount ──────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<App />);
