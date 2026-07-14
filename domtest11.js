const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const mk=(o)=>({fltTime:"",shtdwn:"",fuel:"",notes:"",refuel:false,upliftL:"",hems:false,hemsGrid:"",patientKg:"",...o});
const cur = { date:"14.07.2026", acReg:"G-KSST", srp:"2047", gwDep:"4600", varField:"4650", plannedFuel:"650",
  hoursAvail:"6:00", sunriseSet:"0459 / 2113", rows:[mk({fltTime:"90", shtdwn:"1030", fuel:"400"}),...Array.from({length:6},()=>mk({}))], misc:"", powerChecks:[] };
const html = fs.readFileSync("./index.html","utf8");
const dom = new JSDOM(html,{runScripts:"dangerously",url:"https://x.github.io/",pretendToBeVisual:true,virtualConsole:new VirtualConsole(),
  beforeParse(w){
    w.localStorage.setItem("daily-flight-card",JSON.stringify(cur));
    // stub the share sheet so the EXPORT path completes in jsdom
    w.navigator.canShare = () => true;
    w.navigator.share = async () => {};
  }});
const w=dom.window,d=w.document;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const click=(el)=>el.dispatchEvent(new w.MouseEvent("click",{bubbles:true,cancelable:true}));
const btnIncl=(t)=>[...d.querySelectorAll("button")].find(b=>b.textContent.includes(t));
(async()=>{
  await sleep(2500);
  click([...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="A/C DATA")); await sleep(300);
  click(btnIncl("NEW CARD")); await sleep(200);
  click(btnIncl("CARRY OVER A/C DATA")); await sleep(100);
  click(btnIncl("EXPORT PDF & NEW CARD")); await sleep(1500);
  const inputs=[...d.querySelectorAll("input")];
  const res=[
    ["EXPORT path: SRP 2047 → 2048", inputs.some(i=>i.value==="2048")],
    ["available = remaining 4:30", inputs.some(i=>i.value==="4:30")],
    ["old card archived as 2047", JSON.parse(w.localStorage.getItem("card-history"))[0].srp==="2047"],
  ];
  let fail=0; for(const [n,ok] of res){console.log((ok?"PASS":"FAIL")+"  "+n); if(!ok)fail++;}
  process.exit(fail?1:0);
})();
