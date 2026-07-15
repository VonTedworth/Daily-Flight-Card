const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const mk = (o) => ({ fltTime:"30", shtdwn:"1030", fuel:"", notes:"", refuel:false, upliftL:"", hems:false, hemsGrid:"", patientKg:"", ...o });
// gwDep 4600, planned 650.
// FLT1: dep fuel = planned → DEP GW = 4600 (+patient 0). Lands 500.
// FLT2: no refuel → dep fuel = 500 → GW = 4600 + (500-650) = 4450. HEMS patient 90 → 4540. Lands 350, refuel ticked.
// FLT3: after refuel → dep fuel = planned → GW = 4600. Lands 620 (>650? no, fine).
// FLT4: no refuel → dep = 620 → GW = 4600 + (620-650) = 4570.
const rows = [
  mk({ fuel:"500" }),
  mk({ fuel:"350", refuel:true, upliftL:"380", hems:true, patientKg:"90" }),
  mk({ fuel:"620" }),
  mk({ fuel:"400" }),
  ...Array.from({length:4},()=>mk({fltTime:"",shtdwn:"",fuel:""})),
];
const cur = { date:"11.07.2026", acReg:"G-KSST", srp:"1234", gwDep:"4600", varField:"4650", plannedFuel:"650", hoursAvail:"9:00", sunriseSet:"", rows, misc:"", powerChecks:[] };
const html = fs.readFileSync("./index.html","utf8");
const dom = new JSDOM(html,{runScripts:"dangerously",url:"https://x.github.io/",pretendToBeVisual:true,virtualConsole:new VirtualConsole(),
  beforeParse(w){ w.localStorage.setItem("daily-flight-card",JSON.stringify(cur));
                  w.localStorage.setItem("card-history",JSON.stringify([{...cur, srp:"1200"}])); }});
const w = dom.window, d = w.document;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await sleep(2500);
  const t = d.getElementById("root").textContent;
  const res=[]; const check=(n,ok)=>res.push([n,ok]);
  check("FLT1 dep GW = gwDep (planned fuel)", t.includes("DEP GW 4600KG"));
  check("FLT2 prev-landed + patient (4540)", t.includes("DEP GW 4540KG"));
  check("FLT4 prev landed 620 (4570)", t.includes("DEP GW 4570KG"));
  check("FLT1 4600 not flagged (not >4600)", !t.includes("DEP GW 4600KG —"));
  check("VAR margin (4650-4540=+110), no old DEP PERF wording", t.includes("VAR +110") && !t.includes("DEP PERF"));
  check("VERT margin em-dash (vertField unset)", t.includes("VERT —"));
  // wording — history list is on the A/C DATA page
  [...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="A/C DATA")
    .dispatchEvent(new w.MouseEvent("click",{bubbles:true})); await sleep(300);
  const histBtn=[...d.querySelectorAll("button")].find(b=>b.textContent.includes("SRP 1200"));
  histBtn.dispatchEvent(new w.MouseEvent("click",{bubbles:true})); await sleep(400);
  const t2=d.getElementById("root").textContent;
  check("banner button says CURRENT CARD", [...d.querySelectorAll("button")].some(b=>b.textContent.trim()==="CURRENT CARD"));
  check("bottom says RETURN TO CURRENT CARD", t2.includes("RETURN TO CURRENT CARD"));
  check("no TODAY wording", !t2.includes("TODAY"));
  let fail=0; for(const [n,ok] of res){console.log((ok?"PASS":"FAIL")+"  "+n); if(!ok)fail++;}
  process.exit(fail?1:0);
})();
