"use strict";
/* Unser Kühlschrank – Version 0.1
   Bestand, Ablauf-Ampel, Live-Barcode-Scanner mit Open Food Facts.
   Daten liegen vorerst im Browser (localStorage); die gemeinsame Datenbank kommt im nächsten Schritt. */

const PLACES = ["Kühlschrank", "Tiefkühler", "Vorrat"];
const CATS = {
  "Gemüse": { d: 7, c: "#3f9a4a" }, "Obst": { d: 10, c: "#e0862b" }, "Milchprodukte": { d: 7, c: "#4d8fd6" },
  "Fleisch & Fisch": { d: 3, c: "#c9473d" }, "Eier": { d: 21, c: "#d9b13b" }, "Brot & Backwaren": { d: 4, c: "#a5774a" },
  "Tiefkühl": { d: 90, c: "#5bb7c9" }, "Trockenware": { d: 180, c: "#8a7f6e" }, "Getränke": { d: 30, c: "#7a6bd1" },
  "Sonstiges": { d: 14, c: "#8a979c" },
};
const QUICK = [["Äpfel","Obst","Vorrat",14],["Bananen","Obst","Vorrat",6],["Tomaten","Gemüse","Kühlschrank",7],["Gurke","Gemüse","Kühlschrank",7],["Paprika","Gemüse","Kühlschrank",8],["Zwiebeln","Gemüse","Vorrat",30],["Kartoffeln","Gemüse","Vorrat",21],["Möhren","Gemüse","Kühlschrank",14],["Salat","Gemüse","Kühlschrank",4],["Zitrone","Obst","Kühlschrank",21],["Brot","Brot & Backwaren","Vorrat",4],["Eier","Eier","Kühlschrank",21]];
const OPEN_DAYS = { "Milchprodukte": 4, "Fleisch & Fisch": 1, "Sonstiges": 5, "Getränke": 4 };

const $ = (s) => document.querySelector(s);
const iso = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const plus = (n, from) => { const d = from ? new Date(from + "T12:00") : new Date(); d.setDate(d.getDate() + n); return iso(d); };
const today = () => iso(new Date());
const daysLeft = (e) => e ? Math.round((new Date(e + "T12:00") - new Date(today() + "T12:00")) / 864e5) : null;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/* ---------- Speicher ---------- */
const KEY = "kuehlschrank-items-v1", PKEY = "kuehlschrank-products-v1";
function load(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? fallback; } catch (e) { return fallback; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast("Speichern nicht möglich (privater Modus?)"); } }
let items = load(KEY, []);
let products = load(PKEY, {});   // gelernte Produkte: EAN -> {name, cat, qty, unit, place, days}
let place = "Alle", takeId = null, moveId = null;
const store = {
  add(r) { r.id = uid(); r.qty0 = r.qty0 ?? r.qty; items.push(r); save(KEY, items); render(); return r; },
  update(id, patch) { const r = items.find((x) => x.id === id); if (r) Object.assign(r, patch); save(KEY, items); render(); },
  remove(id) { items = items.filter((x) => x.id !== id); save(KEY, items); render(); },
};

/* ---------- Anzeige ---------- */
function urgency(d) {
  if (d === null) return ["p-muted", "ohne Datum"];
  if (d < 0) return ["p-red", `seit ${-d} T abgelaufen`];
  if (d === 0) return ["p-red", "heute"];
  if (d === 1) return ["p-red", "morgen"];
  if (d <= 3) return ["p-amber", `in ${d} Tagen`];
  return ["p-green", d > 60 ? "lange haltbar" : `${d} Tage`];
}
function effExp(r) {
  if (!r.opened) return r.exp;
  const od = OPEN_DAYS[r.cat]; if (!od) return r.exp;
  const o = plus(od, r.opened);
  return (!r.exp || o < r.exp) ? o : r.exp;
}
const active = () => items.filter((r) => r.status === "aktiv");
function fmtQty(r) { const q = Number(r.qty); return `${Number.isInteger(q) ? q : q.toFixed(1).replace(".", ",")} ${r.unit}`; }

function render() {
  const act = active();
  const soon = act.filter((r) => { const d = daysLeft(effExp(r)); return d !== null && d <= 1; }).length;
  const mid = act.filter((r) => { const d = daysLeft(effExp(r)); return d !== null && d > 1 && d <= 3; }).length;
  $("#alerts").innerHTML = `<span class="pill ${soon ? "p-red" : "p-muted"}">${soon} bis morgen</span><span class="pill ${mid ? "p-amber" : "p-muted"}">${mid} in 2–3 Tagen</span><span class="pill p-muted">${act.length} Artikel</span>`;
  $("#placeChips").innerHTML = ["Alle", ...PLACES].map((p) => { const n = p === "Alle" ? act.length : act.filter((r) => r.place === p).length; return `<button class="chip" aria-pressed="${p === place}" data-place="${p}">${p} ${n}</button>`; }).join("");
  const rows = act.filter((r) => place === "Alle" || r.place === place).sort((a, b) => (effExp(a) || "9999").localeCompare(effExp(b) || "9999"));
  if (!act.length) $("#list").innerHTML = `<div class="empty"><p><b>Noch nichts eingetragen.</b><br>Unter „Scannen“ Barcodes einlesen oder unter „Hinzufügen“ lose Ware antippen.</p></div>`;
  else if (!rows.length) $("#list").innerHTML = `<div class="empty"><p>Hier ist gerade nichts.</p></div>`;
  else $("#list").innerHTML = '<div class="list">' + rows.map((r) => {
    const [cls, txt] = urgency(daysLeft(effExp(r))); const col = (CATS[r.cat] || CATS.Sonstiges).c;
    return `<div class="item"><span class="dot" style="background:${col}"></span><span class="name">${esc(r.name)}</span><span class="pill ${cls}">${txt}</span>
    <span class="meta">${fmtQty(r)} · ${esc(r.cat)} · ${esc(r.place)}${r.opened ? " · angebrochen" : ""}</span>
    <div class="acts"><button class="act" data-a="used" data-id="${r.id}">Aufgebraucht</button>${r.unit === "Stk" ? `<button class="act" data-a="one" data-id="${r.id}">1 weniger</button>` : ""}<button class="act" data-a="take" data-id="${r.id}">Menge entnehmen</button>${r.opened ? "" : `<button class="act" data-a="open" data-id="${r.id}">Angebrochen</button>`}<button class="act" data-a="move" data-id="${r.id}">Ort ändern</button><button class="act warn" data-a="waste" data-id="${r.id}">Weggeworfen</button></div>${takeId === r.id ? takePanel(r) : ""}${moveId === r.id ? `<div class="take"><span class="note">Wohin kommt ${esc(r.name)}?</span><div class="tags">${PLACES.filter((p) => p !== r.place).map((p) => `<button class="act" data-a="moveTo" data-v="${p}" data-id="${r.id}">${p}</button>`).join("")}</div></div>` : ""}</div>`;
  }).join("") + "</div>";
  const m = today().slice(0, 7);
  const wasted = items.filter((r) => r.status === "weggeworfen" && (r.done || "").startsWith(m)).length;
  const used = items.filter((r) => r.status === "aufgebraucht" && (r.done || "").startsWith(m)).length;
  $("#stats").textContent = `Diesen Monat: ${used} aufgebraucht, ${wasted} weggeworfen.`;
  renderShop();
}
function takePanel(r) {
  const u = r.unit; const pre = (u === "Stk" ? [1, 2, 3] : u === "Pck" ? [0.25, 0.5] : [25, 50, 100]).filter((v) => v < Number(r.qty));
  return `<div class="take"><label for="take-amt">Wie viel nehmt ihr? In ${u}, noch da: ${fmtQty(r)}<input id="take-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="z. B. ${pre[0] ?? 1}"></label><div class="tags">${pre.map((v) => `<button class="act" data-a="pre" data-v="${v}" data-id="${r.id}">${String(v).replace(".", ",")} ${u}</button>`).join("")}<button class="act" data-a="pre" data-v="${Number(r.qty) / 2}" data-id="${r.id}">Hälfte</button><button class="act" data-a="pre" data-v="${r.qty}" data-id="${r.id}">Alles</button></div><button class="btn" data-a="takeGo" data-id="${r.id}">Abziehen</button></div>`;
}
function takeAmount(r, v) {
  const rest = Math.round((Number(r.qty) - v) * 100) / 100;
  if (rest <= 0) { store.update(r.id, { qty: 0, status: "aufgebraucht", done: today() }); toast(`${r.name}: aufgebraucht`); return; }
  const patch = { qty: rest }; if (r.unit !== "Stk" && !r.opened) patch.opened = today();
  store.update(r.id, patch); toast(`${r.name}: noch ${fmtQty({ qty: rest, unit: r.unit })}`);
}

/* ---------- Bedienung ---------- */
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-place]"); if (c) { place = c.dataset.place; render(); return; }
  const b = e.target.closest("[data-a]"); if (!b) return;
  const r = items.find((x) => x.id === b.dataset.id); if (!r) return;
  const a = b.dataset.a;
  if (a === "used") { store.update(r.id, { status: "aufgebraucht", done: today() }); toast(`${r.name}: aufgebraucht`); }
  if (a === "waste") { store.update(r.id, { status: "weggeworfen", done: today() }); toast(`${r.name}: weggeworfen, zählt in die Statistik`); }
  if (a === "open") { store.update(r.id, { opened: today() }); toast(`${r.name}: angebrochen, Haltbarkeit angepasst`); }
  if (a === "one") takeAmount(r, 1);
  if (a === "move") { moveId = moveId === r.id ? null : r.id; render(); return; }
  if (a === "moveTo") { moveId = null; moveItem(r, b.dataset.v); return; }
  if (a === "take") { takeId = takeId === r.id ? null : r.id; render(); const el = $("#take-amt"); if (el) el.focus(); return; }
  if (a === "pre") { $("#take-amt").value = b.dataset.v; return; }
  if (a === "takeGo") { const v = parseFloat(String($("#take-amt").value).replace(",", ".")); if (!(v > 0)) { toast("Bitte eine Menge eingeben."); return; } takeId = null; takeAmount(r, v); }
  // Scan-Karten
  if (a === "exp") { store.update(r.id, { exp: plus(Number(b.dataset.v)), expSource: "eingetragen" }); learn(r, { days: Number(b.dataset.v), learned: true }); renderRecent(); }
  if (a === "undo") { store.remove(r.id); recent = recent.filter((x) => x !== r.id); renderRecent(); toast(`${r.name} entfernt`); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("[data-expdate]")) { const r = items.find((x) => x.id === t.dataset.expdate); if (r && t.value) { store.update(r.id, { exp: t.value, expSource: "eingetragen" }); learnExp(r, t.value); renderRecent(); } }
  if (t.matches("[data-qty]")) { const r = items.find((x) => x.id === t.dataset.qty); const v = parseFloat(String(t.value).replace(",", ".")); if (r && v > 0) { store.update(r.id, { qty: v, qty0: v }); learn(r, { qty: v }); } }
  if (t.matches("[data-mhd]")) {
    const r = items.find((x) => x.id === t.dataset.mhd); if (!r || !t.value.trim()) return;
    const d = parseMhd(t.value);
    if (!d) { toast("Datum nicht erkannt. Beispiele: 1203, 12.03.27 oder 03.2027"); return; }
    store.update(r.id, { exp: d, expSource: "eingetragen" }); learnExp(r, d); renderRecent(); toast(`${r.name}: haltbar bis ${d.split("-").reverse().join(".")}`);
  }
  if (t.matches("[data-placefor]")) { const r = items.find((x) => x.id === t.dataset.placefor); if (r) { moveItem(r, t.value); renderRecent(); } }
});
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.removeAttribute("aria-current")); b.setAttribute("aria-current", "page");
  ["bestand", "scan", "shop", "add"].forEach((v) => $("#v-" + v).hidden = v !== b.dataset.view);
  if (b.dataset.view !== "scan") stopScan();
  window.scrollTo(0, 0);
});
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }

/* ---------- Hinzufügen ---------- */
function defaultPlace(cat) { return cat === "Tiefkühl" ? "Tiefkühler" : ["Trockenware", "Getränke", "Brot & Backwaren"].includes(cat) ? "Vorrat" : "Kühlschrank"; }
$("#f-place").innerHTML = PLACES.map((p) => `<option>${p}</option>`).join("");
$("#f-cat").innerHTML = Object.keys(CATS).map((c) => `<option>${c}</option>`).join("");
$("#f-cat").onchange = () => { const c = $("#f-cat").value; $("#f-exp").value = plus(CATS[c].d); $("#f-place").value = defaultPlace(c); };
$("#f-exp").value = plus(7);
$("#form").addEventListener("submit", (e) => {
  e.preventDefault(); const n = $("#f-name").value.trim(); if (!n) return;
  const dn = dupNote(n);
  store.add({ name: n, qty: Number($("#f-qty").value) || 1, unit: $("#f-unit").value, cat: $("#f-cat").value, place: $("#f-place").value, exp: $("#f-exp").value || null, status: "aktiv", added: today() });
  toast(dn ? `${n} hinzugefügt. ${dn}` : `${n} hinzugefügt`); $("#form").reset(); $("#f-qty").value = 1; $("#f-exp").value = plus(7);
});
$("#quick").innerHTML = QUICK.map((q, i) => `<button data-q="${i}">${q[0]}</button>`).join("");
$("#quick").onclick = (e) => {
  const b = e.target.closest("[data-q]"); if (!b) return; const [n, cat, pl, d] = QUICK[b.dataset.q];
  const ex = active().find((r) => r.name === n && r.unit === "Stk");
  if (ex) { store.update(ex.id, { qty: Number(ex.qty) + 1 }); toast(`${n}: jetzt ${Number(ex.qty) + 1} Stk`); }
  else { store.add({ name: n, qty: 1, unit: "Stk", cat, place: pl, exp: plus(d), status: "aktiv", added: today() }); toast(`${n} hinzugefügt`); }
};
function parseFast(t) {
  return t.split(/,|\bund\b/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+[.,]?\d*)\s*(g|ml|kg|l|stk|pck)?\.?\s+(.+)$/i);
    let qty = 1, unit = "Stk", name = s;
    if (m) { qty = parseFloat(m[1].replace(",", ".")); unit = (m[2] || "Stk").toLowerCase(); name = m[3]; if (unit === "kg") { qty *= 1000; unit = "g"; } if (unit === "l") { qty *= 1000; unit = "ml"; } unit = { stk: "Stk", pck: "Pck" }[unit] || unit; }
    const q = QUICK.find((x) => name.toLowerCase().startsWith(x[0].toLowerCase().slice(0, 4)));
    const cat = q ? q[1] : "Sonstiges";
    return { name: q ? q[0] : name, qty, unit, cat, place: q ? q[2] : defaultPlace(cat), exp: plus(q ? q[3] : CATS[cat].d), status: "aktiv", added: today() };
  });
}
$("#fastBtn").onclick = () => {
  const t = $("#fast").value.trim(); if (!t) return; const rows = parseFast(t);
  rows.forEach((r) => store.add(r));
  $("#fastStatus").textContent = `Eingetragen: ${rows.map((r) => `${fmtQty(r)} ${r.name}`).join(", ")}`; $("#fast").value = "";
};

/* ---------- Barcode-Scanner ---------- */
let scanner = null, scanning = false, lastCode = "", lastAt = 0, recent = [];
function validEan(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number); const check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 1760 : 440; g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.09 : 0.25));
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [60, 60, 60]);
}
async function startScan() {
  if (scanning) return;
  if (!window.Html5Qrcode) { $("#scanStatus").textContent = "Der Scanner konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden."; return; }
  beep(true); // entsperrt den Ton auf dem Handy
  const F = window.Html5QrcodeSupportedFormats;
  scanner = scanner || new Html5Qrcode("reader", { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
  try {
    await scanner.start({ facingMode: "environment" },
      { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 360), height: Math.min(h * 0.45, 160) }), aspectRatio: 1.333 },
      onCode, () => {});
    scanning = true; $("#scanStart").disabled = true; $("#scanStop").disabled = false;
    $("#scanStatus").textContent = "Scanner läuft. Barcode in den Rahmen halten.";
  } catch (err) {
    $("#scanStatus").textContent = /Permission|NotAllowed/i.test(String(err))
      ? "Kein Kamerazugriff. Bitte in den Browser-Einstellungen die Kamera für diese Seite erlauben."
      : "Die Kamera ließ sich nicht starten. Bitte die Seite neu laden.";
  }
}
async function stopScan() {
  if (!scanning || !scanner) return;
  try { await scanner.stop(); } catch (e) {}
  scanning = false; $("#scanStart").disabled = false; $("#scanStop").disabled = true;
  $("#scanStatus").textContent = "Scanner gestoppt.";
}
$("#scanStart").onclick = startScan;
$("#scanStop").onclick = stopScan;
document.addEventListener("visibilitychange", () => { if (document.hidden) stopScan(); });
$("#manualEan").addEventListener("submit", (e) => { e.preventDefault(); const c = $("#eanInput").value.replace(/\D/g, ""); if (c) { handleCode(c, true); $("#eanInput").value = ""; } });

function onCode(code) {
  const now = Date.now();
  if (code === lastCode && now - lastAt < 3000) return; // gleicher Code direkt hintereinander
  if (!validEan(code)) return;
  lastCode = code; lastAt = now;
  handleCode(code, false);
}

// Erkennt Tiefkühlware auch ohne passende Kategorie in Open Food Facts: über Lagerhinweise (-18 °C) und typische Namen.
const FROZEN_RE = /tiefk[üu]hl|tiefgefroren|tiefgek[üu]hlt|gefroren|gefrier|frozen|surgel|congel|-\s?18\s?°|\bTK\b|fischst[äa]bchen|backfisch|schlemmerfilet|pommes|kroketten|r[öo]sti-?ecken|tk-|eiscreme|speiseeis|rahmspinat|kaisergem[üu]se|gem[üu]sepfanne|gyrospfanne|bami goreng|nasi goreng|steinofenpizza|pizza/i;
function isFrozen(tags, text) { return (tags || []).some((t) => t.includes("frozen")) || FROZEN_RE.test(text || ""); }
function mapCategory(tags, text = "") {
  if (isFrozen(tags, text)) return "Tiefkühl";
  const t = (tags || []).join(" ") + " " + String(text).toLowerCase();
  const has = (...k) => k.some((x) => t.includes(x));
  if (has("eggs", " eier")) return "Eier";
  if (has("meats", "poultry", "fishes", "seafood", "sausages", "hams", "hähnchen", "huhn", "pute", "rind", "schwein", "hack", "fisch", "lachs", "wurst", "schinken", "salami")) return "Fleisch & Fisch";
  if (has("dairies", "cheeses", "yogurts", "milks", "creams", "butters", "desserts", "milch", "käse", "joghurt", "sahne", "quark", "butter")) return "Milchprodukte";
  if (has("breads", "pastries", "viennoiseries", "rolls", "brot", "toast", "brötchen")) return "Brot & Backwaren";
  if (has("beverages", "drinks", "juices", "waters", "sodas", "saft", "wasser", "limo")) return "Getränke";
  if (has("fresh-vegetables", "en:vegetables", "gemüse")) return "Gemüse";
  if (has("fresh-fruits", "en:fruits", "obst")) return "Obst";
  if (has("pastas", "rices", "cereals", "canned", "sauces", "snacks", "sweets", "chocolates", "flours", "spreads", "condiments", "legumes", "coffees", "teas", "nudel", "reis", "mehl")) return "Trockenware";
  return "Sonstiges";
}
// Ort ändern: Tiefkühler verlängert die Haltbarkeit, Auftauen verkürzt sie. Die App merkt sich den Ort pro Barcode.
function moveItem(r, to) {
  if (!to || to === r.place) return;
  const patch = { place: to };
  if (to === "Tiefkühler") { patch.cat = "Tiefkühl"; const e = plus(180); if (!r.exp || r.exp < e) patch.exp = e; patch.expSource = "geschätzt"; }
  if (r.place === "Tiefkühler" && to !== "Tiefkühler") { patch.exp = plus(r.cat === "Fleisch & Fisch" || /h[äa]hnchen|fisch|fleisch|hack/i.test(r.name) ? 1 : 2); patch.opened = today(); }
  store.update(r.id, patch);
  learn(r, to === "Tiefkühler" ? { place: to, cat: "Tiefkühl", days: 180, learned: true } : { place: to, learned: true });
  toast(to === "Tiefkühler" ? `${r.name}: in den Tiefkühler, haltbar ca. 6 Monate` : r.place === "Tiefkühler" ? `${r.name}: aufgetaut, bald verbrauchen` : `${r.name}: jetzt im ${to === "Vorrat" ? "Vorrat" : to}`);
}
function parseQuantity(p) {
  const s = String(p.quantity || "").toLowerCase();
  const pcs = s.match(/(\d+)\s*(stück|stk|st\b|pcs|pieces|x\b)/);
  if (pcs) return { qty: Number(pcs[1]), unit: "Stk" };
  const pq = Number(p.product_quantity), pu = String(p.product_quantity_unit || "").toLowerCase();
  if (pq > 0 && (pu === "g" || pu === "ml")) return { qty: pq, unit: pu };
  const m = s.match(/(\d+[.,]?\d*)\s*(kg|g|ml|cl|l)\b/);
  if (m) { let q = parseFloat(m[1].replace(",", ".")); let u = m[2]; if (u === "kg") { q *= 1000; u = "g"; } if (u === "l") { q *= 1000; u = "ml"; } if (u === "cl") { q *= 10; u = "ml"; } return { qty: Math.round(q), unit: u }; }
  return { qty: 1, unit: "Pck" };
}
async function lookup(code) {
  // Gemerktes nur nehmen, wenn ihr es selbst korrigiert oder benannt habt; sonst frisch nachschlagen.
  if (products[code] && (products[code].learned || products[code].manual)) return { ...products[code], known: true };
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_de,generic_name_de,brands,quantity,product_quantity,product_quantity_unit,categories_tags,categories,conservation_conditions,conservation_conditions_de,labels_tags`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctl.signal }); const j = await res.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product; const name = (p.product_name_de || p.product_name || p.generic_name_de || "").trim();
    if (!name) return null;
    const brand = (p.brands || "").split(",")[0].trim();
    const cat = mapCategory(p.categories_tags, [name, p.categories, p.conservation_conditions, p.conservation_conditions_de, (p.labels_tags || []).join(" ")].join(" "));
    const { qty, unit } = parseQuantity(p);
    return { name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name, cat, qty, unit, place: defaultPlace(cat), days: estimateDays(name, p.categories_tags, cat) };
  } catch (e) { return { offline: true }; }
  finally { clearTimeout(t); }
}
function learnExp(r, exp) { const d = daysBetween(r.added || today(), exp); if (d > 0) learn(r, { days: d, learned: true }); }
function learn(r, patch) { if (!r.ean) return; products[r.ean] = { ...(products[r.ean] || { name: r.name, cat: r.cat, qty: r.qty, unit: r.unit, place: r.place, days: CATS[r.cat].d }), ...patch }; save(PKEY, products); }

async function handleCode(code, manual) {
  $("#scanStatus").textContent = `Barcode ${code} gelesen, suche Produkt …`;
  const info = await lookup(code);
  const chosen = $("#scanPlace").value;
  if (!info || info.offline) {
    beep(false);
    const r = store.add({ name: `Unbekannt (${code})`, ean: code, qty: 1, unit: "Stk", cat: "Sonstiges", place: chosen === "auto" ? "Kühlschrank" : chosen, exp: plus(14), status: "aktiv", added: today(), unknown: true });
    recent.unshift(r.id); renderRecent();
    $("#scanStatus").textContent = info && info.offline ? "Keine Verbindung zur Produktdatenbank. Bitte Namen unten eintragen." : "Produkt nicht in der Datenbank. Bitte Namen unten eintragen, die App merkt es sich.";
    return;
  }
  beep(true);
  const dup = dupNote(info.name, code);
  const r = store.add({ name: info.name, ean: code, qty: info.qty, unit: info.unit, cat: info.cat, place: chosen === "auto" ? info.place : chosen, exp: plus(info.days), expSource: info.known && info.learned ? "gelernt" : "geschätzt", status: "aktiv", added: today(), dupNote: dup || undefined });
  recent.unshift(r.id); renderRecent();
  $("#scanStatus").textContent = dup ? `Eingetragen: ${info.name}. ${dup}` : `Eingetragen: ${info.name}. Nächstes Produkt einfach scannen.`;
}

function renderRecent() {
  const list = recent.map((id) => items.find((x) => x.id === id)).filter(Boolean).slice(0, 15);
  $("#recent").innerHTML = list.map((r) => {
    const [cls, txt] = urgency(daysLeft(r.exp));
    const nameField = r.unknown
      ? `<form class="row" data-nameform="${r.id}"><input placeholder="Was ist das?" aria-label="Produktname" data-namefor="${r.id}"><button class="btn ghost" type="submit">Speichern</button></form>`
      : "";
    return `<div class="card scanned"><div class="top"><b>${esc(r.name)}</b><span class="pill ${cls}">${txt}</span></div>
      ${nameField}
      ${r.dupNote ? `<p class="note warnnote">${esc(r.dupNote)}</p>` : ""}
      <p class="note">Haltbar bis ca. <b>${r.exp ? r.exp.split("-").reverse().join(".") : "?"}</b> · ${r.expSource === "gelernt" ? "so lange wie beim letzten Mal" : r.expSource === "eingetragen" ? "von euch eingetragen" : "geschätzt, übliche Haltbarkeit"}</p>
      <details class="more"><summary>Datum, Menge oder Ort ändern</summary>
      <div class="tags">${[3, 7, 14, 30].map((d) => `<button class="act" data-a="exp" data-v="${d}" data-id="${r.id}">+${d} Tage</button>`).join("")}</div>
      <div class="row"><label>MHD eintippen<input type="text" inputmode="numeric" enterkeyhint="done" placeholder="z. B. 1203" data-mhd="${r.id}" autocomplete="off"></label>
      <label>oder auswählen<input type="date" value="${r.exp || ""}" data-expdate="${r.id}"></label></div>
      <div class="row"><label>Menge (${esc(r.unit)})<input type="number" min="0" step="any" value="${r.qty}" data-qty="${r.id}"></label>
      <label>Ort<select data-placefor="${r.id}">${PLACES.map((p) => `<option${p === r.place ? " selected" : ""}>${p}</option>`).join("")}</select></label></div>
      </details>
      <div class="tags"><button class="act warn" data-a="undo" data-id="${r.id}">Rückgängig</button></div></div>`;
  }).join("");
}
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-nameform]"); if (!f) return; e.preventDefault();
  const id = f.dataset.nameform; const v = f.querySelector("input").value.trim(); const r = items.find((x) => x.id === id);
  if (!r || !v) return;
  const q = QUICK.find((x) => v.toLowerCase().startsWith(x[0].toLowerCase().slice(0, 4)));
  const cat = q ? q[1] : "Sonstiges";
  store.update(id, { name: v, unknown: false, cat });
  learn(items.find((x) => x.id === id), { name: v, cat, manual: true });
  renderRecent(); toast(`${v} gespeichert. Beim nächsten Scan erkennt die App es sofort.`);
});

/* ---------- Haltbarkeit schätzen ----------
   Open Food Facts kennt kein Ablaufdatum (es steht nur auf der Packung).
   Darum: übliche Haltbarkeit ab Kauf nach Produktart; korrigiert ihr einmal, merkt sich die App das pro Barcode. */
const SHELF = [
  [/h-milch|haltbare milch|uht/, 90], [/frischmilch|vollmilch|milch|milk/, 8], [/sahne|cream|schmand|crème fraîche|creme fraiche|saure sahne/, 14],
  [/joghurt|yogurt|quark|skyr|pudding|dessert/, 18], [/butter/, 40], [/frischkäse|mozzarella|feta|cream cheese/, 14],
  [/käse|cheese|gouda|emmentaler|parmesan/, 28], [/hackfleisch|hack|minced/, 1], [/hähnchen|huhn|chicken|pute|turkey|fisch|fish|lachs|salmon/, 3],
  [/schinken|salami|wurst|aufschnitt|sausage|ham/, 10], [/fleisch|meat|steak|schnitzel/, 3], [/eier|eggs|ei/, 21],
  [/toast|piccolini|aufback|brötchen|baguette/, 7], [/brot|bread/, 5], [/salat|lettuce|spinat|rucola|kräuter/, 4], [/beeren|berries|erdbeer/, 4],
  [/tiefkühl|frozen|eis|ice cream/, 180], [/konserve|canned|dose/, 720], [/nudel|pasta|reis|rice|mehl|flour|zucker|sugar|müsli|cereal/, 365],
  [/schokolade|chocolate|kekse|biscuit|chips|snack/, 180], [/saft|juice|limonade|cola|soda/, 120], [/wasser|water/, 365],
  [/marmelade|konfitüre|jam|honig|honey|nutella|aufstrich|spread/, 300], [/ketchup|senf|mustard|mayo|soße|sauce|dressing/, 180],
];
function estimateDays(name, tags, cat) {
  const hay = (String(name) + " " + (tags || []).join(" ")).toLowerCase().replace(/en:|de:/g, "");
  if (cat === "Tiefkühl") return 180;
  for (const [re, d] of SHELF) if (re.test(hay)) return d;
  return CATS[cat] ? CATS[cat].d : 14;
}

/* ---------- MHD schnell eintippen ---------- */
// Versteht: 1203 · 12.03 · 120327 · 12.03.27 · 12032027 · 03.2027 (Monat/Jahr -> letzter Tag)
function parseMhd(raw) {
  const s = String(raw).trim(); let d, m, y;
  if (/^\d+$/.test(s)) {
    if (s.length === 4) { d = s.slice(0, 2); m = s.slice(2); }
    else if (s.length === 6 || s.length === 8) { d = s.slice(0, 2); m = s.slice(2, 4); y = s.slice(4); }
    else return null;
  } else {
    const p = s.split(/[.\/\-\s]+/).filter(Boolean);
    if (p.length === 2 && p[1].length === 4) { m = +p[0]; y = +p[1]; if (!(m >= 1 && m <= 12)) return null; return iso(new Date(y, m, 0, 12)); }
    if (p.length < 2 || p.length > 3) return null;
    [d, m, y] = p;
  }
  d = +d; m = +m; if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
  const yr = y ? (+y < 100 ? 2000 + +y : +y) : new Date().getFullYear();
  const dt = new Date(yr, m - 1, d, 12); if (dt.getMonth() !== m - 1) return null;
  if (!y && iso(dt) < plus(-30)) dt.setFullYear(yr + 1);
  return iso(dt);
}

/* ---------- Doppelkauf ---------- */
function dupNote(name, ean) {
  const same = active().filter((r) => (ean && r.ean === ean) || r.name.toLowerCase() === String(name).toLowerCase());
  if (!same.length) return "";
  const total = same.reduce((s, r) => s + Number(r.qty), 0);
  const soon = Math.min(...same.map((r) => daysLeft(effExp(r)) ?? 999));
  return `Schon da: ${fmtQty({ qty: total, unit: same[0].unit })}${soon < 999 ? `, läuft ${soon <= 0 ? "heute" : soon === 1 ? "morgen" : `in ${soon} Tagen`} ab` : ""}.`;
}

/* ---------- Einkaufsliste & Nachkauf ---------- */
const SHOPS = ["Egal", "Aldi", "Lidl", "Rewe", "Edeka", "Kaufland", "Netto", "Penny", "dm"];
const LKEY = "kuehlschrank-list-v1", SKEY = "kuehlschrank-shops-v1", DKEY = "kuehlschrank-dismissed-v1";
let shopList = load(LKEY, []);
let shopOf = load(SKEY, {});       // Produktname (klein) -> Laden
let dismissed = load(DKEY, {});    // Produktname (klein) -> Datum, bis wann ausgeblendet
const key = (n) => String(n).trim().toLowerCase();
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 864e5);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const onList = (n) => shopList.some((l) => !l.done && key(l.name) === key(n));

function suggestions() {
  const groups = {};
  for (const r of items) (groups[key(r.name)] ||= []).push(r);
  const out = [];
  for (const [k, rs] of Object.entries(groups)) {
    const last = rs[rs.length - 1]; const name = last.name;
    if (last.unknown || onList(name) || (dismissed[k] && dismissed[k] >= today())) continue;
    const stock = rs.filter((r) => r.status === "aktiv");
    const usual = median(rs.map((r) => Number(r.qty0 ?? r.qty)).filter((x) => x > 0)) || 1;
    let reason = "", prio = 0;
    if (!stock.length) {
      const lastDone = rs.map((r) => r.done).filter(Boolean).sort().pop();
      if (lastDone && daysBetween(lastDone, today()) <= 30) {
        const ago = daysBetween(lastDone, today());
        reason = ago === 0 ? "heute leer geworden" : `leer seit ${ago} ${ago === 1 ? "Tag" : "Tagen"}`; prio = 3;
      }
    } else {
      const total = stock.reduce((s, r) => s + Number(r.qty), 0), total0 = stock.reduce((s, r) => s + Number(r.qty0 ?? r.qty), 0);
      const low = last.unit === "Stk" ? (total <= 1 && total0 > 1) || (total0 >= 4 && total <= total0 * 0.25) : total <= total0 * 0.25;
      if (low) { reason = `nur noch ${fmtQty({ qty: total, unit: last.unit })}`; prio = 2; }
    }
    const days = [...new Set(rs.map((r) => r.added).filter(Boolean))].sort();
    if (days.length >= 2) {
      const every = Math.max(1, Math.round(daysBetween(days[0], days[days.length - 1]) / (days.length - 1)));
      const since = daysBetween(days[days.length - 1], today());
      if (reason) reason += ` · kauft ihr etwa alle ${every} Tage`;
      else if (!stock.length && since >= every) { reason = `kauft ihr etwa alle ${every} Tage, zuletzt vor ${since} Tagen`; prio = 1; }
    }
    if (reason) out.push({ name, reason, prio, qty: usual, unit: last.unit });
  }
  return out.sort((a, b) => b.prio - a.prio || a.name.localeCompare(b.name));
}

function addToList(name, qty, unit) {
  const d = dupNote(name);
  shopList.push({ id: uid(), name, qty: qty || 1, unit: unit || "Stk", shop: shopOf[key(name)] || "Egal", done: false });
  save(LKEY, shopList); renderShop();
  toast(d ? `${name} auf der Liste. ${d}` : `${name} auf der Liste`);
}
function renderShop() {
  if (!$("#v-shop")) return;
  const sug = suggestions();
  $("#sugCount").textContent = sug.length ? String(sug.length) : "";
  $("#suggest").innerHTML = sug.length
    ? '<div class="list">' + sug.map((s) => `<div class="item"><span class="dot" style="background:var(${s.prio === 3 ? "--red" : s.prio === 2 ? "--amber" : "--accent"})"></span><span class="name">${esc(s.name)}</span><span class="pill p-muted">${fmtQty(s)}</span><span class="meta">${esc(s.reason)}</span><div class="acts"><button class="act" data-s="add" data-n="${esc(s.name)}" data-q="${s.qty}" data-u="${s.unit}">Auf die Liste</button><button class="act" data-s="hide" data-n="${esc(s.name)}">Diese Woche nicht</button></div></div>`).join("") + "</div>"
    : `<div class="empty"><p>Gerade nichts nachzukaufen. Vorschläge erscheinen, wenn etwas leer wird oder knapp ist, und wenn die App merkt, wie oft ihr etwas kauft.</p></div>`;
  const open = shopList.filter((l) => !l.done), done = shopList.filter((l) => l.done);
  const byShop = {};
  for (const l of open) (byShop[l.shop] ||= []).push(l);
  const order = SHOPS.filter((s) => byShop[s]).concat(Object.keys(byShop).filter((s) => !SHOPS.includes(s)));
  $("#shoplist").innerHTML = open.length
    ? order.map((s) => `<h3 class="shopname">${s === "Egal" ? "Egal wo" : esc(s)}</h3><div class="list">${byShop[s].map(rowHtml).join("")}</div>`).join("")
    : `<p class="note">Die Liste ist leer.</p>`;
  $("#shopdone").innerHTML = done.length ? `<h3 class="shopname">Erledigt</h3><div class="list">${done.map(rowHtml).join("")}</div><button class="btn ghost" id="clearDone">Erledigte entfernen</button>` : "";
}
function rowHtml(l) {
  return `<div class="item shoprow${l.done ? " done" : ""}"><input type="checkbox" aria-label="${esc(l.name)} erledigt" data-l="check" data-id="${l.id}"${l.done ? " checked" : ""}><span class="name">${esc(l.name)}</span><span class="pill p-muted">${fmtQty(l)}</span>
    <select class="meta shopsel" aria-label="Laden für ${esc(l.name)}" data-l="shop" data-id="${l.id}">${SHOPS.map((s) => `<option${s === l.shop ? " selected" : ""}>${s}</option>`).join("")}</select></div>`;
}
document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-s]");
  if (s) {
    if (s.dataset.s === "add") addToList(s.dataset.n, Number(s.dataset.q), s.dataset.u);
    if (s.dataset.s === "hide") { dismissed[key(s.dataset.n)] = plus(7); save(DKEY, dismissed); renderShop(); }
    return;
  }
  if (e.target.id === "clearDone") { shopList = shopList.filter((l) => !l.done); save(LKEY, shopList); renderShop(); }
});
document.addEventListener("change", (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.l) return;
  const l = shopList.find((x) => x.id === t.dataset.id); if (!l) return;
  if (t.dataset.l === "check") l.done = t.checked;
  if (t.dataset.l === "shop") { l.shop = t.value; shopOf[key(l.name)] = t.value; save(SKEY, shopOf); }
  save(LKEY, shopList); renderShop();
});
$("#listAdd").addEventListener("submit", (e) => {
  e.preventDefault(); const v = $("#listInput").value.trim(); if (!v) return;
  const m = v.match(/^(\d+[.,]?\d*)\s*(g|ml|stk|pck)?\.?\s+(.+)$/i);
  if (m) addToList(m[3], parseFloat(m[1].replace(",", ".")), ({ g: "g", ml: "ml", stk: "Stk", pck: "Pck" })[String(m[2] || "stk").toLowerCase()]);
  else addToList(v, 1, "Stk");
  $("#listInput").value = "";
});

/* ---------- Start ---------- */
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
