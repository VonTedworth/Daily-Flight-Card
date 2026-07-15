import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";

// ═══════════════════════════════════════════════════════════
// Fuel Uplift + Daily Flight Card — v10
// UX pass:
//  1. NOW button stamps the shutdown time in one tap.
//  2. Ticking REFUEL calculates the litres inline on the row
//     (planned − landed ÷ density) — no tab switch for the
//     routine case. The uplift tab remains for odd cases.
//  3. Used flights stay fully expanded; empty rows stay
//     hidden until needed. Last 4 cards kept for post-editing.
//  4. DAY/NIGHT theme toggle (day = high contrast for sunlight).
//  5. Power check is once per card: the 0-minute ground-run
//     prompt triggers it, or the POWER CHECK button by MISC.
//     No per-flight checkbox.
// ═══════════════════════════════════════════════════════════

// localStorage shim with the async storage API shape.
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

// ── Themes ─────────────────────────────────────────────────
// C is swapped wholesale between night (MFD) and day (sunlight)
// palettes; the app remounts on toggle so everything re-reads it.
const NIGHT = {
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
const DAY = {
  bg: "#d9dde2",
  panel: "#ffffff",
  edge: "#b7bfc7",
  inputBg: "#eef1f4",
  checkboxBg: "#e2e6ea",
  cyan: "#075b6d",
  green: "#136b36",
  grey: "#4a545e",
  amber: "#9a4a00",
  white: "#10151b",
};
const C = { ...NIGHT };

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const NUM_ROWS = 7; // one SRP page has seven sectors
// >4600 kg is NOT an exceedance — the AW169 all-up mass is 4800 kg.
// Flights over 4600 must be noted on the SRP (maintenance penalties).
const SRP_NOTE_WT = 4600;
const MTOW = 4800;
const REDHILL = { lat: 51.2136, lng: -0.1386 };
const AC_REGS = ["G-LNAC", "G-MGPS", "G-KSSC", "G-KSST", "G-ICER"];

// ── Parsing / formatting helpers ───────────────────────────

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

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseCardDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

function isBST(date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "short" })
    .formatToParts(date)
    .some((p) => p.type === "timeZoneName" && p.value === "BST");
}

function zuluFromLocal(text, bst) {
  const m = String(text).trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  let total = h * 60 + min - (bst ? 60 : 0);
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}z`;
}

// Sunrise/sunset for Redhill (NOAA algorithm, offline, UK time).
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
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
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
      : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false })
          .format(d)
          .replace(":", "");
  return `${fmt(calc(true))} / ${fmt(calc(false))}`;
}

// WGS84 → OSGB36 six-figure grid reference (fully offline).
function latLonToOSGrid(latDeg, lonDeg) {
  const rad = Math.PI / 180;
  let a = 6378137.0, b = 6356752.3142;
  let e2 = 1 - (b * b) / (a * a);
  let lat = latDeg * rad, lon = lonDeg * rad;
  let nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  let x = nu * Math.cos(lat) * Math.cos(lon);
  let y = nu * Math.cos(lat) * Math.sin(lon);
  let z = nu * (1 - e2) * Math.sin(lat);
  const tx = -446.448, ty = 125.157, tz = -542.06;
  const s = 20.4894e-6;
  const rx = (-0.1502 / 3600) * rad, ry = (-0.247 / 3600) * rad, rz = (-0.8421 / 3600) * rad;
  const x2 = tx + x * (1 + s) - y * rz + z * ry;
  const y2 = ty + x * rz + y * (1 + s) - z * rx;
  const z2 = tz - x * ry + y * rx + z * (1 + s);
  a = 6377563.396; b = 6356256.909;
  e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  lat = Math.atan2(z2, p * (1 - e2));
  for (let i = 0; i < 8; i++) {
    nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z2 + e2 * nu * Math.sin(lat), p);
  }
  lon = Math.atan2(y2, x2);
  const F0 = 0.9996012717, lat0 = 49 * rad, lon0 = -2 * rad, N0 = -100000, E0 = 400000;
  const n = (a - b) / (a + b);
  nu = (a * F0) / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * Math.sin(lat) ** 2, 1.5);
  const eta2 = nu / rho - 1;
  const dLat = lat - lat0, sLat = lat + lat0;
  const Ma = (1 + n + (5 / 4) * n * n + (5 / 4) * n ** 3) * dLat;
  const Mb = (3 * n + 3 * n * n + (21 / 8) * n ** 3) * Math.sin(dLat) * Math.cos(sLat);
  const Mc = ((15 / 8) * n * n + (15 / 8) * n ** 3) * Math.sin(2 * dLat) * Math.cos(2 * sLat);
  const Md = (35 / 24) * n ** 3 * Math.sin(3 * dLat) * Math.cos(3 * sLat);
  const M = b * F0 * (Ma - Mb + Mc - Md);
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat), tanLat = Math.tan(lat);
  const I = M + N0;
  const II = (nu / 2) * sinLat * cosLat;
  const III = (nu / 24) * sinLat * cosLat ** 3 * (5 - tanLat ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * sinLat * cosLat ** 5 * (61 - 58 * tanLat ** 2 + tanLat ** 4);
  const IV = nu * cosLat;
  const V = (nu / 6) * cosLat ** 3 * (nu / rho - tanLat ** 2);
  const VI = (nu / 120) * cosLat ** 5 * (5 - 18 * tanLat ** 2 + tanLat ** 4 + 14 * eta2 - 58 * tanLat ** 2 * eta2);
  const dLon = lon - lon0;
  const N = I + II * dLon ** 2 + III * dLon ** 4 + IIIA * dLon ** 6;
  const E = E0 + IV * dLon + V * dLon ** 3 + VI * dLon ** 5;
  if (E < 0 || E >= 700000 || N < 0 || N >= 1300000) return null;
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

// ── Numeric input control ──────────────────────────────────
const SAN = {
  int: (v) => v.replace(/[^0-9]/g, ""),
  dec: (v) => v.replace(/[^0-9.]/g, ""),
  time: (v) => v.replace(/[^0-9:]/g, ""),
  date: (v) => v.replace(/[^0-9.]/g, ""),
  signed: (v) => v.replace(/[^0-9.\-]/g, ""),
  // Numeric pad only: digits in, colon auto-inserted before the
  // last two (934 → 9:34). 1-2 digits are whole hours.
  hm: (v) => {
    const d = v.replace(/[^0-9]/g, "").slice(0, 4);
    return d.length <= 2 ? d : d.slice(0, -2) + ":" + d.slice(-2);
  },
};
const KIND_MODE = { int: "numeric", dec: "decimal", time: "numeric", date: "decimal", signed: "text", hm: "numeric" };
const HEADER_KIND = { date: "date", srp: "int", gwDep: "int", varField: "int", vertField: "int", plannedFuel: "int", hoursAvail: "hm" };

// ── Shared styles (functions so they read C at render time) ──
const label = () => ({
  display: "block",
  fontSize: 11,
  letterSpacing: "0.14em",
  color: C.grey,
  textTransform: "uppercase",
  marginBottom: 6,
  fontFamily: mono,
});
const inputWell = () => ({
  display: "flex",
  alignItems: "baseline",
  background: C.inputBg,
  border: `1px solid ${C.edge}`,
  borderRadius: 6,
  padding: "10px 14px",
  boxSizing: "border-box",
  maxWidth: "100%",
});
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
const btnStyle = (color) => ({
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
});
const miniBtn = (color) => ({
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
        flex: 1,
      }}
    >
      <span style={{ color: C.white, fontSize: 14, fontWeight: 600, letterSpacing: "0.18em", fontFamily: mono }}>
        {title}
      </span>
      <span style={{ color: C.grey, fontSize: 11, letterSpacing: "0.1em", fontFamily: mono }}>{subtitle}</span>
    </div>
  );
}

function CheckBox({ checked, onToggle }) {
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
// TAB — Fuel uplift calculator (+ power check details panel)
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
  powerCheckRow, // false = closed, null = SRP-level, number = flight
  onPowerCheckConfirm,
  onPowerCheckCancel,
}) {
  const c = parseNum(current), t = parseNum(target), d = parseNum(density);

  const [pc, setPc] = useState({ oat: "", qnh: "", e1n1: "", e1itt: "", e2n1: "", e2itt: "" });
  useEffect(() => {
    setPc({ oat: "", qnh: "", e1n1: "", e1itt: "", e2n1: "", e2itt: "" });
  }, [powerCheckRow]);
  const pcComplete = Object.values(pc).every((v) => String(v).trim() !== "");

  const result = useMemo(() => {
    if (c === null || t === null || d === null) return { state: "incomplete" };
    if (d < 0.7 || d > 0.9) return { state: "badDensity" };
    const upliftKg = t - c;
    if (upliftKg < 0) return { state: "overTarget", upliftKg };
    return { state: "ok", upliftKg, litres: upliftKg / d };
  }, [c, t, d]);

  const field = (lab, value, setter, unit, note) => (
    <label style={{ display: "block", marginBottom: 18 }}>
      <span style={label()}>
        {lab}
        {note && <span style={{ color: C.green, marginLeft: 8, letterSpacing: "0.05em" }}>{note}</span>}
      </span>
      <div style={inputWell()}>
        <input inputMode="decimal" value={value} onChange={(e) => setter(SAN.dec(e.target.value))} style={inputStyle()} />
        <span style={{ color: C.grey, fontSize: 14, marginLeft: 8, fontFamily: mono }}>{unit}</span>
      </div>
    </label>
  );

  const PC_KIND = { oat: "int", qnh: "int", e1n1: "dec", e1itt: "int", e2n1: "dec", e2itt: "int" };
  // OAT keeps the numeric pad; a ± button flips the sign since
  // the iOS number pad has no minus key.
  const flipOatSign = () =>
    setPc((p) => ({ ...p, oat: p.oat.startsWith("-") ? p.oat.slice(1) : p.oat === "" ? "-" : "-" + p.oat }));
  const pcField = (key, lab, unit) => (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>{lab}</span>
      <div style={{ ...inputWell(), padding: "8px 10px", alignItems: "center" }}>
        <input
          inputMode={KIND_MODE[PC_KIND[key]]}
          value={pc[key]}
          onChange={(e) =>
            setPc({
              ...pc,
              [key]: (key === "oat" && pc.oat.startsWith("-") ? "-" : "") + SAN[PC_KIND[key]](e.target.value),
            })
          }
          style={inputStyle(16)}
        />
        {key === "oat" && (
          <button
            onClick={flipOatSign}
            aria-label="toggle temperature sign"
            style={{
              background: "transparent",
              border: `1px solid ${C.edge}`,
              borderRadius: 4,
              color: pc.oat.startsWith("-") ? C.amber : C.grey,
              fontFamily: mono,
              fontSize: 13,
              fontWeight: 600,
              padding: "2px 7px",
              marginLeft: 6,
              cursor: "pointer",
            }}
          >
            ±
          </button>
        )}
        <span style={{ color: C.grey, fontSize: 11, marginLeft: 6, fontFamily: mono }}>{unit}</span>
      </div>
    </label>
  );

  return (
    <>
      <PanelHeader title="FUEL UPLIFT" subtitle="JET A-1 · KG → L" />
      {field("FUEL ON BOARD", current, setCurrent, "kg", sourceRow !== null ? `← FLIGHT ${sourceRow + 1} LANDED FUEL` : null)}
      {field("REQUIRED FUEL", target, setTarget, "kg")}
      {field("DENSITY (SG)", density, setDensity, "kg/L")}

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
            FUEL ON BOARD EXCEEDS REQUIRED FUEL BY {Math.abs(result.upliftKg).toFixed(0)} KG. NO UPLIFT NEEDED.
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
        <button onClick={() => onConfirm(result.litres, result.upliftKg)} style={{ ...btnStyle(C.green), marginTop: 16 }}>
          CONFIRM UPLIFT → FLIGHT {sourceRow + 1}
        </button>
      )}

      {powerCheckRow !== false && (
        <div style={{ marginTop: 20, border: `1px solid ${C.green}60`, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ color: C.green, fontSize: 12, fontWeight: 600, letterSpacing: "0.15em", fontFamily: mono }}>
              POWER CHECK DETAILS
            </span>
            <span style={{ color: C.grey, fontSize: 11, fontFamily: mono }}>
              {powerCheckRow === null ? "THIS SRP" : `FLIGHT ${powerCheckRow + 1}`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {pcField("oat", "TEMP", "°C")}
            {pcField("qnh", "PRESSURE", "HPA")}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, border: `1px solid ${C.edge}`, borderRadius: 6, padding: 10 }}>
              <span style={{ ...label(), fontSize: 10, marginBottom: 8 }}>ENG 1</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pcField("e1n1", "N1", "%")}
                {pcField("e1itt", "ITT", "°C")}
              </div>
            </div>
            <div style={{ flex: 1, border: `1px solid ${C.edge}`, borderRadius: 6, padding: 10 }}>
              <span style={{ ...label(), fontSize: 10, marginBottom: 8 }}>ENG 2</span>
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
              style={{ ...btnStyle(pcComplete ? C.green : C.grey), opacity: pcComplete ? 1 : 0.5 }}
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
// PDF export
// ═══════════════════════════════════════════════════════════

function makeCardPdf(card, rowGW, bst) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 14;
  let y = 16;

  doc.setFont("courier", "bold");
  doc.setFontSize(13);
  doc.text("GAMA KSS DAILY FLIGHT CARD", M, y);
  doc.setFontSize(10);
  doc.text(card.date || "", W - M, y, { align: "right" });
  y += 4;
  doc.setLineWidth(0.4);
  doc.line(M, y, W - M, y);
  y += 7;

  const gw = parseNum(card.gwDep), vt = parseNum(card.varField), vv = parseNum(card.vertField);
  const perfVar = gw !== null && vt !== null ? vt - gw : null;
  const perfVert = gw !== null && vv !== null ? vv - gw : null;
  const hdr = [
    ["AC REG", card.acReg.trim()],
    ["SRP", card.srp],
    ["GW DEP KG", card.gwDep],
    ["VAR TOW KG", card.varField],
    ["VERT TOW KG", card.vertField],
    ["PERF KG", null], // dual VAR/VERT margins, rendered specially below
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
    if (k === "PERF KG") {
      const vx = x + 38;
      doc.setFont("courier", "bold");
      const seg = (label, val) => {
        doc.setTextColor(...(val !== null && val < 0 ? [200, 120, 0] : [20, 20, 20]));
        const str = `${label} ${val === null ? "-" : `${val > 0 ? "+" : ""}${val.toFixed(0)}`}`;
        doc.text(str, vx + seg.w, yy);
        seg.w += doc.getTextWidth(str + "  ");
      };
      seg.w = 0;
      seg("VAR", perfVar);
      seg("VERT", perfVert);
      return;
    }
    doc.setFont("courier", "bold");
    doc.setTextColor(20, 20, 20);
    doc.text(String(v || "-"), x + 38, yy);
  });
  y += Math.ceil(hdr.length / 2) * 6 + 4;
  doc.line(M, y, W - M, y);
  y += 6;

  const rowUsedPdf = (r) => r.fltTime || r.shtdwn || r.fuel || r.notes || r.refuel || r.hems;
  card.rows.forEach((r, i) => {
    const used = rowUsedPdf(r);
    if (!used) return;
    const zulu = bst ? zuluFromLocal(r.shtdwn, true) : null;
    const w = rowGW(r, i);
    const flags = [];
    if (r.refuel) flags.push(r.upliftL ? `REFUEL ${r.upliftL} L` : "REFUEL");
    if (card.powerChecks.some((p) => p.row === i)) flags.push("PWR CHECK");
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
      const overAum = w > MTOW;
      const perfVarRow = vt !== null ? vt - w : null;
      const perfVertRow = vv !== null ? vv - w : null;
      const bad = overAum || (perfVarRow !== null && perfVarRow < 0) || (perfVertRow !== null && perfVertRow < 0);
      const fmtMargin = (val) => (val === null ? "-" : `${val > 0 ? "+" : ""}${val.toFixed(0)}`);
      doc.setFont("courier", bad ? "bold" : "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...(bad ? [200, 120, 0] : [110, 110, 110]));
      doc.text(
        `    DEP GW ${w.toFixed(0)}KG${overAum ? " — OVER AUM" : ""} · VAR ${fmtMargin(perfVarRow)} · VERT ${fmtMargin(perfVertRow)}`,
        M,
        y
      );
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

  // The line the SRP filler actually needs: which flights crossed 4600.
  const srpFlights = card.rows
    .map((r, i) => ({ i, w: rowUsedPdf(r) ? rowGW(r, i) : null }))
    .filter((x) => x.w !== null && x.w > SRP_NOTE_WT)
    .map((x) => `FLT ${x.i + 1}`);
  if (srpFlights.length) {
    y += 2;
    doc.setFont("courier", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(200, 120, 0);
    doc.text(`NOTE ON SRP — GW OVER ${SRP_NOTE_WT} KG: ${srpFlights.join(", ")}`, M, y);
    y += 5.5;
  }

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
        `${p.row === null ? "SRP" : "FLT " + (p.row + 1)}: OAT ${p.oat} C  QNH ${p.qnh} HPA  ENG1 N1 ${p.e1n1}% ITT ${p.e1itt} C  ENG2 N1 ${p.e2n1}% ITT ${p.e2itt} C`,
        M,
        y
      );
      y += 4.4;
    });
  }

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

  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text("GENERATED BY DAILY FLIGHT CARD APP", W - M, 290, { align: "right" });

  return doc;
}

// ═══════════════════════════════════════════════════════════
// TAB — Daily flight card
// ═══════════════════════════════════════════════════════════

const HEADER_FIELDS = [
  ["date", "DATE"],
  ["acReg", "AC REG"],
  ["srp", "SRP"],
  ["hoursAvail", "HOURS AVAILABLE"],
  ["gwDep", "GW DEP KG"],
  ["varField", "VAR TOW KG"],
  ["vertField", "VERT TOW KG"],
  ["perfKg", "PERF KG"],
  ["plannedFuel", "PLANNED FUEL KG"],
  ["sunriseSet", "SUNRISE / SUNSET"],
];

function freshRow() {
  return {
    fltTime: "",
    shtdwn: "",
    fuel: "",
    notes: "",
    refuel: false,
    upliftL: "",
    hems: false,
    hemsGrid: "",
    patientKg: "",
  };
}

function freshCard() {
  const date = todayString();
  const d = parseCardDate(date);
  return {
    date,
    acReg: "",
    srp: "",
    gwDep: "",
    varField: "",
    vertField: "",
    plannedFuel: "",
    hoursAvail: "",
    sunriseSet: d ? sunTimes(d, REDHILL.lat, REDHILL.lng) : "",
    rows: Array.from({ length: NUM_ROWS }, freshRow),
    misc: "",
    powerChecks: [], // [{row: index|null, oat, qnh, e1n1, e1itt, e2n1, e2itt}]
  };
}

const STORAGE_KEY = "daily-flight-card";
const HISTORY_KEY = "card-history";
const MAX_HISTORY = 4; // work runs in blocks of four days
const LAST_REG_KEY = "last-ac-reg";
const GROUND_RUN = "GROUND RUN";
const GR_POWER_CHECK = "GROUND RUN – POWER CHECK";
const PWR_ONLY = "POWER CHECK";
const AUTO_NOTES = ["", GROUND_RUN, GR_POWER_CHECK, PWR_ONLY];

const rowUsed = (r) => Boolean(r.fltTime || r.shtdwn || r.fuel || r.notes || r.refuel || r.hems);
const cardUsed = (c) =>
  Boolean(c && (c.rows.some(rowUsed) || c.srp || c.gwDep || c.varField || c.vertField || c.plannedFuel || c.misc || c.powerChecks.length));

function FlightCard({
  page, // "ac" = aircraft data page, "flights" = flight rows page
  onRefuel,
  onPowerCheckStart,
  onPlannedFuel,
  upliftDensity,
  pendingUplift,
  onPendingApplied,
  pendingPowerCheck,
  onPowerCheckApplied,
}) {
  const [card, setCard] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [carryOver, setCarryOver] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [powerCheckAsk, setPowerCheckAsk] = useState(null);
  const [lastReg, setLastReg] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState([]); // previous cards, newest first
  const [histIdx, setHistIdx] = useState(null); // null = current card
  const saveTimer = useRef(null);
  const histIdxRef = useRef(null);
  const historyRef = useRef([]);
  const snapshotRef = useRef(null); // current card while viewing a previous one

  useEffect(() => {
    (async () => {
      try {
        const lr = await storage.get(LAST_REG_KEY);
        if (lr && AC_REGS.includes(lr.value)) setLastReg(lr.value);
      } catch {}
      try {
        const hs = await storage.get(HISTORY_KEY);
        const arr = JSON.parse(hs.value);
        if (Array.isArray(arr)) {
          const clean = arr.slice(0, MAX_HISTORY);
          historyRef.current = clean;
          setHistory(clean);
        }
      } catch {}
      try {
        const res = await storage.get(STORAGE_KEY);
        const saved = JSON.parse(res.value);
        // Keep at least NUM_ROWS; keep MORE only where legacy rows hold data.
        const merged = saved.rows.map((r) => ({ ...freshRow(), ...r }));
        let keep = merged.length;
        while (keep > NUM_ROWS && !rowUsed(merged[keep - 1])) keep--;
        saved.rows = merged.slice(0, Math.max(NUM_ROWS, keep));
        while (saved.rows.length < NUM_ROWS) saved.rows.push(freshRow());
        if (!saved.powerChecks) saved.powerChecks = [];
        if (saved.plannedFuel === undefined) saved.plannedFuel = "";
        if (saved.gwDep === undefined) saved.gwDep = saved.tdpWat || "";
        if (!saved.sunriseSet) {
          const d = parseCardDate(saved.date);
          if (d) saved.sunriseSet = sunTimes(d, REDHILL.lat, REDHILL.lng);
        }
        if (saved.plannedFuel) onPlannedFuel(saved.plannedFuel);
        setCard(saved);
      } catch {
        setCard(freshCard());
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = useCallback((next) => {
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        if (histIdxRef.current === null) {
          await storage.set(STORAGE_KEY, JSON.stringify(next));
        } else {
          const h = historyRef.current.map((c, idx) => (idx === histIdxRef.current ? next : c));
          historyRef.current = h;
          setHistory(h);
          await storage.set(HISTORY_KEY, JSON.stringify(h));
        }
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
  }, []);

  // Write whichever card is on screen straight to the right
  // place, skipping the debounce — used when switching views.
  const flushSave = async (c) => {
    clearTimeout(saveTimer.current);
    try {
      if (histIdxRef.current === null) {
        await storage.set(STORAGE_KEY, JSON.stringify(c));
      } else {
        const h = historyRef.current.map((cc, idx) => (idx === histIdxRef.current ? c : cc));
        historyRef.current = h;
        setHistory(h);
        await storage.set(HISTORY_KEY, JSON.stringify(h));
      }
    } catch {}
  };

  const openHistory = async (i) => {
    if (!card) return;
    await flushSave(card);
    if (histIdxRef.current === null) snapshotRef.current = card;
    histIdxRef.current = i;
    setHistIdx(i);
    setCard(historyRef.current[i]);
    setPowerCheckAsk(null);
    setConfirming(false);
    setSaveState("idle");
  };

  const backToCurrent = async () => {
    await flushSave(card);
    histIdxRef.current = null;
    setHistIdx(null);
    setCard(snapshotRef.current || freshCard());
    snapshotRef.current = null;
    setPowerCheckAsk(null);
    setSaveState("idle");
  };

  const update = (patch) => {
    const next = { ...card, ...patch };
    setCard(next);
    scheduleSave(next);
  };

  const updateRow = (i, patch, extraPatch = {}) => {
    const rows = card.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    update({ rows, ...extraPatch });
  };

  const updateRowAsync = (i, patch) => {
    setCard((prev) => {
      if (!prev) return prev;
      const next = { ...prev, rows: prev.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) };
      scheduleSave(next);
      return next;
    });
  };

  const setDate = (value) => {
    const v = SAN.date(value).toUpperCase();
    const d = parseCardDate(v);
    if (d) update({ date: v, sunriseSet: sunTimes(d, REDHILL.lat, REDHILL.lng) });
    else update({ date: v });
  };

  const rowHasPC = (i) => card.powerChecks.some((p) => p.row === i);

  const setFltTime = (i, value) => {
    const row = card.rows[i];
    const v = SAN.int(value);
    const isZero = v.trim() === "0";
    if (AUTO_NOTES.includes(row.notes)) {
      const pc = rowHasPC(i);
      updateRow(i, { fltTime: v, notes: isZero ? (pc ? GR_POWER_CHECK : GROUND_RUN) : pc ? PWR_ONLY : "" });
    } else {
      updateRow(i, { fltTime: v });
    }
    // One power check per card: only ask if none recorded yet.
    if (isZero && card.powerChecks.length === 0) setPowerCheckAsk(i);
    else if (!isZero && powerCheckAsk === i) setPowerCheckAsk(null);
  };

  const answerPowerCheck = (i, yes) => {
    setPowerCheckAsk(null);
    if (yes) {
      const row = card.rows[i];
      if (AUTO_NOTES.includes(row.notes)) updateRow(i, { notes: GR_POWER_CHECK });
      onPowerCheckStart(i);
    }
  };

  useEffect(() => {
    if (pendingUplift && card) {
      updateRow(pendingUplift.row, { upliftL: pendingUplift.litres.toFixed(0) });
      onPendingApplied();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUplift, card === null]);

  useEffect(() => {
    if (pendingPowerCheck && card) {
      const others = card.powerChecks.filter((p) => p.row !== pendingPowerCheck.row);
      update({ powerChecks: [...others, pendingPowerCheck] });
      onPowerCheckApplied();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPowerCheck, card === null]);

  const removePowerCheck = (row) => update({ powerChecks: card.powerChecks.filter((p) => p.row !== row) });

  // ── Inline refuel ─────────────────────────────────────────
  // If planned fuel and this row's landed fuel are known, work
  // the litres out right here using the uplift tab's density —
  // no tab switch. Falls back to the uplift tab if data is missing.
  const toggleRefuel = (i) => {
    const row = card.rows[i];
    if (row.refuel) {
      updateRow(i, { refuel: false, upliftL: "" });
      return;
    }
    const planned = parseNum(card.plannedFuel);
    const landed = parseNum(row.fuel);
    const d = parseNum(upliftDensity) || 0.79;
    if (planned !== null && landed !== null) {
      const upliftKg = Math.max(0, planned - landed);
      updateRow(i, { refuel: true, upliftL: (upliftKg / d).toFixed(0) });
    } else {
      updateRow(i, { refuel: true });
      onRefuel(row.fuel, i);
    }
  };

  const toggleHems = (i) => {
    const row = card.rows[i];
    if (row.hems) {
      updateRow(i, { hems: false, hemsGrid: "" });
      return;
    }
    updateRow(i, { hems: true, hemsGrid: "…" });
    if (!navigator.geolocation) {
      updateRowAsync(i, { hemsGrid: "N/A" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => updateRowAsync(i, { hemsGrid: latLonToOSGrid(pos.coords.latitude, pos.coords.longitude) || "N/A" }),
      () => updateRowAsync(i, { hemsGrid: "N/A" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const newCard = (carry = false) => {
    // Keep the outgoing card — last MAX_HISTORY are editable later.
    if (cardUsed(card)) {
      const h = [card, ...historyRef.current].slice(0, MAX_HISTORY);
      historyRef.current = h;
      setHistory(h);
      storage.set(HISTORY_KEY, JSON.stringify(h)).catch(() => {});
    }
    const next = freshCard();
    if (carry) {
      // Same day ran past 7 sectors: new SRP page, same aircraft data.
      next.date = card.date;
      next.acReg = card.acReg;
      next.gwDep = card.gwDep;
      next.varField = card.varField;
      next.vertField = card.vertField;
      next.plannedFuel = card.plannedFuel;
      next.sunriseSet = card.sunriseSet;
      // SRP increments if numeric, else copies verbatim
      next.srp = /^\d+$/.test(card.srp) ? String(parseInt(card.srp, 10) + 1) : card.srp;
      // Maintenance countdown continues: new AVAILABLE = old REMAINING
      if (remaining !== null && remaining >= 0) next.hoursAvail = formatMinutes(remaining);
      else next.hoursAvail = card.hoursAvail;
    }
    setCard(next);
    scheduleSave(next);
    setConfirming(false);
    setPowerCheckAsk(null);
    onPlannedFuel(carry ? next.plannedFuel : "");
  };

  // Departure fuel per flight (post-flight data collation rules):
  //   flight 1            → planned fuel
  //   after a refuel      → planned fuel (refuelled back to plan)
  //   otherwise           → previous flight's landed fuel
  const depFuel = (i) => {
    const planned = parseNum(card.plannedFuel);
    if (i === 0) return planned;
    const prev = card.rows[i - 1];
    if (prev.refuel) return planned;
    return parseNum(prev.fuel);
  };

  // GW at DEPARTURE of flight i — this is what the SRP >4600
  // notation and the PERF margin are judged against.
  const rowGrossWeight = (row, i) => {
    const gwd = parseNum(card.gwDep);
    const planned = parseNum(card.plannedFuel);
    const dep = depFuel(i);
    if (gwd === null || planned === null || dep === null) return null;
    const patient = row.hems ? parseNum(row.patientKg) || 0 : 0;
    return gwd + (dep - planned) + patient;
  };

  const totalMins = useMemo(
    () => (card ? card.rows.map((r) => parseMinutes(r.fltTime)).filter((v) => v !== null).reduce((a, b) => a + b, 0) : 0),
    [card]
  );
  const availMins = card ? parseAvailMinutes(card.hoursAvail) : null;
  const remaining = availMins !== null ? availMins - totalMins : null;

  if (!card) return <div style={{ color: C.grey, fontFamily: mono, fontSize: 14 }}>LOADING CARD…</div>;

  const cardDateObj = parseCardDate(card.date);
  const bst = cardDateObj ? isBST(cardDateObj) : isBST(new Date());

  const sharePdf = async () => {
    const doc = makeCardPdf(card, rowGrossWeight, bst);
    const subject = [card.acReg.trim() || "AC", card.srp ? `SRP ${card.srp}` : null, card.date || "UNDATED"]
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
  };

  const exportAndClear = async (carry = false) => {
    setExporting(true);
    try {
      await sharePdf();
      newCard(carry);
    } catch {
      setConfirming(false);
    }
    setExporting(false);
  };

  // Re-export a previous card after post-editing — no clear.
  const exportOnly = async () => {
    setExporting(true);
    try {
      await sharePdf();
    } catch {}
    setExporting(false);
  };

  // ── Header fields ─────────────────────────────────────────
  const regIsListed = AC_REGS.includes(card.acReg);
  const regSelectValue = regIsListed ? card.acReg : card.acReg === "" ? "" : "OTHER";
  const orderedRegs = lastReg ? [lastReg, ...AC_REGS.filter((r) => r !== lastReg)] : AC_REGS;

  const rememberReg = (reg) => {
    if (!AC_REGS.includes(reg)) return;
    setLastReg(reg);
    storage.set(LAST_REG_KEY, reg).catch(() => {});
  };

  const acRegField = (
    <label key="acReg" style={{ flex: 1, minWidth: 0 }}>
      <span style={{ ...label(), fontSize: 10, marginBottom: 4 }}>AC REG</span>
      <select
        value={regSelectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v !== "OTHER") rememberReg(v);
          update({ acReg: v === "OTHER" ? (regIsListed || card.acReg === "" ? " " : card.acReg) : v });
        }}
        style={{
          ...inputStyle(16),
          ...inputWell(),
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
          style={{ ...inputStyle(16), ...inputWell(), display: "block", padding: "8px 10px", marginTop: 6 }}
        />
      )}
    </label>
  );

  const gw = parseNum(card.gwDep);
  const vt = parseNum(card.varField);
  const vv = parseNum(card.vertField);
  const perfVar = gw !== null && vt !== null ? vt - gw : null;
  const perfVert = gw !== null && vv !== null ? vv - gw : null;
  const perfHalf = (lab, val) => (
    <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 6 }}>
      <span style={{ color: C.grey, fontSize: 10, letterSpacing: "0.1em", fontFamily: mono }}>{lab}</span>
      <span
        style={{
          color: val === null ? C.grey : val < 0 ? C.amber : C.green,
          fontSize: 16,
          fontWeight: 600,
          fontFamily: mono,
        }}
      >
        {val === null ? "—" : `${val > 0 ? "+" : ""}${val.toFixed(0)}`}
      </span>
    </div>
  );
  const perfField = (
    <div key="perfKg" style={{ flex: 1, minWidth: 0 }}>
      <span style={{ ...label(), fontSize: 10, marginBottom: 4 }}>PERF KG</span>
      <div style={{ ...inputWell(), padding: "8px 10px" }}>
        {perfHalf("VAR", perfVar)}
        <div style={{ width: 1, alignSelf: "stretch", background: C.edge }} />
        {perfHalf("VERT", perfVert)}
      </div>
    </div>
  );

  // Subtle row-group divider: optional tiny letter-spaced label, then a
  // hairline in the panel edge colour, legible but unobtrusive in both themes.
  const sectionDivider = (text) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {text && (
        <span style={{ color: C.grey, opacity: 0.55, fontSize: 9, letterSpacing: "0.16em", fontFamily: mono, whiteSpace: "nowrap" }}>
          {text}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: C.edge }} />
    </div>
  );

  const smallField = (key, lab) =>
    key === "acReg" ? (
      acRegField
    ) : key === "perfKg" ? (
      perfField
    ) : (
      <label key={key} style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...label(), fontSize: 10, marginBottom: 4 }}>{lab}</span>
        <input
          value={card[key]}
          inputMode={HEADER_KIND[key] ? KIND_MODE[HEADER_KIND[key]] : undefined}
          onChange={(e) => {
            const kind = HEADER_KIND[key];
            const v = (kind ? SAN[kind](e.target.value) : e.target.value).toUpperCase();
            if (key === "date") return setDate(v);
            update({ [key]: v });
            if (key === "plannedFuel") onPlannedFuel(v);
          }}
          style={{ ...inputStyle(16), ...inputWell(), display: "block", padding: "8px 10px" }}
        />
      </label>
    );

  const saveLabel = { saving: "SAVING…", saved: "SAVED", error: "SAVE FAILED", idle: "" }[saveState];

  // ── Row visibility ────────────────────────────────────────
  // Used rows stay fully expanded; the first unused row is the
  // working flight; later empty rows stay hidden.
  const firstUnused = card.rows.findIndex((r) => !rowUsed(r));
  const isRowVisible = (i) => rowUsed(card.rows[i]) || i === firstUnused;

  const expandedRow = (row, i) => (
    <div style={{ padding: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ color: C.grey, fontFamily: mono, fontSize: 14, fontWeight: 600, width: 18, paddingTop: 16 }}>
          {i + 1}
        </span>

        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>FLT MIN</span>
          <input
            value={row.fltTime}
            inputMode="numeric"
            onChange={(e) => setFltTime(i, e.target.value)}
            style={{ ...inputStyle(15), display: "block", width: "100%" }}
          />
        </label>

        <label style={{ flex: 1.4, minWidth: 0 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>SHTDWN</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              value={row.shtdwn}
              inputMode="numeric"
              onChange={(e) => updateRow(i, { shtdwn: SAN.time(e.target.value) })}
              style={{ ...inputStyle(15), display: "block", width: "100%" }}
            />
            {/* One tap stamps the current time; button hides once a
                time exists (clear the field to bring it back) */}
            {row.shtdwn === "" && (
            <button
              onClick={() => updateRow(i, { shtdwn: nowHHMM() })}
              style={{ ...miniBtn(C.cyan), padding: "4px 8px", fontSize: 10 }}
            >
              NOW
            </button>
            )}
          </div>
          {bst && zuluFromLocal(row.shtdwn, true) && (
            <span style={{ display: "block", color: C.green, fontFamily: mono, fontSize: 12, fontWeight: 600, marginTop: 3 }}>
              {zuluFromLocal(row.shtdwn, true)}
            </span>
          )}
        </label>

        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>FUEL KG</span>
          <input
            value={row.fuel}
            inputMode="numeric"
            onChange={(e) => updateRow(i, { fuel: SAN.int(e.target.value) })}
            style={{ ...inputStyle(15), display: "block", width: "100%" }}
          />
          {row.upliftL && (
            <span style={{ display: "block", color: C.green, fontFamily: mono, fontSize: 12, fontWeight: 600, marginTop: 3 }}>
              ↑ {row.upliftL} L
            </span>
          )}
        </label>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>REFUEL</span>
          <CheckBox checked={row.refuel} onToggle={() => toggleRefuel(i)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-start" }}>
        <span style={{ width: 18 }} />
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>NOTES</span>
          <input
            value={row.notes}
            onChange={(e) => updateRow(i, { notes: e.target.value.toUpperCase() })}
            style={{ ...inputStyle(15), display: "block", width: "100%" }}
          />
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

        {row.hems && (
          <label style={{ width: 84 }}>
            <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>PATIENT KG</span>
            <input
              value={row.patientKg}
              inputMode="numeric"
              onChange={(e) => updateRow(i, { patientKg: SAN.int(e.target.value) })}
              style={{ ...inputStyle(15), display: "block", width: "100%" }}
            />
          </label>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>HEMS</span>
          <CheckBox checked={row.hems} onToggle={() => toggleHems(i)} />
        </div>
      </div>

      {rowGrossWeight(row, i) !== null &&
        (() => {
          const w = rowGrossWeight(row, i);
          const vt = parseNum(card.varField);
          const vv = parseNum(card.vertField);
          const overAum = w > MTOW;
          const varMargin = vt !== null ? vt - w : null; // VAR TOW − this flight's GW
          const vertMargin = vv !== null ? vv - w : null; // VERT TOW − this flight's GW
          const rowMargin = (lab, val) => (
            <span key={lab}>
              <span style={{ color: C.grey }}> · {lab} </span>
              <span style={{ color: val === null ? C.grey : val < 0 ? C.amber : C.green }}>
                {val === null ? "—" : `${val > 0 ? "+" : ""}${val.toFixed(0)}`}
              </span>
            </span>
          );
          return (
            // Fits one line at normal sizes for every realistic combination; the extreme
            // case (over AUM + both margins deep negative) can exceed a 375px viewport, so
            // this scrolls horizontally rather than wrapping or silently clipping a figure.
            <div style={{ marginTop: 8, paddingLeft: 28, overflowX: "auto", WebkitOverflowScrolling: "touch", maxWidth: "100%" }}>
              <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", width: "max-content" }}>
                <span style={{ color: overAum ? C.amber : C.grey, fontWeight: overAum ? 700 : 600 }}>
                  DEP GW {w.toFixed(0)}KG
                  {overAum ? " — OVER AUM" : ""}
                </span>
                {rowMargin("VAR", varMargin)}
                {rowMargin("VERT", vertMargin)}
              </div>
            </div>
          );
        })()}

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
          <span style={{ color: C.amber, fontFamily: mono, fontSize: 12, flex: 1 }}>GROUND RUN — POWER CHECK?</span>
          <button onClick={() => answerPowerCheck(i, true)} style={miniBtn(C.green)}>
            YES
          </button>
          <button onClick={() => answerPowerCheck(i, false)} style={miniBtn(C.grey)}>
            NO
          </button>
        </div>
      )}

    </div>
  );

  return (
    <>
      <PanelHeader title={page === "ac" ? "AIRCRAFT DATA" : "FLIGHTS"} subtitle="REDHILL EGKR" />

      {histIdx !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: `1px solid ${C.amber}`,
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 16,
          }}
        >
          <span style={{ color: C.amber, fontFamily: mono, fontSize: 12, fontWeight: 600, flex: 1, lineHeight: 1.5 }}>
            PREVIOUS CARD {histIdx + 1} OF {history.length} — EDITS SAVE TO THIS CARD
          </span>
          <button onClick={backToCurrent} style={{ ...miniBtn(C.cyan), padding: "6px 10px", fontSize: 10 }}>
            CURRENT CARD
          </button>
        </div>
      )}

      {page === "ac" && (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 12 }}>
          {smallField(...HEADER_FIELDS[0])}
          {smallField(...HEADER_FIELDS[1])}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {smallField(...HEADER_FIELDS[2])}
          {smallField(...HEADER_FIELDS[3])}
        </div>
        {sectionDivider("PERFORMANCE")}
        <div style={{ display: "flex", gap: 12 }}>
          {smallField(...HEADER_FIELDS[4])}
          {smallField(...HEADER_FIELDS[5])}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {smallField(...HEADER_FIELDS[6])}
          {smallField(...HEADER_FIELDS[7])}
        </div>
        {sectionDivider()}
        <div style={{ display: "flex", gap: 12 }}>
          {smallField(...HEADER_FIELDS[8])}
          {smallField(...HEADER_FIELDS[9])}
        </div>
      </div>
      )}

      <div
        style={{
          display: page === "ac" ? "flex" : "none",
          justifyContent: "space-between",
          background: C.inputBg,
          border: `1px solid ${C.edge}`,
          borderRadius: 8,
          padding: 14,
          marginBottom: 18,
        }}
      >
        <div>
          <span style={{ ...label(), fontSize: 10, marginBottom: 2 }}>AVAILABLE</span>
          <span style={{ color: C.grey, fontSize: 22, fontWeight: 600, fontFamily: mono }}>
            {availMins === null ? "—" : formatMinutes(availMins)}
          </span>
        </div>
        <div style={{ textAlign: "center" }}>
          <span style={{ ...label(), fontSize: 10, marginBottom: 2 }}>FLOWN</span>
          <span style={{ color: C.white, fontSize: 22, fontWeight: 600, fontFamily: mono }}>
            {formatMinutes(totalMins)}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ ...label(), fontSize: 10, marginBottom: 2 }}>REMAINING</span>
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

      {page === "flights" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: mono,
            fontSize: 12,
            fontWeight: 600,
            color: C.grey,
            padding: "0 2px",
            marginBottom: 12,
            letterSpacing: "0.08em",
          }}
        >
          <span>{card.acReg.trim() || "AC —"}</span>
          <span>{card.srp ? `SRP ${card.srp}` : "SRP —"}</span>
          <span style={{ color: remaining === null ? C.grey : remaining < 0 ? C.amber : C.green }}>
            REM {remaining === null ? "—" : formatMinutes(remaining)}
          </span>
        </div>
      )}

      {page === "flights" && (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {card.rows.map((row, i) =>
          !isRowVisible(i) ? null : (
            <div
              key={i}
              style={{
                background: C.inputBg,
                border: `1px solid ${row.refuel ? C.green + "60" : C.edge}`,
                borderRadius: 8,
              }}
            >
              {expandedRow(row, i)}
            </div>
          )
        )}
      </div>
      )}

      {page === "ac" && (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={label()}>MISC</span>
          <button
            onClick={() => onPowerCheckStart(null)}
            style={{ ...miniBtn(C.green), marginBottom: 6, padding: "4px 10px", fontSize: 10 }}
          >
            {card.powerChecks.length ? "REDO POWER CHECK" : "POWER CHECK"}
          </button>
        </div>

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
              <div key={String(p.row)} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ color: C.green, fontFamily: mono, fontSize: 12, lineHeight: 1.7, flex: 1 }}>
                  <span style={{ fontWeight: 700 }}>
                    {p.row === null ? "SRP POWER CHECK" : `FLT ${p.row + 1} POWER CHECK`}
                  </span>
                  {"  ·  "}OAT {p.oat}°C{"  ·  "}QNH {p.qnh} HPA
                  <br />
                  ENG1 N1 {p.e1n1}% ITT {p.e1itt}°C{"  ·  "}ENG2 N1 {p.e2n1}% ITT {p.e2itt}°C
                </div>
                <button
                  onClick={() => removePowerCheck(p.row)}
                  aria-label="remove power check"
                  style={{ ...miniBtn(C.grey), padding: "2px 8px", fontSize: 11 }}
                >
                  ✕
                </button>
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
      )}

      {page === "ac" && (
      <>
      {histIdx !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={exportOnly} disabled={exporting} style={btnStyle(C.green)}>
            {exporting ? "EXPORTING…" : "EXPORT PDF (THIS CARD)"}
          </button>
          <button onClick={backToCurrent} style={btnStyle(C.grey)}>
            RETURN TO CURRENT CARD
          </button>
        </div>
      ) : confirming ? (
        <div style={{ border: `1px solid ${C.amber}`, borderRadius: 8, padding: 14, fontFamily: mono }}>
          <p style={{ color: C.amber, fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
            NEW CARD: EXPORT THE PDF FIRST (SHARE SHEET → MAIL), OR CLEAR WITHOUT
            EXPORTING. THIS CARD STAYS EDITABLE UNDER PREVIOUS CARDS (LAST {MAX_HISTORY} KEPT).
          </p>
          {/* Day ran past 7 sectors: continue on a fresh SRP page */}
          <button
            onClick={() => setCarryOver(!carryOver)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              background: "transparent",
              border: `1px solid ${carryOver ? C.cyan : C.edge}`,
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 12,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: `1px solid ${carryOver ? C.cyan : C.grey}`,
                background: carryOver ? C.cyan : "transparent",
                color: C.inputBg,
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {carryOver ? "\u2713" : ""}
            </span>
            <span style={{ color: carryOver ? C.cyan : C.grey, fontFamily: mono, fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
              CARRY OVER A/C DATA — SRP +1, AVAILABLE = REMAINING
            </span>
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => exportAndClear(carryOver)} disabled={exporting} style={btnStyle(C.green)}>
              {exporting ? "EXPORTING…" : "EXPORT PDF & NEW CARD"}
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => newCard(carryOver)} style={btnStyle(C.amber)}>
                CLEAR WITHOUT PDF
              </button>
              <button onClick={() => setConfirming(false)} style={btnStyle(C.grey)}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setCarryOver(false);
            setConfirming(true);
          }}
          style={btnStyle(C.amber)}
        >
          NEW CARD
        </button>
      )}

      {histIdx === null && history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={{ ...label(), fontSize: 10 }}>PREVIOUS CARDS (TAP TO VIEW / EDIT)</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((c, i) => (
              <button
                key={i}
                onClick={() => openHistory(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: C.inputBg,
                  border: `1px solid ${C.edge}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: C.cyan, fontFamily: mono, fontSize: 13, fontWeight: 600, flex: 1 }}>
                  {[c.date || "UNDATED", c.acReg.trim() || null, c.srp ? `SRP ${c.srp}` : null]
                    .filter(Boolean)
                    .join("  ·  ")}
                </span>
                <span style={{ color: C.grey, fontFamily: mono, fontSize: 11 }}>
                  {c.rows.filter(rowUsed).length} FLT
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
        <span style={{ color: saveState === "error" ? C.amber : C.grey, fontSize: 10, fontFamily: mono, letterSpacing: "0.1em" }}>
          {saveLabel}
        </span>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// App shell
// ═══════════════════════════════════════════════════════════

function App() {
  const [tab, setTab] = useState("card");
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "night");

  // Swap the palette in place; the key below remounts the tree
  // so every component re-reads C.
  Object.assign(C, theme === "day" ? DAY : NIGHT);

  const toggleTheme = () => {
    const next = theme === "night" ? "day" : "night";
    localStorage.setItem("theme", next);
    setTheme(next);
  };

  const [current, setCurrent] = useState("300");
  const [target, setTarget] = useState("650");
  const [density, setDensity] = useState("0.79");
  const [sourceRow, setSourceRow] = useState(null);
  const [pendingUplift, setPendingUplift] = useState(null);
  // false = panel closed; null = SRP-level check; number = flight index
  const [powerCheckRow, setPowerCheckRow] = useState(false);
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
    setPowerCheckRow(rowIndex); // may be null (SRP-level)
    setTab("uplift");
  };

  const handlePowerCheckConfirm = (pc) => {
    setPendingPowerCheck({ row: powerCheckRow, ...pc });
    setTab(powerCheckRow === null ? "ac" : "card");
    setPowerCheckRow(false);
  };

  const handlePowerCheckCancel = () => {
    setTab(powerCheckRow === null ? "ac" : "card");
    setPowerCheckRow(false);
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
      key={theme}
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        justifyContent: "center",
        padding: 16,
        // Full-bleed home-screen app: keep content clear of the
        // iPhone status bar (clock/signal/battery) and home indicator.
        paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        fontFamily: mono,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        html, body { background: ${C.bg}; }
        input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${C.cyan}; outline-offset: 2px; border-radius: 2px; }
        select option { background: ${C.inputBg}; color: ${C.cyan}; }
        /* Auto-scale by device class: phone 1x, iPad mini ~1.35x, iPad 1.55x.
           zoom scales the whole 460px design proportionally (Safari supports it). */
        @media (min-width: 700px)  { .shell-scale { zoom: 1.35; } }
        @media (min-width: 900px)  { .shell-scale { zoom: 1.55; } }
      `}</style>

      <div className="shell-scale" style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {tabBtn("ac", "A/C DATA")}
          {tabBtn("card", "FLIGHTS")}
          {tabBtn("uplift", "UPLIFT")}
          <button
            onClick={toggleTheme}
            aria-label="toggle day/night mode"
            style={{
              width: 46,
              background: "transparent",
              border: `1px solid ${C.edge}`,
              borderRadius: 8,
              color: C.grey,
              fontFamily: mono,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {theme === "night" ? "\u2600" : "\u263E"}
          </button>
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.edge}`,
            borderRadius: 12,
            padding: "24px 22px 22px",
            boxShadow: theme === "night" ? "0 20px 60px rgba(0,0,0,0.6)" : "0 8px 30px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ display: tab === "card" || tab === "ac" ? "block" : "none" }}>
            <FlightCard
              page={tab === "ac" ? "ac" : "flights"}
              onRefuel={handleRefuel}
              onPowerCheckStart={handlePowerCheckStart}
              onPlannedFuel={(v) => setTarget(v)}
              upliftDensity={density}
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
