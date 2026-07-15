const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const mk = (o) => ({ fltTime:"30", shtdwn:"1030", fuel:"", notes:"", refuel:false, upliftL:"", hems:false, hemsGrid:"", patientKg:"", ...o });
// gwDep 4650, planned 650 (departure basis):
// FLT1: dep=planned -> 4650 -> SRP note (grey, informational)
// FLT2: dep=620 -> 4650-30+250 = 4870 -> OVER AUM (amber)
// FLT3: dep=640 -> 4640 -> SRP note
const rows = [ mk({fuel:"620"}), mk({fuel:"640", hems:true, patientKg:"250"}), mk({fuel:"300"}),
  ...Array.from({length:5},()=>mk({fltTime:"",shtdwn:"",fuel:""})) ];
const cur = { date:"11.07.2026", acReg:"G-KSST", srp:"1234", gwDep:"4650", varField:"4650", plannedFuel:"650", hoursAvail:"9:00", sunriseSet:"", rows, misc:"", powerChecks:[] };
const html = fs.readFileSync("./index.html","utf8");
const dom = new JSDOM(html,{runScripts:"dangerously",url:"https://x.github.io/",pretendToBeVisual:true,virtualConsole:new VirtualConsole(),
  beforeParse(w){w.localStorage.setItem("daily-flight-card",JSON.stringify(cur));}});
setTimeout(()=>{
  const d = dom.window.document;
  const t = d.getElementById("root").textContent;
  const spans = [...d.querySelectorAll("span")];
  const srpSpan = spans.find(s=>s.textContent.trim().startsWith("DEP GW 4650KG"));
  const aumSpan = spans.find(s=>s.textContent.includes("DEP GW 4870KG — OVER AUM"));
  const checks = [
    ["FLT1 4650 plain", !!srpSpan],
    ["FLT2 4870 AUM warning (shortened, no repeated 4800)", !!aumSpan && !aumSpan.textContent.includes("4800")],
    ["FLT3 4640 plain", t.includes("DEP GW 4640KG")],
    ["4650 grey vs AUM amber", srpSpan && aumSpan && srpSpan.style.color !== aumSpan.style.color],
    ["no SRP note text on rows", !t.includes("NOTE ON SRP")],
    ["no old OVER 4600 wording", !t.includes("OVER 4600")],
  ];
  let fail=0; for (const [n,ok] of checks){console.log((ok?"PASS":"FAIL")+"  "+n); if(!ok)fail++;}
  process.exit(fail?1:0);
},3000);
