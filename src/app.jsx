import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import {
  AC,
  SCENARIO_ORDER,
  SCENARIO_TEXT,
  SCENARIO_HINT,
  PINS_NOTE,
  approachSummary,
  planner,
  freshTrip,
  haversineNm,
  kgToL,
  DATA as FUEL_DATA,
  MAP,
  project,
  placeLabels,
} from "./fuelcalc.js";
import { explainSector } from "./ifr-explain.mjs";

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
  purple: "#B57CFF", // reserved for "tap to expand" (ExpandArrow) — use for nothing else
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
  purple: "#6A2FC0", // darker so it holds contrast on the white day panel
};
const C = { ...NIGHT };

const mono = "'IBM Plex Mono', ui-monospace, monospace";
// Bump by one on every source change that gets built + committed, so Ed can
// confirm on the phone which build is actually live. BUILD_DATE is stamped
// automatically by build_html.py at build time — always accurate even if a
// version bump is forgotten, so the footer can never silently go stale.
const APP_VERSION = "v19";
// The user guide (rendered on GitHub). Opening it needs signal; the app itself does not.
const README_URL = "https://github.com/VonTedworth/Daily-Flight-Card/blob/main/README.md";
// The crew guide (33-slide PDF), saved on the phone by the service worker (own cache, kept across
// deploys). The name carries the version and never changes: a new guide is crew-guide-v2.pdf, and
// GUIDE_URL here + GUIDE / GUIDE_CACHE in service-worker.src.js are bumped together.
const GUIDE_URL = "./crew-guide-v1.pdf"; // relative: the site lives on a subpath
const BUILD_DATE = typeof window !== "undefined" && window.__BUILD_DATE__ ? window.__BUILD_DATE__ : "";
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
      <a
        data-guide
        href={GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          marginTop: 16,
          paddingTop: 12,
          borderTop: `1px solid ${C.edge}`,
          color: C.cyan,
          fontFamily: mono,
          fontSize: 12,
          letterSpacing: "0.1em",
          textDecoration: "none",
        }}
      >
        USER GUIDE — HOW TO USE THE APP ↗
        <span style={{ display: "block", color: C.grey, fontSize: 9.5, letterSpacing: "0.04em", marginTop: 3 }}>
          33-slide crew guide (PDF). Saved on this phone.
        </span>
      </a>
      <a
        data-readme
        href={README_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          marginTop: 12,
          color: C.cyan,
          fontFamily: mono,
          fontSize: 10.5,
          letterSpacing: "0.1em",
          textDecoration: "none",
        }}
      >
        README — HOW THE APP WORKS ↗
        <span style={{ display: "block", color: C.grey, fontSize: 9.5, letterSpacing: "0.04em", marginTop: 3 }}>
          Full calculations on GitHub (needs signal).
        </span>
      </a>
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
    const pt = r.patient ? parseNum(r.patientKg) : null;
    if (r.refuel) {
      const to = parseNum(r.refuelTo) !== null ? parseNum(r.refuelTo) : parseNum(card.plannedFuel);
      const note = r.refuelNote ? ` - ${pdfText(r.refuelNote).toUpperCase()}` : "";
      flags.push(to !== null ? `REFUEL TO ${to} KG${r.upliftL ? ` ${r.upliftL} L` : ""}${note}` : r.upliftL ? `REFUEL ${r.upliftL} L${note}` : `REFUEL${note}`);
    }
    if (card.powerChecks.some((p) => p.row === i)) flags.push("PWR CHECK");
    if (r.hems) flags.push(`HEMS${r.hemsGrid && r.hemsGrid !== "N/A" && r.hemsGrid !== "…" ? " " + r.hemsGrid : ""}`);
    if (pt) flags.push(`PT ${pt} KG`);

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
        `    DEP GW ${w.toFixed(0)}KG${pt ? ` (PT ${pt})` : ""}${overAum ? " — OVER AUM" : ""} · VAR ${fmtMargin(perfVarRow)} · VERT ${fmtMargin(perfVertRow)}`,
        M,
        y
      );
      y += 4.2;
    }
    if (flags.length) {
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(0, 130, 60);
      const fl = doc.splitTextToSize("    " + flags.join("  ·  "), W - 2 * M);
      doc.text(fl, M, y);
      y += fl.length * 4.2;
    }
    if (r.notes) {
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(60, 60, 60);
      const wrapped = doc.splitTextToSize("    NOTES: " + r.notes.toUpperCase(), W - 2 * M);
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
    // A 0-minute GROUND RUN has no takeoff, so it is never a "flight over 4600".
    .map((r, i) => ({ i, w: rowUsedPdf(r) && parseMinutes(r.fltTime) !== 0 ? rowGW(r, i) : null }))
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
    const wrapped = doc.splitTextToSize(card.misc.toUpperCase(), W - 2 * M);
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
    hems: false, // this flight LANDS at a scene (grid captured here)
    hemsGrid: "",
    patient: false, // this flight CARRIES a patient (set when the previous row ticks HEMS)
    patientKg: "", // weight of the patient this flight carries
    refuelTo: "", // kg the aircraft was refuelled to after this flight ("" = planned fuel)
    refuelNote: "",
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
    // Fuel on board at the first takeoff when it is NOT the planned figure — set only by a
    // carry-over (the previous card's last landed fuel). "" = assume PLANNED FUEL.
    startFuel: "",
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
// Case-insensitive: NOTES is no longer force-uppercased as the user types (iOS
// predictive text fix), so a still-untouched auto-tag may be typed in any case.
const isAutoNote = (v) => AUTO_NOTES.includes((v || "").toUpperCase());

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
  // Refuel confirmation panel (screen-only until CONFIRM): { row, mode: "plan" | "other", to, note, reopen }
  const [refuelPanel, setRefuelPanel] = useState(null);
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
    if (isAutoNote(row.notes)) {
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
      if (isAutoNote(row.notes)) updateRow(i, { notes: GR_POWER_CHECK });
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
  // Ticking REFUEL opens a confirmation (refuel to planned, or another figure). Nothing is saved
  // until CONFIRM, so closing the panel any other way leaves the row unrefuelled.
  const density = () => parseNum(upliftDensity) || 0.79;
  const litresFor = (toKg, landed) => Math.round(Math.max(0, toKg - landed) / density());
  const refuelProblem = (toKg, landed) =>
    toKg === null ? "" : toKg > AC.usable_fuel_kg ? `ABOVE USABLE FUEL ${AC.usable_fuel_kg} KG` : landed !== null && toKg < landed ? "BELOW FUEL ALREADY ON BOARD" : "";
  const confirmRefuel = (i, toKg, note) => {
    const landed = parseNum(card.rows[i].fuel);
    updateRow(i, { refuel: true, refuelTo: String(toKg), refuelNote: (note || "").trim(), upliftL: String(litresFor(toKg, landed)) });
    setRefuelPanel(null);
  };
  // Small inline inputs (refuel panel, patient KG) need a visible box — they can start empty.
  const boxedInput = { background: C.bg, border: `1px solid ${C.cyan}`, borderRadius: 5, padding: "3px 6px", boxSizing: "border-box" };
  const closeRefuelPanel = () => setRefuelPanel(null); // unconfirmed → nothing was saved
  const reopenRefuel = (i) => {
    const row = card.rows[i];
    const planned = parseNum(card.plannedFuel);
    const other = parseNum(row.refuelTo) !== planned;
    setRefuelPanel({ row: i, mode: other ? "other" : "plan", to: other ? row.refuelTo : "", note: row.refuelNote || "", reopen: true });
  };
  const toggleRefuel = (i) => {
    const row = card.rows[i];
    if (refuelPanel && refuelPanel.row === i && !row.refuel) {
      closeRefuelPanel(); // ticked, not confirmed, unticked again
      return;
    }
    if (row.refuel) {
      updateRow(i, { refuel: false, upliftL: "", refuelTo: "", refuelNote: "" });
      if (refuelPanel && refuelPanel.row === i) closeRefuelPanel();
      return;
    }
    const planned = parseNum(card.plannedFuel);
    const landed = parseNum(row.fuel);
    if (planned !== null && landed !== null) {
      setRefuelPanel({ row: i, mode: "plan", to: "", note: "", reopen: false });
    } else {
      updateRow(i, { refuel: true });
      onRefuel(row.fuel, i);
    }
  };

  // HEMS on row i = this flight lands at a scene: the patient boards there, so they are on
  // board for the NEXT flight (row i + 1), which is flagged as carrying them.
  const toggleHems = (i) => {
    const row = card.rows[i];
    if (row.hems) {
      // Clear the next row's patient flag only if no weight has been entered there.
      const rows = card.rows.map((r, idx) =>
        idx === i ? { ...r, hems: false, hemsGrid: "" } : idx === i + 1 && !String(r.patientKg || "").trim() ? { ...r, patient: false } : r
      );
      update({ rows });
      return;
    }
    const rows = card.rows.map((r, idx) => (idx === i ? { ...r, hems: true, hemsGrid: "…" } : idx === i + 1 ? { ...r, patient: true } : r));
    update({ rows });
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
      // DATE and SUNRISE/SUNSET are deliberately NOT copied — freshCard() already
      // stamps today's date and recomputes today's sun times. If the carry-over is
      // a same-day overrun, today equals the outgoing card's date, so nothing is
      // lost; if it's a night shift past midnight (or later), copying the old date
      // would silently produce the wrong date and stale sun times. Copying has no
      // upside and one failure mode, so it's never done.
      next.acReg = card.acReg;
      next.gwDep = card.gwDep;
      next.varField = card.varField;
      next.vertField = card.vertField;
      next.plannedFuel = card.plannedFuel;
      // The aircraft does not magically refill between SRP pages: sector 1 of the new card
      // departs with what the last flight landed with — unless that sector was refuelled
      // (then it is back to planned, which is what "" means). GW DEP is the baseline at
      // planned fuel, so the departure weight is GW DEP + (startFuel − planned).
      const flown = (r) => Boolean(r.fltTime || r.fuel || r.shtdwn);
      const lastFlown = [...card.rows].reverse().find(flown);
      if (lastFlown && lastFlown.refuel) {
        // refuelled after the last flight: to its confirmed figure ("" = planned)
        const to = parseNum(lastFlown.refuelTo);
        if (to !== null && to !== parseNum(card.plannedFuel)) next.startFuel = String(to);
      } else if (lastFlown && parseNum(lastFlown.fuel) !== null) {
        next.startFuel = String(parseNum(lastFlown.fuel));
      }
      // HEMS on the last sector: the patient is on board for flight 1 of the new card.
      if (card.rows[card.rows.length - 1].hems) next.rows[0].patient = true;
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
  //   after a refuel      → the confirmed refuel-to figure ("" / old rows = planned fuel)
  //   otherwise           → previous flight's landed fuel
  const depFuel = (i) => {
    const planned = parseNum(card.plannedFuel);
    if (i === 0) {
      const start = parseNum(card.startFuel); // carried-over card: previous landed fuel
      return start !== null ? start : planned;
    }
    const prev = card.rows[i - 1];
    if (prev.refuel) {
      const to = parseNum(prev.refuelTo);
      return to !== null ? to : planned;
    }
    return parseNum(prev.fuel);
  };

  // GW at DEPARTURE of flight i — this is what the SRP >4600
  // notation and the PERF margin are judged against.
  const rowGrossWeight = (row, i) => {
    const gwd = parseNum(card.gwDep);
    const planned = parseNum(card.plannedFuel);
    const dep = depFuel(i);
    if (gwd === null || planned === null || dep === null) return null;
    const patient = row.patient ? parseNum(row.patientKg) || 0 : 0; // the patient this flight carries
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
            onChange={(e) => {
              const v = SAN.int(e.target.value);
              const to = parseNum(row.refuelTo), landed = parseNum(v);
              updateRow(i, row.refuel && to !== null && landed !== null ? { fuel: v, upliftL: String(litresFor(to, landed)) } : { fuel: v });
            }}
            style={{ ...inputStyle(15), display: "block", width: "100%" }}
          />
          {row.upliftL && !row.refuelTo && (
            <span style={{ display: "block", color: C.green, fontFamily: mono, fontSize: 12, fontWeight: 600, marginTop: 3 }}>
              ↑ {row.upliftL} L
            </span>
          )}
        </label>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>REFUEL</span>
          <span data-refuel-box={i}>
            <CheckBox checked={row.refuel || (refuelPanel !== null && refuelPanel.row === i)} onToggle={() => toggleRefuel(i)} />
          </span>
        </div>
      </div>

      {refuelPanel && refuelPanel.row === i
        ? (() => {
            const planned = parseNum(card.plannedFuel);
            const landed = parseNum(row.fuel);
            const P = refuelPanel;
            const to = P.mode === "plan" ? planned : parseNum(P.to);
            const problem = refuelProblem(to, landed);
            const can = to !== null && landed !== null && !problem;
            const txt = { fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.white };
            const small = { ...label(), fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" };
            return (
              <div data-refuel-panel={i} style={{ margin: "8px 0 0 28px", padding: "9px 10px", border: `1px solid ${C.green}80`, borderRadius: 8, background: C.inputBg }}>
                {P.mode === "plan" ? (
                  <>
                    <div style={txt}>Refuel to planned fuel, {planned} kg?</div>
                    <div style={{ ...txt, color: C.grey, fontSize: 11, marginTop: 3 }}>
                      Uplift {Math.max(0, planned - landed)} kg = {litresFor(planned, landed)} L at {density()}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={small}>REFUEL TO</span>
                      <input
                        data-refuel-to={i}
                        value={P.to}
                        inputMode="numeric"
                        autoFocus={!P.reopen}
                        onChange={(e) => setRefuelPanel({ ...P, to: SAN.int(e.target.value) })}
                        style={{ ...inputStyle(15), ...boxedInput, flex: "none", width: 70 }}
                      />
                      <span style={small}>KG</span>
                      <span data-refuel-litres={i} style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.green }}>
                        {to !== null && landed !== null ? `↑ ${litresFor(to, landed)} L` : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                      <span style={small}>NOTE</span>
                      <input
                        data-refuel-note={i}
                        value={P.note}
                        autoCapitalize="characters"
                        onChange={(e) => setRefuelPanel({ ...P, note: e.target.value })}
                        style={{ ...inputStyle(13), ...boxedInput, flex: 1, minWidth: 0, textTransform: "uppercase" }}
                      />
                    </div>
                  </>
                )}
                {problem && (
                  <div data-refuel-problem={i} style={{ marginTop: 6, fontFamily: mono, fontSize: 11, fontWeight: 700, color: C.amber }}>
                    {problem}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    data-refuel-confirm={i}
                    disabled={!can}
                    onClick={() => can && confirmRefuel(i, to, P.mode === "plan" ? "" : P.note)}
                    style={{ ...miniBtn(C.green), flex: 1, padding: "8px 4px", fontSize: 10.5, whiteSpace: "nowrap", opacity: can ? 1 : 0.4 }}
                  >
                    CONFIRM {to !== null ? `${to} KG` : ""}
                  </button>
                  {P.mode === "plan" ? (
                    <button data-refuel-other={i} onClick={() => setRefuelPanel({ ...P, mode: "other", to: "" })} style={{ ...miniBtn(C.cyan), flex: 1, padding: "8px 4px", fontSize: 10.5, whiteSpace: "nowrap" }}>
                      OTHER FIGURE
                    </button>
                  ) : null}
                  {(P.mode === "other" || P.reopen) && (
                    <button data-refuel-cancel={i} onClick={closeRefuelPanel} style={{ ...miniBtn(C.grey), flex: 1, padding: "8px 4px", fontSize: 10.5, whiteSpace: "nowrap" }}>
                      CANCEL
                    </button>
                  )}
                </div>
              </div>
            );
          })()
        : row.refuel &&
          row.refuelTo && (
            <button
              data-refuel-done={i}
              onClick={() => reopenRefuel(i)}
              style={{ display: "block", margin: "6px 0 0 28px", padding: 0, background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.green }}
            >
              REFUELLED TO {row.refuelTo} KG · ↑ {row.upliftL} L
              {parseNum(row.refuelTo) !== parseNum(card.plannedFuel) && <span style={{ color: C.amber }}> · NOT PLANNED FUEL</span>}
              {row.refuelNote && <span style={{ display: "block", color: C.grey, fontWeight: 500, marginTop: 2, textTransform: "uppercase" }}>{row.refuelNote}</span>}
            </button>
          )}

      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-start" }}>
        <span style={{ width: 18 }} />
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 3, letterSpacing: "0.1em" }}>NOTES</span>
          <input
            value={row.notes}
            // Stored as typed (displayed uppercase via CSS below) — forcing the case on
            // every keystroke discards iOS predictive-text insertions mid-composition.
            onChange={(e) => updateRow(i, { notes: e.target.value })}
            autoCapitalize="characters"
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

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ ...label(), fontSize: 9, marginBottom: 0, letterSpacing: "0.1em" }}>HEMS</span>
          <span data-hems-box={i}>
            <CheckBox checked={row.hems} onToggle={() => toggleHems(i)} />
          </span>
        </div>
      </div>

      {((i > 0 && card.rows[i - 1].hems) || row.patient) && (
        <div data-patient-line={i} style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", paddingLeft: 28 }}>
          <span data-patient-box={i}>
            <CheckBox checked={!!row.patient} onToggle={() => updateRow(i, { patient: !row.patient })} />
          </span>
          <span style={{ ...label(), display: "inline", fontSize: 10, marginBottom: 0, letterSpacing: "0.1em", color: row.patient ? C.white : C.grey }}>PATIENT ON BOARD</span>
          {row.patient && (
            <>
              <input
                data-patient-kg={i}
                value={row.patientKg}
                inputMode="numeric"
                onChange={(e) => updateRow(i, { patientKg: SAN.int(e.target.value) })}
                style={{ ...inputStyle(15), ...boxedInput, flex: "none", width: 64 }}
              />
              <span style={{ ...label(), display: "inline", fontSize: 10, marginBottom: 0 }}>KG</span>
            </>
          )}
        </div>
      )}
      {row.hems && i === card.rows.length - 1 && (
        <div data-patient-next-card style={{ marginTop: 6, paddingLeft: 28, fontFamily: mono, fontSize: 11, fontWeight: 600, color: C.green }}>
          PATIENT GOES ON FLIGHT 1 OF THE NEXT CARD
        </div>
      )}

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
              <div data-depgw={i} style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", width: "max-content" }}>
                <span style={{ color: overAum ? C.amber : C.grey, fontWeight: overAum ? 700 : 600 }}>DEP GW {w.toFixed(0)}KG</span>
                {row.patient && parseNum(row.patientKg) ? (
                  <span data-pt={i} style={{ color: C.white }}>
                    {" "}(PT {parseNum(row.patientKg)})
                  </span>
                ) : null}
                {overAum && <span style={{ color: C.amber, fontWeight: 700 }}> — OVER AUM</span>}
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
          // Stored as typed (displayed uppercase via CSS below) — see NOTES above.
          onChange={(e) => update({ misc: e.target.value })}
          autoCapitalize="characters"
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

// ═══════════════════════════════════════════════════════════
// TAB — IFR FUEL planner, MULTI-SECTOR (offline cross-check, AW169)
// All maths is src/fuelcalc.js — a port of the approved prototype's compute(), with every
// figure and rule read from the bundled dataset. This file only renders it. The trip is
// kept under its own localStorage key and never touches the flight card's storage.
// ═══════════════════════════════════════════════════════════

const TRIP_KEY = "ifr-fuel-trip";
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;

function loadTrip() {
  try {
    return planner.normalizeTrip(JSON.parse(localStorage.getItem(TRIP_KEY)));
  } catch {
    return freshTrip();
  }
}

// ── IFR FUEL plan → PDF (record keeping and error checking) ──
// Built from the same computeTrip() result the screen shows, so it is the plan exactly as
// planned. jsPDF's built-in Courier is WinAnsi-only, so arrows etc. are swapped for ASCII.
const pdfText = (t) => String(t).replace(/→/g, ">").replace(/≥/g, ">=").replace(/−/g, "-");
const two = (n) => String(n).padStart(2, "0");

function makeTripPdf(r, meta) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 14, BOTTOM = 280;
  let y = 16;
  const ensure = (h) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = 16;
    }
  };
  const font = (style, size, rgb) => {
    doc.setFont("courier", style);
    doc.setFontSize(size);
    doc.setTextColor(...rgb);
  };
  const DARK = [20, 20, 20], GREY = [110, 110, 110], AMBER = [200, 120, 0], GREEN = [0, 130, 60];
  const para = (txt, size, rgb, style = "normal", lh = 3.8) => {
    font(style, size, rgb);
    const lines = doc.splitTextToSize(pdfText(txt), W - 2 * M);
    ensure(lines.length * lh);
    doc.text(lines, M, y);
    y += lines.length * lh;
  };
  const rule = () => {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
  };
  const stops = r.trip.stops;
  const site = (id) => FUEL_DATA.sites.find((s) => s.id === id);
  const ac = FUEL_DATA.aircraft, rules = FUEL_DATA.oma_rules;

  // header
  font("bold", 13, DARK);
  doc.text("IFR FUEL PLAN — AW169 (OMB34)", M, y);
  font("normal", 9.5, DARK);
  doc.text(meta.stamp, W - M, y, { align: "right" });
  y += 4;
  doc.setLineWidth(0.4);
  doc.line(M, y, W - M, y);
  y += 5;
  para("Planning cross-check only — not a certified flight-planning tool. Verify against the OFP and current plates.", 8.5, GREY);
  para(
    `App ${meta.version}${meta.buildDate ? " (" + meta.buildDate + ")" : ""} · figures used: ${ac.plan_speed_kt} kt · ${ac.cruise_burn_kg_per_hr} kg/hr · ` +
      `start & taxi ${ac.start_taxi_default_kg} · approach ${ac.per_ifr_approach_kg} · final reserve ${ac.final_reserve_ifr_kg} · ` +
      `contingency ${rules.contingency_pct_ifr}% · 15 min = ${Math.round((rules.scenario_A_trip_add_min / 60) * ac.cruise_burn_kg_per_hr)} · density ${ac.fuel_density_kg_per_l}`,
    8,
    GREY
  );
  y += 2;

  // route + headline
  font("bold", 11, DARK);
  ensure(6);
  doc.text("ROUTE  " + stops.join(" > "), M, y);
  y += 6;
  const h = r.headline;
  const verdict = !h.entered || h.margin === null ? `FUEL AT ${h.site}: not entered` : h.margin < 0 ? `SHORT ${h.margin} KG` : `ENOUGH +${h.margin} KG`;
  font("bold", 10.5, h.entered && h.margin !== null && h.margin < 0 ? AMBER : DARK);
  doc.text(`REQUIRED TO LIFT ${h.site}: ${h.gate === null ? "-" : h.gate + " KG"}`, M, y);
  doc.text(h.entered ? `FUEL AT ${h.site}: ${r.fuel[0]} KG   ${verdict}` : verdict, W - M, y, { align: "right" });
  y += 5;
  rule();
  y += 5;

  // stops table
  font("bold", 9, DARK);
  doc.text("STOPS", M, y);
  y += 4.5;
  const cx = [M, M + 8, M + 92, M + 120, M + 150];
  font("normal", 7.5, GREY);
  ["#", "SITE", "MIN TO LIFT", "FUEL KG", "MARGIN"].forEach((t, i) => doc.text(t, cx[i], y));
  y += 4;
  stops.forEach((id, i) => {
    const st = site(id);
    const last = i === stops.length - 1;
    const entered = !isNaN(parseInt(r.trip.actual[i], 10));
    const fuelTxt = r.fuel[i] === null ? "-" : `${r.fuel[i]} ${last ? "planned on landing" : r.refuelAt[i] ? (entered ? "after refuel" : "after refuel (min)") : entered ? "actual" : i === 0 ? "(lift at min)" : "planned"}`;
    const margin = last || (i === 0 && !r.headline.entered) ? null : r.margin[i];
    ensure(9);
    font("bold", 9, DARK);
    doc.text(String(i + 1), cx[0], y);
    doc.text(pdfText(`${st.icao} ${st.name}`).slice(0, 44), cx[1], y);
    doc.text(last ? "-" : String(r.sec[i].gate ?? "-"), cx[2], y);
    font("normal", 9, DARK);
    doc.text(fuelTxt, cx[3], y);
    font("bold", 9, margin === null ? GREY : margin < 0 ? AMBER : GREEN);
    doc.text(margin === null ? "-" : `${margin > 0 ? "+" : ""}${margin}`, cx[4] + 20, y, { align: "right" });
    y += 4.2;
    if (r.refuelAt[i] && r.planned[i] !== null) {
      font("normal", 8, GREEN);
      doc.text(`   REFUEL HERE — arrive with ${r.planned[i]} kg${r.uplift[i] === undefined ? "" : r.uplift[i] > 0 ? ` · uplift at least ${r.uplift[i]} kg` : " · no uplift needed"}`, cx[1], y);
      y += 3.8;
    }
    if (!last && margin !== null && margin < 0) {
      font("bold", 8, AMBER);
      doc.text("   BELOW MINIMUM — IFR DEPARTURE NOT AVAILABLE. REFUEL BEFORE CONTINUING, OR HOLD FOR WEATHER.", cx[1], y);
      y += 3.8;
    }
  });
  y += 2;
  rule();
  y += 5;

  // sectors
  r.sec.forEach((s) => {
    ensure(30);
    font("bold", 9.5, DARK);
    const alt = s.needAlts === 0 ? "NO ALTERNATE" : s.error ? s.error : `ALTN ${s.a1.id}${s.needAlts === 2 ? " + " + s.a2.id : ""} (${s.auto ? "nearest" : "chosen"})`;
    doc.text(pdfText(`SECTOR ${s.i + 1}  ${s.from.id} > ${s.to.id} · ${Math.round(s.dist)} nm · PROFILE ${s.sc} · ${alt}`), M, y);
    font("bold", 9.5, DARK);
    doc.text(`BURN ${s.burn} KG`, W - M, y, { align: "right" });
    y += 4.4;
    para(SCENARIO_TEXT[s.sc] + (s.profile.key === "pins" && !s.vfr ? " " + PINS_NOTE : ""), 7.8, GREY);
    const appr = [s.to, ...(s.needAlts >= 1 && s.a1 ? [s.a1] : []), ...(s.needAlts === 2 && s.a2 ? [s.a2] : [])]
      .map((x) => `${x.id}: ${approachSummary(x.id).join(" · ") || "none listed"}`)
      .join("   ");
    para("Approaches  " + appr, 7.8, GREY);
    y += 1;
    const tx = [M + 2, M + 34, M + 150, M + 170];
    font("normal", 7.2, GREY);
    ensure(5);
    doc.text(`MIN TO LIFT ${s.from.id}`, tx[0], y);
    doc.text("REQUIREMENT", tx[1], y);
    doc.text("L", tx[2], y, { align: "right" });
    doc.text("KG", tx[3], y, { align: "right" });
    y += 3.8;
    s.rows.forEach((row) => {
      ensure(4);
      font("normal", 8.5, DARK);
      doc.text(pdfText(row.item), tx[0], y);
      font("normal", 8, GREY);
      doc.text(pdfText(row.req), tx[1], y);
      font("normal", 8.5, DARK);
      doc.text(row.kg === null ? "-" : String(kgToL(row.kg)), tx[2], y, { align: "right" });
      font("bold", 8.5, DARK);
      doc.text(row.kg === null ? "-" : String(row.kg), tx[3], y, { align: "right" });
      y += 3.9;
    });
    const line = (item, req, l, kg, bold) => {
      ensure(4);
      font(bold ? "bold" : "normal", 8.5, DARK);
      doc.text(pdfText(item), tx[0], y);
      font("normal", 8, GREY);
      doc.text(pdfText(req), tx[1], y);
      font("normal", 8.5, DARK);
      doc.text(l, tx[2], y, { align: "right" });
      font("bold", 8.5, DARK);
      doc.text(kg, tx[3], y, { align: "right" });
      y += 3.9;
    };
    if (s.extra) {
      line("This leg (OMA)", "sum of the lines above", s.own === null ? "-" : String(kgToL(s.own)), s.own === null ? "-" : String(s.own), true);
      line(s.extra.item, s.extra.req, s.extra.kg === null ? "-" : `+${kgToL(s.extra.kg)}`, s.extra.kg === null ? "-" : `+${s.extra.kg}`);
    }
    ensure(5);
    font("bold", 9, DARK);
    doc.text("MIN TO LIFT", tx[0], y);
    if (s.extra && s.extra.kg !== null) { font("normal", 8, GREY); doc.text(`${s.own} + ${s.extra.kg}`, tx[1], y); font("bold", 9, DARK); }
    doc.text(s.gate === null ? "-" : String(kgToL(s.gate)), tx[2], y, { align: "right" });
    doc.text(s.gate === null ? "-" : String(s.gate), tx[3], y, { align: "right" });
    y += 4.2;
    if (s.fuelAt) {
      line(`Fuel at ${s.from.id}`, s.fuelAt.kind, String(kgToL(s.fuelAt.kg)), String(s.fuelAt.kg));
      line(s.disc < 0 ? "BELOW MINIMUM" : "Discretionary", s.disc < 0 ? "short of min to lift" : "above min to lift - commander's discretion", signed(kgToL(s.disc)), signed(s.disc), true);
    }
    y += 3;
  });
  rule();
  y += 5;
  para("OPEN ITEMS (awaiting confirmation; implemented as stated)", 8.5, DARK, "bold");
  [
    "1. PinS in clear VMC: never planned without an alternate (OMA 8.3.2.7.7).",
    "2. PinS approach status: the PinS procedures are not yet confirmed as published and usable.",
    "3. Site coordinates: East Brighton Park (EGGB) user-supplied; all others to be verified.",
    "4. The OMA PinS text is a provisional starting position and may change.",
  ].forEach((t) => para(t, 7.8, GREY));
  para("Contingency (confirmed): 10% of each sector's trip, treated as burnt on that sector - none of it is assumed left for the next leg.", 7.8, GREY);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    font("normal", 8, GREY);
    doc.text(`GENERATED BY DAILY FLIGHT CARD APP ${meta.version} · PAGE ${p} OF ${pages}`, W - M, 290, { align: "right" });
  }
  return doc;
}

async function shareTripPdf(r) {
  const now = new Date();
  const date = `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()}`;
  const hhmm = `${two(now.getHours())}${two(now.getMinutes())}`;
  const doc = makeTripPdf(r, { version: APP_VERSION, buildDate: BUILD_DATE, stamp: `${date} ${hhmm}` });
  const subject = `IFR FUEL ${r.trip.stops.join("-")} ${date} ${hhmm}`;
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
}

const siteName = (st) => `${st.icao || st.short} ${st.name.toUpperCase()}`;

// The one "tap to expand" marker: a purple boxed chevron, down when closed, up when open.
// Purple is reserved for this. The parent control carries aria-expanded / open.
function ExpandArrow({ open, size = 24 }) {
  return (
    <span
      aria-hidden="true"
      data-arrow={open ? "open" : "closed"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: size,
        height: size,
        boxSizing: "border-box",
        border: `1.5px solid ${C.purple}`,
        borderRadius: 6,
        background: `${C.purple}24`, // ≈ 14% opacity
      }}
    >
      <svg className="exp-chev" width="14" height="14" viewBox="0 0 24 24" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
        <path d="M6 9l6 6 6-6" fill="none" stroke={C.purple} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
function siteCaption(st) {
  const kind = { airfield_ifr: "IFR airfield", pins_site: "PinS site", refuel_vfr: "VFR refuel point", hospital: "hospital (map only)" }[st.type] || st.type;
  const fuel = st.type === "hospital" ? "" : st.fuel ? " · fuel" : " · no fuel";
  return `${st.icao ? st.icao + " " : ""}${st.name} — ${kind}${fuel}`;
}

// Wireframe map: ONS county outlines + every dataset site in the same projection
// (src/map-geometry.json is generated for exactly that). Draws the whole trip route and each
// sector's alternate(s). Tapping a site shows what it is; stops are chosen with the dropdowns.
function IfrMap({ result, note, onTap }) {
  const stops = result.trip.stops;
  const stopSet = new Set(stops);
  const altIds = new Set();
  result.sec.forEach((s) => {
    if (s.needAlts >= 1 && s.a1) altIds.add(s.a1.id);
    if (s.needAlts === 2 && s.a2) altIds.add(s.a2.id);
  });
  const roleOf = (id) => (id === stops[0] ? C.green : stopSet.has(id) ? C.cyan : altIds.has(id) ? C.amber : null);
  const sites = FUEL_DATA.sites.map((st) => ({ st, ...project(st.lat, st.lon) }));
  const get = (id) => sites.find((x) => x.st.id === id);
  const small = (st) => st.type === "hospital" || st.type === "pins_site";
  const text = (st) => (small(st) ? st.short || st.icao : st.icao);

  const rank = (x) => (roleOf(x.st.id) ? 0 : x.st.type === "airfield_ifr" ? 1 : x.st.type === "pins_site" ? 2 : x.st.type === "refuel_vfr" ? 3 : 4);
  const labels = placeLabels(
    [...sites].sort((a, b) => rank(a) - rank(b)).map((x) => ({ id: x.st.id, x: x.x, y: x.y, text: text(x.st), fs: small(x.st) ? 5.3 : 6.5, must: true }))
  );

  const lines = [];
  const seen = new Set();
  const seg = (a, b, color, dash) => {
    const A = get(a), B = get(b);
    const key = `${a}>${b}:${dash || ""}`;
    if (A && B && a !== b && !seen.has(key)) {
      seen.add(key);
      lines.push({ key, x1: A.x, y1: A.y, x2: B.x, y2: B.y, color, dash });
    }
  };
  result.sec.forEach((s) => {
    if (s.needAlts >= 1 && s.a1) seg(s.to.id, s.a1.id, C.amber, "3 2");
    if (s.needAlts === 2 && s.a2) seg(s.to.id, s.a2.id, C.amber, "3 2");
  });
  for (let i = 0; i < stops.length - 1; i++) seg(stops[i], stops[i + 1], C.cyan);

  const legend = (sym, color, label) => (
    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 10 }}>
      <span style={{ color }}>{sym}</span>
      {label}
    </span>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <svg
        viewBox={`0 0 ${MAP.meta.w} ${MAP.meta.h}`}
        role="img"
        aria-label="Map of the trip"
        style={{ display: "block", width: "100%", height: "auto", background: C.inputBg, border: `1px solid ${C.edge}`, borderRadius: 8 }}
      >
        <g pointerEvents="none">
          {MAP.counties.map((c) => (
            <path key={c.n} d={c.d} fill={C.edge} stroke={C.inputBg} strokeWidth="0.5" strokeLinejoin="round" />
          ))}
          {lines.map((l) => (
            <line key={l.key} data-route={l.dash ? "alternate" : "sector"} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth="1.2" strokeDasharray={l.dash} />
          ))}
        </g>
        {sites.map(({ st, x, y }) => {
          const role = roleOf(st.id);
          return (
            <g key={st.id} data-site={st.id} role="button" aria-label={`${text(st)}${role ? " selected" : ""}`} onClick={() => onTap(st.id)} style={{ cursor: "pointer" }}>
              <circle cx={x} cy={y} r="7" fill="transparent" />
              {st.type === "airfield_ifr" ? (
                <circle cx={x} cy={y} r="3.2" fill={role || "none"} stroke={role || C.cyan} strokeWidth="1.1" />
              ) : st.type === "refuel_vfr" ? (
                <polygon points={`${x},${y - 3.6} ${x + 3.6},${y} ${x},${y + 3.6} ${x - 3.6},${y}`} fill="none" stroke={C.amber} strokeWidth="1.1" />
              ) : (
                <>
                  <circle cx={x} cy={y} r="3.3" fill={role || "none"} stroke={role || (st.type === "pins_site" ? C.cyan : C.grey)} strokeWidth="0.9" />
                  <text x={x} y={y + 1.7} textAnchor="middle" fontSize="4.6" fontWeight="700" fontFamily={mono} fill={role ? C.bg : st.type === "pins_site" ? C.cyan : C.grey}>
                    H
                  </text>
                </>
              )}
            </g>
          );
        })}
        <g pointerEvents="none">
          {Object.entries(labels).map(([id, p]) => {
            const st = get(id).st;
            const role = roleOf(id);
            return (
              <text key={id} data-label={id} x={p.x} y={p.y} textAnchor={p.anchor} fontSize={p.fs} fontWeight={role ? 700 : 500} fontFamily={mono} fill={role || C.grey} opacity={small(st) && !role ? 0.9 : 1}>
                {text(st)}
              </text>
            );
          })}
        </g>
      </svg>
      <div style={{ color: note ? C.amber : C.grey, fontFamily: mono, fontSize: 10, lineHeight: 1.6, marginTop: 6, minHeight: 16 }}>
        {note || [
          legend("●", C.green, "START"),
          legend("●", C.cyan, "STOP"),
          legend("●", C.amber, "ALTN"),
          legend("○", C.cyan, "AIRFIELD"),
          legend("Ⓗ", C.cyan, "PinS SITE"),
          legend("◇", C.amber, "REFUEL"),
          legend("Ⓗ", C.grey, "HOSPITAL"),
        ]}
      </div>
    </div>
  );
}

function IfrFuel() {
  const [trip, setTripState] = useState(loadTrip);
  const [open, setOpen] = useState([]);
  const [workOpen, setWorkOpen] = useState([]); // FUEL WORKINGS per sector, closed by default
  const [mapNote, setMapNote] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Every change goes through here: normalise, persist under the planner's own key.
  const update = (fn) =>
    setTripState((prev) => {
      const draft = JSON.parse(JSON.stringify(prev));
      fn(draft);
      const next = planner.normalizeTrip(draft);
      try {
        localStorage.setItem(TRIP_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const r = planner.computeTrip(trip);
  const n = trip.stops.length;
  const stopSites = planner.stopSites();

  const changeStop = (i, v) =>
    update((t) => {
      t.stops[i] = v;
      t.refuel[i] = false;
      if (i > 0) {
        // a new destination resets that sector's alternate(s) and profile to defaults
        t.alt[i - 1] = null;
        t.alt2[i - 1] = null;
        t.scen[i - 1] = null;
      }
    });
  const setActual = (i, v) => update((t) => (t.actual[i] = SAN.int(v)));
  const toggleRefuel = (i) =>
    update((t) => {
      t.refuel[i] = !t.refuel[i];
      t.actual[i] = "";
    });
  const removeStop = (i) => {
    update((t) => {
      t.stops.splice(i, 1);
      t.actual.splice(i, 1);
      t.refuel.splice(i, 1);
      const m = t.stops.length - 1;
      t.scen = Array(m).fill(null);
      t.alt = Array(m).fill(null);
      t.alt2 = Array(m).fill(null);
    });
    setOpen([]);
    setWorkOpen([]);
  };
  const addSector = () =>
    update((t) => {
      t.stops.push("");
      t.actual.push("");
      t.refuel.push(false);
      t.scen.push(null);
      t.alt.push(null);
      t.alt2.push(null);
    });
  const resetTrip = () => {
    update((t) => Object.assign(t, freshTrip()));
    setOpen([]);
    setWorkOpen([]);
    setConfirmReset(false);
    setMapNote("");
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      await shareTripPdf(r);
    } catch {} // share sheet cancelled, or unavailable: nothing to do
    setExporting(false);
  };
  const toggleOpen = (i) => setOpen((o) => Object.assign([...o], { [i]: !o[i] }));
  const tapMap = (id) => {
    const st = FUEL_DATA.sites.find((x) => x.id === id);
    setMapNote(st ? siteCaption(st) : "");
  };

  const k = { display: "block", fontFamily: mono, fontSize: 8, letterSpacing: "0.13em", color: C.grey, marginBottom: 3 };
  const v = { fontFamily: mono, fontSize: 15, fontWeight: 700 };
  const selectStyle = {
    ...inputStyle(13),
    flex: 1,
    minWidth: 0,
    background: C.inputBg,
    border: `1px solid ${C.edge}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontWeight: 700,
    appearance: "none",
    WebkitAppearance: "none",
    cursor: "pointer",
  };
  const pill = (on) => ({
    fontFamily: mono,
    fontSize: 8,
    letterSpacing: "0.1em",
    color: on ? C.bg : C.grey,
    background: on ? C.cyan : "transparent",
    border: `1px solid ${on ? C.cyan : C.edge}`,
    borderRadius: 10,
    padding: "4px 8px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    fontWeight: on ? 700 : 500,
  });

  const head = r.headline;
  const planReady = r.complete && r.sec.every((s) => s.gate !== null);
  const headBad = head.entered && head.margin !== null && head.margin < 0;
  const headColor = !head.entered ? C.cyan : headBad ? C.amber : C.green;

  const card = (i) => {
    const st = stopSites.find((x) => x.id === trip.stops[i]) || null; // null = not chosen yet
    const last = i === n - 1;
    const mid = i > 0 && !last;
    const rf = r.refuelAt[i];
    const gate = last ? null : r.sec[i].gate;
    const margin = last || (i === 0 && !r.headline.entered) ? null : r.margin[i];
    const warn = !last && margin !== null && margin < 0;
    return (
      <div
        key={`stop-${i}`}
        data-stop={i}
        style={{ background: C.inputBg, border: `1px solid ${warn ? C.amber : rf ? C.cyan : C.edge}`, borderRadius: 8, padding: "9px 11px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select aria-label={`stop ${i + 1}`} value={st ? st.id : ""} onChange={(e) => changeStop(i, e.target.value)} style={selectStyle}>
            <option value="">SELECT</option>
            {stopSites.map((x) => (
              <option key={x.id} value={x.id}>
                {siteName(x)}
              </option>
            ))}
          </select>
          {mid && st && planner.hasFuel(st) && (
            <button data-refuel={i} onClick={() => toggleRefuel(i)} aria-pressed={rf} style={pill(rf)}>
              REFUEL HERE
            </button>
          )}
          {n > 2 && (
            <button data-remove={i} aria-label={`remove stop ${i + 1}`} onClick={() => removeStop(i)} style={{ ...miniBtn(C.grey), padding: "3px 8px", fontSize: 12 }}>
              ✕
            </button>
          )}
        </div>
        {!last ? (
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={k}>MIN TO LIFT</span>
              <span data-min={i} style={{ ...v, color: C.white }}>
                {gate === null ? "—" : gate}
              </span>
            </div>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={k}>{rf ? "AFTER REFUEL KG" : "ACTUAL KG"}</span>
              <input
                className="ifr-actual"
                data-actual={i}
                value={trip.actual[i]}
                inputMode="numeric"
                placeholder={i === 0 ? "" : rf ? (gate === null ? "" : `≥ ${gate}`) : r.planned[i] === null ? "" : `plan ${r.planned[i]}`}
                onChange={(e) => setActual(i, e.target.value)}
                style={{
                  ...inputStyle(15),
                  width: "100%",
                  boxSizing: "border-box",
                  background: C.bg,
                  border: `1px solid ${C.cyan}`,
                  borderRadius: 5,
                  padding: "3px 6px",
                  fontWeight: 700,
                }}
              />
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={k}>MARGIN</span>
              <span data-margin={i} style={{ ...v, color: margin === null ? C.grey : margin < 0 ? C.amber : C.green }}>
                {margin === null ? "—" : signed(margin)}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 9 }}>
            <span style={k}>PLANNED ON LANDING</span>
            <span data-landing style={{ ...v, color: r.landing === null ? C.grey : r.landing < AC.final_reserve_ifr_kg ? C.amber : C.grey }}>
              {r.landing === null ? "—" : `${r.landing} KG`}
            </span>
          </div>
        )}
        {rf && r.planned[i] !== null && (
          <div data-refuel-msg style={{ marginTop: 8, fontFamily: mono, fontSize: 9.5, lineHeight: 1.5, color: C.cyan }}>
            FUEL STOP — ARRIVE WITH {r.planned[i]} KG
            {r.uplift[i] === undefined ? "" : r.uplift[i] > 0 ? ` · UPLIFT AT LEAST ${r.uplift[i]} KG` : " · NO UPLIFT NEEDED TO CONTINUE"}
          </div>
        )}
        {warn && (
          <div data-warn={i} style={{ marginTop: 8, fontFamily: mono, fontSize: 9.5, lineHeight: 1.5, color: C.amber, fontWeight: 600 }}>
            BELOW MINIMUM — IFR DEPARTURE NOT AVAILABLE. REFUEL BEFORE CONTINUING, OR HOLD FOR WEATHER.
          </div>
        )}
      </div>
    );
  };

  const sector = (i) => {
    const s = r.sec[i];
    if (s.incomplete) {
      return (
        <div key={`sec-${i}`} data-sector={i} style={{ marginLeft: 14, borderLeft: `1px solid ${C.edge}`, padding: "8px 0 8px 12px" }}>
          <div data-sector-line={i} data-incomplete style={{ fontFamily: mono, fontSize: 10, color: C.grey }}>
            → {s.from ? "SELECT THE NEXT STOP" : "SELECT THIS STOP"}
          </div>
        </div>
      );
    }
    const noAlt = s.needAlts === 0;
    const altTxt = noAlt ? "NO ALTN" : s.error ? "NO VALID ALTN" : "ALTN " + s.a1.id + (s.needAlts === 2 ? "+" + s.a2.id : "");
    const isOpen = !!open[i];
    const cols = { display: "grid", gridTemplateColumns: "1.05fr 1.6fr 34px 40px", gap: 4, alignItems: "baseline" };
    const cell = { fontFamily: mono, fontSize: 10, color: C.white, padding: "4px 0" };
    const altPick = (lab, key, value, list, distTo, extra) => (
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", color: C.grey, marginBottom: 6 }}>
        <span style={{ minWidth: 62 }}>{lab}</span>
        <select data-alt-picker={key} value={value} onChange={(e) => update((t) => (t[key][i] = e.target.value))} style={{ ...selectStyle, color: C.amber, fontSize: 11 }}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {siteName(x)}
            </option>
          ))}
        </select>
        <span style={{ letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
          {extra ? `${extra} · ` : ""}
          {Math.round(distTo)} nm
        </span>
      </label>
    );
    return (
      <div key={`sec-${i}`} data-sector={i} style={{ marginLeft: 14, borderLeft: `1px solid ${C.edge}`, padding: "8px 0 8px 12px" }}>
        <button
          data-sector-line={i}
          onClick={() => toggleOpen(i)}
          aria-expanded={isOpen}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: mono, fontSize: 10, color: C.grey, textAlign: "left" }}
        >
          <span>
            → {s.to.id} · {Math.round(s.dist)} nm · <span style={{ color: C.cyan, fontWeight: 700 }}>{s.sc}</span> · {altTxt}
          </span>
          <span style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
            <b style={{ color: C.white }}>{s.burn} KG</b>
            <ExpandArrow open={isOpen} />
          </span>
        </button>
        {isOpen && (
          <div data-detail={i} style={{ marginTop: 9 }}>
            <div style={{ display: "flex", gap: 5 }}>
              {SCENARIO_ORDER.map((c) => {
                const ok = s.profile.allowed.includes(c);
                const on = c === s.sc;
                return (
                  <button
                    key={c}
                    data-chip={`${i}:${c}`}
                    disabled={!ok}
                    aria-pressed={on}
                    aria-label={`Profile ${c}: ${SCENARIO_HINT[c].join(", ")}${ok ? "" : " (not offered)"}`}
                    onClick={() => ok && update((t) => (t.scen[i] = c))}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: C.inputBg,
                      border: `1px solid ${on ? C.cyan : C.edge}`,
                      borderRadius: 5,
                      padding: "5px 0 4px",
                      color: on ? C.cyan : C.grey,
                      fontFamily: mono,
                      cursor: ok ? "pointer" : "default",
                      opacity: ok ? 1 : 0.3,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{c}</span>
                    {SCENARIO_HINT[c].map((h) => (
                      <span key={h} style={{ fontSize: 7, fontWeight: 600, lineHeight: 1.3 }}>
                        {h}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.grey, lineHeight: 1.5, margin: "7px 0 9px", borderLeft: `2px solid ${C.edge}`, paddingLeft: 8 }}>
              {SCENARIO_TEXT[s.sc]}
              {s.profile.key === "pins" && !s.vfr && <span style={{ opacity: 0.75 }}> {PINS_NOTE}</span>}
            </div>
            <div data-approaches={s.to.id} style={{ fontFamily: mono, fontSize: 9.5, lineHeight: 1.5, color: C.white, marginBottom: 6 }}>
              <span style={{ color: C.grey, letterSpacing: "0.1em", marginRight: 6 }}>APPROACHES {s.to.id}</span>
              {approachSummary(s.to.id).join(" · ") || "NONE LISTED"}
            </div>
            {!noAlt && !s.error && (
              <>
                {altPick("ALTERNATE", "alt", s.a1.id, s.list, haversineNm(s.to, s.a1), s.auto ? "nearest" : "chosen")}
                {s.needAlts === 2 && altPick("2ND ALTN", "alt2", s.a2.id, s.list.filter((x) => x !== s.a1), haversineNm(s.to, s.a2))}
                {[s.a1, ...(s.needAlts === 2 ? [s.a2] : [])].map((a) => (
                  <div key={a.id} data-approaches={a.id} style={{ fontFamily: mono, fontSize: 9.5, lineHeight: 1.5, color: C.white, marginBottom: 4 }}>
                    <span style={{ color: C.grey, letterSpacing: "0.1em", marginRight: 6 }}>APPROACHES {a.id}</span>
                    {approachSummary(a.id).join(" · ")}
                  </div>
                ))}
              </>
            )}
            {(() => {
              const ex = explainSector(s, {
                fromName: siteName(s.from),
                toName: siteName(s.to),
                nextGate: r.sec[i + 1] ? r.sec[i + 1].gate : null,
                addMin: FUEL_DATA.oma_rules.scenarios[s.sc].trip_add_min || 0,
              });
              return (
                <div data-explain={i} style={{ fontFamily: mono, fontSize: 9.5, color: C.white, lineHeight: 1.5, margin: "8px 0 4px", borderLeft: `2px solid ${C.edge}`, paddingLeft: 8 }}>
                  {ex.text || (
                    <>
                      {ex.pre}
                      <b>{ex.total}</b>
                      {ex.after}
                    </>
                  )}
                </div>
              );
            })()}
            <details
              data-workings={i}
              open={!!workOpen[i]}
              onToggle={(e) => {
                const o = e.currentTarget.open;
                setWorkOpen((w) => (!!w[i] === o ? w : Object.assign([...w], { [i]: o })));
              }}
              style={{ marginTop: 8 }}
            >
              <summary
                data-workings-toggle={i}
                className="ifr-sum"
                style={{ listStyle: "none", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 0 6px", borderBottom: `1px solid ${C.edge}` }}
              >
                <ExpandArrow open={!!workOpen[i]} size={22} />
                <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.13em", color: C.grey }}>FUEL WORKINGS</span>
              </summary>
            <div style={{ marginTop: 6 }}>
              <div style={{ ...cols, borderBottom: `1px solid ${C.edge}` }}>
                {[`MIN TO LIFT ${s.from.id}`, "REQUIREMENT", "L", "KG"].map((h, j) => (
                  <span key={h} style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: "0.12em", color: C.grey, padding: "3px 0", textAlign: j >= 2 ? "right" : "left" }}>
                    {h}
                  </span>
                ))}
              </div>
              {s.rows.map((row, j) => (
                <div key={j} data-row={`${i}:${j}`} style={{ ...cols, borderBottom: `1px solid ${C.edge}55` }}>
                  <span style={cell}>{row.item}</span>
                  <span style={{ ...cell, color: C.grey, fontSize: 9 }}>{row.req}</span>
                  <span style={{ ...cell, textAlign: "right", color: C.grey }}>{row.kg === null ? "—" : kgToL(row.kg)}</span>
                  <span style={{ ...cell, textAlign: "right", color: C.cyan, fontWeight: 600 }}>{row.kg === null ? "—" : row.kg}</span>
                </div>
              ))}
              {s.extra && (
                <>
                  <div data-subtotal={i} style={{ ...cols, borderBottom: `1px solid ${C.edge}55` }}>
                    <span style={{ ...cell, fontWeight: 700 }}>This leg (OMA)</span>
                    <span style={{ ...cell, color: C.grey, fontSize: 9 }}>sum of the lines above</span>
                    <span style={{ ...cell, textAlign: "right", color: C.grey, fontWeight: 700 }}>{s.own === null ? "—" : kgToL(s.own)}</span>
                    <span style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{s.own === null ? "—" : s.own}</span>
                  </div>
                  <div data-row={`${i}:extra`} data-extra={i} style={{ ...cols, borderBottom: `1px solid ${C.edge}55` }}>
                    <span style={cell}>{s.extra.item}</span>
                    <span style={{ ...cell, color: C.grey, fontSize: 9 }}>{s.extra.req}</span>
                    <span style={{ ...cell, textAlign: "right", color: C.grey }}>{s.extra.kg === null ? "—" : `+${kgToL(s.extra.kg)}`}</span>
                    <span style={{ ...cell, textAlign: "right", color: C.cyan, fontWeight: 600 }}>{s.extra.kg === null ? "—" : `+${s.extra.kg}`}</span>
                  </div>
                </>
              )}
              <div data-row-total={i} style={{ ...cols, borderTop: `1px solid ${C.edge}` }}>
                <span style={{ ...cell, fontWeight: 700 }}>MIN TO LIFT</span>
                <span style={{ ...cell, color: C.grey, fontSize: 9 }}>{s.extra && s.extra.kg !== null ? `${s.own} + ${s.extra.kg}` : ""}</span>
                <span style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{s.gate === null ? "—" : kgToL(s.gate)}</span>
                <span style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{s.gate === null ? "—" : s.gate}</span>
              </div>
              {s.fuelAt && (
                <>
                  <div data-fuel-at={i} style={{ ...cols, borderTop: `1px solid ${C.edge}55` }}>
                    <span style={cell}>Fuel at {s.from.id}</span>
                    <span style={{ ...cell, color: C.grey, fontSize: 9 }}>{s.fuelAt.kind}</span>
                    <span style={{ ...cell, textAlign: "right", color: C.grey }}>{kgToL(s.fuelAt.kg)}</span>
                    <span style={{ ...cell, textAlign: "right" }}>{s.fuelAt.kg}</span>
                  </div>
                  <div data-disc={i} style={cols}>
                    <span style={{ ...cell, fontWeight: 700, color: s.disc < 0 ? C.amber : C.green }}>{s.disc < 0 ? "BELOW MINIMUM" : "Discretionary"}</span>
                    <span style={{ ...cell, color: C.grey, fontSize: 9 }}>{s.disc < 0 ? "short of min to lift" : "above min to lift — commander's discretion"}</span>
                    <span style={{ ...cell, textAlign: "right", color: s.disc < 0 ? C.amber : C.green }}>{signed(kgToL(s.disc))}</span>
                    <span style={{ ...cell, textAlign: "right", fontWeight: 700, color: s.disc < 0 ? C.amber : C.green }}>{signed(s.disc)}</span>
                  </div>
                </>
              )}
            </div>
            </details>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`.ifr-actual::placeholder { color: ${C.grey}; opacity: 0.55; font-weight: 500; text-transform: none; }
.ifr-sum { list-style: none; } .ifr-sum::-webkit-details-marker { display: none; } .ifr-sum::marker { content: ""; }
@media (prefers-reduced-motion: reduce) { .exp-chev { transition: none !important; } }`}</style>
      <PanelHeader title="IFR FUEL" subtitle="AW169 · OMB34" />
      <IfrMap result={r} note={mapNote} onTap={tapMap} />

      <div data-headline style={{ border: `1px solid ${!r.complete ? C.edge : headBad ? C.amber : C.green}80`, borderRadius: 8, padding: "11px 13px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", color: C.grey }}>REQUIRED TO LIFT {head.site || ""}</span>
          <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: headColor }}>{head.gate === null ? "—" : `${head.gate} KG`}</span>
        </div>
        <div data-verdict style={{ marginTop: 6, fontFamily: mono, fontSize: 10.5, fontWeight: 600, textAlign: "right", color: !head.entered ? C.grey : headBad ? C.amber : C.green }}>
          {!r.complete
            ? "SELECT EVERY STOP TO PLAN"
            : !head.entered || head.margin === null
            ? `ENTER FUEL AT ${head.site}`
            : headBad
            ? `SHORT ${head.margin} KG`
            : `ENOUGH ${signed(head.margin)} KG`}
        </div>
      </div>

      <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.15em", color: C.grey, margin: "0 2px 8px" }}>
        TRIP — MINIMUM FUEL TO LIFT FROM EACH SITE
      </div>
      {trip.stops.map((_, i) => (
        <div key={i}>
          {card(i)}
          {i < n - 1 && sector(i)}
        </div>
      ))}

      <button
        data-add-sector
        onClick={addSector}
        style={{ width: "100%", marginTop: 10, border: `1px dashed ${C.cyan}`, borderRadius: 8, background: "transparent", fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: C.cyan, padding: "10px 0", cursor: "pointer" }}
      >
        + ADD SECTOR
      </button>
      <button
        data-export-pdf
        onClick={exportPdf}
        disabled={exporting || !planReady}
        style={{ ...btnStyle(C.green), marginTop: 8, padding: "10px 0", fontSize: 10, opacity: exporting || !planReady ? 0.4 : 1 }}
      >
        {exporting ? "PREPARING PDF…" : "EXPORT PLAN (PDF)"}
      </button>
      {!confirmReset ? (
        <button data-reset onClick={() => setConfirmReset(true)} style={{ ...btnStyle(C.grey), marginTop: 8, padding: "8px 0", fontSize: 10 }}>
          RESET TRIP
        </button>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <span style={{ flex: 1.4, fontFamily: mono, fontSize: 9.5, color: C.amber, lineHeight: 1.4 }}>RESET TO THE DEFAULT TRIP? CLEARS STOPS AND FUEL ENTERED.</span>
          <button data-reset-confirm onClick={resetTrip} style={{ ...btnStyle(C.amber), padding: "8px 0", fontSize: 10 }}>
            RESET
          </button>
          <button data-reset-cancel onClick={() => setConfirmReset(false)} style={{ ...btnStyle(C.grey), padding: "8px 0", fontSize: 10 }}>
            CANCEL
          </button>
        </div>
      )}

      <p style={{ marginTop: 14, marginBottom: 0, color: C.grey, fontSize: 10.5, lineHeight: 1.6, fontFamily: mono }}>
        Planning cross-check only — not a certified flight-planning tool. Verify against the OFP and current plates.
      </p>
    </>
  );
}

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
        // Four tabs + theme toggle must share one row at 375px: slightly tighter
        // than the original three-tab bar, and never wrapping to two lines.
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
        minWidth: 0,
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
          {tabBtn("ifr", "IFR FUEL")}
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
          <div style={{ display: tab === "ifr" ? "block" : "none" }}>
            <IfrFuel />
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 10,
            color: C.grey,
            opacity: 0.6,
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: "0.08em",
          }}
        >
          {APP_VERSION}
          {BUILD_DATE ? ` · ${BUILD_DATE}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── Mount ──────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<App />);
