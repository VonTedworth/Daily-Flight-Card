// Base duties. Item: { id, t } | { id, t, auto: "pc" } | { id, t, handover: true } | { id, t, sub: [items] }
// NEVER rename or reuse an id (ticks on cards are stored by id). New duty = new id.
export const DUTIES = {
  daily: [
    { id: "acan", t: "ACAN NOTAM data cleared, refreshed and filtered" },
    { id: "cw", t: "Compressor wash" },
    { id: "pc", t: "Power check", auto: "pc" },
    { id: "hov", t: "Handover sheet", handover: true },
    { id: "nvgout", t: "NVGs signed out" },
    { id: "ipad", t: "Capt and FO iPad cases changed" },
    { id: "tac", t: "TAC radio batteries changed" },
    { id: "shrep", t: "Shift report" },
    { id: "srpscan", t: "SRPs scanned and sent" },
    { id: "yellow", t: "Yellow sheets filed" },
    { id: "white3", t: "Max 3 white SRPs in tech log folder" },
  ],
  night: [
    { id: "notam", t: "NOTAMs" },
    { id: "wboard", t: "Whiteboard" },
    { id: "nvgin", t: "NVGs signed in" },
  ],
  // getDay(): 0 = Sunday … 6 = Saturday. Empty = "No duties".
  days: {
    1: [
      { id: "srppost", t: "SRPs posted to head office" },
      { id: "acwash", t: "Aircraft wash", sub: [
        { id: "acwash.ext", t: "External windscreens and windows cleaned" },
        { id: "acwash.int", t: "Internal windscreens and windows polished" },
        { id: "acwash.scr", t: "Internal screens polished" },
        { id: "acwash.floor", t: "Cockpit floor hoovered and washed" },
      ]},
    ],
    2: [{ id: "nvgcheck", t: "NVG check" }],
    3: [], 4: [], 5: [],
    6: [{ id: "ddl", t: "Deferred defects list scanned and sent" }],
    0: [],
  },
  optional: [
    { id: "o.sweep", t: "Blow and sweep the hangar" },
    { id: "o.floor", t: "Wash the hangar floor" },
    { id: "o.bins", t: "Empty the hangar bins" },
    { id: "o.jerry", t: "Empty the fuel jerry cans" },
    { id: "o.fcc", t: "Fuel check cabinet", sub: [
      { id: "o.fcc.tidy", t: "Clean and tidy" },
      { id: "o.fcc.gloves", t: "Gloves replenished" },
      { id: "o.fcc.swd", t: "Shell water detectors: check expiry" },
    ]},
    { id: "o.skin", t: "Skin wash the aircraft" },
    { id: "o.ext", t: "External windscreens and windows cleaned" },
    { id: "o.int", t: "Internal windscreens and windows polished" },
    { id: "o.cabin", t: "Aircraft interior: clear mud, hoover, light wash" },
  ],
  winter: [{ id: "w.salt", t: "Salt the apron" }],
};
