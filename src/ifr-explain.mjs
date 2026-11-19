// IFR FUEL — the one plain-English sentence shown when a sector is opened.
// Presentation only: it reads figures the engine (fuelcalc.js) has already worked out
// and never calculates a requirement itself. Kept in its own module so the tests can
// check every case directly (domtest23.js).
//
// Returns { pre, total, after } — the UI bolds `total` — or { text } when there is no
// figure to give.
export function explainSector(s, { fromName, toName, nextGate = null, addMin = 0 }) {
  if (s.own === null) return { text: `No valid alternate for ${toName}, so the minimum to leave ${fromName} can't be worked out.` };
  if (s.gate === null) return { text: `Select every stop to see what leaving ${fromName} needs.` };
  const rest = s.gate - s.burn;
  let tail;
  if (s.useOnward) tail = `then ${nextGate} kg to leave ${toName}.`;
  else if (s.vfr) tail = `then ${rest} kg final reserve.`;
  else if (!s.needAlts)
    tail = `then ${rest} kg for reserve${s.sc === "A" ? ` and the extra approach${addMin ? ` (incl. ${addMin} min added to trip)` : ""}` : ""}.`;
  else tail = `then ${rest} kg for the alternate and reserve.`;
  return { pre: `Leaving ${fromName} needs `, total: `${s.gate} kg`, after: `: ${s.burn} kg for this sector, ${tail}` };
}
