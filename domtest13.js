const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setter = (w) => Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
const taSetter = (w) => Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set;

(async () => {
  const res = [];
  const check = (n, ok) => res.push([n, ok]);

  // ── A/B: NOTES and MISC store text as typed, display uppercase via CSS ──
  {
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "",
      rows: [{ fltTime: "20", shtdwn: "1030", fuel: "400", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" },
        ...Array.from({ length: 6 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }))],
      misc: "", powerChecks: [] };
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(cur)); } });
    const w = dom.window, d = w.document;
    await sleep(2500);

    // NOTES input is on the FLIGHTS page (default tab), row 1
    const notesInput = [...d.querySelectorAll("input")].find((i) => i.value === "" && i.previousElementSibling?.textContent?.trim() === "NOTES");
    check("found row NOTES input", !!notesInput);
    if (notesInput) {
      setter(w).call(notesInput, "diverted for wx");
      notesInput.dispatchEvent(new w.Event("input", { bubbles: true }));
      await sleep(100);
      check("NOTES: state holds text as typed (not force-uppercased)", notesInput.value === "diverted for wx");
      check("NOTES: CSS text-transform uppercase applied", notesInput.style.textTransform === "uppercase");
      check("NOTES: autoCapitalize=characters set", notesInput.getAttribute("autocapitalize") === "characters");
    }

    // A/C DATA page for MISC
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "A/C DATA")
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(300);
    const miscArea = d.querySelector("textarea");
    check("found MISC textarea", !!miscArea);
    if (miscArea) {
      taSetter(w).call(miscArea, "oil top up needed");
      miscArea.dispatchEvent(new w.Event("input", { bubbles: true }));
      await sleep(100);
      check("MISC: state holds text as typed (not force-uppercased)", miscArea.value === "oil top up needed");
      check("MISC: CSS text-transform uppercase applied", miscArea.style.textTransform === "uppercase");
      check("MISC: autoCapitalize=characters set", miscArea.getAttribute("autocapitalize") === "characters");
    }
  }

  // ── C: GROUND RUN / POWER CHECK auto-tagging stays case-insensitive ──
  {
    // Row 1 already sits at "ground run" in lowercase — as it would if the
    // auto-tag were ever written before the uppercase change, or the field
    // otherwise ended up lowercase. The auto-clear-on-edit logic must still
    // recognise it as an untouched auto-note (case-insensitively) and clear
    // it when flight time moves away from 0, rather than leaving it stuck.
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "",
      rows: [{ fltTime: "0", shtdwn: "", fuel: "", notes: "ground run", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" },
        ...Array.from({ length: 6 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }))],
      misc: "", powerChecks: [] };
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(cur)); } });
    const w = dom.window, d = w.document;
    await sleep(2500);
    const fltInput = [...d.querySelectorAll("input")].find((i) => i.previousElementSibling?.textContent?.trim() === "FLT MIN");
    const notesInput = [...d.querySelectorAll("input")].find((i) => i.previousElementSibling?.textContent?.trim() === "NOTES");
    check("row seeded with lowercase 'ground run'", notesInput.value === "ground run");
    // editing flight time away from 0 should clear the auto-tag even though it's lowercase
    setter(w).call(fltInput, "25");
    fltInput.dispatchEvent(new w.Event("input", { bubbles: true }));
    await sleep(300);
    check("lowercase 'ground run' cleared on edit (case-insensitive AUTO_NOTES check)", notesInput.value === "");
  }

  // ── D: PDF output — notes/misc print uppercase regardless of typed case ──
  {
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "0459 / 2113",
      rows: [{ fltTime: "20", shtdwn: "1030", fuel: "400", notes: "diverted for wx", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" },
        ...Array.from({ length: 6 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }))],
      misc: "oil top up needed", powerChecks: [] };
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(w) {
        w.localStorage.setItem("daily-flight-card", JSON.stringify(cur));
        w.navigator.canShare = () => true;
        let captured = null;
        w.navigator.share = async (data) => { captured = data.files[0]; };
        w.__getShared = () => captured;
      } });
    const w = dom.window, d = w.document;
    await sleep(2500);
    const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    const btnIncl = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.includes(t));
    click([...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "A/C DATA")); await sleep(300);
    click(btnIncl("NEW CARD")); await sleep(200);
    click(btnIncl("EXPORT PDF & NEW CARD")); await sleep(1500);
    const file = w.__getShared();
    check("PDF share captured", !!file);
    if (file) {
      const bytes = await file.text();
      check("PDF: notes print uppercase", bytes.includes("DIVERTED FOR WX"));
      check("PDF: notes NOT printed lowercase", !bytes.includes("diverted for wx"));
      check("PDF: misc prints uppercase", bytes.includes("OIL TOP UP NEEDED"));
      check("PDF: misc NOT printed lowercase", !bytes.includes("oil top up needed"));
    }
  }

  // ── E: carry-over does not copy date or sunriseSet ──
  {
    const cur = { date: "14.07.2026", acReg: "G-KSST", srp: "1234", gwDep: "4600", varField: "4650", vertField: "4550",
      plannedFuel: "650", hoursAvail: "9:00", sunriseSet: "0459 / 2113",
      rows: [{ fltTime: "40", shtdwn: "1030", fuel: "500", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" },
        ...Array.from({ length: 6 }, () => ({ fltTime: "", shtdwn: "", fuel: "", notes: "", refuel: false, upliftL: "", hems: false, hemsGrid: "", patientKg: "" }))],
      misc: "", powerChecks: [] };
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.github.io/", pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.localStorage.setItem("daily-flight-card", JSON.stringify(cur)); } });
    const w = dom.window, d = w.document;
    const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    const btn = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
    const btnIncl = (t) => [...d.querySelectorAll("button")].find((b) => b.textContent.includes(t));
    await sleep(2500);
    click(btn("A/C DATA")); await sleep(300);
    click(btnIncl("NEW CARD")); await sleep(200);
    click(btnIncl("CARRY OVER A/C DATA")); await sleep(100);
    click(btn("CLEAR WITHOUT PDF")); await sleep(900);
    const inputs = [...d.querySelectorAll("input")];
    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
    check("carry-over: SRP still increments to 1235", inputs.some((i) => i.value === "1235"));
    check("carry-over: GW DEP still carried (4600)", inputs.some((i) => i.value === "4600"));
    check("carry-over: VERT TOW still carried (4550)", inputs.some((i) => i.value === "4550"));
    check("carry-over: date is today, not the outgoing 14.07.2026", inputs.some((i) => i.value === todayStr) && !inputs.some((i) => i.value === "14.07.2026"));
    check("carry-over: sunrise/sunset recomputed, not the outgoing 0459 / 2113", !d.getElementById("root").textContent.includes("0459 / 2113"));
  }

  let fail = 0;
  for (const [n, ok] of res) { console.log((ok ? "PASS" : "FAIL") + "  " + n); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
})();
