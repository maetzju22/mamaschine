(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================= storage ================= */
const store = {
  get(k, d) { try { const v = localStorage.getItem("mamaschine." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mamaschine." + k, JSON.stringify(v)); } catch {} },
};

const state = {
  machines: store.get("machines", []),
  activeId: store.get("active", null),
  mTab: "foto",
  lTab: "foto",
  machinePhoto: null,
  laundry: [],
  picked: new Set(),
  amount: 4.5,
  dirt: 1,
  detergent: "Flüssigwaschmittel",
  softener: false,
  panic: 3,
  ai: null,
  ctl: null,
};
const activeMachine = () => state.machines.find((m) => m.id === state.activeId) || null;
function saveMachines() { store.set("machines", state.machines); store.set("active", state.activeId); }

/* ================= toast ================= */
let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
}

/* ================= counter / badges ================= */
const BADGES = [
  [1, "Erste Trommel! Mama wäre stolz."],
  [3, "Abzeichen: Sockenflüsterer"],
  [5, "Abzeichen: Weichspül-Lehrling"],
  [10, "Abzeichen: Schleuderkönig"],
  [25, "Abzeichen: Trommelmeister. Du darfst jetzt anderen helfen."],
  [50, "Abzeichen: Waschlegende. Ernsthaft beeindruckend."],
];
function renderCounter() { $("counterNum").textContent = store.get("count", 0); }

/* ================= AI status ================= */
async function checkAI() {
  const el = $("aiStatus");
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    const d = await r.json();
    state.ai = !!d.ai;
  } catch { state.ai = false; }
  el.classList.toggle("on", state.ai); el.classList.toggle("off", !state.ai);
  $("aiStatusText").textContent = state.ai ? "Foto-KI bereit" : "Foto-KI macht Pause · Eintippen & „Ohne Foto“ gehen immer";
  if (!state.ai) { setMTab("manuell"); setLTab("picker"); }
}

/* ================= machines ================= */
function machineSpec(m) {
  return [m.kind, m.capacity_kg ? m.capacity_kg + " kg" : null, m.source === "foto" ? "per Foto" : "eingetippt"].filter(Boolean).join(" · ");
}
function renderMachines() {
  const list = $("machineList"); list.innerHTML = "";
  state.machines.forEach((m) => {
    const b = document.createElement("div");
    b.setAttribute("role", "listitem");
    b.innerHTML = `<button type="button" class="mcard" aria-pressed="${m.id === state.activeId}">
      ${m.thumb ? `<img class="mthumb" src="${m.thumb}" alt="">` : `<span class="mthumb">${esc((m.brand || "?").slice(0, 1).toUpperCase())}</span>`}
      <span><span class="mname">${esc(m.nickname || "Maschine")} · ${esc([m.brand, m.model].filter(Boolean).join(" ") || "unbekannt")}</span><br><span class="mspec">${esc(machineSpec(m))}</span></span>
      <span class="mdel" data-del="${m.id}" role="button" tabindex="0" aria-label="${esc(m.nickname)} löschen">löschen</span>
    </button>`;
    b.querySelector(".mcard").addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) { deleteMachine(m.id); return; }
      state.activeId = m.id; saveMachines(); renderMachines();
    });
    list.append(b);
  });
  const hasActive = !!activeMachine();
  $("machineNew").hidden = hasActive && !state.addingMachine;
  if (state.machines.length) {
    const add = document.createElement("button");
    add.type = "button"; add.className = "text-link add-m";
    add.textContent = state.addingMachine ? "Doch nicht, bestehende nehmen" : "+ Andere Maschine hinzufügen";
    add.onclick = () => {
      state.addingMachine = !state.addingMachine;
      if (state.addingMachine) { state.activeId = null; } else if (!state.activeId && state.machines[0]) { state.activeId = state.machines[0].id; }
      state.machinePhoto = null; resetMachineShot(); saveMachines(); renderMachines();
    };
    list.append(add);
  }
}
function deleteMachine(id) {
  state.machines = state.machines.filter((m) => m.id !== id);
  if (state.activeId === id) state.activeId = state.machines[0]?.id || null;
  saveMachines(); renderMachines(); toast("Maschine vergessen. Sie wird es verkraften.");
}
function addMachine(m) {
  m.id = "m" + Date.now().toString(36);
  m.nickname = m.nickname || ($("mNick").value.trim() || "Zuhause");
  state.machines.push(m); state.activeId = m.id; state.addingMachine = false;
  $("mNick").value = ""; saveMachines(); renderMachines();
}
function layoutToCompartments(v) {
  if (!v) return null;
  const pos = ["links", "mitte", "rechts"];
  const purpose = { "I": "Vorwäsche", "II": "Hauptwäsche", "✿": "Weichspüler" };
  const parts = v.split(",");
  return parts.map((s, i) => ({ symbol: s, position: parts.length === 2 ? ["links", "rechts"][i] : pos[i], purpose: purpose[s] }));
}
$("mSave").onclick = () => {
  const brand = $("mBrand").value.trim();
  if (!brand) { $("mBrand").focus(); toast("Die Marke steht meistens groß vorne drauf."); return; }
  addMachine({
    source: "manuell", brand, model: $("mModel").value.trim() || null, kind: $("mKind").value,
    capacity_kg: Number($("mCap").value) || null, compartments: layoutToCompartments($("mLayout").value),
    programs: $("mPrograms").value.split(",").map((s) => s.trim()).filter(Boolean),
  });
  ["mBrand", "mModel", "mPrograms"].forEach((id) => ($(id).value = ""));
  toast("Gespeichert. Mamaschine merkt sich das.");
};

/* ================= tabs ================= */
function setMTab(t) {
  state.mTab = t;
  document.querySelectorAll("[data-mtab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mtab === t)));
  $("mTabFoto").hidden = t !== "foto"; $("mTabManuell").hidden = t !== "manuell";
}
function setLTab(t) {
  state.lTab = t;
  document.querySelectorAll("[data-ltab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.ltab === t)));
  $("lTabFoto").hidden = t !== "foto"; $("lTabPicker").hidden = t !== "picker";
}
document.querySelectorAll("[data-mtab]").forEach((b) => (b.onclick = () => {
  if (b.dataset.mtab === "foto" && state.ai === false) toast("Foto-KI macht gerade Pause. Eintippen geht aber sofort.");
  setMTab(b.dataset.mtab);
}));
document.querySelectorAll("[data-ltab]").forEach((b) => (b.onclick = () => {
  if (b.dataset.ltab === "foto" && state.ai === false) toast("Foto-KI macht gerade Pause. „Ohne Foto“ klappt aber.");
  setLTab(b.dataset.ltab);
}));

/* ================= photos ================= */
async function shrink(file, max = 1280) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.8);
    return { media_type: "image/jpeg", data: url.split(",")[1], url };
  } catch {
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const mt = (url.match(/^data:(.*?);/) || [])[1] || "image/jpeg";
    return { media_type: mt, data: url.split(",")[1], url };
  }
}
async function thumbOf(url, size = 120) {
  const img = new Image(); img.src = url; await img.decode().catch(() => {});
  const s = Math.min(img.naturalWidth, img.naturalHeight) || 1, c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}
function resetMachineShot() {
  $("mShot").classList.remove("has");
  $("mShotLabel").innerHTML = "<b>Bedienfeld fotografieren</b><small>Drehknopf, Tasten und am besten auch das Waschmittelfach</small>";
}
$("mInput").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  state.machinePhoto = await shrink(f);
  $("mShot").classList.add("has");
  $("mShotLabel").innerHTML = `<img src="${state.machinePhoto.url}" alt="Foto deiner Waschmaschine"><small>Passt. Wird bei der Analyse gespeichert.</small>`;
  e.target.value = "";
};
async function addLaundry(files) {
  for (const f of files) { if (state.laundry.length >= 3) break; state.laundry.push(await shrink(f)); }
  const box = $("lThumbs"); box.innerHTML = "";
  state.laundry.forEach((p, i) => { const img = new Image(); img.src = p.url; img.alt = "Wäschefoto " + (i + 1); box.append(img); });
  if (state.laundry.length) {
    $("lShot").classList.add("has");
    $("lShotLabel").innerHTML = state.laundry.length < 3 ? "<b>Noch ein Foto?</b><small>Zum Beispiel vom Etikett eines heiklen Teils</small>" : "<b>Drei Fotos reichen.</b><small>Mehr Haufen gibt es nicht.</small>";
  }
}
$("lInput").onchange = (e) => { addLaundry(e.target.files); e.target.value = ""; };
$("lGallery").onchange = (e) => { addLaundry(e.target.files); e.target.value = ""; };

/* ================= picker ================= */
const CATS = {
  jeans: { label: "Jeans & dunkle Hosen", group: "dunkel", w: 0.7 },
  dunkel: { label: "Dunkle Shirts & Pullis", group: "dunkel", w: 0.3 },
  bunt: { label: "Bunte Shirts & Pullis", group: "bunt", w: 0.3 },
  hemden: { label: "Business-Hemden", group: "bunt", w: 0.25 },
  weiss: { label: "Weiße Shirts & Hemden", group: "weiss", w: 0.25 },
  unter: { label: "Unterwäsche & Socken", group: "hygiene", w: 0.12 },
  handtuch: { label: "Handtücher", group: "hygiene", w: 0.5 },
  bett: { label: "Bettwäsche", group: "hygiene", w: 0.8 },
  sport: { label: "Sport & Funktion", group: "sport", w: 0.25 },
  wolle: { label: "Wolle & Kaschmir", group: "wolle", w: 0.4 },
};
const GROUPS = {
  hygiene: { name: "Handtücher & Unterwäsche", programs: ["Baumwolle", "Koch", "Buntwäsche"], temp: 60, spin: 1400, dur: 150,
    tip: ["Handtücher ohne Weichspüler", "Weichspüler macht sie schön weich, aber sie saugen dann schlechter."] },
  weiss: { name: "Weißes", programs: ["Baumwolle", "Weiß", "Buntwäsche"], temp: 40, spin: 1200, dur: 120,
    tip: ["Weißes bleibt unter sich", "Ein einziges rotes Teil reicht für ein komplett rosa Leben."] },
  bunt: { name: "Buntes", programs: ["Buntwäsche", "Mix", "Baumwolle"], temp: 40, spin: 1200, dur: 110,
    tip: ["Bedrucktes auf links drehen", "So bleiben Aufdrucke länger heil."] },
  dunkel: { name: "Dunkles & Jeans", programs: ["Dunkle Wäsche", "Jeans", "Buntwäsche", "Mix"], temp: 30, spin: 1000, dur: 90,
    tip: ["Jeans auf links drehen und zuknöpfen", "Dann bleibt die Farbe länger satt und der Reißverschluss zerkratzt nichts."] },
  sport: { name: "Sportsachen", programs: ["Sport", "Outdoor", "Synthetik", "Pflegeleicht"], temp: 30, spin: 800, dur: 70, nosoft: true,
    tip: ["Kein Weichspüler bei Sportsachen", "Der verklebt die Fasern, dann atmet das Shirt nicht mehr und riecht schneller."] },
  wolle: { name: "Wolle", programs: ["Wolle", "Handwäsche", "Feinwäsche"], temp: 30, spin: 600, dur: 40, wool: true,
    tip: ["Wolle nie heiß und nie in den Trockner", "Sonst passt der Pulli danach deinem Neffen."] },
};
(function renderPicker() {
  const p = $("picker");
  Object.entries(CATS).forEach(([k, c]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.k = k; b.textContent = c.label; b.setAttribute("aria-pressed", "false");
    b.onclick = () => { const on = !state.picked.has(k); on ? state.picked.add(k) : state.picked.delete(k); b.setAttribute("aria-pressed", String(on)); };
    p.append(b);
  });
})();
function chipGroup(id, cb) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    for (const c of $(id).querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(c === b));
    cb(b.dataset.v);
  });
}
chipGroup("amountChips", (v) => (state.amount = Number(v)));
chipGroup("dirtChips", (v) => (state.dirt = Number(v)));
chipGroup("detChips", (v) => (state.detergent = v));
$("softChip").onclick = () => { state.softener = !state.softener; $("softChip").setAttribute("aria-pressed", String(state.softener)); };

const PANIC_L = ["", "Profi", "Geht schon", "Unsicher", "Mama hat immer …", "Was ist eine Waschmaschine?"];
$("panic").oninput = () => { state.panic = Number($("panic").value); $("panicLabel").textContent = PANIC_L[state.panic]; };
$("panicLabel").textContent = PANIC_L[3];

/* ================= rule engine (offline) ================= */
function pickProgram(machine, candidates) {
  const progs = (machine?.programs || []).map(String);
  for (const c of candidates) {
    const hit = progs.find((p) => p.toLowerCase().includes(c.toLowerCase()));
    if (hit) return hit;
  }
  return candidates[0] + (progs.length ? " (oder ähnlich)" : "");
}
function round5(n) { return Math.max(20, Math.round(n / 5) * 5); }
function compartmentWhere(machine, symbol) {
  const c = (machine?.compartments || []).find((x) => x.symbol === symbol);
  const name = symbol === "II" ? "Hauptwäsche-Fach „II“" : symbol === "✿" ? "Weichspüler-Fach (Blume)" : "Fach „" + symbol + "“";
  return c ? `${name}, ${c.position}` : name;
}
function ruleEngine(machine) {
  const cats = [...state.picked];
  if (!cats.length) return null;
  const totalW = cats.reduce((s, k) => s + CATS[k].w, 0);
  const groups = {};
  cats.forEach((k) => {
    const g = CATS[k].group;
    (groups[g] ||= { keys: [], kg: 0 });
    groups[g].keys.push(k); groups[g].kg += (CATS[k].w / totalW) * state.amount;
  });
  // small sport loads ride along with dark or colored
  if (groups.sport && groups.sport.kg < 1.2 && (groups.dunkel || groups.bunt)) {
    const t = groups.dunkel || groups.bunt; t.keys.push(...groups.sport.keys); t.kg += groups.sport.kg; t.withSport = true; delete groups.sport;
  }
  // tiny colored + dark loads merge at 30 °C
  if (groups.bunt && groups.dunkel && groups.bunt.kg + groups.dunkel.kg < 2.5) {
    groups.dunkel.keys.push(...groups.bunt.keys); groups.dunkel.kg += groups.bunt.kg; groups.dunkel.merged = true; delete groups.bunt;
  }
  const cap = machine?.capacity_kg || 7;
  const warnings = [];
  const loads = Object.entries(groups).map(([gk, g]) => {
    const G = GROUPS[gk];
    let temp = G.temp, spin = G.spin;
    if (g.withSport) { temp = Math.min(temp, 30); spin = Math.min(spin, 800); }
    if (gk === "bunt" && g.keys.includes("hemden")) spin = 800;
    const nosoft = G.nosoft || g.withSport || gk === "hygiene" && !g.keys.every((k) => k === "bett");
    const kg = Math.round(g.kg * 10) / 10;
    const factor = Math.min(1.25, Math.max(0.6, kg / 4.5)) * state.dirt;
    const det = state.detergent;
    let amount, ml = null, where, symbol, note = "";
    if (det === "Caps") {
      const n = kg > 5 || state.dirt > 1.2 ? 2 : 1;
      amount = n + (n === 1 ? " Cap" : " Caps"); where = "direkt hinten in die leere Trommel, VOR der Wäsche"; symbol = "Trommel";
      note = "Caps nie ins Fach legen, dort lösen sie sich nicht auf.";
    } else {
      ml = round5(75 * factor * (G.wool ? 0.6 : 1));
      amount = ml + " ml"; symbol = "II"; where = compartmentWhere(machine, "II");
      note = det === "Pulver" ? `Pulver: ca. ${round5(ml * 0.9)} g, also gut ${Math.max(1, Math.round(ml / 75 * 10) / 10)} Messbecher-Kappen bis zur Markierung.` : "Mit der Kappe abmessen, die hat Striche. Nach Gefühl wird's Schaumparty.";
      if (G.wool) note = "Am besten Wollwaschmittel. Normales Vollwaschmittel kann Wolle verfilzen.";
      if (gk === "weiss" && det === "Colorwaschmittel") note = "Für Weißes ist Vollwaschmittel besser (strahlt mehr). Color geht zur Not auch.";
      if (["bunt", "dunkel"].includes(gk) && det === "Pulver") note += " Für Buntes ist Color- oder Flüssigwaschmittel schonender.";
    }
    const useSoft = state.softener && !nosoft;
    if (kg > cap) warnings.push(`„${G.name}“ hat ca. ${kg} kg, deine Maschine schafft ${cap} kg. Teil das auf zwei Runden auf.`);
    if (g.merged) warnings.push("Bunt und Dunkel laufen zusammen bei 30 °C. Ganz neue, knallfarbige Teile lieber separat waschen.");
    return {
      name: G.name, items: g.keys.map((k) => CATS[k].label),
      program: pickProgram(machine, g.withSport ? ["Mix", ...G.programs] : G.programs),
      temp_c: temp, spin_rpm: spin, duration_min: G.dur,
      extras: state.dirt > 1.2 ? ["Intensiv / Flecken"] : [],
      detergent: { amount, ml, where, symbol, note },
      softener: useSoft ? { use: true, amount: "25–30 ml", where: compartmentWhere(machine, "✿") } : { use: false },
      steps: buildSteps(machine, G, { kg, cap, temp, spin, caps: det === "Caps", useSoft, program: null }),
      tipGroup: G.tip,
    };
  });
  loads.forEach((l) => { l.steps = buildSteps(machine, GROUPS[Object.keys(GROUPS).find((k) => GROUPS[k].name === l.name)], { kg: 0, cap, temp: l.temp_c, spin: l.spin_rpm, caps: state.detergent === "Caps", useSoft: l.softener.use, program: l.program, where: l.detergent.where, amount: l.detergent.amount }); });
  const QUIPS = ["Mama nennt das „ein bisserl Wäsche“.", "Ein Haufen, ein Plan, null Panik.", "Heute wird nichts rosa. Versprochen.", "Socken zählen nicht als Ausrede."];
  return {
    quip: QUIPS[Math.floor(Math.random() * QUIPS.length)],
    laundry: { summary: cats.map((k) => CATS[k].label).join(", "), weight_kg: state.amount },
    loads, warnings, assumptions: ["Mittlere Wasserhärte angenommen. Die Waschmittelpackung hat eine genauere Tabelle."], offline: true,
  };
}
function buildSteps(m, G, o) {
  const p = state.panic, top = m?.kind === "Toplader";
  const s = [];
  if (p >= 5) s.push({ title: "Kurzer Gesundheitscheck", detail: "Stecker in der Steckdose? Wasserhahn hinter oder neben der Maschine aufgedreht (Hebel zeigt in Rohrrichtung)? Gut. Die Maschine beißt nicht." });
  s.push({ title: "Taschen leeren", detail: "Alle Hosentaschen ausräumen." + (p >= 3 ? " Ein vergessenes Taschentuch verwandelt die ganze Ladung in einen Schneesturm." : "") });
  if (G?.tip) s.push({ title: G.tip[0], detail: G.tip[1] });
  if (o.caps) s.push({ title: "Cap in die leere Trommel", detail: `${o.amount || "1 Cap"} hinten in die Trommel legen, bevor die Wäsche reinkommt.` + (p >= 4 ? " Nicht aufdrücken, nicht kosten. Ehrlich." : "") });
  s.push(top
    ? { title: "Deckel auf, Wäsche rein", detail: "Deckel oben öffnen, dann die Trommelklappen öffnen (meist ein Knopf zum Drücken). Wäsche locker rein, Klappen hörbar einrasten lassen." }
    : { title: "Tür auf, Wäsche rein", detail: "Am Griff ziehen. Wäsche locker reinlegen, oben eine Handbreit Luft lassen." + (p >= 4 ? " Nicht stopfen wie einen Reisekoffer." : "") });
  if (!o.caps) s.push({ title: "Waschmittel einfüllen", detail: `Waschmittelschublade ${top ? "(beim Toplader oft im Deckel oder an der Klappe)" : "oben links"} rausziehen. ${o.amount || "Die Menge"} ins ${o.where || "Fach „II“ (Hauptwäsche)"}. Das Fach „I“ ist für Vorwäsche, das brauchst du nicht.` });
  if (o.useSoft) s.push({ title: "Weichspüler in die Blume", detail: "25–30 ml ins Fach mit der Blume. Nicht über die MAX-Linie, sonst läuft es zu früh durch." });
  s.push({ title: `Programm „${o.program || G?.programs?.[0] || "Baumwolle"}“`, detail: "Den großen Drehknopf darauf drehen, bis es einrastet oder das Display es anzeigt." });
  s.push({ title: `${o.temp} °C und ${o.spin} Umdrehungen`, detail: "Meist stellt das Programm schon was vor. Mit den Tasten „Temp.“ und „Schleudern“ bzw. „U/min“ nachjustieren." });
  s.push({ title: "Zumachen und Start", detail: (top ? "Deckel zu." : "Tür zudrücken, bis es klickt.") + " Dann Start/Pause drücken." + (p >= 3 ? " Wenn es brummt und Wasser rauscht: gratuliere." : "") });
  s.push({ title: "Rechtzeitig wieder raus", detail: "Nach dem Ende sofort aufhängen. Nasse Wäsche in der Trommel fängt nach ein paar Stunden an zu müffeln." });
  return s;
}

/* ================= spin ================= */
const SPIN_LINES = ["Wäsche fliegt rein …", "Trommel dreht …", "Socken werden gezählt … eine fehlt", "Etiketten werden entziffert …", "Waschmittel wird abgemessen …", "Mama wird nicht angerufen …", "Gleich fertig …"];
let spinT;
function startSpin(pics) {
  show("spin");
  const drum = $("drum"); drum.innerHTML = "";
  const fl = $("flyers"); fl.innerHTML = "";
  pics.slice(0, 3).forEach((url, i) => {
    const f = new Image(); f.src = url; f.className = "flyer"; f.style.animationDelay = i * 0.25 + "s"; f.alt = ""; fl.append(f);
    const c = new Image(); c.src = url; c.className = "c" + i; c.alt = ""; drum.append(c);
  });
  if (!pics.length) {
    ["Socke", "Shirt", "Jeans"].forEach((t, i) => { const s = document.createElement("span"); s.className = "sock"; s.textContent = t; s.style.cssText = ["left:12%;top:30%", "right:12%;top:28%", "left:38%;bottom:16%"][i]; drum.append(s); });
  }
  let i = 0; $("spinStatus").textContent = SPIN_LINES[0];
  clearInterval(spinT); spinT = setInterval(() => { i = Math.min(i + 1, SPIN_LINES.length - 1); $("spinStatus").textContent = SPIN_LINES[i]; }, 2400);
}
function stopSpin() { clearInterval(spinT); }
function show(which) {
  $("app").hidden = which !== "app"; $("spin").hidden = which !== "spin"; $("result").hidden = which !== "result";
  const target = which === "app" ? $("app") : $(which);
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
$("stopBtn").onclick = () => { state.ctl?.abort(); stopSpin(); show("app"); };

function showErr(msg) { $("errBox").textContent = msg || ""; $("errBox").hidden = !msg; }

/* ================= GO ================= */
$("goBtn").onclick = async () => {
  showErr("");
  const machine = activeMachine();
  const pendingPhoto = !machine && state.machinePhoto;
  if (!machine && !pendingPhoto) { showErr("Erst die Waschmaschine: fotografieren oder kurz eintippen. Dauert 20 Sekunden, einmalig."); $("stepMachine").scrollIntoView({ behavior: "smooth" }); return; }

  if (state.lTab === "picker") {
    if (!state.picked.size) { showErr("Tipp an, was im Haufen liegt. Mindestens ein Teil."); return; }
    if (pendingPhoto && !state.ai) { showErr("Die Foto-KI macht gerade Pause. Tipp deine Maschine bitte kurz ein."); return; }
    if (pendingPhoto) { showErr("Für eine Maschine per Foto brauche ich auch ein Wäschefoto. Oder tipp die Maschine kurz ein."); return; }
    startSpin([]);
    await wait(2600);
    stopSpin(); renderResult(ruleEngine(machine), { machine });
    return;
  }

  if (!state.laundry.length) { showErr("Da fehlt noch das Foto vom Wäschehaufen. Oder nimm „Ohne Foto“."); return; }
  if (state.ai === false) { showErr("Die Foto-KI macht gerade Pause. Nimm „Ohne Foto“, das geht immer."); return; }

  const images = (pendingPhoto ? [state.machinePhoto] : []).concat(state.laundry);
  state.ctl = new AbortController();
  startSpin(images.map((i) => i.url));
  const minSpin = wait(3000);
  try {
    const r = await fetch("/api/analyze", {
      method: "POST", signal: state.ctl.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        images: images.map(({ media_type, data }) => ({ media_type, data })),
        machinePhoto: !!pendingPhoto,
        machine: machine ? { brand: machine.brand, model: machine.model, kind: machine.kind, capacity_kg: machine.capacity_kg, compartments: machine.compartments, programs: machine.programs, controls: machine.controls } : null,
        detergent: state.detergent, softener: state.softener, panic: state.panic, note: $("note").value,
      }),
    });
    const data = await r.json().catch(() => ({}));
    await minSpin;
    if (r.status === 429) throw new Error("Zu viele Waschgänge auf einmal. Gönn der Trommel eine Minute Pause.");
    if (!r.ok || !data.loads) throw new Error(data.message || "Die Trommel hat sich verschluckt. Probier's nochmal.");
    let useMachine = machine;
    if (pendingPhoto && data.machine) {
      const thumb = await thumbOf(state.machinePhoto.url);
      addMachine({ ...data.machine, source: "foto", thumb });
      state.machinePhoto = null; resetMachineShot();
      useMachine = activeMachine();
      toast(`${[data.machine.brand, data.machine.model].filter(Boolean).join(" ") || "Maschine"} gespeichert.`);
    }
    stopSpin(); renderResult(data, { machine: useMachine });
  } catch (e) {
    stopSpin(); show("app");
    if (e.name === "AbortError") return;
    showErr(e.message || "Da ist was schiefgelaufen. Probier's nochmal.");
  }
};

/* ================= result ================= */
function cupSvg(ml) {
  const lvl = ml ? Math.min(1, ml / 150) : 0.5;
  const top = 84 - 66 * lvl;
  return `<svg class="cup" viewBox="0 0 76 96" aria-hidden="true">
    <clipPath id="cupc"><path d="M8 8h60l-7 78a6 6 0 0 1-6 6H21a6 6 0 0 1-6-6z"/></clipPath>
    <rect x="0" y="${top}" width="76" height="96" fill="var(--yellow)" clip-path="url(#cupc)"/>
    <path d="M8 8h60l-7 78a6 6 0 0 1-6 6H21a6 6 0 0 1-6-6z" fill="none" stroke="var(--ink)" stroke-width="4"/>
    <g stroke="var(--ink)" stroke-width="2"><path d="M54 30h10"/><path d="M55 50h9"/><path d="M57 70h7"/></g>
    <g font-family="JetBrains Mono,monospace" font-size="8" fill="var(--ink)"><text x="40" y="33">100</text><text x="42" y="53">60</text><text x="44" y="73">30</text></g>
  </svg>`;
}
function drawerHtml(machine, load, data) {
  const comps = (data.machine?.compartments || machine?.compartments || []).slice(0, 3);
  const order = { links: 0, vorne: 0, mitte: 1, rechts: 2, hinten: 2 };
  const slots = comps.length ? [...comps].sort((a, b) => (order[a.position] ?? 1) - (order[b.position] ?? 1)) : [{ symbol: "I", purpose: "Vorwäsche" }, { symbol: "✿", purpose: "Weichspüler" }, { symbol: "II", purpose: "Hauptwäsche" }];
  const target = String(load.detergent?.symbol || "");
  if (/trommel/i.test(target) || /trommel/i.test(load.detergent?.where || "")) return "";
  return `<div class="drawer" aria-label="Waschmittelfach">${slots.map((s) => {
    const hit = target && (s.symbol === target || (target.includes("II") && s.symbol === "II"));
    const soft = load.softener?.use && s.symbol === "✿";
    return `<div class="slot ${hit ? "hit" : soft ? "soft" : ""}"><b>${esc(s.symbol)}</b>${esc(s.purpose || "")}</div>`;
  }).join("")}</div>${comps.length ? "" : `<p class="dose-note">Typische Aufteilung. Such bei dir das Fach mit „II“ oder dem großen Strich.</p>`}`;
}
let lastResult = null;
function renderResult(data, { machine, demo = false }) {
  lastResult = { data, machine };
  const sec = $("result"); let cur = 0;
  const mName = demo ? "Beispielmaschine" : [machine?.brand, machine?.model].filter(Boolean).join(" ") || "deine Maschine";
  const draw = () => {
    const L = data.loads[cur];
    sec.innerHTML = `
      <div class="res-top">
        ${demo ? `<span class="badge-ex">Beispiel</span>` : ""}
        <p class="kicker">Anleitung für ${esc(mName)}${data.offline ? " · ohne Foto" : ""}</p>
        <h2>${data.loads.length > 1 ? data.loads.length + " Ladungen. Du schaffst das." : "So geht das."}</h2>
        ${data.quip ? `<p class="quip">${esc(data.quip)}</p>` : ""}
        <p class="fine">${esc(data.laundry?.summary)}${data.laundry?.weight_kg ? " · ca. " + esc(data.laundry.weight_kg) + " kg" : ""}</p>
      </div>
      ${data.loads.length > 1 ? `<div class="tabs" role="tablist">${data.loads.map((l, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${i === cur}">${i + 1}. ${esc(l.name)}</button>`).join("")}</div>` : ""}
      ${(data.warnings || []).map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
      <div class="plate">
        <span class="kicker">Programm${data.loads.length > 1 ? " · Ladung " + (cur + 1) : ""}</span>
        <div class="prog">${esc(L.program)}</div>
        <div class="specs">
          <div class="spec"><small>Temperatur</small><b>${esc(L.temp_c)}°</b></div>
          <div class="spec"><small>Schleudern</small><b>${esc(L.spin_rpm)}</b></div>
          <div class="spec"><small>Dauer ca.</small><b>${L.duration_min ? esc(L.duration_min) + "′" : "–"}</b></div>
        </div>
        ${L.extras?.length ? `<p class="extras">Extras: ${L.extras.map(esc).join(", ")}</p>` : ""}
        ${data.loads.length > 1 && L.items?.length ? `<p class="extras">Rein kommt: ${L.items.map(esc).join(", ")}</p>` : ""}
      </div>
      <div class="dose">
        ${cupSvg(L.detergent?.ml)}
        <div style="min-width:0">
          <div class="dose-amt">${esc(L.detergent?.amount)}</div>
          <div class="dose-where">${esc(L.detergent?.where)}</div>
          ${L.detergent?.note ? `<p class="dose-note">${esc(L.detergent.note)}</p>` : ""}
          ${L.softener?.use ? `<p class="dose-note"><b>Weichspüler:</b> ${esc(L.softener.amount)} → ${esc(L.softener.where)}</p>` : ""}
          ${drawerHtml(machine, L, data)}
        </div>
      </div>
      <div>
        <p class="kicker" style="margin-bottom:8px">Schritt für Schritt · antippen zum Abhaken</p>
        <ol class="steps">${(L.steps || []).map((s, i) => `<li class="step" tabindex="0"><span class="n">${i + 1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div></li>`).join("")}</ol>
      </div>
      ${data.assumptions?.length ? `<div class="box"><p class="kicker">Angenommen</p><ul>${data.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
      <div class="res-actions">
        <button type="button" class="btn btn-yellow btn-big" id="startedBtn">Läuft! Maschine gestartet</button>
        <div class="row">
          <button type="button" class="btn btn-ink" id="copyBtn">Anleitung kopieren</button>
          <button type="button" class="btn" id="againBtn" style="background:var(--card)">Neue Wäsche</button>
        </div>
      </div>`;
    sec.querySelectorAll(".step").forEach((li) => {
      const t = () => li.classList.toggle("done");
      li.onclick = t; li.onkeydown = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); t(); } };
    });
    sec.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { cur = +b.dataset.i; draw(); }));
    $("startedBtn").onclick = () => started(L, demo);
    $("copyBtn").onclick = () => copyText(L, mName);
    $("againBtn").onclick = newWash;
  };
  draw(); show("result");
}
function started(L, demo) {
  if (!demo) {
    const n = store.get("count", 0) + 1; store.set("count", n); renderCounter();
    const badge = BADGES.find(([k]) => k === n);
    toast(badge ? badge[1] : `Waschgang Nr. ${n} ohne Mama. Respekt.`);
  } else toast("Im echten Leben würde das jetzt zählen.");
  const mins = Number(L.duration_min) || 120;
  const end = Date.now() + mins * 60000;
  store.set("timer", end); runTimer();
  try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {}
}
let timerI;
function runTimer() {
  const end = store.get("timer", 0);
  clearInterval(timerI);
  if (!end || end < Date.now() - 3600000) { $("timerbar").hidden = true; return; }
  const tick = () => {
    const left = end - Date.now();
    const at = new Date(end).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    if (left <= 0) {
      $("timerText").textContent = "Fertig! Raus damit und aufhängen.";
      clearInterval(timerI);
      if (!store.get("notified", false)) {
        store.set("notified", true);
        try { if (Notification.permission === "granted") new Notification("Mamaschine", { body: "Deine Wäsche ist fertig. Raus damit, bevor sie müffelt." }); } catch {}
      }
      return;
    }
    const h = Math.floor(left / 3600000), m = Math.ceil((left % 3600000) / 60000);
    $("timerText").textContent = `Wäsche fertig ca. ${at} · noch ${h ? h + " h " : ""}${m} min`;
  };
  store.set("notified", false);
  $("timerbar").hidden = false; tick(); timerI = setInterval(tick, 20000);
}
$("timerStop").onclick = () => { store.set("timer", 0); clearInterval(timerI); $("timerbar").hidden = true; };

async function copyText(L, mName) {
  const txt = [`Mamaschine-Anleitung (${mName})`, `Programm: ${L.program} · ${L.temp_c} °C · ${L.spin_rpm} U/min`, `Waschmittel: ${L.detergent?.amount} → ${L.detergent?.where}`, ...(L.steps || []).map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`), "", "mamaschine.netlify.app"].join("\n");
  try { await navigator.clipboard.writeText(txt); toast("Kopiert. Schick's an jemanden, der's braucht."); }
  catch { toast("Kopieren ging nicht. Mach einen Screenshot."); }
}
function newWash() {
  state.laundry = []; $("lThumbs").innerHTML = ""; $("note").value = "";
  $("lShot").classList.remove("has");
  $("lShotLabel").innerHTML = "<b>Haufen fotografieren</b><small>Ruhig ausgebreitet, damit man was erkennt. Peinliches darf drin bleiben.</small>";
  show("app");
}

/* ================= demo ================= */
$("demoBtn").onclick = () => renderResult({
  quip: "Zwei Ladungen, null Drama. Die Jeans danken es dir.",
  laundry: { summary: "Jeans, bunte T-Shirts, Socken und ein weißes Hemd", weight_kg: 5 },
  machine: { compartments: [{ symbol: "I", position: "links", purpose: "Vorwäsche" }, { symbol: "✿", position: "mitte", purpose: "Weichspüler" }, { symbol: "II", position: "rechts", purpose: "Hauptwäsche" }] },
  loads: [
    { name: "Bunt & Jeans", items: ["2 Jeans", "4 T-Shirts", "Socken"], program: "Buntwäsche", temp_c: 40, spin_rpm: 1200, duration_min: 110, extras: [],
      detergent: { amount: "75 ml", ml: 75, symbol: "II", where: "Hauptwäsche-Fach „II“, rechts", note: "Eine Kappe bis zum mittleren Strich." }, softener: { use: false },
      steps: buildSteps({ kind: "Frontlader" }, GROUPS.dunkel, { temp: 40, spin: 1200, program: "Buntwäsche", amount: "75 ml", where: "Fach „II“ rechts" }) },
    { name: "Weißes Hemd", items: ["Weißes Hemd"], program: "Pflegeleicht", temp_c: 40, spin_rpm: 800, duration_min: 75, extras: [],
      detergent: { amount: "40 ml", ml: 40, symbol: "II", where: "Hauptwäsche-Fach „II“, rechts", note: "Kragen vorher mit etwas Waschmittel einreiben." }, softener: { use: false },
      steps: buildSteps({ kind: "Frontlader" }, GROUPS.weiss, { temp: 40, spin: 800, program: "Pflegeleicht", amount: "40 ml", where: "Fach „II“ rechts" }) },
  ],
  warnings: ["Neue dunkle Jeans färben gern ab. Nie mit Weißem waschen."],
  assumptions: ["Das ist ein Beispiel, nicht deine Maschine."],
}, { machine: null, demo: true });

/* ================= care symbols ================= */
const tub = (inner, cross) => `<svg viewBox="0 0 64 56" aria-hidden="true"><path d="M6 14l6 32h40l6-32" fill="none" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round"/><path d="M6 14q6.5 6 13 0t13 0 13 0 13 0" fill="none" stroke="var(--ink)" stroke-width="3.5"/>${inner}${cross ? '<path d="M8 6l48 46M56 6L8 52" stroke="var(--red)" stroke-width="4"/>' : ""}</svg>`;
const txt = (t) => `<text x="32" y="40" text-anchor="middle" font-family="JetBrains Mono,monospace" font-weight="700" font-size="15" fill="var(--ink)">${t}</text>`;
const sq = (inner, cross) => `<svg viewBox="0 0 64 56" aria-hidden="true"><rect x="10" y="4" width="44" height="44" fill="none" stroke="var(--ink)" stroke-width="3.5"/>${inner}${cross ? '<path d="M6 2l52 50M58 2L6 52" stroke="var(--red)" stroke-width="4"/>' : ""}</svg>`;
const iron = (dots) => `<svg viewBox="0 0 64 56" aria-hidden="true"><path d="M8 44h48l-4-18q-2-10-14-10H24l-4 6h16" fill="none" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round"/>${dots.map((x) => `<circle cx="${x}" cy="35" r="3" fill="var(--ink)"/>`).join("")}</svg>`;
const SYMBOLS = [
  [tub(txt("30")), "Max. 30 °C", "Normal waschen, aber kühl. Für Buntes und Dunkles."],
  [tub(txt("40") + '<path d="M14 52h36" stroke="var(--ink)" stroke-width="3"/>'), "40 °C, Strich drunter", "Strich = schonend. Pflegeleicht-Programm, weniger schleudern."],
  [tub(txt("60")), "Max. 60 °C", "Handtücher, Bettwäsche, Unterwäsche. Hygienisch sauber."],
  [tub('<path d="M24 38q4-12 10-6l4-8q4 2 2 8l4 4" fill="none" stroke="var(--ink)" stroke-width="3"/>'), "Handwäsche", "Programm „Handwäsche“ oder „Wolle“. Nicht über 30 °C."],
  [tub("", true), "Nicht waschen", "Ab in die Reinigung. Ernsthaft."],
  [`<svg viewBox="0 0 64 56" aria-hidden="true"><path d="M32 6l26 44H6z" fill="none" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round"/><path d="M10 4l44 48M54 4L10 52" stroke="var(--red)" stroke-width="4"/></svg>`, "Nicht bleichen", "Kein Bleichmittel, kein Fleckensalz mit Chlor."],
  [sq('<circle cx="32" cy="26" r="16" fill="none" stroke="var(--ink)" stroke-width="3.5"/><circle cx="32" cy="26" r="3" fill="var(--ink)"/>'), "Trockner, niedrig", "Ein Punkt = Schontrocknen."],
  [sq('<circle cx="32" cy="26" r="16" fill="none" stroke="var(--ink)" stroke-width="3.5"/>', true), "Kein Trockner", "Aufhängen. Sonst schrumpft's."],
  [iron([32]), "Bügeln, wenig Hitze", "Ein Punkt = niedrigste Stufe."],
  [iron([24, 32, 40]), "Bügeln, heiß", "Drei Punkte = volle Hitze, z. B. Leinen."],
  [`<svg viewBox="0 0 64 56" aria-hidden="true"><circle cx="32" cy="28" r="20" fill="none" stroke="var(--ink)" stroke-width="3.5"/>${txt("P").replace('y="40"', 'y="34"')}</svg>`, "Kreis mit Buchstabe", "Nur für die chemische Reinigung. Dich betrifft das nicht."],
];
$("symbols").innerHTML = SYMBOLS.map(([svg, t, d]) => `<div class="sym">${svg}<b>${t}</b><small>${d}</small></div>`).join("");

/* ================= init ================= */
if (!activeMachine() && state.machines[0]) state.activeId = state.machines[0].id;
renderMachines(); renderCounter(); runTimer(); checkAI();
})();
