const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const mk = (o) => ({ fltTime:"", shtdwn:"", fuel:"", notes:"", refuel:false, upliftL:"", hems:false, hemsGrid:"", patientKg:"", ...o });
// legacy 8-row card with row 8 USED — must not be truncated
const rows8 = [ mk({fltTime:"40", shtdwn:"1030", fuel:"500"}), mk({fltTime:"35", fuel:"420"}), mk({}), mk({}), mk({}), mk({}), mk({}), mk({fltTime:"20", fuel:"300"}) ];
const cur = { date:"14.07.2026", acReg:"G-KSST", srp:"1234", gwDep:"4600", varField:"4650", plannedFuel:"650", hoursAvail:"9:00", sunriseSet:"0459 / 2113", rows: rows8, misc:"", powerChecks:[] };
const html = fs.readFileSync("./index.html","utf8");
const dom = new JSDOM(html,{runScripts:"dangerously",url:"https://x.github.io/",pretendToBeVisual:true,virtualConsole:new VirtualConsole(),
  beforeParse(w){w.localStorage.setItem("daily-flight-card",JSON.stringify(cur));}});
const w = dom.window, d = w.document;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const click=(el)=>el.dispatchEvent(new w.MouseEvent("click",{bubbles:true,cancelable:true}));
const btn=(txt)=>[...d.querySelectorAll("button")].find(b=>b.textContent.trim()===txt);
const btnIncl=(txt)=>[...d.querySelectorAll("button")].find(b=>b.textContent.includes(txt));
(async()=>{
  await sleep(2500);
  const res=[]; const check=(n,ok)=>res.push([n,ok]);
  let t = d.getElementById("root").textContent;

  // default tab = FLIGHTS (page split)
  check("flights page shows rows", t.includes("FLT MIN"));
  check("flights context bar (reg/srp/rem)", t.includes("G-KSST") && t.includes("SRP 1234") && t.includes("REM 7:25"));
  check("no header grid on flights page", !t.includes("PLANNED FUEL KG"));
  check("legacy row 8 preserved", t.includes("DEP GW"));  // will assert count next
  const fltLabels = t.match(/FLT MIN/g) || [];
  check("used rows incl legacy 8th + 1 working (4 visible)", fltLabels.length === 4);

  // A/C DATA page
  click(btn("A/C DATA")); await sleep(300);
  t = d.getElementById("root").textContent;
  check("ac page has header fields", t.includes("PLANNED FUEL KG") && t.includes("HOURS AVAILABLE"));
  check("ac page has summary strip", t.includes("AVAILABLE") && t.includes("FLOWN"));
  check("ac page has MISC + power check", t.includes("MISC") && t.includes("POWER CHECK"));
  check("ac page has NEW CARD", !!btnIncl("NEW CARD"));
  check("no flight rows on ac page", !t.includes("FLT MIN"));

  // carry-over flow
  click(btnIncl("NEW CARD")); await sleep(200);
  check("carry toggle present", !!btnIncl("CARRY OVER A/C DATA"));
  click(btnIncl("CARRY OVER A/C DATA")); await sleep(100);
  click(btn("CLEAR WITHOUT PDF")); await sleep(900);
  t = d.getElementById("root").textContent;
  const inputs=[...d.querySelectorAll("input")];
  check("SRP incremented to 1235", inputs.some(i=>i.value==="1235"));
  check("reg carried", [...d.querySelectorAll("select")].some(sel=>sel.value==="G-KSST"));
  check("gw dep carried", inputs.some(i=>i.value==="4600"));
  check("available = old remaining 7:25", inputs.some(i=>i.value==="7:25"));
  check("date carried", inputs.some(i=>i.value==="14.07.2026"));
  // new card rows are 7 and empty
  click(btn("FLIGHTS")); await sleep(300);
  t = d.getElementById("root").textContent;
  const flt2 = t.match(/FLT MIN/g) || [];
  check("fresh card: 1 working row visible", flt2.length === 1);
  check("archived old card", !!(await (async()=>{const h=JSON.parse(w.localStorage.getItem("card-history"));return h[0].srp==="1234";})()));

  let fail=0; for(const [n,ok] of res){console.log((ok?"PASS":"FAIL")+"  "+n); if(!ok)fail++;}
  process.exit(fail?1:0);
})();
