import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   TINOCO APART HOTEL — CONECTADO A SUPABASE
   
   PASOS PARA CONECTAR:
   1. Ve a Supabase → Settings → API
   2. Copia tu "Project URL" y "anon public" key
   3. Reemplaza los valores abajo
   ═══════════════════════════════════════════════════════════════ */

// ⚠️ REEMPLAZA ESTOS 2 VALORES:
const SUPABASE_URL = "https://mnaslqlkzavcmkipwalv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mxifxqVbzIw1LSzSDXUXkA_SZQigrOZ";

/* ═══ MINI SUPABASE REST CLIENT ═══ */
const sbCfg = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
async function sbRest(table, method, body, filter, prefer) {
  const url = sbCfg.url + "/rest/v1/" + table + (filter ? "?" + filter : "");
  const h = { "Content-Type": "application/json", apikey: sbCfg.key, Authorization: "Bearer " + sbCfg.key };
  if (method !== "GET") h["Prefer"] = prefer || "return=representation";
  const opts = { method, headers: h };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(url, opts);
    if (!r.ok) { console.error("SB:", await r.text()); return null; }
    if (r.status === 204) return [];
    return await r.json();
  } catch (e) { console.error("SB fetch:", e); return null; }
}

/* ═══ CONSTANTS ═══ */
const CHANNELS = ["WhatsApp", "Booking", "Airbnb", "Directo", "Teléfono", "Otro"];
const PAYS = ["Efectivo", "Tarjeta", "Transferencia", "Yape", "Plin"];
const RSTATES = ["Reservado", "Hospedado", "Finalizado", "Cancelado"];

const toDS = (d) => {
  const x = new Date(d);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
};
const addD = (ds, n) => {
  const d = new Date(ds + "T12:00:00");
  d.setDate(d.getDate() + n);
  return toDS(d);
};
const genId = () => "R-" + String(Math.floor(Math.random() * 900) + 100).padStart(3, "0");
const dwk = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short" });
const dnum = (ds) => new Date(ds + "T12:00:00").getDate();
const msh = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("es-PE", { month: "short" });
const MN = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const DW = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const TODAY = toDS(new Date());

/* Format "2026-02-09T18:45" → "09/02/2026, 18:45" */
function fmtDT(dt) {
  if (!dt) return "";
  const parts = dt.split("T");
  const d = parts[0].split("-");
  const t = parts.length > 1 ? parts[1].substring(0, 5) : "";
  if (d.length < 3) return dt;
  return d[2] + "/" + d[1] + "/" + d[0] + (t ? ", " + t : "");
}

/* Format "2026-02-09" → "09/02/2026" */
function fmtD(ds) {
  if (!ds) return "";
  const d = ds.split("-");
  if (d.length < 3) return ds;
  return d[2] + "/" + d[1] + "/" + d[0];
}

function buildMonth(y, m) {
  const f = new Date(y, m, 1);
  let s = f.getDay() - 1;
  if (s < 0) s = 6;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < s; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const wks = [];
  for (let i = 0; i < cells.length; i += 7) wks.push(cells.slice(i, i + 7));
  return wks;
}

/* Get hour from datetime string like "2026-02-09T18:00" */
function getHour(dt) {
  if (!dt) return 13;
  const parts = dt.split("T");
  if (parts.length < 2) return 13;
  const hm = parts[1].split(":");
  return parseInt(hm[0]) || 13;
}

/* Get HH:MM from datetime */
function getTime(dt) {
  if (!dt) return "13:00";
  const parts = dt.split("T");
  if (parts.length < 2) return "13:00";
  return parts[1].substring(0, 5) || "13:00";
}

/* Real-time room status using ACTUAL checkin/checkout hours */
function roomSt(rid, ds, reservations) {
  let am = "free", pm = "free", ar = null, pr = null;
  for (const r of reservations) {
    if (r.roomId !== rid || r.state === "Cancelado" || r.state === "Finalizado") continue;
    const ci = toDS(r.checkin);
    const co = toDS(r.checkout);
    const ciHour = getHour(r.checkin);
    const coHour = getHour(r.checkout);
    const st = r.state === "Hospedado" ? "occ" : "res";

    // Checkout day: occupied/reserved in AM until checkout hour, free after
    if (co === ds) {
      if (coHour > 12) { am = st; pm = st; ar = r; pr = r; }
      else { am = st; ar = r; }
    }
    // Checkin day: free in AM, occupied/reserved from checkin hour
    if (ci === ds && co !== ds) {
      if (ciHour <= 12) { am = st; pm = st; ar = r; pr = r; }
      else { pm = st; pr = r; }
    }
    // Same day checkin+checkout
    if (ci === ds && co === ds) { am = st; pm = st; ar = r; pr = r; }
    // Full days in between
    if (ci < ds && co > ds) { am = st; pm = st; ar = r; pr = r; }
  }
  return { am, pm, ar, pr };
}

/* Count rooms by status for a specific date */
function countByDate(rooms, reservations, dateStr) {
  let occ = 0, rsv = 0;
  const counted = new Set();
  for (const room of rooms) {
    const { am, pm } = roomSt(room.id, dateStr, reservations);
    if (am === "occ" || pm === "occ") { occ++; counted.add(room.id); }
    else if (am === "res" || pm === "res") { rsv++; counted.add(room.id); }
  }
  return { occ, rsv, free: rooms.length - occ - rsv };
}

const holsOn = (ds, hs) => hs.filter((h) => ds >= h.s && ds <= h.e);
const isHol = (ds, hs) => holsOn(ds, hs).length > 0;

function Fld({ label, type = "text", opts, value, onChange, ro, min }) {
  return (
    <div className="fld">
      <label>{label}</label>
      {type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {(opts || []).map((o) =>
            typeof o === "string" ? (
              <option key={o}>{o}</option>
            ) : (
              <option key={o.v} value={o.v}>{o.l}</option>
            )
          )}
        </select>
      ) : (
        <input type={type} min={min} value={value || ""} readOnly={ro} style={ro ? { opacity: 0.6 } : {}} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}


/* ═══ DB ↔ APP DATA MAPPING ═══ */
const parseJ = (v) => { if (!v) return []; if (typeof v === "string") try { return JSON.parse(v); } catch { return []; } return v; };
const dbToRoom = (r) => ({ id: r.id, name: r.name, type: r.type_id, floor: r.floor, photos: parseJ(r.photos), obs: parseJ(r.observations) });
const dbToType = (t) => ({ id: t.id, name: t.name, base: Number(t.base_price), high: Number(t.high_price), cap: t.capacity });
const dbToHol = (h) => ({ id: h.id, name: h.name, s: h.start_date, e: h.end_date, icon: h.icon || "🎉" });
const dbToUser = (u) => ({ id: u.id, name: u.name, user: u.username, pass: u.password });
function dbToRes(r) {
  return { id: r.id, created: r.created_date, createdBy: r.created_by, lastModBy: r.last_mod_by || "",
    guest: r.guest, doc: r.doc, phone: r.phone, email: r.email || "", channel: r.channel || "Directo",
    roomType: r.room_type, roomId: r.room_id, persons: r.persons || 1,
    checkin: r.checkin, checkout: r.checkout,
    ciDate: r.ci_date, ciTime: r.ci_time || "13:00", coDate: r.co_date, coTime: r.co_time || "12:00",
    state: r.state || "Reservado", total: Number(r.total) || 0, advance: Number(r.advance) || 0,
    balance: Number(r.balance) || 0, payment: r.payment || "Efectivo", comments: r.comments || "",
    checkoutVerifiedBy: r.checkout_verified_by || "", checkoutVerifiedUser: r.checkout_verified_user || "",
    advances: typeof r.advances === "string" ? JSON.parse(r.advances || "[]") : (r.advances || []) };
}
function resToDb(r) {
  return { id: r.id, created_date: r.created, created_by: r.createdBy, last_mod_by: r.lastModBy || "",
    guest: r.guest, doc: r.doc, phone: r.phone, email: r.email || "", channel: r.channel,
    room_type: r.roomType, room_id: r.roomId, persons: r.persons || 1,
    checkin: r.checkin, checkout: r.checkout,
    ci_date: r.ciDate, ci_time: r.ciTime || "13:00", co_date: r.coDate, co_time: r.coTime || "12:00",
    state: r.state, total: r.total, advance: r.advance, balance: r.balance,
    payment: r.payment, comments: r.comments || "",
    checkout_verified_by: r.checkoutVerifiedBy || "", checkout_verified_user: r.checkoutVerifiedUser || "",
    advances: JSON.stringify(r.advances || []) };
}

/* ═══ LOGIN ═══ */
function LoginPage({ users, onLogin }) {
  const [u, sU] = useState("");
  const [p, sP] = useState("");
  const [err, sErr] = useState("");
  const login = () => {
    const found = users.find((x) => x.user === u && x.pass === p);
    if (found) { onLogin(found); sErr(""); } else sErr("Usuario o contraseña incorrectos");
  };
  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-header">
          <span style={{ fontSize: 36 }}>🏨</span>
          <h1>Tinoco Apart Hotel</h1>
          <p>Sistema de Gestión</p>
        </div>
        <div className="fld" style={{ marginBottom: 10 }}>
          <label>Usuario</label>
          <input value={u} onChange={(e) => { sU(e.target.value); sErr(""); }} placeholder="usuario" />
        </div>
        <div className="fld" style={{ marginBottom: 10 }}>
          <label>Contraseña</label>
          <input type="password" value={p} onChange={(e) => { sP(e.target.value); sErr(""); }} placeholder="contraseña" onKeyDown={(e) => e.key === "Enter" && login()} />
        </div>
        {err && <p className="login-err">{err}</p>}
        <button className="ba login-btn" onClick={login}>Ingresar</button>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <span style={{ fontSize: 10, color: "#27ae60" }}>🟢 Conectado a Supabase — datos sincronizados</span>
        </div>
      </div>
    </div>
  );
}

/* ═══ SETUP SCREEN ═══ */
function SetupScreen({ onSetup }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState("");
  const test = async () => {
    if (!url || !key) return setErr("Completa ambos campos");
    setTesting(true); setErr("");
    try {
      const r = await fetch(url + "/rest/v1/users?select=id&limit=1", { headers: { apikey: key, Authorization: "Bearer " + key } });
      if (!r.ok) throw new Error("No se pudo conectar. Verifica URL y Key.");
      onSetup(url, key);
    } catch (e) { setErr(e.message); }
    setTesting(false);
  };
  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-header">
          <span style={{ fontSize: 36 }}>🔌</span>
          <h1>Conectar a Supabase</h1>
          <p>Ingresa los datos de tu proyecto</p>
        </div>
        <div className="fld" style={{ marginBottom: 10 }}>
          <label>Project URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://xxxxx.supabase.co" />
        </div>
        <div className="fld" style={{ marginBottom: 10 }}>
          <label>Anon Public Key</label>
          <input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="eyJhbGciOiJI..." style={{ fontSize: 10 }} />
        </div>
        <p style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
          Los encuentras en: Supabase → Settings → API
        </p>
        {err && <p className="login-err">{err}</p>}
        <button className="ba login-btn" onClick={test} disabled={testing}>
          {testing ? "Conectando..." : "Conectar"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MAIN APP — SUPABASE CONNECTED ═══ */
export default function App() {
  const needSetup = SUPABASE_URL.includes("TU-PROYECTO");
  const [configured, setConfigured] = useState(!needSetup);
  const [loading, setLoading] = useState(true);
  const [curUser, setCurUser] = useState(null);
  const [pg, setPg] = useState("reg");
  const [users, setUsers] = useState([]);
  const [types, setTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [res, setRes] = useState([]);
  const [hols, setHols] = useState([]);
  const [clnOverrides, setClnOverrides] = useState({});
  const [calD, setCalD] = useState(TODAY);
  const [modal, setModal] = useState(null);
  const [selR, setSelR] = useState(null);
  const pollRef = useRef(null);

  const handleSetup = (url, key) => { sbCfg.url = url; sbCfg.key = key; setConfigured(true); };

  const loadAll = useCallback(async () => {
    try {
      const [u, t, r, rv, h, c] = await Promise.all([
        sbRest("users", "GET", null, "select=*"),
        sbRest("room_types", "GET", null, "select=*"),
        sbRest("rooms", "GET", null, "select=*"),
        sbRest("reservations", "GET", null, "select=*"),
        sbRest("holidays", "GET", null, "select=*"),
        sbRest("cleaning_overrides", "GET", null, "select=*"),
      ]);
      if (u) setUsers(u.map(dbToUser));
      if (t) setTypes(t.map(dbToType));
      if (r) setRooms(r.map(dbToRoom));
      if (rv) setRes(rv.map(dbToRes));
      if (h) setHols(h.map(dbToHol));
      if (c) {
        const m = {};
        c.forEach((row) => { m[row.override_key] = { key: row.override_key, roomId: row.room_id, status: row.status, by: row.done_by, at: row.done_at, user: row.registered_by }; });
        setClnOverrides(m);
      }
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!configured) return;
    loadAll();
    // Poll every 8 seconds for real-time sync between devices
    pollRef.current = setInterval(loadAll, 8000);
    return () => clearInterval(pollRef.current);
  }, [configured, loadAll]);

  /* ═══ CRUD → SUPABASE ═══ */
  const addReservation = async (data) => {
    const nr = { ...data, id: genId(), created: TODAY, createdBy: curUser.name };
    setRes((p) => [...p, nr]);
    await sbRest("reservations", "POST", [resToDb(nr)]);
  };
  const updateReservation = async (id, data) => {
    setRes((p) => p.map((r) => r.id === id ? { ...r, ...data } : r));
    const d = resToDb(data); delete d.id;
    await sbRest("reservations", "PATCH", d, "id=eq." + id);
  };
  const deleteReservation = async (id) => {
    setRes((p) => p.filter((r) => r.id !== id));
    await sbRest("reservations", "DELETE", null, "id=eq." + id);
  };
  const addRoom = async (data) => {
    const room = { ...data, photos: [], obs: [] };
    setRooms((p) => [...p, room]);
    await sbRest("rooms", "POST", [{ id: room.id, name: room.name, type_id: room.type, floor: room.floor, photos: "[]", observations: "[]" }]);
  };
  const updateRoom = async (id, data) => {
    setRooms((p) => p.map((r) => r.id === id ? data : r));
    await sbRest("rooms", "PATCH", { name: data.name, type_id: data.type, floor: data.floor, photos: JSON.stringify(data.photos || []), observations: JSON.stringify(data.obs || []) }, "id=eq." + id);
  };
  const deleteRoom = async (id) => {
    setRooms((p) => p.filter((r) => r.id !== id));
    await sbRest("rooms", "DELETE", null, "id=eq." + id);
  };
  const addType = async (data) => {
    setTypes((p) => [...p, data]);
    await sbRest("room_types", "POST", [{ id: data.id, name: data.name, base_price: data.base, high_price: data.high, capacity: data.cap }]);
  };
  const updateType = async (id, data) => {
    setTypes((p) => p.map((t) => t.id === id ? { ...t, ...data } : t));
    await sbRest("room_types", "PATCH", { name: data.name, base_price: data.base, high_price: data.high, capacity: data.cap }, "id=eq." + id);
  };
  const addHoliday = async (data) => {
    setHols((p) => [...p, data]);
    await sbRest("holidays", "POST", [{ id: data.id, name: data.name, start_date: data.s, end_date: data.e, icon: data.icon }]);
  };
  const updateHoliday = async (id, data) => {
    setHols((p) => p.map((h) => h.id === id ? { ...h, ...data } : h));
    await sbRest("holidays", "PATCH", { name: data.name, start_date: data.s, end_date: data.e, icon: data.icon }, "id=eq." + id);
  };
  const deleteHoliday = async (id) => {
    setHols((p) => p.filter((h) => h.id !== id));
    await sbRest("holidays", "DELETE", null, "id=eq." + id);
  };
  const markCleaningDone = async (key, roomId, by, userName) => {
    setClnOverrides((p) => ({ ...p, [key]: { key, roomId, status: "limpio", by, at: new Date().toISOString(), user: userName } }));
    await sbRest("cleaning_overrides", "POST", [{ override_key: key, room_id: roomId, status: "limpio", done_by: by, done_at: new Date().toISOString(), registered_by: userName }], "", "return=representation,resolution=merge-duplicates");
  };

  const nav = [
    { id: "reg", l: "Registro", i: "📋" },
    { id: "disp", l: "Disponibilidad", i: "📅" },
    { id: "cal", l: "Calendario", i: "🗓️" },
    { id: "hab", l: "Habitaciones", i: "🏨" },
    { id: "lim", l: "Limpieza", i: "🧹" },
  ];

  if (!configured) return (<><style>{CSS}</style><SetupScreen onSetup={handleSetup} /></>);
  if (loading) return (
    <><style>{CSS}</style>
      <div className="login-bg"><div className="login-card" style={{ textAlign: "center" }}>
        <span style={{ fontSize: 48, display: "block", marginBottom: 16 }}>🏨</span>
        <h2 style={{ fontFamily: "var(--FD)", fontSize: 18, color: "#6B3410", marginBottom: 8 }}>Tinoco Apart Hotel</h2>
        <p style={{ fontSize: 13, color: "#888" }}>Cargando datos desde Supabase...</p>
        <div style={{ marginTop: 20 }}><div style={{ width: 40, height: 40, border: "4px solid #e0dcd6", borderTopColor: "#8B4513", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} /></div>
      </div></div>
    </>
  );
  if (!curUser) return (<><style>{CSS}</style><LoginPage users={users} onLogin={setCurUser} /></>);

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="hdr-l"><span className="hdr-ico">🏨</span><div><h1 className="hdr-t">Tinoco Apart Hotel</h1><p className="hdr-s">Sistema de Gestión — En línea</p></div></div>
          <nav className="hdr-nav">
            {nav.map((n2) => (
              <button key={n2.id} className={"nv" + (pg === n2.id ? " ac" : "")} onClick={() => setPg(n2.id)}>
                <span className="ni">{n2.i}</span>{n2.l}
              </button>
            ))}
            <div className="hdr-user">
              <span className="hdr-uname">👤 {curUser.name}</span>
              <span style={{ fontSize: 8, color: "#4caf50", marginLeft: 4 }}>●</span>
              <button className="hdr-logout" onClick={() => setCurUser(null)}>Salir</button>
            </div>
          </nav>
        </header>
        <main className="cnt">
          {pg === "reg" && <PgReg res={res} deleteReservation={deleteReservation} rooms={rooms} types={types} setModal={setModal} curUser={curUser} />}
          {pg === "disp" && <PgDisp rooms={rooms} types={types} res={res} hols={hols} calD={calD} setCalD={setCalD} />}
          {pg === "cal" && <PgCal hols={hols} addHoliday={addHoliday} updateHoliday={updateHoliday} deleteHoliday={deleteHoliday} />}
          {pg === "hab" && <PgHab rooms={rooms} updateRoom={updateRoom} deleteRoom={deleteRoom} types={types} updateType={updateType} sel={selR} setSel={setSelR} setModal={setModal} />}
          {pg === "lim" && <PgLim rooms={rooms} types={types} res={res} cln={clnOverrides} markCleaningDone={markCleaningDone} curUser={curUser} />}
        </main>
        {modal?.t === "res" && (
          <MdlRes data={modal.d} rooms={rooms} types={types} curUser={curUser} users={users} onSave={(d) => {
            if (modal.d) { updateReservation(modal.d.id, { ...modal.d, ...d }); }
            else { addReservation(d); }
            setModal(null);
          }} onClose={() => setModal(null)} />
        )}
        {modal?.t === "addRoom" && (
          <MdlAddRm types={types} onSave={(d) => { addRoom(d); setModal(null); }} onClose={() => setModal(null)} />
        )}
        {modal?.t === "addType" && (
          <MdlAddType onSave={(d) => { addType(d); setModal(null); }} onClose={() => setModal(null)} />
        )}
      </div>
    </>
  );
}

/* ═══ REGISTRO — with date-based stats & add type ═══ */
function PgReg({ res, deleteReservation, rooms, types, setModal, curUser }) {
  const [q, sQ] = useState("");
  const [sf, sSf] = useState("all");
  const [statsDate, setStatsDate] = useState(TODAY);

  const dateCounts = useMemo(() => countByDate(rooms, res, statsDate), [rooms, res, statsDate]);

  const fl = useMemo(() => res.filter((r) => {
    if (sf !== "all" && r.state !== sf) return false;
    if (q) {
      const s = q.toLowerCase();
      return r.guest.toLowerCase().includes(s) || r.id.toLowerCase().includes(s) || r.doc.includes(s) || r.roomId.includes(s);
    }
    return true;
  }), [res, q, sf]);

  return (
    <div className="fi">
      <div className="pt">
        <h2 className="ptt">Registro de Huéspedes</h2>
        <div className="ptr">
          <div className="sb"><span className="si">🔍</span><input placeholder="Buscar..." value={q} onChange={(e) => sQ(e.target.value)} /></div>
          <button className="ba" onClick={() => setModal({ t: "res", d: null })}>+ Nueva Reserva</button>
        </div>
      </div>

      {/* Date-based stats */}
      <div className="stats-date-row">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Estado al:</span>
        <input type="date" value={statsDate} onChange={(e) => setStatsDate(e.target.value)} style={{ width: 150 }} />
        {statsDate !== TODAY && <button className="bc bsm" onClick={() => setStatsDate(TODAY)}>Hoy</button>}
      </div>
      <div className="sr">
        <div className="sc"><div className="sn">{rooms.length}</div><div className="sl">Total Hab.</div></div>
        <div className="sc srd"><div className="sn">{dateCounts.occ}</div><div className="sl">Hospedados</div></div>
        <div className="sc sor"><div className="sn">{dateCounts.rsv}</div><div className="sl">Reservados</div></div>
        <div className="sc sgr"><div className="sn">{dateCounts.free}</div><div className="sl">Libres</div></div>
      </div>

      <div className="fr">
        {["all", ...RSTATES].map((s) => (
          <button key={s} className={"fb" + (sf === s ? " ac" : "")} onClick={() => sSf(s)}>
            {s === "all" ? "Todos" : s}
          </button>
        ))}
      </div>

      <div className="tw">
        <table className="tb">
          <thead><tr>
            <th>ID</th><th>Fecha Reg.</th><th>Por</th><th>Mod.</th><th>Huésped</th><th>DNI</th><th>Tel.</th><th>Canal</th><th>Tipo</th><th>Hab.</th><th>Pers.</th><th>Check-in</th><th>Check-out</th><th>Estado</th><th>Total</th><th>Adelantos</th><th>Saldo</th><th>Pago</th><th>Conformidad</th><th>Comentarios</th><th></th>
          </tr></thead>
          <tbody>
            {fl.length === 0 && <tr><td colSpan={21} className="empty">No hay reservas</td></tr>}
            {fl.map((r) => (
              <tr key={r.id}>
                <td className="tid">{r.id}</td>
                <td>{fmtD(r.created)}</td>
                <td style={{ fontSize: 11, color: "#888" }}>{r.createdBy || "—"}</td>
                <td style={{ fontSize: 11, color: "#888" }}>{r.lastModBy && r.lastModBy !== r.createdBy ? r.lastModBy : "—"}</td>
                <td className="tgst">{r.guest}</td>
                <td>{r.doc}</td>
                <td>{r.phone}</td>
                <td>{r.channel}</td>
                <td>{types.find((t) => t.id === r.roomType)?.name}</td>
                <td className="trm">{r.roomId}</td>
                <td style={{ textAlign: "center" }}>{r.persons}</td>
                <td>{fmtDT(r.checkin)}</td>
                <td>{fmtDT(r.checkout)}</td>
                <td><span className={"badge b-" + r.state.toLowerCase()}>{r.state}</span></td>
                <td className="tmny">S/ {r.total}</td>
                <td className="tmny">S/ {(r.advances || []).reduce((s2, a) => s2 + a.amount, 0) || r.advance || 0}</td>
                <td className={"tmny " + (r.balance > 0 ? "debt" : "paid")}>S/ {r.balance}</td>
                <td>{r.payment}</td>
                <td style={{ fontSize: 11 }}>
                  {(() => {
                    const pendAdv = (r.advances || []).some((a) => a.amount > 0 && !a.verifiedBy);
                    const pendCo = r.state === "Finalizado" && !r.checkoutVerifiedBy;
                    if (pendAdv || pendCo) return <span style={{ color: "#e67e22", fontWeight: 600 }}>⚠️ Por validar</span>;
                    if (r.state === "Finalizado" && r.checkoutVerifiedBy) return <span style={{ color: "#27ae60" }}>✅ {r.checkoutVerifiedBy}</span>;
                    const verified = (r.advances || []).filter((a) => a.verifiedBy);
                    if (verified.length > 0) return <span style={{ color: "#27ae60" }}>✅ Pagos OK</span>;
                    return <span style={{ color: "#999" }}>—</span>;
                  })()}
                </td>
                <td style={{ fontSize: 11, color: "#666", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }} title={r.comments}>{r.comments || "—"}</td>
                <td className="tact">
                  <button className="ab" onClick={() => setModal({ t: "res", d: r })}>✏️</button>
                  <button className="ab" onClick={() => { if (confirm("¿Eliminar " + r.id + "?")) deleteReservation(r.id); }}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══ ADD TYPE MODAL ═══ */
function MdlAddType({ onSave, onClose }) {
  const [f, sF] = useState({ name: "", base: 100, high: 150, cap: 2 });
  return (
    <div className="mbg" onClick={onClose}>
      <div className="mdl ms" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo Tipo de Habitación</h3>
        <div className="fg">
          <Fld label="Nombre del tipo" value={f.name} onChange={(v) => sF({ ...f, name: v })} />
          <Fld label="Precio Normal S/" type="number" min={0} value={f.base} onChange={(v) => sF({ ...f, base: v })} />
          <Fld label="Precio Alta S/" type="number" min={0} value={f.high} onChange={(v) => sF({ ...f, high: v })} />
          <Fld label="Capacidad" type="number" min={1} value={f.cap} onChange={(v) => sF({ ...f, cap: v })} />
        </div>
        <div className="mf">
          <button className="bc" onClick={onClose}>Cancelar</button>
          <button className="ba" onClick={() => { if (!f.name) return alert("Ingresa el nombre del tipo"); onSave({ id: f.name.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now(), name: f.name, base: +f.base, high: +f.high, cap: +f.cap }); }}>Crear Tipo</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ RESERVATION MODAL ═══ */
function MdlRes({ data, rooms, types, curUser, users, onSave, onClose }) {
  const AUTH_USERS = (users || []).filter((u) => ["ivanaberrocal", "marianelatinoco", "dafnaberrocal"].includes(u.user));
  const initAdvances = (d) => {
    if (d && d.advances && d.advances.length > 0) return d.advances;
    if (d && d.advance > 0) return [{ amount: d.advance, verifiedBy: "", verifiedUser: "", date: d.created || TODAY }];
    return [];
  };
  const [f, sF] = useState(() => {
    const d = data || {
      guest: "", doc: "", phone: "", email: "", channel: "WhatsApp",
      roomType: types[0]?.id || "", roomId: rooms[0]?.id || "",
      persons: 1, ciDate: "", ciTime: "13:00", coDate: "", coTime: "12:00",
      checkin: "", checkout: "", state: "Reservado",
      total: 0, advance: 0, balance: 0, payment: "Efectivo", comments: "",
      checkoutVerifiedBy: "", checkoutVerifiedUser: "", advances: [],
      lastModBy: ""
    };
    if (d.checkin && !d.ciDate) { const p2 = d.checkin.split("T"); d.ciDate = p2[0] || ""; d.ciTime = (p2[1] || "13:00").substring(0, 5); }
    if (d.checkout && !d.coDate) { const p2 = d.checkout.split("T"); d.coDate = p2[0] || ""; d.coTime = (p2[1] || "12:00").substring(0, 5); }
    return { ...d, checkoutVerifiedBy: d.checkoutVerifiedBy || "", checkoutVerifiedUser: d.checkoutVerifiedUser || "" };
  });
  const [advs, setAdvs] = useState(() => initAdvances(data));
  const [coVerified, setCoVerified] = useState({ by: data?.checkoutVerifiedBy || "", user: data?.checkoutVerifiedUser || "" });
  const [authModal, setAuthModal] = useState(null);
  const [authU, setAuthU] = useState("");
  const [authP, setAuthP] = useState("");
  const [authErr, setAuthErr] = useState("");

  const totalAdv = advs.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
  const balance = (Number(f.total) || 0) - totalAdv;

  const s = (k, v) => {
    const u = { ...f, [k]: v };
    if (k === "roomType") { const ar = rooms.filter((r) => r.type === v); if (ar.length) u.roomId = ar[0].id; }
    sF(u);
  };

  const addAdv = () => {
    if (advs.length >= 4) return alert("Máximo 4 adelantos");
    setAdvs((p) => [...p, { amount: 0, verifiedBy: "", verifiedUser: "", date: TODAY }]);
  };
  const updAdv = (i, key, val) => setAdvs((p) => p.map((a, j) => j === i ? { ...a, [key]: val } : a));
  const rmAdv = (i) => setAdvs((p) => p.filter((_, j) => j !== i));

  const startAuth = (type, index) => { setAuthModal({ type, index }); setAuthU(""); setAuthP(""); setAuthErr(""); };
  const confirmAuth = () => {
    const found = AUTH_USERS.find((x) => x.user === authU && x.pass === authP);
    if (!found) { setAuthErr("Credenciales incorrectas o usuario no autorizado"); return; }
    if (authModal.type === "adv") {
      updAdv(authModal.index, "verifiedBy", found.name);
      updAdv(authModal.index, "verifiedUser", found.user);
    } else if (authModal.type === "checkout") {
      setCoVerified({ by: found.name, user: found.user });
    }
    setAuthModal(null);
  };

  const sv = () => {
    if (!f.guest || !f.doc || !f.ciDate || !f.coDate) return alert("Completa campos obligatorios (nombre, DNI, fechas)");
    const checkin = f.ciDate + "T" + (f.ciTime || "13:00");
    const checkout = f.coDate + "T" + (f.coTime || "12:00");
    // Allow saving WITHOUT verification — verification is optional but tracked
    // Only block finalization if balance > 0
    if (f.state === "Finalizado" && balance > 0) {
      return alert("No se puede finalizar: saldo pendiente S/ " + balance + ". Registra los pagos primero.");
    }
    onSave({
      ...f, checkin, checkout,
      advances: advs.map((a) => ({ ...a, amount: Number(a.amount) || 0 })),
      advance: totalAdv, balance: balance, total: +f.total,
      lastModBy: curUser.name,
      checkoutVerifiedBy: coVerified.by,
      checkoutVerifiedUser: coVerified.user
    });
  };

  const frms = rooms.filter((r) => r.type === f.roomType);
  const roomOpts = frms.length ? frms.map((r) => ({ v: r.id, l: r.name })) : rooms.map((r) => ({ v: r.id, l: r.name }));
  const showCoVerify = f.state === "Finalizado";
  const isAuth = AUTH_USERS.some((au) => au.user === curUser.user);

  return (
    <div className="mbg" onClick={onClose}>
      <div className="mdl" style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <h3>{data ? "Editar " + data.id : "Nueva Reserva"}</h3>
        <p style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
          Registrado por: <strong>{data?.createdBy || curUser.name}</strong>
          {data?.lastModBy && data.lastModBy !== data.createdBy && <span> · Mod: <strong>{data.lastModBy}</strong></span>}
        </p>
        <div className="fg">
          <Fld label="Nombre *" value={f.guest} onChange={(v) => s("guest", v)} />
          <Fld label="DNI *" value={f.doc} onChange={(v) => s("doc", v)} />
          <Fld label="Teléfono" value={f.phone} onChange={(v) => s("phone", v)} />
          <Fld label="Email" value={f.email} onChange={(v) => s("email", v)} />
          <Fld label="Canal" type="select" opts={CHANNELS} value={f.channel} onChange={(v) => s("channel", v)} />
          <Fld label="Tipo Hab." type="select" opts={types.map((t) => ({ v: t.id, l: t.name }))} value={f.roomType} onChange={(v) => s("roomType", v)} />
          <Fld label="Habitación" type="select" opts={roomOpts} value={f.roomId} onChange={(v) => s("roomId", v)} />
          <Fld label="Personas" type="number" min={1} value={f.persons} onChange={(v) => s("persons", v)} />
          <Fld label="Fecha Check-in *" type="date" value={f.ciDate} onChange={(v) => s("ciDate", v)} />
          <Fld label="Hora Check-in" type="time" value={f.ciTime} onChange={(v) => s("ciTime", v)} />
          <Fld label="Fecha Check-out *" type="date" value={f.coDate} onChange={(v) => s("coDate", v)} />
          <Fld label="Hora Check-out" type="time" value={f.coTime} onChange={(v) => s("coTime", v)} />
          <Fld label="Estado" type="select" opts={RSTATES} value={f.state} onChange={(v) => s("state", v)} />
          <Fld label="Pago" type="select" opts={PAYS} value={f.payment} onChange={(v) => s("payment", v)} />
          {advs.some((a) => a.verifiedBy) && !isAuth
            ? <div className="fld"><label>Total S/ 🔒</label><input type="number" value={f.total} readOnly style={{ background: "#f0f0f0", cursor: "not-allowed" }} /></div>
            : <Fld label="Total S/" type="number" min={0} value={f.total} onChange={(v) => s("total", v)} />
          }
        </div>

        {/* ADELANTOS */}
        <div style={{ marginTop: 14, padding: 12, background: "#f9f7f4", borderRadius: 8, border: "1px solid #e0dcd6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#6B3410" }}>💵 ADELANTOS ({advs.length}/4)</span>
            {advs.length < 4 && <button className="ba bsm" onClick={addAdv}>+ Adelanto</button>}
          </div>
          {advs.length === 0 && <p style={{ fontSize: 12, color: "#999" }}>Sin adelantos registrados</p>}
          {advs.map((a, i) => {
            const locked = a.verifiedBy && !isAuth;
            return (
            <div key={i} className="adv-row" style={locked ? { opacity: 0.85 } : {}}>
              <div className="adv-num">#{i + 1}</div>
              <div className="fld" style={{ flex: 1 }}>
                <label>Monto S/{locked ? " 🔒" : ""}</label>
                <input type="number" min={0} value={a.amount} readOnly={locked} style={locked ? { background: "#f0f0f0", cursor: "not-allowed" } : {}} onChange={(e) => updAdv(i, "amount", e.target.value)} />
              </div>
              <div style={{ flex: 1.3, display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: ".3px" }}>Conformidad</label>
                {a.verifiedBy
                  ? <span style={{ fontSize: 12, color: "#27ae60", fontWeight: 600, padding: "7px 0" }}>✅ {a.verifiedBy}</span>
                  : Number(a.amount) > 0
                    ? <button className="bc bsm" style={{ fontSize: 11 }} onClick={() => startAuth("adv", i)}>🔐 Validar pago</button>
                    : <span style={{ fontSize: 11, color: "#999", padding: "7px 0" }}>—</span>
                }
              </div>
              {locked
                ? <span style={{ marginTop: 16, fontSize: 10, color: "#999", width: 24, textAlign: "center" }}>🔒</span>
                : <button className="ab" style={{ marginTop: 16 }} onClick={() => rmAdv(i)}>🗑️</button>
              }
            </div>
            );
          })}
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, fontWeight: 600 }}>
            <span>Total adelantos: <span style={{ color: "#27ae60" }}>S/ {totalAdv}</span></span>
            <span>Saldo: <span style={{ color: balance > 0 ? "#c0392b" : "#27ae60" }}>S/ {balance}</span></span>
          </div>
        </div>

        {/* CHECKOUT VERIFICATION */}
        {showCoVerify && (
          <div style={{ marginTop: 14, background: coVerified.by ? "#e8f5e9" : "#fff8e1", padding: 12, borderRadius: 8, border: "1px solid " + (coVerified.by ? "#a5d6a7" : "#ffe082") }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: coVerified.by ? "#2e7d32" : "#e65100" }}>
              {coVerified.by ? "✅ CHECKOUT VERIFICADO" : "⚠️ VERIFICACIÓN DE CHECKOUT"}
            </span>
            {balance > 0 && <p style={{ fontSize: 12, color: "#c0392b", marginTop: 4 }}>Saldo pendiente: S/ {balance}</p>}
            {coVerified.by
              ? <p style={{ fontSize: 12, color: "#2e7d32", marginTop: 4 }}>Verificado por: <strong>{coVerified.by}</strong></p>
              : <div style={{ marginTop: 8 }}><button className="bc bsm" onClick={() => startAuth("checkout")}>🔐 Validar checkout</button></div>
            }
          </div>
        )}
        {!showCoVerify && data?.checkoutVerifiedBy && (
          <div style={{ marginTop: 10, background: "#e8f5e9", padding: 10, borderRadius: 8, border: "1px solid #a5d6a7" }}>
            <span style={{ color: "#2e7d32", fontSize: 12 }}>✅ Checkout verificado por: {data.checkoutVerifiedBy}</span>
          </div>
        )}

        <div className="fld fw" style={{ marginTop: 10 }}><label>Comentarios</label><textarea value={f.comments} onChange={(e) => s("comments", e.target.value)} /></div>
        <div className="mf"><button className="bc" onClick={onClose}>Cancelar</button><button className="ba" onClick={sv}>{data ? "Guardar" : "Crear"}</button></div>

        {/* AUTH SUB-MODAL */}
        {authModal && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, zIndex: 10 }}>
            <div style={{ background: "#fff", padding: 24, borderRadius: 8, width: 320, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }} onClick={(e) => e.stopPropagation()}>
              <h4 style={{ fontSize: 14, marginBottom: 4, color: "#6B3410" }}>🔐 Validar {authModal.type === "checkout" ? "Checkout" : "Adelanto #" + (authModal.index + 1)}</h4>
              <p style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>Solo usuarios autorizados pueden dar conformidad de pago</p>
              <div className="fld"><label>Usuario autorizado</label><input value={authU} onChange={(e) => { setAuthU(e.target.value); setAuthErr(""); }} placeholder="usuario" /></div>
              <div className="fld" style={{ marginTop: 8 }}><label>Contraseña</label><input type="password" value={authP} onChange={(e) => { setAuthP(e.target.value); setAuthErr(""); }} placeholder="contraseña" onKeyDown={(e) => e.key === "Enter" && confirmAuth()} /></div>
              {authErr && <p style={{ color: "#c0392b", fontSize: 11, marginTop: 6 }}>{authErr}</p>}
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="ba bsm" onClick={confirmAuth}>Confirmar</button>
                <button className="bc bsm" onClick={() => setAuthModal(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ DISPONIBILIDAD — real-time hours ═══ */
function PgDisp({ rooms, types, res, hols, calD, setCalD }) {
  const days = useMemo(() => { const r = []; for (let i = -3; i <= 4; i++) r.push(addD(calD, i)); return r; }, [calD]);
  const [dispInput, setDispInput] = useState(() => { const p = calD.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; });
  const [tt, sTt] = useState(null);
  const sl = (s) => (s === "occ" ? "OCUPADO" : s === "res" ? "RESERVADO" : "LIBRE");
  const sc = (s) => (s === "occ" ? "co" : s === "res" ? "cr" : "cf");

  const applyDate = (val) => {
    setDispInput(val);
    const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) { setCalD(m[3] + "-" + m[2] + "-" + m[1]); }
  };
  const onDateBlur = () => { const p = calD.split("-"); setDispInput(p[2] + "/" + p[1] + "/" + p[0]); };
  const navDate = (offset) => { const nd = addD(calD, offset); setCalD(nd); const p = nd.split("-"); setDispInput(p[2] + "/" + p[1] + "/" + p[0]); };

  return (
    <div className="fi">
      <div className="pt">
        <h2 className="ptt">Disponibilidad de Habitaciones</h2>
        <div className="ptr">
          <span style={{ fontSize: 13, color: "#666" }}>Consultar fecha:</span>
          <input className="di" value={dispInput} onChange={(e) => applyDate(e.target.value)} onBlur={onDateBlur} placeholder="dd/mm/yyyy" style={{ width: 120, textAlign: "center" }} />
        </div>
      </div>
      <div className="lr">
        <span className="li"><span className="ld dg" />Libre</span>
        <span className="li"><span className="ld dor" />Reservado</span>
        <span className="li"><span className="ld dr" />Ocupado</span>
        <span className="lnfo">3 días antes y 4 días después de la fecha consultada</span>
      </div>
      <div className="as">
        <div className="anb apl" onClick={() => navDate(-7)}>‹</div>
        <div className="anb anr" onClick={() => navDate(7)}>›</div>
        <table className="at">
          <thead><tr>
            <th className="ath-r">Hab.</th><th className="ath-t">Tipo</th>
            {days.map((d) => (
              <th key={d} className={"ath-d" + (d === TODAY ? " aty" : "") + (d === calD ? " aty" : "") + (isHol(d, hols) ? " athol" : "")}>
                <span className="adw">{dwk(d)}</span>
                <span className="adn">{String(dnum(d)).padStart(2, "0")}/{msh(d)}</span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rooms.map((rm) => {
              const tp = types.find((t) => t.id === rm.type);
              return (
                <tr key={rm.id}>
                  <td className="avr">{rm.name}</td>
                  <td className="avt">{tp?.name}</td>
                  {days.map((d) => {
                    const { am, pm, ar, pr } = roomSt(rm.id, d, res);
                    const spl = am !== pm;
                    const mE = (e) => {
                      const rc = e.currentTarget.getBoundingClientRect();
                      let tx = "Hab. " + rm.name + " — " + d;
                      if (spl) {
                        tx += "\nAM: " + sl(am) + (ar ? " — " + ar.guest + " (hasta " + getTime(ar.checkout) + ")" : "");
                        tx += "\nPM: " + sl(pm) + (pr ? " — " + pr.guest + " (desde " + getTime(pr.checkin) + ")" : "");
                      } else {
                        tx += "\nEstado: " + sl(am);
                        if (ar) tx += "\nHuésped: " + ar.guest + "\nCheck-in: " + fmtDT(ar.checkin) + "\nCheck-out: " + fmtDT(ar.checkout);
                      }
                      sTt({ x: rc.left + rc.width / 2, y: rc.top - 4, tx });
                    };
                    if (spl) {
                      return (
                        <td key={d} className="avsp" onMouseEnter={mE} onMouseLeave={() => sTt(null)}>
                          <div className="spw">
                            <div className={"sph " + sc(am)}><span className="cl">{sl(am)}</span>{ar && <span className="cgs">{ar.guest.split(" ")[0]}</span>}</div>
                            <div className={"sph " + sc(pm)}><span className="cl">{sl(pm)}</span>{pr && <span className="cgs">{pr.guest.split(" ")[0]}</span>}</div>
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={d} className={"avc " + sc(am)} onMouseEnter={mE} onMouseLeave={() => sTt(null)}>
                        <span className="cl">{sl(am)}</span>{ar && <span className="cgs">{ar.guest.split(" ")[0]}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tt && <div className="ttp" style={{ left: tt.x, top: tt.y }}>{tt.tx.split("\n").map((l, i) => <div key={i}>{l}</div>)}</div>}
    </div>
  );
}

/* ═══ CALENDARIO + FESTIVIDADES ═══ */
function PgCal({ hols, addHoliday, updateHoliday, deleteHoliday }) {
  const [yr, setYr] = useState(2026);
  const [edH, sEdH] = useState(null);
  const [fm, sFm] = useState({ name: "", s: "", e: "", icon: "🎉" });
  const ics = ["🎉", "✝️", "🇵🇪", "🎄", "🎃", "🌸", "⭐", "🎵", "🏛️", "🎆", "☀️", "🕯️", "🏖️", "🎭"];
  const saveH = () => {
    if (!fm.name || !fm.s || !fm.e) return alert("Completa todo");
    if (edH === "new") addHoliday({ ...fm, id: "h" + Date.now() });
    else updateHoliday(edH, fm);
    sEdH(null);
  };
  return (
    <div className="fi">
      <div className="pt">
        <h2 className="ptt">Calendario Anual</h2>
        <div className="ptr">
          <button className="bc bsm" onClick={() => setYr(yr - 1)}>◀ {yr - 1}</button>
          <button className="bc bsm" onClick={() => setYr(yr + 1)}>{yr + 1} ▶</button>
        </div>
      </div>
      <div className="cyh">{yr}</div>
      <div className="cyg">
        {Array.from({ length: 12 }, (_, m) => {
          const wks = buildMonth(yr, m);
          return (
            <div key={m} className="cmc">
              <div className="cmt">{MN[m]}</div>
              <table className="cmtb">
                <thead><tr>{DW.map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>
                  {wks.map((w, wi) => (
                    <tr key={wi}>
                      {w.map((day, di) => {
                        if (day === null) return <td key={di} className="cd-empty" />;
                        const ds = yr + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
                        const hh = holsOn(ds, hols);
                        const ih = hh.length > 0;
                        const we = di >= 5;
                        const isT = ds === TODAY;
                        return (
                          <td key={di} className={"cd" + (ih ? " cd-hol" : "") + (we && !ih ? " cd-we" : "") + (isT ? " cd-today" : "")} title={ih ? hh.map((x) => x.icon + " " + x.name).join(", ") : ""}>
                            <span className="cd-num">{day}</span>
                            {ih && <span className="cd-ico">{hh.map((x) => x.icon).join("")}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <div className="clg">
        <span className="clgi"><span className="ld dg" />Normal</span>
        <span className="clgi"><span className="ld dr" />Festividad</span>
        <span className="clgi"><span className="ld" style={{ background: "#8B4513" }} />Hoy</span>
      </div>
      {/* Festividades */}
      <div className="crd" style={{ marginTop: 20 }}>
        <div className="pt" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 16 }}>🎉 Gestión de Festividades</h3>
          <button className="ba bsm" onClick={() => { sEdH("new"); sFm({ name: "", s: "", e: "", icon: "🎉" }); }}>+ Nueva</button>
        </div>
        {edH && (
          <div style={{ background: "#f9f7f4", padding: 16, borderRadius: 8, marginBottom: 16, border: "1px solid #e0dcd6" }}>
            <h4 style={{ fontSize: 14, marginBottom: 10 }}>{edH === "new" ? "Nueva Festividad" : "Editar"}</h4>
            <div className="fg">
              <Fld label="Nombre" value={fm.name} onChange={(v) => sFm({ ...fm, name: v })} />
              <Fld label="Inicio" type="date" value={fm.s} onChange={(v) => sFm({ ...fm, s: v })} />
              <Fld label="Fin" type="date" value={fm.e} onChange={(v) => sFm({ ...fm, e: v })} />
              <div className="fld"><label>Ícono</label><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{ics.map((i) => <button key={i} className={"ib" + (fm.icon === i ? " ac" : "")} onClick={() => sFm({ ...fm, icon: i })}>{i}</button>)}</div></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="ba bsm" onClick={saveH}>Guardar</button><button className="bc bsm" onClick={() => sEdH(null)}>Cancelar</button></div>
          </div>
        )}
        {hols.map((h) => (
          <div key={h.id} className="fest-row">
            <span style={{ fontSize: 20 }}>{h.icon}</span>
            <div style={{ flex: 1 }}><strong>{h.name}</strong><span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>{h.s} → {h.e}</span></div>
            <button className="ab" onClick={() => { sEdH(h.id); sFm({ ...h }); }}>✏️</button>
            <button className="ab" onClick={() => { if (confirm("¿Eliminar " + h.name + "?")) deleteHoliday(h.id); }}>🗑️</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ HABITACIONES + TARIFARIO ═══ */
function PgHab({ rooms, updateRoom, deleteRoom, types, updateType, sel, setSel, setModal }) {
  const [ob, sOb] = useState("");
  const fr = useRef();
  const s = rooms.find((r) => r.id === sel);
  const tp = s ? types.find((t) => t.id === s.type) : null;
  const [edTar, sEdTar] = useState(false);
  const [tarFm, sTarFm] = useState({});
  const aO = () => { if (!ob.trim() || !sel) return; const rm = rooms.find((r) => r.id === sel); updateRoom(sel, { ...rm, obs: [...rm.obs, { text: ob.trim(), date: TODAY }] }); sOb(""); };
  const hP = (e) => { const f2 = e.target.files[0]; if (!f2 || !sel) return; const rd = new FileReader(); rd.onload = (ev) => { const rm = rooms.find((r) => r.id === sel); updateRoom(sel, { ...rm, photos: [...rm.photos, { id: Date.now(), url: ev.target.result }] }); }; rd.readAsDataURL(f2); e.target.value = ""; };

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">Habitaciones & Tarifario</h2><div className="ptr"><button className="ba" onClick={() => setModal({ t: "addRoom" })}>+ Habitación</button><button className="bc bsm" onClick={() => setModal({ t: "addType" })}>+ Tipo Hab.</button></div></div>
      <div className="rg">
        {rooms.map((r) => {
          const t2 = types.find((t) => t.id === r.type);
          return (
            <div key={r.id} className={"rc" + (sel === r.id ? " ac" : "")} onClick={() => { setSel(r.id); sEdTar(false); }}>
              <div className="rn">{r.name}</div><div className="rtl">{t2?.name}</div><div className="rmeta">Piso {r.floor}</div>
            </div>
          );
        })}
      </div>
      {s && (
        <div className="hab-detail">
          <div className="hab-left">
            <div className="crd">
              <h4 style={{ fontSize: 15, marginBottom: 10, color: "#6B3410" }}>📸 Fotos — Hab. {s.name}</h4>
              <input type="file" accept="image/*" ref={fr} style={{ display: "none" }} onChange={hP} />
              <div className="phg">
                {s.photos.map((p2) => (
                  <div key={p2.id} className="pht"><img src={p2.url} alt="" /><button className="phr" onClick={() => { const rm = rooms.find((r) => r.id === sel); updateRoom(sel, { ...rm, photos: rm.photos.filter((x) => x.id !== p2.id) }); }}>×</button></div>
                ))}
                <div className="pha" onClick={() => fr.current?.click()}>📷 Subir foto</div>
              </div>
            </div>
            <div className="crd">
              <h4 style={{ fontSize: 15, marginBottom: 10, color: "#6B3410" }}>📝 Observaciones</h4>
              <div style={{ display: "flex", gap: 8 }}><input value={ob} onChange={(e) => sOb(e.target.value)} placeholder="Ej: Enchufe suelto..." onKeyDown={(e) => e.key === "Enter" && aO()} style={{ flex: 1 }} /><button className="ba bsm" onClick={aO}>Agregar</button></div>
              <div className="obl">
                {s.obs.map((o, i) => (
                  <div key={i} className="obi"><span style={{ flex: 1 }}>{o.text}</span><span style={{ fontSize: 11, color: "#aaa" }}>{o.date}</span><button className="ab" onClick={() => { const rm = rooms.find((r) => r.id === sel); updateRoom(sel, { ...rm, obs: rm.obs.filter((_, j) => j !== i) }); }}>×</button></div>
                ))}
                {s.obs.length === 0 && <p style={{ color: "#aaa", fontSize: 13, marginTop: 8 }}>Sin observaciones</p>}
              </div>
            </div>
          </div>
          <div className="hab-right">
            <div className="crd">
              <h4 style={{ fontSize: 15, marginBottom: 10, color: "#6B3410" }}>💰 Tarifa — {tp?.name}</h4>
              {edTar ? (
                <div>
                  <div className="fg">
                    <Fld label="Nombre" value={tarFm.name} onChange={(v) => sTarFm({ ...tarFm, name: v })} />
                    <Fld label="Normal S/" type="number" value={tarFm.base} onChange={(v) => sTarFm({ ...tarFm, base: v })} />
                    <Fld label="Alta S/" type="number" value={tarFm.high} onChange={(v) => sTarFm({ ...tarFm, high: v })} />
                    <Fld label="Capacidad" type="number" value={tarFm.cap} onChange={(v) => sTarFm({ ...tarFm, cap: v })} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="ba bsm" onClick={() => { updateType(tp.id, { ...tp, name: tarFm.name, base: +tarFm.base, high: +tarFm.high, cap: +tarFm.cap }); sEdTar(false); }}>Guardar</button>
                    <button className="bc bsm" onClick={() => sEdTar(false)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="tp-row">
                    <div className="tp-n"><div className="tp-l">Normal</div><div className="tp-v">S/{tp?.base}</div><div className="tp-s">por noche</div></div>
                    <div className="tp-h"><div className="tp-l">Alta demanda</div><div className="tp-v">S/{tp?.high}</div><div className="tp-s">por noche</div></div>
                  </div>
                  <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>Capacidad: {tp?.cap} persona{tp?.cap > 1 ? "s" : ""}</p>
                  <button className="btn-et" onClick={() => { sEdTar(true); sTarFm({ ...tp }); }}>✏️ Editar tarifa</button>
                </div>
              )}
            </div>
            <div className="crd">
              <h4 style={{ fontSize: 15, marginBottom: 10, color: "#6B3410" }}>ℹ️ Información</h4>
              <p style={{ fontSize: 13 }}>Hab. <strong>{s.name}</strong> — Piso {s.floor} — {tp?.name}</p>
              <button className="bd bsm" style={{ marginTop: 12 }} onClick={() => { if (confirm("¿Eliminar habitación " + s.name + "?")) { deleteRoom(sel); setSel(null); } }}>🗑️ Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MdlAddRm({ types, onSave, onClose }) {
  const [f, sF] = useState({ id: "", name: "", type: types[0]?.id || "", floor: 1 });
  return (
    <div className="mbg" onClick={onClose}>
      <div className="mdl ms" onClick={(e) => e.stopPropagation()}>
        <h3>Agregar Habitación</h3>
        <div className="fg">
          <Fld label="Número" value={f.id} onChange={(v) => sF({ ...f, id: v, name: v })} />
          <Fld label="Tipo" type="select" opts={types.map((t) => ({ v: t.id, l: t.name }))} value={f.type} onChange={(v) => sF({ ...f, type: v })} />
          <Fld label="Piso" type="number" min={1} value={f.floor} onChange={(v) => sF({ ...f, floor: +v })} />
        </div>
        <div className="mf"><button className="bc" onClick={onClose}>Cancelar</button><button className="ba" onClick={() => { if (!f.id) return alert("Ingresa número"); onSave(f); }}>Agregar</button></div>
      </div>
    </div>
  );
}

/* ═══ LIMPIEZA ═══
   - Parcial: days between checkin+1 and checkout-1
   - General: checkout day from 6am
   - Limpio: after staff marks it clean
   - "Verificar": rooms whose checkin is TODAY (just arrived)
*/
function PgLim({ rooms, types, res, cln, markCleaningDone, curUser }) {
  const [rn, sRn] = useState({});
  const getRn = (key) => rn[key] || "";
  const setRn = (key, val) => sRn((p) => ({ ...p, [key]: val }));

  // Rooms needing cleaning (parcial or general)
  const cleanList = useMemo(() => {
    const result = [];
    const hr = new Date().getHours();
    for (const room of rooms) {
      for (const r of res) {
        if (r.roomId !== room.id || (r.state !== "Hospedado" && r.state !== "Reservado")) continue;
        const ci = toDS(r.checkin);
        const co = toDS(r.checkout);
        let status = null;
        if (TODAY > ci && TODAY < co) status = "parcial";
        if (TODAY === co && hr >= 6) status = "general";
        if (TODAY === co && hr < 6) status = "parcial";
        if (status) result.push({ room, res: r, status, type: types.find((t) => t.id === room.type) });
      }
    }
    return result;
  }, [rooms, res, types]);

  // Rooms arriving today (checkin today) — verify section
  const verifyList = useMemo(() => {
    const result = [];
    for (const room of rooms) {
      for (const r of res) {
        if (r.roomId !== room.id || (r.state !== "Hospedado" && r.state !== "Reservado")) continue;
        if (toDS(r.checkin) === TODAY) result.push({ room, res: r, type: types.find((t) => t.id === room.type) });
      }
    }
    return result;
  }, [rooms, res, types]);

  const getEff = (roomId, autoStatus) => {
    const ov = cln[roomId];
    if (ov && ov.status === "limpio" && toDS(ov.at) === TODAY) return { status: "limpio", by: ov.by, user: ov.user || "" };
    return { status: autoStatus, by: null, user: "" };
  };

  const markClean = (roomId) => {
    const name = getRn("c_" + roomId).trim();
    if (!name) return alert("Ingresa el nombre del responsable");
    markCleaningDone(roomId, roomId, name, curUser.name);
    setRn("c_" + roomId, "");
  };

  const markVerify = (roomId) => {
    const name = getRn("v_" + roomId).trim();
    if (!name) return alert("Ingresa el nombre del responsable de verificar");
    markCleaningDone(roomId + "_verify", roomId, name, curUser.name);
    setRn("v_" + roomId, "");
  };

  const stInfo = {
    limpio: { label: "Limpio", color: "#27ae60", icon: "🟢" },
    parcial: { label: "Limpieza Parcial", color: "#e67e22", icon: "🟠" },
    general: { label: "Limpieza General", color: "#3498db", icon: "🔵" },
  };

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">Control de Limpieza</h2></div>
      <div className="sr">
        {Object.entries(stInfo).map(([k, v]) => {
          const c = cleanList.filter((cr) => getEff(cr.room.id, cr.status).status === k).length;
          return <div key={k} className="sc"><div className="sn">{c}</div><div className="sl">{v.icon} {v.label}</div></div>;
        })}
      </div>
      <div className="lr">
        <span className="li"><span className="ld" style={{ background: "#e67e22" }} />Parcial (no cambiar sábanas)</span>
        <span className="li"><span className="ld" style={{ background: "#3498db" }} />General (cambiar sábanas)</span>
        <span className="li"><span className="ld" style={{ background: "#27ae60" }} />Limpio</span>
      </div>

      {/* Main cleaning table */}
      {cleanList.length === 0 ? (
        <div className="crd" style={{ textAlign: "center", padding: 40, color: "#999" }}>No hay habitaciones que requieran limpieza hoy</div>
      ) : (
        <div className="tw">
          <table className="tb">
            <thead><tr><th>Hab.</th><th>Tipo</th><th>Huésped</th><th>Check-out</th><th>Estado</th><th>Responsable</th><th>Acción</th></tr></thead>
            <tbody>
              {cleanList.map(({ room, res: rv, status, type: tp }) => {
                const eff = getEff(room.id, status);
                const inf = stInfo[eff.status];
                return (
                  <tr key={room.id}>
                    <td className="trm">{room.name}</td>
                    <td>{tp?.name}</td>
                    <td className="tgst">{rv.guest}</td>
                    <td>{fmtDT(rv.checkout)}</td>
                    <td><span className="lim-badge" style={{ background: inf.color + "22", color: inf.color, borderColor: inf.color + "44" }}>{inf.icon} {inf.label}</span></td>
                    <td style={{ fontSize: 12 }}>{eff.by ? <span>✅ {eff.by} <span style={{ color: "#aaa", fontSize: 10 }}>(reg: {eff.user || curUser.name})</span></span> : "—"}</td>
                    <td>
                      {eff.status !== "limpio" ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input style={{ width: 110, fontSize: 11, padding: "4px 8px" }} placeholder="Responsable..." value={getRn("c_" + room.id)} onChange={(e) => setRn("c_" + room.id, e.target.value)} onKeyDown={(e) => e.key === "Enter" && markClean(room.id)} />
                          <button className="ba bsm" onClick={() => markClean(room.id)}>✓ Limpio</button>
                        </div>
                      ) : <span style={{ color: "#27ae60", fontWeight: 600, fontSize: 12 }}>✅ Listo</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Verify: rooms checking in today */}
      {verifyList.length > 0 && (
        <div className="crd" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 12, color: "#6B3410" }}>🔍 Verificar estado de limpieza — Ingresos de hoy</h3>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>Estas habitaciones se ocupan hoy. Verifica que estén listas para el huésped.</p>
          <div className="tw">
            <table className="tb">
              <thead><tr><th>Hab.</th><th>Tipo</th><th>Huésped</th><th>Check-in</th><th>Estado</th><th>Responsable</th><th>Acción</th></tr></thead>
              <tbody>
                {verifyList.map(({ room, res: rv, type: tp }) => {
                  const ov = cln[room.id + "_verify"];
                  const isClean = ov && ov.status === "limpio" && toDS(ov.at) === TODAY;
                  return (
                    <tr key={room.id}>
                      <td className="trm">{room.name}</td>
                      <td>{tp?.name}</td>
                      <td className="tgst">{rv.guest}</td>
                      <td>{fmtDT(rv.checkin)}</td>
                      <td>
                        {isClean
                          ? <span style={{ color: "#27ae60", fontWeight: 600, fontSize: 12 }}>🟢 Verificado</span>
                          : <span style={{ color: "#e67e22", fontWeight: 600, fontSize: 12 }}>⚠️ Pendiente</span>
                        }
                      </td>
                      <td style={{ fontSize: 12 }}>{isClean ? <span>✅ {ov.by}</span> : "—"}</td>
                      <td>
                        {!isClean ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input style={{ width: 110, fontSize: 11, padding: "4px 8px" }} placeholder="Responsable..." value={getRn("v_" + room.id)} onChange={(e) => setRn("v_" + room.id, e.target.value)} onKeyDown={(e) => e.key === "Enter" && markVerify(room.id)} />
                            <button className="ba bsm" onClick={() => markVerify(room.id)}>✓ Limpio</button>
                          </div>
                        ) : <span style={{ color: "#27ae60", fontWeight: 600, fontSize: 12 }}>✅ Listo</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ CSS ═══ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
:root{--a:#8B4513;--al:#A0522D;--ad:#6B3410;--hb:#3E2723;--ht:#FAEBD7;--bg:#f7f5f2;--cb:#fff;--tx:#2c2c2c;--ts:#666;--mu:#999;--bd:#e0dcd6;--rd:#c0392b;--rb:#fde8e5;--gn:#27ae60;--gb:#e8f8ee;--or:#e67e22;--ob:#fef3e2;--R:8px;--F:'Source Sans 3',sans-serif;--FD:'Libre Baskerville',Georgia,serif}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--F);background:var(--bg);color:var(--tx);line-height:1.5}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
input,select,textarea{font-family:var(--F);font-size:13px;background:#fff;border:1px solid var(--bd);color:var(--tx);padding:7px 10px;border-radius:var(--R);outline:none;width:100%;transition:border-color .2s}
input:focus,select:focus,textarea:focus{border-color:var(--a)}textarea{resize:vertical;min-height:60px}
button{font-family:var(--F);cursor:pointer;border:none;transition:all .15s}
.ba{background:var(--a);color:#fff;padding:8px 20px;border-radius:var(--R);font-weight:600;font-size:13px}.ba:hover{background:var(--al)}
.bc{background:#eee;color:var(--tx);padding:8px 20px;border-radius:var(--R);font-size:13px}.bc:hover{background:#ddd}
.bd{background:var(--rb);color:var(--rd);padding:6px 14px;border-radius:var(--R);font-size:12px;border:1px solid #f5c6cb}.bd:hover{background:#f5c6cb}
.bsm{padding:5px 12px;font-size:12px}.ab{background:none;border:none;padding:3px 6px;font-size:15px;cursor:pointer;opacity:.6}.ab:hover{opacity:1}
.login-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#3E2723 0%,#5D4037 50%,#3E2723 100%)}
.login-card{background:var(--cb);border-radius:12px;padding:36px;width:360px;box-shadow:0 12px 48px rgba(0,0,0,.3)}
.login-header{text-align:center;margin-bottom:24px}.login-header h1{font-family:var(--FD);font-size:22px;color:var(--ad);margin-top:8px}.login-header p{font-size:12px;color:var(--mu)}
.login-btn{width:100%;margin-top:16px;padding:12px;font-size:14px}
.login-err{color:var(--rd);font-size:12px;margin-top:8px;text-align:center}
.login-link{text-align:center;font-size:12px;color:var(--mu);margin-top:12px}.login-link span{color:var(--a);cursor:pointer;font-weight:600}.login-link span:hover{text-decoration:underline}
.hdr{background:var(--hb);color:var(--ht);padding:0 20px;display:flex;align-items:center;justify-content:space-between;min-height:56px;position:sticky;top:0;z-index:100;box-shadow:0 2px 12px rgba(0,0,0,.2)}
.hdr-l{display:flex;align-items:center;gap:10px}.hdr-ico{font-size:24px}.hdr-t{font-family:var(--FD);font-size:16px;font-weight:700;color:#FAEBD7}.hdr-s{font-size:10px;opacity:.7}
.hdr-nav{display:flex;gap:2px;flex-wrap:wrap;align-items:center}
.nv{background:transparent;color:rgba(250,235,215,.7);padding:7px 12px;border-radius:var(--R);font-size:12px;font-weight:500;display:flex;align-items:center;gap:4px;white-space:nowrap}
.nv:hover{background:rgba(255,255,255,.1);color:#FAEBD7}.nv.ac{background:rgba(255,255,255,.15);color:#fff;font-weight:600}.ni{font-size:13px}
.hdr-user{display:flex;align-items:center;gap:8px;margin-left:16px;padding-left:16px;border-left:1px solid rgba(255,255,255,.15)}
.hdr-uname{font-size:12px;color:rgba(250,235,215,.8)}.hdr-logout{background:rgba(255,255,255,.1);color:#FAEBD7;padding:4px 10px;border-radius:var(--R);font-size:11px}.hdr-logout:hover{background:rgba(255,255,255,.2)}
.cnt{max-width:1440px;margin:0 auto;padding:20px 24px 40px}
.pt{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px}
.ptt{font-family:var(--FD);font-size:20px;color:var(--tx)}.ptr{display:flex;align-items:center;gap:8px}
.sb{position:relative}.sb input{padding-left:32px;width:260px}.si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px}
.stats-date-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:var(--cb);border:1px solid var(--bd);border-radius:var(--R)}
.sr{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.sc{background:var(--cb);border:1px solid var(--bd);border-radius:var(--R);padding:12px 20px;min-width:110px;text-align:center;border-top:3px solid var(--bd)}
.srd{border-top-color:var(--rd)}.sor{border-top-color:var(--or)}.sgr{border-top-color:var(--gn)}.sac{border-top-color:var(--a)}
.sn{font-size:22px;font-weight:700}.sl{font-size:10px;color:var(--mu);text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
.fr{display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap}
.fb{background:var(--cb);border:1px solid var(--bd);padding:5px 14px;border-radius:20px;font-size:12px;color:var(--ts)}.fb.ac{background:var(--a);color:#fff;border-color:var(--a)}.fb:hover{border-color:var(--a)}
.tw{overflow-x:auto;border:1px solid var(--bd);border-radius:var(--R);background:var(--cb)}
.tb{width:100%;border-collapse:collapse;font-size:13px}
.tb thead{background:#f9f7f4}.tb th{padding:9px 10px;text-align:left;font-size:10px;font-weight:600;color:var(--ts);text-transform:uppercase;letter-spacing:.3px;border-bottom:2px solid var(--bd);white-space:nowrap}
.tb td{padding:9px 10px;border-bottom:1px solid #f0ece6;white-space:nowrap;vertical-align:middle}.tb tr:hover td{background:#faf8f5}
.tid{font-weight:700;color:var(--ad);font-size:12px}.tgst{font-weight:500}.trm{font-weight:700;font-size:14px}.tmny{font-weight:600}
.debt{color:var(--rd)}.paid{color:var(--gn)}.tact{white-space:nowrap}.empty{text-align:center;padding:32px;color:#999}
.badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;color:#fff}
.b-hospedado{background:var(--rd)}.b-reservado{background:var(--or)}.b-finalizado{background:var(--gn)}.b-cancelado{background:#aaa}
.crd{background:var(--cb);border:1px solid var(--bd);border-radius:var(--R);padding:20px;margin-bottom:16px}
.fg{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.fld{display:flex;flex-direction:column;gap:3px}.fld label{font-size:11px;font-weight:600;color:var(--ts);text-transform:uppercase;letter-spacing:.3px}.fw{grid-column:1/-1}
.mbg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000}
.mdl{background:var(--cb);border-radius:var(--R);width:90%;max-width:680px;max-height:85vh;overflow-y:auto;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.2)}
.ms{max-width:420px}.mdl h3{font-family:var(--FD);font-size:18px;color:var(--ad);margin-bottom:16px}
.mf{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--bd)}
.di{width:150px}
.lr{display:flex;gap:14px;align-items:center;margin-bottom:12px;flex-wrap:wrap;padding:8px 12px;background:var(--cb);border:1px solid var(--bd);border-radius:var(--R)}
.li{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:500}
.ld{width:14px;height:14px;border-radius:3px;display:inline-block}.dg{background:var(--gn)}.dor{background:var(--or)}.dr{background:var(--rd)}
.lnfo{font-size:11px;color:var(--mu);margin-left:auto;font-style:italic}
.as{overflow-x:auto;position:relative;border:1px solid var(--bd);border-radius:var(--R);background:var(--cb)}
.anb{position:absolute;top:50%;transform:translateY(-50%);width:30px;height:30px;background:var(--cb);border:1px solid var(--bd);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;z-index:10;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.anb:hover{background:var(--a);color:#fff}.apl{left:4px}.anr{right:4px}
.at{width:100%;border-collapse:collapse;min-width:1000px}.at th,.at td{border:1px solid #e8e4de}
.ath-r{padding:6px 10px;background:#f9f7f4;font-size:12px;font-weight:700;width:60px;text-align:center}
.ath-t{padding:6px 8px;background:#f9f7f4;font-size:10px;font-weight:500;width:60px;color:var(--ts)}
.ath-d{padding:5px 3px;background:#f9f7f4;text-align:center;min-width:80px}
.adw{display:block;font-size:9px;text-transform:lowercase;color:var(--mu)}.adn{display:block;font-size:11px;font-weight:700;color:var(--tx)}
.aty{background:#fdf2e4!important}.athol{background:var(--rb)!important}
.avr{font-size:13px;font-weight:700;text-align:center;padding:4px 6px;background:#faf8f5}
.avt{font-size:10px;color:var(--ts);text-align:center;padding:4px 4px;background:#faf8f5}
.avc{text-align:center;padding:5px 3px;vertical-align:middle;cursor:default}
.cf{background:var(--gb)}.co{background:var(--rb)}.cr{background:var(--ob)}
.cl{display:block;font-size:9px;font-weight:700;letter-spacing:.2px}
.cf .cl{color:var(--gn)}.co .cl{color:var(--rd)}.cr .cl{color:var(--or)}
.cgs{display:block;font-size:9px;font-weight:500;color:#555;margin-top:1px}
.avsp{padding:0!important}.spw{display:flex;height:100%;min-height:44px}
.sph{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 1px}
.ttp{position:fixed;transform:translate(-50%,-100%);background:var(--hb);color:var(--ht);padding:8px 12px;border-radius:var(--R);font-size:11px;line-height:1.6;white-space:pre-line;pointer-events:none;z-index:2000;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:300px}
.cyh{text-align:center;font-family:var(--FD);font-size:28px;font-weight:700;background:var(--gn);color:#fff;padding:10px;border-radius:var(--R);margin-bottom:16px}
.cyg{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.cmc{background:var(--cb);border:2px solid #2e7d32;border-radius:var(--R);overflow:hidden}
.cmt{background:#2e7d32;color:#fff;text-align:center;font-weight:700;font-size:12px;padding:5px;letter-spacing:1.5px}
.cmtb{width:100%;border-collapse:collapse}.cmtb th{font-size:9px;padding:4px 1px;color:var(--ts);text-align:center;background:#e8f5e9;border:1px solid #c8e6c9;font-weight:600}
.cmtb td{font-size:11px;padding:0;text-align:center;border:1px solid #e0e0e0;cursor:default;height:34px;vertical-align:middle}
.cd-empty{background:#fafafa}.cd:hover{background:#f0f0f0}
.cd-num{font-size:11px;display:block}.cd-ico{font-size:8px;display:block;line-height:1;margin-top:-1px}
.cd-hol{background:#ffcdd2!important;color:var(--rd)!important;font-weight:700}.cd-hol .cd-num{color:var(--rd)}
.cd-we{background:#f5f5f5;color:#888}.cd-today{background:#fdf2e4!important;outline:2px solid var(--a);outline-offset:-2px}.cd-today .cd-num{color:var(--a);font-weight:700}
.clg{display:flex;gap:16px;margin-top:14px;font-size:12px;flex-wrap:wrap;align-items:center}.clgi{display:flex;align-items:center;gap:5px}
.fest-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0ece6;font-size:13px}
.tp-row{display:flex;gap:8px;margin-top:8px}.tp-n,.tp-h{flex:1;padding:10px;border-radius:var(--R);text-align:center}
.tp-n{background:#f9f7f4}.tp-h{background:#fdf2e4;border:1px solid rgba(139,69,19,.2)}
.tp-l{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--mu)}.tp-v{font-size:20px;font-weight:700;color:var(--tx);margin-top:2px}.tp-h .tp-v{color:var(--a)}.tp-s{font-size:10px;color:var(--mu)}
.btn-et{margin-top:10px;background:none;border:1px solid var(--bd);padding:5px 12px;border-radius:var(--R);font-size:12px;color:var(--ts);width:100%}.btn-et:hover{border-color:var(--a);color:var(--a)}
.rg{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:16px}
.rc{background:var(--cb);border:1px solid var(--bd);border-radius:var(--R);padding:12px;cursor:pointer;text-align:center;transition:all .15s}
.rc:hover{border-color:var(--a);transform:translateY(-1px)}.rc.ac{border-color:var(--a);box-shadow:0 0 0 2px rgba(139,69,19,.2)}
.rn{font-family:var(--FD);font-size:22px;font-weight:700;color:var(--ad)}.rtl{font-size:11px;color:var(--ts)}.rmeta{font-size:10px;color:var(--mu);margin-top:2px}
.hab-detail{display:grid;grid-template-columns:1fr 320px;gap:16px}.hab-left{min-width:0}.hab-right{min-width:0}
.phg{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.pht{position:relative;aspect-ratio:4/3;border-radius:var(--R);overflow:hidden;background:#f0f0f0}.pht img{width:100%;height:100%;object-fit:cover}
.phr{position:absolute;top:3px;right:3px;background:rgba(0,0,0,.6);color:#fff;width:20px;height:20px;border-radius:50%;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:none}
.pha{aspect-ratio:4/3;border:2px dashed var(--bd);border-radius:var(--R);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:var(--mu)}.pha:hover{border-color:var(--a);color:var(--a)}
.obl{margin-top:8px}.obi{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f9f7f4;border-radius:var(--R);margin-bottom:4px;font-size:12px}
.lim-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid;white-space:nowrap}
.ib{width:30px;height:30px;border:1px solid var(--bd);border-radius:var(--R);background:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}.ib.ac{border-color:var(--a);background:#fdf2e4}
.adv-row{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:#f9f7f4;border-radius:var(--R);margin-bottom:6px;border:1px solid #e8e4de}
.adv-num{font-weight:700;color:var(--a);font-size:14px;min-width:24px;padding-top:18px}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fadeIn .25s ease-out}
@media(max-width:900px){.cyg{grid-template-columns:repeat(2,1fr)}.hab-detail{grid-template-columns:1fr}}
@media(max-width:768px){.hdr{flex-direction:column;padding:12px;gap:8px}.hdr-nav{justify-content:center;flex-wrap:wrap}.cnt{padding:12px}.fg{grid-template-columns:1fr}.sr{flex-wrap:wrap}}
@media(max-width:600px){.cyg{grid-template-columns:1fr}}
`;
