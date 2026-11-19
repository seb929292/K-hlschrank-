"use strict";
/* Gemeinsamer Haushalt über Supabase.
   Ohne Konfiguration (config.js leer) bleibt alles wie bisher nur auf diesem Gerät.
   Mit Anmeldung + Haushalt: jede Änderung geht in die Tabelle "entries", das andere Handy bekommt sie live.
   Zugriff: Row Level Security, nur Mitglieder des Haushalts (siehe supabase/schema.sql). */
(function () {
  const cfg = window.KS_CONFIG || {};
  const card = $("#household");
  const KINDS = {
    item: { key: () => KEY, get: () => items, set: (v) => { items = v; }, arr: true },
    list: { key: () => LKEY, get: () => shopList, set: (v) => { shopList = v; }, arr: true },
    product: { key: () => PKEY, get: () => products, set: (v) => { products = v; } },
    shop: { key: () => SKEY, get: () => shopOf, set: (v) => { shopOf = v; } },
    dismissed: { key: () => DKEY, get: () => dismissed, set: (v) => { dismissed = v; } },
    never: { key: () => NKEY, get: () => never, set: (v) => { never = v; } },
  };
  const kindOfKey = {}; for (const [k, d] of Object.entries(KINDS)) kindOfKey[d.key()] = k;
  const HKEY = "kuehlschrank-household-v1";

  let client = null, session = null, household = load(HKEY, null), members = 0, channel = null;
  let lastSent = {}, timers = {}, online = false;

  function toRows(kind) {
    const d = KINDS[kind], v = d.get(), out = {};
    if (d.arr) for (const e of v) out[e.id] = e; else for (const [k, x] of Object.entries(v)) out[k] = { v: x };
    return out;
  }
  function writeLocal(kind) { try { localStorage.setItem(KINDS[kind].key(), JSON.stringify(KINDS[kind].get())); } catch (e) {} }

  // App -> Datenbank (gebündelt, nur geänderte Einträge)
  window.onSaved = function (storageKey) {
    const kind = kindOfKey[storageKey]; if (!kind || !online) return;
    clearTimeout(timers[kind]); timers[kind] = setTimeout(() => push(kind), 400);
  };
  async function push(kind) {
    if (!online) return;
    const rows = toRows(kind), sent = lastSent[kind] || (lastSent[kind] = {}), up = [];
    for (const [id, data] of Object.entries(rows)) { const j = JSON.stringify(data); if (sent[id] !== j) up.push({ household_id: household.id, kind, id, data, updated_at: new Date().toISOString() }); }
    for (const id of Object.keys(sent)) if (!(id in rows)) up.push({ household_id: household.id, kind, id, data: { deleted: true }, updated_at: new Date().toISOString() });
    if (!up.length) return;
    for (let i = 0; i < up.length; i += 200) {
      const { error } = await client.from("entries").upsert(up.slice(i, i + 200), { onConflict: "household_id,kind,id" });
      if (error) { status("Speichern in der gemeinsamen Liste fehlgeschlagen. Wird beim nächsten Ändern erneut versucht."); return; }
    }
    for (const r of up) { if (r.data.deleted) delete sent[r.id]; else sent[r.id] = JSON.stringify(r.data); }
  }

  // Datenbank -> App
  function applyRow(kind, id, data) {
    const d = KINDS[kind]; if (!d) return;
    const sent = lastSent[kind] || (lastSent[kind] = {});
    if (d.arr) {
      const arr = d.get().filter((e) => e.id !== id);
      if (!data.deleted) arr.push({ ...data, id });
      d.set(arr);
    } else {
      const m = { ...d.get() };
      if (data.deleted) delete m[id]; else m[id] = data.v;
      d.set(m);
    }
    if (data.deleted) delete sent[id]; else sent[id] = JSON.stringify(d.arr ? { ...data, id } : data);
    writeLocal(kind);
  }
  async function pull() {
    const remote = {}; let from = 0;
    for (;;) {
      const { data, error } = await client.from("entries").select("kind,id,data").eq("household_id", household.id).range(from, from + 999);
      if (error) throw error;
      for (const r of data) (remote[r.kind] ||= {})[r.id] = r.data;
      if (data.length < 1000) break; from += 1000;
    }
    lastSent = {};
    for (const kind of Object.keys(KINDS)) {
      const d = KINDS[kind], rem = remote[kind] || {}, sent = (lastSent[kind] = {});
      // Zusammenführen: Gemeinsames gewinnt, nur hier vorhandene Einträge kommen dazu und werden hochgeladen.
      if (d.arr) {
        const merged = [], seen = new Set();
        for (const [id, data] of Object.entries(rem)) { seen.add(id); if (!data.deleted) { merged.push({ ...data, id }); sent[id] = JSON.stringify({ ...data, id }); } }
        for (const e of d.get()) if (!seen.has(e.id)) merged.push(e);
        d.set(merged);
      } else {
        const m = { ...d.get() };
        for (const [id, data] of Object.entries(rem)) { if (data.deleted) delete m[id]; else { m[id] = data.v; sent[id] = JSON.stringify(data); } }
        d.set(m);
      }
      writeLocal(kind);
    }
    render();
    for (const kind of Object.keys(KINDS)) await push(kind);
  }
  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client.channel("entries-" + household.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter: "household_id=eq." + household.id }, (p) => {
        const r = p.new; if (!r || !r.kind) return;
        applyRow(r.kind, r.id, r.data); render();
      })
      .subscribe((s) => { if (s === "SUBSCRIBED") status(""); });
  }

  async function loadHousehold() {
    const { data, error } = await client.from("household_members").select("household_id, households(id,name,invite_code)").eq("user_id", session.user.id);
    if (error) { status("Haushalt konnte nicht geladen werden."); return; }
    const h = data && data[0] && data[0].households;
    household = h || null; save(HKEY, household);
    if (household) {
      const { count } = await client.from("household_members").select("user_id", { count: "exact", head: true }).eq("household_id", household.id);
      members = count || 1;
      online = true; await pull(); subscribe();
    } else online = false;
    draw();
  }

  /* ---------- Oberfläche ---------- */
  function status(t) { const el = $("#hhStatus"); if (el) el.textContent = t; }
  function setSub() {
    const sub = $("#modeSub");
    sub.textContent = online && household ? `Gemeinsam: ${household.name} · ${members} ${members === 1 ? "Mitglied" : "Mitglieder"} · live` : "Nur auf diesem Gerät · Teilen einrichten";
  }
  function draw() {
    setSub();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      card.innerHTML = `<h2>Gemeinsame Liste</h2><p class="note">Noch nicht eingerichtet. Sobald die Datenbank verbunden ist, könnt ihr hier euren Haushalt anlegen.</p>`; return;
    }
    if (!session) {
      card.innerHTML = `<h2>Gemeinsame Liste</h2><p class="note">Meldet euch beide mit eurer E-Mail-Adresse an. Ihr bekommt einen Link, ein Passwort braucht ihr nicht. Eure Daten sehen nur Mitglieder eures Haushalts.</p>
        <form id="hhLogin" class="row"><input id="hhEmail" type="email" required placeholder="E-Mail-Adresse" autocomplete="email" aria-label="E-Mail-Adresse"><button class="btn" type="submit">Link schicken</button></form><p class="status" id="hhStatus"></p>`; return;
    }
    if (!household) {
      card.innerHTML = `<h2>Gemeinsame Liste</h2><p class="note">Angemeldet als ${esc(session.user.email)}.</p>
        <button class="btn" id="hhCreate">Neuen Haushalt anlegen</button>
        <p class="note">Oder mit dem Code beitreten, den der andere in seiner App sieht:</p>
        <form id="hhJoin" class="row"><input id="hhCode" required placeholder="Einladungscode" autocapitalize="characters" aria-label="Einladungscode"><button class="btn ghost" type="submit">Beitreten</button></form>
        <p class="status" id="hhStatus"></p><button class="act" id="hhLogout">Abmelden</button>`; return;
    }
    card.innerHTML = `<h2>${esc(household.name)}</h2><p class="note">Angemeldet als ${esc(session.user.email)} · ${members} ${members === 1 ? "Mitglied" : "Mitglieder"}. Änderungen erscheinen sofort auf allen Handys des Haushalts.</p>
      <div class="invite"><span class="note">Einladungscode für deine Frau</span><b class="code">${esc(household.invite_code)}</b></div>
      <p class="note">Sie öffnet die App, meldet sich mit ihrer E-Mail an und gibt diesen Code ein.</p>
      <p class="status" id="hhStatus"></p><button class="act" id="hhLogout">Abmelden</button>`;
  }
  card.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "hhLogin") {
      const email = $("#hhEmail").value.trim(); status("Sende Link …");
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      status(error ? "Das hat nicht geklappt: " + error.message : `Link an ${email} geschickt. Bitte die E-Mail auf diesem Handy öffnen und auf den Link tippen.`);
    }
    if (e.target.id === "hhJoin") {
      const { error } = await client.rpc("join_household", { code: $("#hhCode").value });
      if (error) status(/unbekannt/.test(error.message) ? "Diesen Code gibt es nicht. Bitte noch einmal prüfen." : "Beitreten fehlgeschlagen: " + error.message);
      else { toast("Haushalt beigetreten"); await loadHousehold(); }
    }
  });
  card.addEventListener("click", async (e) => {
    if (e.target.id === "hhCreate") {
      const { error } = await client.rpc("create_household", { hname: "Unser Haushalt" });
      if (error) status("Anlegen fehlgeschlagen: " + error.message); else { toast("Haushalt angelegt"); await loadHousehold(); }
    }
    if (e.target.id === "hhLogout") {
      await client.auth.signOut(); online = false; household = null; save(HKEY, null);
      if (channel) client.removeChannel(channel); channel = null; draw();
    }
  });
  $("#modeSub").addEventListener("click", () => { card.hidden = !card.hidden; if (!card.hidden) card.scrollIntoView({ behavior: "smooth" }); });

  draw();
  if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } });
    let loadedFor = null;
    client.auth.onAuthStateChange((ev, s) => {
      session = s;
      if (s && s.user.id !== loadedFor) { loadedFor = s.user.id; setTimeout(loadHousehold, 0); }
      if (!s) { loadedFor = null; online = false; draw(); }
    });
  }
})();
