import { useState, useEffect, useMemo, useRef, useCallback } from "react";

const SUPABASE_URL = "https://mnaslqlkzavcmkipwalv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mxifxqVbzIw1LSzSDXUXkA_SZQigrOZ";

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

const CHANNELS = ["WhatsApp", "Booking", "Airbnb", "Directo", "Teléfono", "Otro"];
const PAYS = ["Efectivo", "Tarjeta", "Transferencia", "Yape", "Plin"];
const RSTATES = ["Reservado", "Hospedado", "Finalizado", "Cancelado"];
const toDS = (d) => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const addD = (ds, n) => { const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n); return toDS(d); };
const genId = () => "R-" + String(Math.floor(Math.random() * 900) + 100).padStart(3, "0");
const dwk = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short" });
const dnum = (ds) => new Date(ds + "T12:00:00").getDate();
const msh = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("es-PE", { month: "short" });
const MN = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const TODAY = toDS(new Date());

function fmtDT(dt) { if (!dt) return ""; const parts = dt.split("T"); const d = parts[0].split("-"); const t = parts.length > 1 ? parts[1].substring(0, 5) : ""; if (d.length < 3) return dt; return d[2] + "/" + d[1] + "/" + d[0] + (t ? ", " + t : ""); }
function getHour(dt) { if (!dt) return 13; const parts = dt.split("T"); if (parts.length < 2) return 13; return parseInt(parts[1].split(":")[0]) || 13; }
function getTime(dt) { if (!dt) return "13:00"; const parts = dt.split("T"); if (parts.length < 2) return "13:00"; return parts[1].substring(0, 5) || "13:00"; }

function roomSt(rid, ds, reservations) {
  let am = "free", pm = "free", ar = null, pr = null;
  for (const r of reservations) {
    if (r.roomId !== rid || r.state === "Cancelado" || r.state === "Finalizado") continue;
    const ci = toDS(r.checkin), co = toDS(r.checkout);
    const ciH = getHour(r.checkin), coH = getHour(r.checkout);
    const st = r.state === "Hospedado" ? "occ" : "res";
    if (co === ds) { if (coH > 12) { if (am === "free") { am = st; ar = r; } if (pm === "free") { pm = st; pr = r; } } else { if (am === "free") { am = st; ar = r; } } }
    if (ci === ds && co !== ds) { if (ciH <= 12) { if (am === "free") { am = st; ar = r; } if (pm === "free") { pm = st; pr = r; } } else { if (pm === "free") { pm = st; pr = r; } } }
    if (ci === ds && co === ds) { if (am === "free") { am = st; ar = r; } if (pm === "free") { pm = st; pr = r; } }
    if (ci < ds && co > ds) { if (am === "free") { am = st; ar = r; } if (pm === "free") { pm = st; pr = r; } }
  }
  return { am, pm, ar, pr };
}

function getFreeRoomsForMonth(rooms, reservations, year, month) {
  const dim = new Date(year, month + 1, 0).getDate();
  const freeRooms = [];
  for (const room of rooms) {
    let free = true;
    for (let d = 1; d <= dim; d++) {
      const ds = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      const { am, pm } = roomSt(room.id, ds, reservations);
      if (am !== "free" || pm !== "free") { free = false; break; }
    }
    if (free) freeRooms.push(room);
  }
  return freeRooms;
}

const holsOn = (ds, hs) => hs.filter((h) => ds >= h.s && ds <= h.e);
const isHol = (ds, hs) => holsOn(ds, hs).length > 0;

function Fld({ label, type = "text", opts, value, onChange, ro, min }) {
  return (<div className="fld"><label>{label}</label>
    {type === "select" ? (<select value={value} onChange={(e) => onChange(e.target.value)}>{(opts || []).map((o) => typeof o === "string" ? (<option key={o}>{o}</option>) : (<option key={o.v} value={o.v}>{o.l}</option>))}</select>) : (<input type={type} min={min} value={value || ""} readOnly={ro} style={ro ? { opacity: 0.6 } : {}} onChange={(e) => onChange(e.target.value)} />)}
  </div>);
}

const parseJ = (v) => { if (!v) return []; if (typeof v === "string") try { return JSON.parse(v); } catch { return []; } return v; };
const dbToRoom = (r) => ({ id: r.id, name: r.name, type: r.type_id, floor: r.floor, photos: parseJ(r.photos), obs: parseJ(r.observations) });
const dbToType = (t) => ({ id: t.id, name: t.name, base: Number(t.base_price), high: Number(t.high_price), beds15: Number(t.beds_plaza_media) || 0, beds2: Number(t.beds_dos_plazas) || 0, cap: (Number(t.beds_plaza_media) || 0) + 2 * (Number(t.beds_dos_plazas) || 0) });
const dbToHol = (h) => ({ id: h.id, name: h.name, s: h.start_date, e: h.end_date, icon: h.icon || "🎉" });
const dbToUser = (u) => ({ id: u.id, name: u.name, user: u.username, pass: u.password });
function dbToRes(r) {
  return { id: r.id, created: r.created_date, createdBy: r.created_by, lastModBy: r.last_mod_by || "", guest: r.guest, doc: r.doc, phone: r.phone, email: r.email || "", channel: r.channel || "Directo", roomType: r.room_type, roomId: r.room_id, persons: r.persons || 1, checkin: r.checkin, checkout: r.checkout, ciDate: r.ci_date, ciTime: r.ci_time || "13:00", coDate: r.co_date, coTime: r.co_time || "12:00", state: r.state || "Reservado", total: Number(r.total) || 0, advance: Number(r.advance) || 0, balance: Number(r.balance) || 0, payment: r.payment || "Efectivo", comments: r.comments || "", checkoutVerifiedBy: r.checkout_verified_by || "", checkoutVerifiedUser: r.checkout_verified_user || "", advances: typeof r.advances === "string" ? JSON.parse(r.advances || "[]") : (r.advances || []) };
}
function resToDb(r) {
  return { id: r.id, created_date: r.created, created_by: r.createdBy, last_mod_by: r.lastModBy || "", guest: r.guest, doc: r.doc, phone: r.phone, email: r.email || "", channel: r.channel, room_type: r.roomType, room_id: r.roomId, persons: r.persons || 1, checkin: r.checkin, checkout: r.checkout, ci_date: r.ciDate, ci_time: r.ciTime || "13:00", co_date: r.coDate, co_time: r.coTime || "12:00", state: r.state, total: r.total, advance: r.advance, balance: r.balance, payment: r.payment, comments: r.comments || "", checkout_verified_by: r.checkoutVerifiedBy || "", checkout_verified_user: r.checkoutVerifiedUser || "", advances: JSON.stringify(r.advances || []) };
}

/* Session persistence 20min */
const SESSION_KEY = "tinoco_session";
const SESSION_TIMEOUT = 20 * 60 * 1000;
function saveSession(user) { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user, ts: Date.now() })); } catch {} }
function loadSession() { try { const raw = localStorage.getItem(SESSION_KEY); if (!raw) return null; const s = JSON.parse(raw); if (Date.now() - s.ts > SESSION_TIMEOUT) { localStorage.removeItem(SESSION_KEY); return null; } return s.user; } catch { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

/* Notes persistence */
const NOTES_KEY = "tinoco_notes";
function loadNotes() { try { const r = localStorage.getItem(NOTES_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveNotes(notes) { try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch {} }

/* Towels persistence (daily) */
const TOWEL_KEY = "tinoco_towels";
function loadTowelData() { try { const r = localStorage.getItem(TOWEL_KEY); if (!r) return null; const d = JSON.parse(r); if (d.date !== TODAY) return null; return d; } catch { return null; } }
function saveTowelData(data) { try { localStorage.setItem(TOWEL_KEY, JSON.stringify({ ...data, date: TODAY })); } catch {} }

function useIsMobile(bp = 768) { const [m, sM] = useState(window.innerWidth <= bp); useEffect(() => { const h = () => sM(window.innerWidth <= bp); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [bp]); return m; }

function LoginPage({ users, onLogin }) {
  const [u, sU] = useState(""); const [p, sP] = useState(""); const [err, sErr] = useState("");
  const login = () => { const found = users.find((x) => x.user === u && x.pass === p); if (found) { onLogin(found); sErr(""); } else sErr("Usuario o contraseña incorrectos (" + users.length + " usuarios cargados)"); };
  const dbOk = users.length > 0;
  return (<div className="login-bg"><div className="login-card"><div className="login-header"><span style={{ fontSize: 36 }}>🏨</span><h1>Tinoco Apart Hotel</h1><p>Sistema de Gestión</p></div><div className="fld" style={{ marginBottom: 10 }}><label>Usuario</label><input value={u} onChange={(e) => { sU(e.target.value); sErr(""); }} placeholder="usuario" /></div><div className="fld" style={{ marginBottom: 10 }}><label>Contraseña</label><input type="password" value={p} onChange={(e) => { sP(e.target.value); sErr(""); }} placeholder="contraseña" onKeyDown={(e) => e.key === "Enter" && login()} /></div>{err && <p className="login-err">{err}</p>}<button className="ba login-btn" onClick={login}>Ingresar</button><div style={{ textAlign: "center", marginTop: 16 }}>{dbOk ? <span style={{ fontSize: 10, color: "#27ae60" }}>🟢 Conectado a Supabase ({users.length} usuarios)</span> : <span style={{ fontSize: 10, color: "#e67e22" }}>🟡 Esperando conexión a Supabase...</span>}</div></div></div>);
}

/* Main App */
export default function App() {
  const [configured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [curUser, setCurUser] = useState(() => loadSession());
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

  const handleLogin = (user) => { setCurUser(user); saveSession(user); };
  const handleLogout = () => { setCurUser(null); clearSession(); };

  useEffect(() => { if (!curUser) return; const refresh = () => saveSession(curUser); const evts = ["click","keydown","scroll","touchstart"]; evts.forEach(e => window.addEventListener(e, refresh, {passive:true})); return () => evts.forEach(e => window.removeEventListener(e, refresh)); }, [curUser]);

  const loadAll = useCallback(async () => {
    try {
      const [u, t, r, rv, h, c] = await Promise.all([sbRest("users","GET",null,"select=*"),sbRest("room_types","GET",null,"select=*"),sbRest("rooms","GET",null,"select=*"),sbRest("reservations","GET",null,"select=*"),sbRest("holidays","GET",null,"select=*"),sbRest("cleaning_overrides","GET",null,"select=*")]);
      if (u) setUsers(u.map(dbToUser)); if (t) setTypes(t.map(dbToType)); if (r) setRooms(r.map(dbToRoom)); if (rv) setRes(rv.map(dbToRes)); if (h) setHols(h.map(dbToHol));
      if (c) { const m = {}; c.forEach((row) => { m[row.override_key] = { key: row.override_key, roomId: row.room_id, status: row.status, by: row.done_by, at: row.done_at, user: row.registered_by }; }); setClnOverrides(m); }
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  }, []);

  useEffect(() => { if (!configured) return; loadAll(); pollRef.current = setInterval(loadAll, 8000); return () => clearInterval(pollRef.current); }, [configured, loadAll]);

  const addReservation = async (data) => { const nr = { ...data, id: genId(), created: TODAY, createdBy: curUser.name }; setRes((p) => [...p, nr]); await sbRest("reservations", "POST", [resToDb(nr)]); };
  const updateReservation = async (id, data) => { setRes((p) => p.map((r) => r.id === id ? { ...r, ...data } : r)); const d = resToDb(data); delete d.id; await sbRest("reservations", "PATCH", d, "id=eq." + id); };
  const deleteReservation = async (id) => { setRes((p) => p.filter((r) => r.id !== id)); await sbRest("reservations", "DELETE", null, "id=eq." + id); };
  const addRoom = async (data) => { const room = { ...data, photos: [], obs: [] }; setRooms((p) => [...p, room]); await sbRest("rooms", "POST", [{ id: room.id, name: room.name, type_id: room.type, floor: room.floor, photos: "[]", observations: "[]" }]); };
  const updateRoom = async (id, data) => { setRooms((p) => p.map((r) => r.id === id ? data : r)); await sbRest("rooms", "PATCH", { name: data.name, type_id: data.type, floor: data.floor, photos: JSON.stringify(data.photos || []), observations: JSON.stringify(data.obs || []) }, "id=eq." + id); };
  const deleteRoom = async (id) => { setRooms((p) => p.filter((r) => r.id !== id)); await sbRest("rooms", "DELETE", null, "id=eq." + id); };
  const addType = async (data) => { setTypes((p) => [...p, data]); await sbRest("room_types", "POST", [{ id: data.id, name: data.name, base_price: data.base, high_price: data.high, capacity: data.cap, beds_plaza_media: data.beds15, beds_dos_plazas: data.beds2 }]); };
  const updateType = async (id, data) => { setTypes((p) => p.map((t) => t.id === id ? { ...t, ...data } : t)); await sbRest("room_types", "PATCH", { name: data.name, base_price: data.base, high_price: data.high, capacity: data.cap, beds_plaza_media: data.beds15, beds_dos_plazas: data.beds2 }, "id=eq." + id); };
  const deleteType = async (id) => { if (rooms.some((r) => r.type === id) || res.some((r) => r.roomType === id)) return alert("No se puede eliminar: tipo en uso."); setTypes((p) => p.filter((t) => t.id !== id)); await sbRest("room_types", "DELETE", null, "id=eq." + id); };
  const addHoliday = async (data) => { setHols((p) => [...p, data]); await sbRest("holidays", "POST", [{ id: data.id, name: data.name, start_date: data.s, end_date: data.e, icon: data.icon }]); };
  const updateHoliday = async (id, data) => { setHols((p) => p.map((h) => h.id === id ? { ...h, ...data } : h)); await sbRest("holidays", "PATCH", { name: data.name, start_date: data.s, end_date: data.e, icon: data.icon }, "id=eq." + id); };
  const deleteHoliday = async (id) => { setHols((p) => p.filter((h) => h.id !== id)); await sbRest("holidays", "DELETE", null, "id=eq." + id); };
  const markCleaningDone = async (key, roomId, by, userName) => { setClnOverrides((p) => ({ ...p, [key]: { key, roomId, status: "limpio", by, at: new Date().toISOString(), user: userName } })); await sbRest("cleaning_overrides", "POST", [{ override_key: key, room_id: roomId, status: "limpio", done_by: by, done_at: new Date().toISOString(), registered_by: userName }], "", "return=representation,resolution=merge-duplicates"); };

  const conflicts = useMemo(() => {
    const result = []; const active = res.filter((r) => r.state !== "Cancelado" && r.state !== "Finalizado");
    for (let i = 0; i < active.length; i++) { for (let j = i + 1; j < active.length; j++) { const a = active[i], b = active[j]; if (a.roomId !== b.roomId) continue; if (toDS(a.checkin) < toDS(b.checkout) && toDS(b.checkin) < toDS(a.checkout)) result.push({ a, b, room: a.roomId }); } }
    return result;
  }, [res]);

  const nav = [
    { id: "reg", l: "Registro", i: "📋" },
    { id: "disp", l: "Disponibilidad", i: "📅" },
    { id: "hab", l: "Habitaciones", i: "🏨" },
    { id: "lim", l: "Limpieza", i: "🧹" },
    { id: "avisos", l: conflicts.length > 0 ? `Avisos (${conflicts.length})` : "Avisos", i: "⚠️" },
  ];

  if (loading) return (<><style>{CSS}</style><div className="login-bg"><div className="login-card" style={{ textAlign: "center" }}><span style={{ fontSize: 48, display: "block", marginBottom: 16 }}>🏨</span><h2 style={{ fontFamily: "var(--FD)", fontSize: 18, color: "#6B3410", marginBottom: 8 }}>Tinoco Apart Hotel</h2><p style={{ fontSize: 13, color: "#888" }}>Cargando datos...</p><div style={{ marginTop: 20 }}><div style={{ width: 40, height: 40, border: "4px solid #e0dcd6", borderTopColor: "#8B4513", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} /></div></div></div></>);
  if (!curUser) return (<><style>{CSS}</style><LoginPage users={users} onLogin={handleLogin} /></>);

  return (
    <><style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="hdr-l"><span className="hdr-ico">🏨</span><div><h1 className="hdr-t">Tinoco Apart Hotel</h1><p className="hdr-s">Sistema de Gestión — En línea</p></div></div>
          <nav className="hdr-nav">
            {nav.map((n2) => (<button key={n2.id} className={"nv" + (pg === n2.id ? " ac" : "") + (n2.id === "avisos" && conflicts.length > 0 && pg !== "avisos" ? " nv-warn" : "")} onClick={() => setPg(n2.id)} style={n2.id === "avisos" && conflicts.length > 0 ? { color: "#ff6b6b" } : {}}><span className="ni">{n2.i}</span>{n2.l}</button>))}
            <div className="hdr-user"><span className="hdr-uname">👤 {curUser.name}</span><span style={{ fontSize: 8, color: "#4caf50", marginLeft: 4 }}>●</span><button className="hdr-logout" onClick={handleLogout}>Salir</button></div>
          </nav>
        </header>
        <main className="cnt">
          {pg === "reg" && <PgReg res={res} deleteReservation={deleteReservation} rooms={rooms} types={types} setModal={setModal} curUser={curUser} />}
          {pg === "disp" && <PgDisp rooms={rooms} types={types} res={res} hols={hols} calD={calD} setCalD={setCalD} />}
          {pg === "hab" && <PgHab rooms={rooms} updateRoom={updateRoom} deleteRoom={deleteRoom} types={types} addType={addType} updateType={updateType} deleteType={deleteType} sel={selR} setSel={setSelR} setModal={setModal} />}
          {pg === "lim" && <PgLim rooms={rooms} types={types} res={res} cln={clnOverrides} markCleaningDone={markCleaningDone} curUser={curUser} users={users} />}
          {pg === "avisos" && <PgAvisos conflicts={conflicts} rooms={rooms} types={types} setModal={setModal} setPg={setPg} curUser={curUser} />}
        </main>
        {modal?.t === "res" && <MdlRes data={modal.d} rooms={rooms} types={types} curUser={curUser} users={users} onSave={(d) => { if (modal.d) updateReservation(modal.d.id, { ...modal.d, ...d }); else addReservation(d); setModal(null); }} onClose={() => setModal(null)} />}
        {modal?.t === "addRoom" && <MdlAddRm types={types} onSave={(d) => { addRoom(d); setModal(null); }} onClose={() => setModal(null)} />}
        {modal?.t === "freeRooms" && (
          <div className="mbg" onClick={() => setModal(null)}><div className="mdl ms" onClick={(e) => e.stopPropagation()}>
            <h3>🟢 Hab. Libres — {MN[modal.month]} {modal.year}</h3>
            {modal.freeRooms.length === 0 ? <p style={{ color: "#999", textAlign: "center", padding: 20 }}>No hay hab. completamente libres este mes</p> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(100px,1fr))", gap: 8 }}>
                {modal.freeRooms.map((rm) => { const tp = types.find((t) => t.id === rm.type); return (<div key={rm.id} style={{ background: "#e8f8ee", border: "1px solid #a5d6a7", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontFamily: "var(--FD)", fontSize: 20, fontWeight: 700, color: "#2e7d32" }}>{rm.name}</div><div style={{ fontSize: 11, color: "#666" }}>{tp?.name}</div></div>); })}
              </div>
            )}
            <div className="mf"><button className="bc" onClick={() => setModal(null)}>Cerrar</button></div>
          </div></div>
        )}
      </div>
    </>
  );
}

/* PgReg - TODAY only availability */
function PgReg({ res, deleteReservation, rooms, types, setModal, curUser }) {
  const [q, sQ] = useState(""); const [sf, sSf] = useState("all");
  const [showAvail, setShowAvail] = useState(false);

  const todayAvail = useMemo(() => {
    const sorted = rooms.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return sorted.map(rm => {
      const { am, pm, ar, pr } = roomSt(rm.id, TODAY, res);
      const tp = types.find(t => t.id === rm.type);
      const isFree = am === "free" && pm === "free";
      return { room: rm, tp, am, pm, ar, pr, isFree };
    });
  }, [rooms, res, types]);
  const freeCount = todayAvail.filter(a => a.isFree).length;
  const occCount = todayAvail.filter(a => !a.isFree).length;

  const fl = useMemo(() => res.filter((r) => {
    if (sf === "all" && (r.state === "Finalizado" || r.state === "Cancelado")) return false;
    if (sf !== "all" && r.state !== sf) return false;
    if (q) { const s = q.toLowerCase(); return r.guest.toLowerCase().includes(s) || r.id.toLowerCase().includes(s) || r.doc.includes(s) || r.roomId.includes(s); }
    return true;
  }), [res, q, sf]);

  const sl = (s) => (s === "occ" ? "Ocupado" : s === "res" ? "Reservado" : "Libre");

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">Registro de Huéspedes</h2><div className="ptr"><div className="sb"><span className="si">🔍</span><input placeholder="Buscar..." value={q} onChange={(e) => sQ(e.target.value)} /></div><button className="ba" onClick={() => setModal({ t: "res", d: null })}>+ Nueva Reserva</button></div></div>
      <div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <div className="sc" style={{borderTopColor:"var(--gn)",flex:1,minWidth:100,cursor:"pointer"}} onClick={()=>setShowAvail(!showAvail)}><div className="sn" style={{color:"var(--gn)"}}>{freeCount}</div><div className="sl">🟢 Libres hoy</div></div>
        <div className="sc" style={{borderTopColor:"var(--rd)",flex:1,minWidth:100,cursor:"pointer"}} onClick={()=>setShowAvail(!showAvail)}><div className="sn" style={{color:"var(--rd)"}}>{occCount}</div><div className="sl">🔴 Ocupadas hoy</div></div>
        <div className="sc" style={{borderTopColor:"var(--a)",flex:1,minWidth:100}}><div className="sn">{rooms.length}</div><div className="sl">🏨 Total hab.</div></div>
      </div>
      {showAvail && (
        <div className="crd" style={{marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h4 style={{fontSize:14,color:"#6B3410",margin:0}}>📋 Disponibilidad Hoy — {new Date(TODAY+"T12:00:00").toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</h4><button className="bc bsm" onClick={()=>setShowAvail(false)}>Cerrar ×</button></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
            {todayAvail.map(({room,tp,am,pm,ar,pr,isFree})=>{
              const bgColor = isFree ? "#e8f8ee" : (am==="occ"||pm==="occ") ? "#fde8e5" : "#fef3e2";
              const borderColor = isFree ? "#a5d6a7" : (am==="occ"||pm==="occ") ? "#f5c6cb" : "#ffe082";
              const stColor = isFree ? "#2e7d32" : (am==="occ"||pm==="occ") ? "#c0392b" : "#e67e22";
              return (
                <div key={room.id} style={{background:bgColor,border:"1px solid "+borderColor,borderRadius:8,padding:10,textAlign:"center"}}>
                  <div style={{fontFamily:"var(--FD)",fontSize:18,fontWeight:700,color:stColor}}>{room.name}</div>
                  <div style={{fontSize:10,color:"#666"}}>{tp?.name}</div>
                  {isFree ? <div style={{fontSize:11,fontWeight:600,color:"#2e7d32",marginTop:4}}>🟢 LIBRE</div> : (
                    am === pm ? <div style={{fontSize:10,color:stColor,marginTop:4,fontWeight:600}}>{sl(am)}{ar ? <div style={{fontWeight:400,fontSize:9,color:"#555"}}>{ar.guest.split(" ")[0]}</div> : null}</div> : (
                      <div style={{display:"flex",gap:2,marginTop:4,fontSize:9}}>
                        <div style={{flex:1,padding:2,borderRadius:4,background:am==="free"?"#e8f8ee":am==="occ"?"#fde8e5":"#fef3e2"}}><strong>AM</strong> {sl(am)}</div>
                        <div style={{flex:1,padding:2,borderRadius:4,background:pm==="free"?"#e8f8ee":pm==="occ"?"#fde8e5":"#fef3e2"}}><strong>PM</strong> {sl(pm)}</div>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="fr">
        {["all", ...RSTATES].map((s) => (<button key={s} className={"fb" + (sf === s ? " ac" : "")} onClick={() => sSf(s)}>{s === "all" ? "Todos" : s}</button>))}
      </div>
      {/* Desktop */}
      <div className="tw desk-only"><table className="tb"><thead><tr><th>ID</th><th>Huésped</th><th>DNI</th><th>Canal</th><th>Hab.</th><th>Check-in</th><th>Check-out</th><th>Estado</th><th>Total</th><th>Adelantos</th><th>Saldo</th><th>Pago</th><th>Conformidad</th><th></th></tr></thead><tbody>
        {fl.length === 0 && <tr><td colSpan={14} className="empty">No hay reservas</td></tr>}
        {fl.map((r) => (<tr key={r.id}><td className="tid">{r.id}</td><td className="tgst">{r.guest}</td><td>{r.doc}</td><td>{r.channel}</td><td className="trm">{r.roomId}</td><td>{fmtDT(r.checkin)}</td><td>{fmtDT(r.checkout)}</td><td><span className={"badge b-" + r.state.toLowerCase()}>{r.state}</span></td><td className="tmny">S/ {r.total}</td><td className="tmny">S/ {(r.advances || []).reduce((s2, a) => s2 + (Number(a.amount)||0), 0) || r.advance || 0}</td><td className={"tmny " + (r.balance > 0 ? "debt" : "paid")}>S/ {r.balance}</td><td>{r.payment}</td>
          <td style={{ fontSize: 11 }}>{(() => { const pA = (r.advances || []).some((a) => a.amount > 0 && !a.verifiedBy); const pC = r.state === "Finalizado" && !r.checkoutVerifiedBy; if (pA || pC) return <span style={{ color: "#e67e22", fontWeight: 600 }}>⚠️ Por validar</span>; if (r.state === "Finalizado" && r.checkoutVerifiedBy) return <span style={{ color: "#27ae60" }}>✅ {r.checkoutVerifiedBy}</span>; if ((r.advances || []).some((a) => a.verifiedBy)) return <span style={{ color: "#27ae60" }}>✅ Pagos OK</span>; return <span style={{ color: "#999" }}>—</span>; })()}</td>
          <td className="tact"><button className="ab" onClick={() => setModal({ t: "res", d: r })}>✏️</button><button className="ab" onClick={() => { if (confirm("¿Eliminar " + r.id + "?")) deleteReservation(r.id); }}>🗑️</button></td>
        </tr>))}
      </tbody></table></div>
      {/* Mobile */}
      <div className="mob-only">
        {fl.length === 0 && <div className="crd" style={{ textAlign: "center", color: "#999", padding: 24 }}>No hay reservas</div>}
        {fl.map((r) => { const tA = (r.advances || []).reduce((s2, a) => s2 + (Number(a.amount)||0), 0) || r.advance || 0; return (
          <div key={r.id} className="mob-card"><div className="mob-top"><span className="tid">{r.id}</span><span className={"badge b-" + r.state.toLowerCase()}>{r.state}</span></div><div className="mob-guest">{r.guest}</div>
            <div className="mob-row"><span>🏨 <strong>{r.roomId}</strong></span><span>👥 {r.persons}</span><span>📞 {r.channel}</span></div>
            <div className="mob-row"><span>📥 {fmtDT(r.checkin)}</span></div><div className="mob-row"><span>📤 {fmtDT(r.checkout)}</span></div>
            <div className="mob-money"><div><span className="mob-lbl">Total</span><span className="mob-val">S/ {r.total}</span></div><div><span className="mob-lbl">Adelantos</span><span className="mob-val" style={{color:"#27ae60"}}>S/ {tA}</span></div><div><span className="mob-lbl">Saldo</span><span className="mob-val" style={{color: r.balance > 0 ? "#c0392b" : "#27ae60"}}>S/ {r.balance}</span></div></div>
            {r.comments && <div style={{ fontSize: 11, color: "#666", marginTop: 4, fontStyle: "italic" }}>💬 {r.comments}</div>}
            <div className="mob-actions"><button className="ba bsm" style={{ flex: 1 }} onClick={() => setModal({ t: "res", d: r })}>✏️ Editar</button><button className="bd bsm" onClick={() => { if (confirm("¿Eliminar " + r.id + "?")) deleteReservation(r.id); }}>🗑️</button></div>
          </div>); })}
      </div>
    </div>
  );
}

/* MdlRes - Reservation modal (unchanged logic) */
function MdlRes({ data, rooms, types, curUser, users, onSave, onClose }) {
  const AUTH_USERS = (users || []).filter((u) => ["ivanaberrocal", "marianelatinoco", "dafnaberrocal"].includes(u.user));
  const initAdv = (d) => { if (d?.advances?.length > 0) return d.advances; if (d?.advance > 0) return [{ amount: d.advance, verifiedBy: "", verifiedUser: "", date: d.created || TODAY }]; return []; };
  const [f, sF] = useState(() => {
    const d = data || { guest:"",doc:"",phone:"",email:"",channel:"WhatsApp",roomType:types[0]?.id||"",roomId:rooms[0]?.id||"",persons:1,ciDate:"",ciTime:"13:00",coDate:"",coTime:"12:00",checkin:"",checkout:"",state:"Reservado",total:0,advance:0,balance:0,payment:"Efectivo",comments:"",checkoutVerifiedBy:"",checkoutVerifiedUser:"",advances:[],lastModBy:"" };
    if (d.checkin && !d.ciDate) { const p2 = d.checkin.split("T"); d.ciDate = p2[0]||""; d.ciTime = (p2[1]||"13:00").substring(0,5); }
    if (d.checkout && !d.coDate) { const p2 = d.checkout.split("T"); d.coDate = p2[0]||""; d.coTime = (p2[1]||"12:00").substring(0,5); }
    return { ...d, checkoutVerifiedBy: d.checkoutVerifiedBy||"", checkoutVerifiedUser: d.checkoutVerifiedUser||"" };
  });
  const [advs, setAdvs] = useState(() => initAdv(data));
  const [coV, setCoV] = useState({ by: data?.checkoutVerifiedBy||"", user: data?.checkoutVerifiedUser||"" });
  const [authM, setAuthM] = useState(null); const [authU, setAuthU] = useState(""); const [authP, setAuthP] = useState(""); const [authE, setAuthE] = useState("");
  const tAdv = advs.reduce((a2,a) => a2+(Number(a.amount)||0), 0);
  const bal = (Number(f.total)||0) - tAdv;
  const s = (k,v) => { const u = {...f,[k]:v}; if (k==="roomType"){const ar=rooms.filter(r=>r.type===v);if(ar.length)u.roomId=ar[0].id;} sF(u); };
  const addAdv = () => { if(advs.length>=4)return alert("Máximo 4"); setAdvs(p=>[...p,{amount:0,verifiedBy:"",verifiedUser:"",date:TODAY}]); };
  const updAdv = (i,k,v) => setAdvs(p=>p.map((a,j)=>j===i?{...a,[k]:v}:a));
  const rmAdv = (i) => setAdvs(p=>p.filter((_,j)=>j!==i));
  const startAuth = (type,index) => { setAuthM({type,index}); setAuthU(""); setAuthP(""); setAuthE(""); };
  const confirmAuth = () => {
    if(authM.type==="checkout"){const found=(users||[]).find(x=>x.user===authU&&x.pass===authP);if(!found){setAuthE("Credenciales incorrectas");return;} setCoV({by:found.name,user:found.user});}
    else{const found=AUTH_USERS.find(x=>x.user===authU&&x.pass===authP);if(!found){setAuthE("No autorizado");return;} updAdv(authM.index,"verifiedBy",found.name);updAdv(authM.index,"verifiedUser",found.user);}
    setAuthM(null);
  };
  const sv = () => {
    if(!f.guest||!f.doc||!f.ciDate||!f.coDate)return alert("Completa campos obligatorios");
    const checkin=f.ciDate+"T"+(f.ciTime||"13:00"),checkout=f.coDate+"T"+(f.coTime||"12:00");
    if(f.state==="Finalizado"&&bal>0)return alert("Saldo pendiente S/ "+bal);
    onSave({...f,checkin,checkout,advances:advs.map(a=>({...a,amount:Number(a.amount)||0})),advance:tAdv,balance:bal,total:+f.total,lastModBy:curUser.name,checkoutVerifiedBy:coV.by,checkoutVerifiedUser:coV.user});
  };
  const frms=rooms.filter(r=>r.type===f.roomType);
  const roomOpts=frms.length?frms.map(r=>({v:r.id,l:r.name})):rooms.map(r=>({v:r.id,l:r.name}));
  const showCoV=f.state==="Finalizado";
  const isAuth=AUTH_USERS.some(au=>au.user===curUser.user);
  return (
    <div className="mbg" onClick={onClose}><div className="mdl" style={{position:"relative"}} onClick={e=>e.stopPropagation()}>
      <h3>{data?"Editar "+data.id:"Nueva Reserva"}</h3>
      <p style={{fontSize:11,color:"#888",marginBottom:12}}>Por: <strong>{data?.createdBy||curUser.name}</strong>{data?.lastModBy&&data.lastModBy!==data.createdBy&&<span> · Mod: <strong>{data.lastModBy}</strong></span>}</p>
      <div className="fg">
        <Fld label="Nombre *" value={f.guest} onChange={v=>s("guest",v)} /><Fld label="DNI *" value={f.doc} onChange={v=>s("doc",v)} /><Fld label="Teléfono" value={f.phone} onChange={v=>s("phone",v)} /><Fld label="Email" value={f.email} onChange={v=>s("email",v)} />
        <Fld label="Canal" type="select" opts={CHANNELS} value={f.channel} onChange={v=>s("channel",v)} /><Fld label="Tipo Hab." type="select" opts={types.map(t=>({v:t.id,l:t.name}))} value={f.roomType} onChange={v=>s("roomType",v)} />
        <Fld label="Habitación" type="select" opts={roomOpts} value={f.roomId} onChange={v=>s("roomId",v)} /><Fld label="Personas" type="number" min={1} value={f.persons} onChange={v=>s("persons",v)} />
        <Fld label="Fecha Check-in *" type="date" value={f.ciDate} onChange={v=>s("ciDate",v)} /><Fld label="Hora Check-in" type="time" value={f.ciTime} onChange={v=>s("ciTime",v)} />
        <Fld label="Fecha Check-out *" type="date" value={f.coDate} onChange={v=>s("coDate",v)} /><Fld label="Hora Check-out" type="time" value={f.coTime} onChange={v=>s("coTime",v)} />
        <Fld label="Estado" type="select" opts={RSTATES} value={f.state} onChange={v=>s("state",v)} /><Fld label="Pago" type="select" opts={PAYS} value={f.payment} onChange={v=>s("payment",v)} />
        {advs.some(a=>a.verifiedBy)&&!isAuth?<div className="fld"><label>Total S/ 🔒</label><input type="number" value={f.total} readOnly style={{background:"#f0f0f0",cursor:"not-allowed"}}/></div>:<Fld label="Total S/" type="number" min={0} value={f.total} onChange={v=>s("total",v)} />}
      </div>
      <div style={{marginTop:14,padding:12,background:"#f9f7f4",borderRadius:8,border:"1px solid #e0dcd6"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap"}}><span style={{fontSize:12,fontWeight:700,color:"#6B3410"}}>💵 ADELANTOS ({advs.length}/4)</span>{advs.length<4&&<button className="ba bsm" onClick={addAdv}>+ Adelanto</button>}</div>
        {advs.length===0&&<p style={{fontSize:12,color:"#999"}}>Sin adelantos</p>}
        {advs.map((a,i)=>{const lk=a.verifiedBy&&!isAuth;return(
          <div key={i} className="adv-row" style={lk?{opacity:.85}:{}}>
            <div className="adv-num">#{i+1}</div>
            <div className="fld" style={{flex:1}}><label>Monto S/{lk?" 🔒":""}</label><input type="number" min={0} value={a.amount} readOnly={lk} style={lk?{background:"#f0f0f0",cursor:"not-allowed"}:{}} onChange={e=>updAdv(i,"amount",e.target.value)}/></div>
            <div style={{flex:1.3,display:"flex",flexDirection:"column",gap:3}}><label style={{fontSize:11,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:".3px"}}>Conformidad</label>
              {a.verifiedBy?<span style={{fontSize:12,color:"#27ae60",fontWeight:600,padding:"7px 0"}}>✅ {a.verifiedBy}</span>:Number(a.amount)>0?<button className="bc bsm" style={{fontSize:11}} onClick={()=>startAuth("adv",i)}>🔐 Validar</button>:<span style={{fontSize:11,color:"#999",padding:"7px 0"}}>—</span>}
            </div>
            {lk?<span style={{marginTop:16,fontSize:10,color:"#999",width:24,textAlign:"center"}}>🔒</span>:<button className="ab" style={{marginTop:16}} onClick={()=>rmAdv(i)}>🗑️</button>}
          </div>);})}
        <div style={{display:"flex",gap:16,marginTop:8,fontSize:13,fontWeight:600,flexWrap:"wrap"}}><span>Adelantos: <span style={{color:"#27ae60"}}>S/ {tAdv}</span></span><span>Saldo: <span style={{color:bal>0?"#c0392b":"#27ae60"}}>S/ {bal}</span></span></div>
      </div>
      {showCoV&&<div style={{marginTop:14,background:coV.by?"#e8f5e9":"#fff8e1",padding:12,borderRadius:8,border:"1px solid "+(coV.by?"#a5d6a7":"#ffe082")}}><span style={{fontSize:12,fontWeight:700,color:coV.by?"#2e7d32":"#e65100"}}>{coV.by?"✅ CHECKOUT VERIFICADO":"⚠️ VERIFICACIÓN"}</span>{coV.by?<p style={{fontSize:12,color:"#2e7d32",marginTop:4}}>Por: <strong>{coV.by}</strong></p>:<div style={{marginTop:8}}><button className="bc bsm" onClick={()=>startAuth("checkout")}>🔐 Validar checkout</button></div>}</div>}
      <div className="fld fw" style={{marginTop:10}}><label>Comentarios</label><textarea value={f.comments} onChange={e=>s("comments",e.target.value)}/></div>
      <div className="mf"><button className="bc" onClick={onClose}>Cancelar</button><button className="ba" onClick={sv}>{data?"Guardar":"Crear"}</button></div>
      {authM&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}><div style={{background:"#fff",padding:24,borderRadius:12,width:"100%",maxWidth:340,boxShadow:"0 8px 24px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <h4 style={{fontSize:14,marginBottom:4,color:"#6B3410"}}>🔐 Validar {authM.type==="checkout"?"Checkout":"Adelanto #"+(authM.index+1)}</h4>
        <p style={{fontSize:11,color:"#888",marginBottom:12}}>{authM.type==="checkout"?"Cualquier usuario":"Solo autorizados"}</p>
        <div className="fld"><label>Usuario</label><input value={authU} onChange={e=>{setAuthU(e.target.value);setAuthE("");}} placeholder="usuario" autoComplete="off"/></div>
        <div className="fld" style={{marginTop:8}}><label>Contraseña</label><input type="password" value={authP} onChange={e=>{setAuthP(e.target.value);setAuthE("");}} placeholder="contraseña" onKeyDown={e=>e.key==="Enter"&&confirmAuth()} autoComplete="off"/></div>
        {authE&&<p style={{color:"#c0392b",fontSize:11,marginTop:6}}>{authE}</p>}
        <div style={{display:"flex",gap:8,marginTop:14}}><button className="ba bsm" onClick={confirmAuth}>Confirmar</button><button className="bc bsm" onClick={()=>setAuthM(null)}>Cancelar</button></div>
      </div></div>}
    </div></div>
  );
}

/* PgDisp - responsive, mobile 2 days */
function PgDisp({ rooms, types, res, hols, calD, setCalD }) {
  const isMobile = useIsMobile();
  const bef = isMobile ? 2 : 3, aft = isMobile ? 2 : 4;
  const days = useMemo(() => { const r = []; for (let i = -bef; i <= aft; i++) r.push(addD(calD, i)); return r; }, [calD, bef, aft]);
  const [dispInput, setDispInput] = useState(() => { const p = calD.split("-"); return p[2]+"/"+p[1]+"/"+p[0]; });
  const [tt, sTt] = useState(null);
  const [filtRoom, setFiltRoom] = useState("all"); const [filtType, setFiltType] = useState("all");
  const sl = (s) => (s === "occ" ? "OCUP." : s === "res" ? "RESERV." : "LIBRE");
  const sc = (s) => (s === "occ" ? "co" : s === "res" ? "cr" : "cf");
  const filteredRooms = useMemo(() => { let fr = rooms; if (filtType !== "all") fr = fr.filter(r => r.type === filtType); if (filtRoom !== "all") fr = fr.filter(r => r.id === filtRoom); return fr.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); }, [rooms, filtType, filtRoom]);
  const applyDate = (val) => { setDispInput(val); const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) setCalD(m[3]+"-"+m[2]+"-"+m[1]); };
  const onDateBlur = () => { const p = calD.split("-"); setDispInput(p[2]+"/"+p[1]+"/"+p[0]); };
  const navDate = (off) => { const nd = addD(calD, off); setCalD(nd); const p = nd.split("-"); setDispInput(p[2]+"/"+p[1]+"/"+p[0]); };

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">Disponibilidad</h2><div className="ptr"><span style={{fontSize:13,color:"#666"}}>Fecha:</span><input className="di" value={dispInput} onChange={e=>applyDate(e.target.value)} onBlur={onDateBlur} placeholder="dd/mm/yyyy" style={{width:120,textAlign:"center"}}/></div></div>
      <div className="lr"><span className="li"><span className="ld dg"/>Libre</span><span className="li"><span className="ld dor"/>Reservado</span><span className="li"><span className="ld dr"/>Ocupado</span><span className="lnfo">{isMobile?"2 días antes/después":"3 antes, 4 después"}</span></div>
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <div className="fld" style={{width:isMobile?"100%":180}}><label>Tipo</label><select value={filtType} onChange={e=>{setFiltType(e.target.value);setFiltRoom("all");}}><option value="all">Todos</option>{types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="fld" style={{width:isMobile?"100%":180}}><label>Habitación</label><select value={filtRoom} onChange={e=>setFiltRoom(e.target.value)}><option value="all">Todas</option>{(filtType!=="all"?rooms.filter(r=>r.type===filtType):rooms).slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        {(filtType!=="all"||filtRoom!=="all")&&<button className="bc bsm" style={{marginTop:isMobile?0:16}} onClick={()=>{setFiltType("all");setFiltRoom("all");}}>Limpiar</button>}
      </div>
      <div className="as">
        <div className="anb apl" onClick={()=>navDate(isMobile?-3:-7)}>‹</div><div className="anb anr" onClick={()=>navDate(isMobile?3:7)}>›</div>
        <table className="at"><thead><tr><th className="ath-r">Hab.</th><th className="ath-t desk-only">Tipo</th>
          {days.map(d=>(<th key={d} className={"ath-d"+(d===TODAY?" aty":"")+(d===calD?" aty":"")+(isHol(d,hols)?" athol":"")}><span className="adw">{dwk(d)}</span><span className="adn">{String(dnum(d)).padStart(2,"0")}/{msh(d)}</span></th>))}
        </tr></thead><tbody>
          {filteredRooms.map(rm=>{const tp=types.find(t=>t.id===rm.type);return(<tr key={rm.id}><td className="avr">{rm.name}</td><td className="avt desk-only">{tp?.name}</td>
            {days.map(d=>{const{am,pm,ar,pr}=roomSt(rm.id,d,res);const spl=am!==pm||(ar&&pr&&ar.id!==pr.id);
              const mE=e=>{const rc=e.currentTarget.getBoundingClientRect();let tx="Hab. "+rm.name+" — "+d;if(spl){tx+="\nAM: "+sl(am)+(ar?" — "+ar.guest:"");tx+="\nPM: "+sl(pm)+(pr?" — "+pr.guest:"");}else{tx+="\n"+sl(am);if(ar)tx+="\n"+ar.guest+"\n"+fmtDT(ar.checkin)+" → "+fmtDT(ar.checkout);}sTt({x:rc.left+rc.width/2,y:rc.top-4,tx});};
              if(spl)return(<td key={d} className="avsp" onMouseEnter={mE} onMouseLeave={()=>sTt(null)}><div className="spw"><div className={"sph "+sc(am)}><span className="cl">{sl(am)}</span>{ar&&<span className="cgs">{ar.guest.split(" ")[0]}</span>}</div><div className={"sph "+sc(pm)}><span className="cl">{sl(pm)}</span>{pr&&<span className="cgs">{pr.guest.split(" ")[0]}</span>}</div></div></td>);
              return(<td key={d} className={"avc "+sc(am)} onMouseEnter={mE} onMouseLeave={()=>sTt(null)}><span className="cl">{sl(am)}</span>{ar&&<span className="cgs">{ar.guest.split(" ")[0]}</span>}</td>);
            })}
          </tr>);})}
        </tbody></table>
      </div>
      {tt&&<div className="ttp" style={{left:tt.x,top:tt.y}}>{tt.tx.split("\n").map((l,i)=><div key={i}>{l}</div>)}</div>}
    </div>
  );
}

/* PgHab - merged tipo+tarifa */
function PgHab({ rooms, updateRoom, deleteRoom, types, addType, updateType, deleteType, sel, setSel, setModal }) {
  const [ob, sOb] = useState(""); const fr = useRef();
  const s = rooms.find(r => r.id === sel); const tp = s ? types.find(t => t.id === s.type) : null;
  const [showTypes, setShowTypes] = useState(false);
  const [edType, setEdType] = useState(null);
  const [typeFm, setTypeFm] = useState({ name: "", base: 100, high: 150, beds15: 1, beds2: 0 });
  const [edTar, sEdTar] = useState(false);
  const [tarFm, sTarFm] = useState({});
  const [zoomImg, setZoomImg] = useState(null);
  const typeCap = (typeFm.beds15||0)+2*(typeFm.beds2||0);
  const aO = () => { if(!ob.trim()||!sel)return; const rm=rooms.find(r=>r.id===sel); updateRoom(sel,{...rm,obs:[...rm.obs,{text:ob.trim(),date:TODAY}]}); sOb(""); };
  const hP = (e) => { const f2=e.target.files[0]; if(!f2||!sel)return; const rd=new FileReader(); rd.onload=(ev)=>{const rm=rooms.find(r=>r.id===sel);updateRoom(sel,{...rm,photos:[...rm.photos,{id:Date.now(),url:ev.target.result}]});}; rd.readAsDataURL(f2); e.target.value=""; };
  const saveType = () => { if(!typeFm.name)return alert("Nombre requerido"); const cap=(Number(typeFm.beds15)||0)+2*(Number(typeFm.beds2)||0); if(edType==="new")addType({id:typeFm.name.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now(),name:typeFm.name,base:+typeFm.base,high:+typeFm.high,beds15:+typeFm.beds15,beds2:+typeFm.beds2,cap}); else updateType(edType,{name:typeFm.name,base:+typeFm.base,high:+typeFm.high,beds15:+typeFm.beds15,beds2:+typeFm.beds2,cap}); setEdType(null); };

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">Habitaciones & Tarifario</h2><div className="ptr"><button className="ba" onClick={()=>setModal({t:"addRoom"})}>+ Habitación</button><button className="bc bsm" onClick={()=>setShowTypes(!showTypes)}>{showTypes?"Ocultar":"Gestionar"} Tipos ({types.length})</button></div></div>
      {showTypes&&(<div className="crd" style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h4 style={{fontSize:15,color:"#6B3410",margin:0}}>🏷️ Tipos ({types.length})</h4><button className="ba bsm" onClick={()=>{setEdType("new");setTypeFm({name:"",base:100,high:150,beds15:1,beds2:0});}}>+ Nuevo</button></div>
        {edType&&(<div style={{background:"#f9f7f4",padding:16,borderRadius:8,marginBottom:12,border:"1px solid #e0dcd6"}}><h4 style={{fontSize:14,marginBottom:10}}>{edType==="new"?"Nuevo Tipo":"Editar"}</h4><div className="fg"><Fld label="Nombre" value={typeFm.name} onChange={v=>setTypeFm({...typeFm,name:v})}/><Fld label="Normal S/" type="number" min={0} value={typeFm.base} onChange={v=>setTypeFm({...typeFm,base:v})}/><Fld label="Alta S/" type="number" min={0} value={typeFm.high} onChange={v=>setTypeFm({...typeFm,high:v})}/><Fld label="Camas 1½" type="number" min={0} value={typeFm.beds15} onChange={v=>setTypeFm({...typeFm,beds15:+v})}/><Fld label="Camas 2P" type="number" min={0} value={typeFm.beds2} onChange={v=>setTypeFm({...typeFm,beds2:+v})}/><div className="fld"><label>Cap.</label><input type="number" value={typeCap} readOnly style={{opacity:.6,background:"#f0f0f0"}}/></div></div><div style={{display:"flex",gap:8,marginTop:12}}><button className="ba bsm" onClick={saveType}>Guardar</button><button className="bc bsm" onClick={()=>setEdType(null)}>Cancelar</button></div></div>)}
        <div className="tw"><table className="tb"><thead><tr><th>Nombre</th><th>Normal</th><th>Alta</th><th>1½</th><th>2P</th><th>Cap.</th><th>Hab.</th><th></th></tr></thead><tbody>
          {types.length===0&&<tr><td colSpan={8} className="empty">Sin tipos</td></tr>}
          {types.map(t=>{const cnt=rooms.filter(r=>r.type===t.id).length;return(<tr key={t.id}><td style={{fontWeight:600}}>{t.name}</td><td>S/ {t.base}</td><td>S/ {t.high}</td><td>{t.beds15||0}</td><td>{t.beds2||0}</td><td>{t.cap}</td><td>{cnt}</td><td className="tact"><button className="ab" onClick={()=>{setEdType(t.id);setTypeFm({name:t.name,base:t.base,high:t.high,beds15:t.beds15||0,beds2:t.beds2||0});}}>✏️</button><button className="ab" onClick={()=>{if(confirm("¿Eliminar \""+t.name+"\"?"))deleteType(t.id);}}>🗑️</button></td></tr>);})}
        </tbody></table></div>
      </div>)}
      <div className="rg">{rooms.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(r=>{const t2=types.find(t=>t.id===r.type);return(<div key={r.id} className={"rc"+(sel===r.id?" ac":"")} onClick={()=>{setSel(r.id);sEdTar(false);}}><div className="rn">{r.name}</div><div className="rtl">{t2?.name}</div><div className="rmeta">Piso {r.floor}</div></div>);})}</div>
      {s&&(<div className="hab-detail"><div className="hab-left">
        <div className="crd"><h4 style={{fontSize:15,marginBottom:10,color:"#6B3410"}}>📸 Fotos — {s.name}</h4><input type="file" accept="image/*" ref={fr} style={{display:"none"}} onChange={hP}/><div className="phg">{s.photos.map(p2=>(<div key={p2.id} className="pht"><img src={p2.url} alt="" style={{cursor:"pointer"}} onClick={()=>setZoomImg(p2.url)}/><button className="phr" onClick={()=>{const rm=rooms.find(r=>r.id===sel);updateRoom(sel,{...rm,photos:rm.photos.filter(x=>x.id!==p2.id)});}}>×</button></div>))}<div className="pha" onClick={()=>fr.current?.click()}>📷 Subir</div></div></div>
        <div className="crd"><h4 style={{fontSize:15,marginBottom:10,color:"#6B3410"}}>📝 Observaciones</h4><div style={{display:"flex",gap:8}}><input value={ob} onChange={e=>sOb(e.target.value)} placeholder="Ej: Enchufe suelto..." onKeyDown={e=>e.key==="Enter"&&aO()} style={{flex:1}}/><button className="ba bsm" onClick={aO}>Agregar</button></div><div className="obl">{s.obs.map((o,i)=>(<div key={i} className="obi"><span style={{flex:1}}>{o.text}</span><span style={{fontSize:11,color:"#aaa"}}>{o.date}</span><button className="ab" onClick={()=>{const rm=rooms.find(r=>r.id===sel);updateRoom(sel,{...rm,obs:rm.obs.filter((_,j)=>j!==i)});}}>×</button></div>))}{s.obs.length===0&&<p style={{color:"#aaa",fontSize:13,marginTop:8}}>Sin observaciones</p>}</div></div>
      </div>
      <div className="hab-right"><div className="crd">
        <h4 style={{fontSize:15,marginBottom:10,color:"#6B3410"}}>🏷️ Tipo & Tarifa — {s.name}</h4>
        <div className="fld" style={{marginBottom:10}}><label>Tipo</label><select value={s.type} onChange={e=>updateRoom(sel,{...s,type:e.target.value})}>{types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        {edTar?(<div><p style={{fontSize:11,color:"#e67e22",marginBottom:8}}>⚠️ Editar tipo "{tp?.name}" afecta todas sus hab.</p><div className="fg"><Fld label="Nombre" value={tarFm.name} onChange={v=>sTarFm({...tarFm,name:v})}/><Fld label="Normal S/" type="number" value={tarFm.base} onChange={v=>sTarFm({...tarFm,base:v})}/><Fld label="Alta S/" type="number" value={tarFm.high} onChange={v=>sTarFm({...tarFm,high:v})}/><Fld label="Camas 1½" type="number" min={0} value={tarFm.beds15} onChange={v=>sTarFm({...tarFm,beds15:+v})}/><Fld label="Camas 2P" type="number" min={0} value={tarFm.beds2} onChange={v=>sTarFm({...tarFm,beds2:+v})}/><div className="fld"><label>Cap.</label><input type="number" value={(tarFm.beds15||0)+2*(tarFm.beds2||0)} readOnly style={{opacity:.6,background:"#f0f0f0"}}/></div></div><div style={{display:"flex",gap:8,marginTop:10}}><button className="ba bsm" onClick={()=>{const cap=(+tarFm.beds15||0)+2*(+tarFm.beds2||0);updateType(tp.id,{...tp,name:tarFm.name,base:+tarFm.base,high:+tarFm.high,beds15:+tarFm.beds15,beds2:+tarFm.beds2,cap});sEdTar(false);}}>Guardar</button><button className="bc bsm" onClick={()=>sEdTar(false)}>Cancelar</button></div></div>):(
          <div><div className="tp-row"><div className="tp-n"><div className="tp-l">Normal</div><div className="tp-v">S/{tp?.base}</div><div className="tp-s">por noche</div></div><div className="tp-h"><div className="tp-l">Alta</div><div className="tp-v">S/{tp?.high}</div><div className="tp-s">por noche</div></div></div><div style={{fontSize:12,color:"#888",marginTop:8}}><p>🛏️ 1½: <strong>{tp?.beds15||0}</strong> · 2P: <strong>{tp?.beds2||0}</strong> · Cap: <strong>{tp?.cap}</strong></p></div><button className="btn-et" onClick={()=>{sEdTar(true);sTarFm({...tp});}}>✏️ Editar tarifa</button></div>
        )}
        <div style={{borderTop:"1px solid var(--bd)",marginTop:12,paddingTop:12}}><p style={{fontSize:12,color:"#666"}}>Hab. <strong>{s.name}</strong> — Piso {s.floor}</p><button className="bd bsm" style={{marginTop:8}} onClick={()=>{if(confirm("¿Eliminar "+s.name+"?")){deleteRoom(sel);setSel(null);}}}>🗑️ Eliminar</button></div>
      </div></div></div>)}
      {zoomImg&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,cursor:"pointer"}} onClick={()=>setZoomImg(null)}><img src={zoomImg} alt="" style={{maxWidth:"75vw",maxHeight:"75vh",objectFit:"contain",borderRadius:8}}/><button style={{position:"absolute",top:20,right:20,background:"rgba(255,255,255,.9)",border:"none",borderRadius:"50%",width:36,height:36,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setZoomImg(null)}>×</button></div>}
    </div>
  );
}

function MdlAddRm({ types, onSave, onClose }) {
  const [f, sF] = useState({ id: "", name: "", type: types[0]?.id || "", floor: 1 });
  return (<div className="mbg" onClick={onClose}><div className="mdl ms" onClick={e=>e.stopPropagation()}><h3>Agregar Habitación</h3><div className="fg"><Fld label="Número" value={f.id} onChange={v=>sF({...f,id:v,name:v})}/><Fld label="Tipo" type="select" opts={types.map(t=>({v:t.id,l:t.name}))} value={f.type} onChange={v=>sF({...f,type:v})}/><Fld label="Piso" type="number" min={1} value={f.floor} onChange={v=>sF({...f,floor:+v})}/></div><div className="mf"><button className="bc" onClick={onClose}>Cancelar</button><button className="ba" onClick={()=>{if(!f.id)return alert("Ingresa número");onSave(f);}}>Agregar</button></div></div></div>);
}

/* PgLim - Limpieza + Toallas */
function PgLim({ rooms, types, res, cln, markCleaningDone, curUser, users }) {
  const AUTH_NAMES = ["ivanaberrocal","dafnaberrocal","marianelatinoco"];
  const [rn, sRn] = useState({}); const getRn = (k) => rn[k]||""; const setRn = (k,v) => sRn(p=>({...p,[k]:v}));
  const [towelData, setTowelData] = useState(() => loadTowelData() || { stock: 0, verified: false, verifiedBy: "", deliveries: [], ingresos: [] });
  const [tAuthM, setTAuthM] = useState(false); const [tAuthU, setTAuthU] = useState(""); const [tAuthP, setTAuthP] = useState(""); const [tAuthE, setTAuthE] = useState("");
  const [newDel, setNewDel] = useState({ roomId: "", qty: "", source: "stock" });
  const [newIng, setNewIng] = useState({ qty: "", note: "" });
  useEffect(() => { saveTowelData(towelData); }, [towelData]);

  const cleanList = useMemo(() => {
    const result = []; const hr = new Date().getHours();
    for (const room of rooms) { for (const r of res) {
      if (r.roomId !== room.id || (r.state !== "Hospedado" && r.state !== "Reservado")) continue;
      const ci = toDS(r.checkin), co = toDS(r.checkout); let status = null;
      if (TODAY > ci && TODAY < co) status = "parcial";
      if (TODAY === co && hr >= 6) status = "general";
      if (TODAY === co && hr < 6) status = "parcial";
      if (status) result.push({ room, res: r, status, type: types.find(t => t.id === room.type) });
    }}
    return result;
  }, [rooms, res, types]);

  const verifyList = useMemo(() => {
    const result = [];
    for (const room of rooms) { for (const r of res) {
      if (r.roomId !== room.id || (r.state !== "Hospedado" && r.state !== "Reservado")) continue;
      if (toDS(r.checkin) === TODAY) result.push({ room, res: r, type: types.find(t => t.id === room.type) });
    }}
    return result;
  }, [rooms, res, types]);

  const towelNeeds = useMemo(() => {
    const needs = []; const seen = new Set();
    for (const cl of cleanList) { if (cl.status === "parcial") { needs.push({ roomId: cl.room.id, roomName: cl.room.name, persons: Number(cl.res.persons)||1, reason: "Limpieza parcial", guest: cl.res.guest }); seen.add(cl.room.id); } }
    for (const v of verifyList) { if (!seen.has(v.room.id)) { needs.push({ roomId: v.room.id, roomName: v.room.name, persons: Number(v.res.persons)||1, reason: "Ingreso hoy", guest: v.res.guest }); } }
    return needs;
  }, [cleanList, verifyList]);

  const towelAlerts = useMemo(() => {
    return towelNeeds.map(n => {
      const del = towelData.deliveries.filter(d => d.roomId === n.roomId).reduce((s, d) => s + d.qty, 0);
      const missing = n.persons - del;
      return { ...n, delivered: del, missing };
    }).filter(a => a.missing > 0);
  }, [towelNeeds, towelData.deliveries]);

  const totalDel = towelData.deliveries.reduce((s, d) => s + d.qty, 0);
  const totalIngreso = (towelData.ingresos || []).reduce((s, d) => s + d.qty, 0);
  const getEff = (roomId, autoSt) => { const ov = cln[roomId]; if (ov && ov.status === "limpio" && toDS(ov.at) === TODAY) return { status: "limpio", by: ov.by, user: ov.user||"" }; return { status: autoSt, by: null, user: "" }; };
  const markClean = (roomId) => { const name = getRn("c_"+roomId).trim(); if (!name) return alert("Nombre requerido"); markCleaningDone(roomId, roomId, name, curUser.name); setRn("c_"+roomId, ""); };
  const markVerify = (roomId) => { const name = getRn("v_"+roomId).trim(); if (!name) return alert("Nombre requerido"); markCleaningDone(roomId+"_verify", roomId, name, curUser.name); setRn("v_"+roomId, ""); };
  const stInfo = { limpio: { label: "Limpio", color: "#27ae60", icon: "🟢" }, parcial: { label: "Parcial", color: "#e67e22", icon: "🟠" }, general: { label: "General", color: "#3498db", icon: "🔵" } };
  const confirmTowelAuth = () => { const found = (users||[]).find(x => AUTH_NAMES.includes(x.user) && x.user === tAuthU && x.pass === tAuthP); if (!found) { setTAuthE("No autorizado"); return; } setTowelData(p => ({ ...p, verified: true, verifiedBy: found.name })); setTAuthM(false); };
  const addDelivery = () => { const qty = Number(newDel.qty); if (!newDel.roomId || !qty || qty <= 0) return alert("Completa los campos"); setTowelData(p => ({ ...p, deliveries: [...p.deliveries, { roomId: newDel.roomId, qty, source: newDel.source || "stock", time: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) }] })); setNewDel({ roomId: "", qty: "", source: "stock" }); };
  const rmDelivery = (i) => setTowelData(p => ({ ...p, deliveries: p.deliveries.filter((_, j) => j !== i) }));
  const addIngreso = () => { const qty = Number(newIng.qty); if (!qty || qty <= 0) return alert("Ingresa cantidad"); setTowelData(p => ({ ...p, ingresos: [...(p.ingresos||[]), { qty, note: newIng.note, time: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) }] })); setNewIng({ qty: "", note: "" }); };
  const rmIngreso = (i) => setTowelData(p => ({ ...p, ingresos: (p.ingresos||[]).filter((_, j) => j !== i) }));

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">Control de Limpieza</h2></div>
      <div className="sr">{Object.entries(stInfo).map(([k, v]) => { const c = cleanList.filter(cr => getEff(cr.room.id, cr.status).status === k).length; return <div key={k} className="sc"><div className="sn">{c}</div><div className="sl">{v.icon} {v.label}</div></div>; })}</div>
      <div className="lr"><span className="li"><span className="ld" style={{background:"#e67e22"}}/>Parcial</span><span className="li"><span className="ld" style={{background:"#3498db"}}/>General</span><span className="li"><span className="ld" style={{background:"#27ae60"}}/>Limpio</span></div>

      {cleanList.length===0?<div className="crd" style={{textAlign:"center",padding:40,color:"#999"}}>No hay limpieza hoy</div>:(
        <div className="tw"><table className="tb"><thead><tr><th>Hab.</th><th>Tipo</th><th>Huésped</th><th>Check-out</th><th>Estado</th><th>Resp.</th><th>Acción</th></tr></thead><tbody>
          {cleanList.map(({room,res:rv,status,type:tp2})=>{const eff=getEff(room.id,status);const inf=stInfo[eff.status];return(
            <tr key={room.id}><td className="trm">{room.name}</td><td>{tp2?.name}</td><td className="tgst">{rv.guest}</td><td>{fmtDT(rv.checkout)}</td><td><span className="lim-badge" style={{background:inf.color+"22",color:inf.color,borderColor:inf.color+"44"}}>{inf.icon} {inf.label}</span></td><td style={{fontSize:12}}>{eff.by?<span>✅ {eff.by}</span>:"—"}</td><td>{eff.status!=="limpio"?(<div style={{display:"flex",gap:4,alignItems:"center"}}><input style={{width:100,fontSize:11,padding:"4px 6px"}} placeholder="Responsable..." value={getRn("c_"+room.id)} onChange={e=>setRn("c_"+room.id,e.target.value)} onKeyDown={e=>e.key==="Enter"&&markClean(room.id)}/><button className="ba bsm" onClick={()=>markClean(room.id)}>✓</button></div>):<span style={{color:"#27ae60",fontWeight:600,fontSize:12}}>✅</span>}</td></tr>
          );})}
        </tbody></table></div>
      )}

      {verifyList.length>0&&(<div className="crd" style={{marginTop:20}}>
        <h3 style={{fontSize:15,marginBottom:12,color:"#6B3410"}}>🔍 Verificar — Ingresos hoy</h3>
        <div className="tw"><table className="tb"><thead><tr><th>Hab.</th><th>Tipo</th><th>Huésped</th><th>Check-in</th><th>Estado</th><th>Resp.</th><th>Acción</th></tr></thead><tbody>
          {verifyList.map(({room,res:rv,type:tp2})=>{const ov=cln[room.id+"_verify"];const ok=ov&&ov.status==="limpio"&&toDS(ov.at)===TODAY;return(
            <tr key={room.id}><td className="trm">{room.name}</td><td>{tp2?.name}</td><td className="tgst">{rv.guest}</td><td>{fmtDT(rv.checkin)}</td><td>{ok?<span style={{color:"#27ae60",fontWeight:600,fontSize:12}}>🟢 OK</span>:<span style={{color:"#e67e22",fontWeight:600,fontSize:12}}>⚠️ Pendiente</span>}</td><td style={{fontSize:12}}>{ok?<span>✅ {ov.by}</span>:"—"}</td><td>{!ok?(<div style={{display:"flex",gap:4,alignItems:"center"}}><input style={{width:100,fontSize:11,padding:"4px 6px"}} placeholder="Responsable..." value={getRn("v_"+room.id)} onChange={e=>setRn("v_"+room.id,e.target.value)} onKeyDown={e=>e.key==="Enter"&&markVerify(room.id)}/><button className="ba bsm" onClick={()=>markVerify(room.id)}>✓</button></div>):<span style={{color:"#27ae60",fontWeight:600,fontSize:12}}>✅</span>}</td></tr>
          );})}
        </tbody></table></div>
      </div>)}

      {/* TOALLAS */}
      <div className="crd" style={{marginTop:20}}>
        <h3 style={{fontSize:15,marginBottom:12,color:"#6B3410"}}>🧺 Inventario de Toallas — Hoy</h3>
        <div style={{background:towelData.verified?"#e8f5e9":"#fff8e1",padding:12,borderRadius:8,border:"1px solid "+(towelData.verified?"#a5d6a7":"#ffe082"),marginBottom:12}}>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:600}}>Stock inicial:</span>
            {towelData.verified?(
              <><span style={{fontSize:18,fontWeight:700,color:"#2e7d32"}}>{towelData.stock} toallas ✅ <span style={{fontSize:11,fontWeight:400}}>por {towelData.verifiedBy}</span></span>
              <button className="bc bsm" style={{marginLeft:8}} onClick={()=>setTowelData(p=>({...p,verified:false,verifiedBy:""}))}>✏️ Modificar</button></>
            ):(
              <><input type="number" min={0} value={towelData.stock} onChange={e=>setTowelData(p=>({...p,stock:Number(e.target.value)||0}))} style={{width:80}}/><button className="ba bsm" onClick={()=>{setTAuthM("stock");setTAuthU("");setTAuthP("");setTAuthE("");}}>🔐 Validar</button></>
            )}
          </div>
          {towelData.verified&&<p style={{fontSize:11,color:"#666",marginTop:4}}>Stock mañana: {towelData.stock} · Ingresos día: {totalIngreso} · Entregadas: {totalDel} · Disponibles: {towelData.stock + totalIngreso - totalDel}</p>}
        </div>
        {towelData.verified&&(<>
          {/* INGRESOS DEL DÍA */}
          <div style={{background:"#e3f2fd",padding:12,borderRadius:8,border:"1px solid #90caf9",marginBottom:12}}>
            <h4 style={{fontSize:13,fontWeight:700,marginBottom:8,color:"#1565c0"}}>📥 Ingresos del Día <span style={{fontWeight:400,fontSize:11,color:"#666"}}>(toallas recibidas durante el día)</span></h4>
            <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"flex-end"}}>
              <div className="fld" style={{width:80}}><label>Cant.</label><input type="number" min={1} value={newIng.qty} onChange={e=>setNewIng(p=>({...p,qty:e.target.value}))}/></div>
              <div className="fld" style={{flex:1,minWidth:120}}><label>Nota (opcional)</label><input value={newIng.note} onChange={e=>setNewIng(p=>({...p,note:e.target.value}))} placeholder="Ej: Lavandería entregó"/></div>
              <button className="ba bsm" onClick={addIngreso}>+ Registrar</button>
            </div>
            {towelData.ingresos&&towelData.ingresos.length>0?(
              <div className="tw" style={{marginBottom:8}}><table className="tb"><thead><tr><th>Cant.</th><th>Nota</th><th>Hora</th><th></th></tr></thead><tbody>{towelData.ingresos.map((ing,i)=>(<tr key={i}><td style={{fontWeight:700,color:"#1565c0"}}>{ing.qty}</td><td style={{fontSize:11}}>{ing.note||"—"}</td><td style={{fontSize:11}}>{ing.time}</td><td><button className="ab" onClick={()=>rmIngreso(i)}>🗑️</button></td></tr>))}</tbody></table></div>
            ):(<p style={{fontSize:12,color:"#999",marginBottom:4}}>Sin ingresos aún</p>)}
            <div style={{fontSize:12,fontWeight:600,color:"#1565c0"}}>Total ingresos del día: {totalIngreso} toallas</div>
          </div>

          <h4 style={{fontSize:13,fontWeight:700,marginBottom:8}}>📦 Toallas Entregadas</h4>
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div className="fld" style={{width:120}}><label>Hab.</label><select value={newDel.roomId} onChange={e=>setNewDel(p=>({...p,roomId:e.target.value}))}><option value="">—</option>{rooms.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div className="fld" style={{width:80}}><label>Cant.</label><input type="number" min={1} value={newDel.qty} onChange={e=>setNewDel(p=>({...p,qty:e.target.value}))}/></div>
            <div className="fld" style={{width:100}}><label>Fuente</label><select value={newDel.source||"stock"} onChange={e=>setNewDel(p=>({...p,source:e.target.value}))}><option value="stock">Stock mañana</option><option value="ingreso">Ingreso día</option></select></div>
            <button className="ba bsm" onClick={addDelivery}>+ Entregar</button>
          </div>
          {towelData.deliveries.length>0&&(<div className="tw" style={{marginBottom:12}}><table className="tb"><thead><tr><th>Hab.</th><th>Cant.</th><th>Fuente</th><th>Hora</th><th></th></tr></thead><tbody>{towelData.deliveries.map((d,i)=>(<tr key={i}><td className="trm">{d.roomId}</td><td>{d.qty}</td><td style={{fontSize:11}}>{d.source==="ingreso"?"📥 Ingreso":"📦 Stock"}</td><td style={{fontSize:11}}>{d.time}</td><td><button className="ab" onClick={()=>rmDelivery(i)}>🗑️</button></td></tr>))}</tbody></table></div>)}
          {towelData.deliveries.length===0&&<p style={{fontSize:12,color:"#999",marginBottom:12}}>Sin entregas aún</p>}
          <div style={{background:"#f9f7f4",padding:10,borderRadius:8,border:"1px solid #e0dcd6",marginBottom:12,fontSize:12}}>
            <div style={{display:"flex",gap:16,flexWrap:"wrap",fontWeight:600}}>
              <span>📦 Stock mañana: {towelData.stock}</span>
              <span style={{color:"#1565c0"}}>📥 Ingresos: +{totalIngreso}</span>
              <span style={{color:"#c0392b"}}>📤 Entregadas: -{totalDel}</span>
              <span style={{color: (towelData.stock+totalIngreso-totalDel)>=0?"#2e7d32":"#c0392b"}}>🧮 Disponibles: {towelData.stock + totalIngreso - totalDel}</span>
            </div>
          </div>
          <div style={{background:towelAlerts.length>0?"#fde8e5":"#e8f5e9",padding:12,borderRadius:8,border:"1px solid "+(towelAlerts.length>0?"#f5c6cb":"#a5d6a7")}}>
            <h4 style={{fontSize:13,fontWeight:700,color:towelAlerts.length>0?"#c0392b":"#2e7d32",marginBottom:8}}>{towelAlerts.length>0?`⚠️ Faltan toallas en ${towelAlerts.length} hab.`:"✅ Toallas completas"}</h4>
            {towelAlerts.map((a,i)=>(<div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",flexWrap:"wrap",fontSize:12}}><strong style={{color:"#c0392b"}}>{a.roomName}</strong><span>{a.guest} ({a.reason})</span><span>Necesita: {a.persons} · Entregadas: {a.delivered}</span><span style={{color:"#c0392b",fontWeight:700}}>Faltan: {a.missing}</span></div>))}
            {towelAlerts.length===0&&towelNeeds.length>0&&<div style={{fontSize:12,color:"#2e7d32"}}>{towelNeeds.map((n,i)=>(<div key={i}>✅ {n.roomName} — {n.guest} — {n.persons} toalla{n.persons>1?"s":""}</div>))}</div>}
            {towelNeeds.length===0&&<p style={{fontSize:12,color:"#888"}}>No hay hab. que requieran toallas hoy</p>}
          </div>
        </>)}
      </div>
      {tAuthM&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}><div style={{background:"#fff",padding:24,borderRadius:12,width:"100%",maxWidth:340}} onClick={e=>e.stopPropagation()}><h4 style={{fontSize:14,color:"#6B3410"}}>🔐 Validar Stock</h4><p style={{fontSize:11,color:"#888",marginBottom:12}}>Solo autorizados</p><div className="fld"><label>Usuario</label><input value={tAuthU} onChange={e=>{setTAuthU(e.target.value);setTAuthE("");}} placeholder="usuario" autoComplete="off"/></div><div className="fld" style={{marginTop:8}}><label>Contraseña</label><input type="password" value={tAuthP} onChange={e=>{setTAuthP(e.target.value);setTAuthE("");}} placeholder="contraseña" onKeyDown={e=>e.key==="Enter"&&confirmTowelAuth()} autoComplete="off"/></div>{tAuthE&&<p style={{color:"#c0392b",fontSize:11,marginTop:6}}>{tAuthE}</p>}<div style={{display:"flex",gap:8,marginTop:14}}><button className="ba bsm" onClick={confirmTowelAuth}>Confirmar</button><button className="bc bsm" onClick={()=>setTAuthM(false)}>Cancelar</button></div></div></div>}
    </div>
  );
}

/* PgAvisos - Conflicts + Notes */
function PgAvisos({ conflicts, rooms, types, setModal, setPg, curUser }) {
  const [notes, setNotes] = useState(() => loadNotes());
  const [newNote, setNewNote] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editText, setEditText] = useState("");
  useEffect(() => { saveNotes(notes); }, [notes]);

  const addNote = () => { if (!newNote.trim()) return; setNotes(p => [{ text: newNote.trim(), done: false, by: curUser.name, time: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }), date: TODAY }, ...p]); setNewNote(""); };
  const toggleNote = (i) => setNotes(p => p.map((n, j) => j === i ? { ...n, done: !n.done } : n));
  const deleteNote = (i) => setNotes(p => p.filter((_, j) => j !== i));
  const startEdit = (i) => { setEditIdx(i); setEditText(notes[i].text); };
  const saveEdit = () => { if (!editText.trim()) return; setNotes(p => p.map((n, j) => j === editIdx ? { ...n, text: editText.trim() } : n)); setEditIdx(null); };

  return (
    <div className="fi">
      <div className="pt"><h2 className="ptt">⚠️ Avisos</h2></div>

      {/* NOTES SECTION */}
      <div className="crd" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12, color: "#6B3410" }}>📝 Anotaciones del Día</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Ej: Cuarto 212 pidió agua hervida..." onKeyDown={e => e.key === "Enter" && addNote()} style={{ flex: 1 }} />
          <button className="ba bsm" onClick={addNote}>+ Agregar</button>
        </div>
        {notes.length === 0 && <p style={{ color: "#999", fontSize: 13, textAlign: "center", padding: 16 }}>Sin anotaciones</p>}
        {notes.map((n, i) => (
          <div key={i} className="note-item" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", background: n.done ? "#f0f0f0" : "#f9f7f4", borderRadius: 8, marginBottom: 6, border: "1px solid #e8e4de" }}>
            <button onClick={() => toggleNote(i)} style={{ background: "none", border: n.done ? "2px solid #27ae60" : "2px solid #ccc", borderRadius: 4, width: 22, height: 22, minWidth: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2, fontSize: 12, color: "#27ae60" }}>
              {n.done ? "✓" : ""}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editIdx === i ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === "Enter" && saveEdit()} style={{ flex: 1, fontSize: 13 }} />
                  <button className="ba bsm" onClick={saveEdit}>✓</button>
                  <button className="bc bsm" onClick={() => setEditIdx(null)}>×</button>
                </div>
              ) : (
                <span style={{ fontSize: 13, textDecoration: n.done ? "line-through" : "none", color: n.done ? "#999" : "var(--tx)", wordBreak: "break-word" }}>{n.text}</span>
              )}
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{n.by} · {n.time} · {n.date}</div>
            </div>
            {editIdx !== i && (
              <div style={{ display: "flex", gap: 2 }}>
                <button className="ab" style={{ fontSize: 13 }} onClick={() => startEdit(i)}>✏️</button>
                <button className="ab" style={{ fontSize: 13 }} onClick={() => deleteNote(i)}>🗑️</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* CONFLICTS */}
      <h3 style={{ fontSize: 15, marginBottom: 12, color: "#6B3410" }}>🔴 Interferencias de Reservas</h3>
      {conflicts.length === 0 ? (
        <div className="crd" style={{ textAlign: "center", padding: 30 }}>
          <span style={{ fontSize: 40, display: "block", marginBottom: 8 }}>✅</span>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#27ae60" }}>Sin interferencias</p>
          <p style={{ fontSize: 12, color: "#888" }}>Todas las reservas activas son compatibles.</p>
        </div>
      ) : (
        <>
          <div className="sr"><div className="sc" style={{ borderTopColor: "#c0392b" }}><div className="sn">{conflicts.length}</div><div className="sl">⚠️ Interferencias</div></div></div>
          {conflicts.map((c, idx) => {
            const rm = rooms.find(r => r.id === c.room); const tp2 = rm ? types.find(t => t.id === rm.type) : null;
            return (
              <div key={idx} className="crd" style={{ borderLeft: "4px solid #c0392b", marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#c0392b" }}>⚠️ Hab. {c.room} {tp2 ? "(" + tp2.name + ")" : ""}</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }} className="conflict-grid">
                  {[c.a, c.b].map((r, ri) => (
                    <div key={ri} style={{ background: "#fef3e2", padding: 10, borderRadius: 8, border: "1px solid #ffe0b2" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span className="tid">{r.id}</span>
                        <span className={"badge b-" + r.state.toLowerCase()} style={{ fontSize: 10 }}>{r.state}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{r.guest}</div>
                      <div style={{ fontSize: 12, color: "#555" }}><div>📥 {fmtDT(r.checkin)}</div><div>📤 {fmtDT(r.checkout)}</div></div>
                      <button className="bc bsm" style={{ marginTop: 8, width: "100%" }} onClick={() => setModal({ t: "res", d: r })}>✏️ Editar</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}


/* CSS */
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
.login-btn{width:100%;margin-top:16px;padding:12px;font-size:14px}.login-err{color:var(--rd);font-size:12px;margin-top:8px;text-align:center}
.hdr{background:var(--hb);color:var(--ht);padding:0 20px;display:flex;align-items:center;justify-content:space-between;min-height:56px;position:sticky;top:0;z-index:100;box-shadow:0 2px 12px rgba(0,0,0,.2)}
.hdr-l{display:flex;align-items:center;gap:10px}.hdr-ico{font-size:24px}.hdr-t{font-family:var(--FD);font-size:16px;font-weight:700;color:#FAEBD7}.hdr-s{font-size:10px;opacity:.7}
.hdr-nav{display:flex;gap:2px;flex-wrap:wrap;align-items:center}
.nv{background:transparent;color:rgba(250,235,215,.7);padding:7px 12px;border-radius:var(--R);font-size:12px;font-weight:500;display:flex;align-items:center;gap:4px;white-space:nowrap}
.nv:hover{background:rgba(255,255,255,.1);color:#FAEBD7}.nv.ac{background:rgba(255,255,255,.15);color:#fff;font-weight:600}.ni{font-size:13px}
.hdr-user{display:flex;align-items:center;gap:8px;margin-left:16px;padding-left:16px;border-left:1px solid rgba(255,255,255,.15)}
.hdr-uname{font-size:12px;color:rgba(250,235,215,.8)}.hdr-logout{background:rgba(255,255,255,.1);color:#FAEBD7;padding:4px 10px;border-radius:var(--R);font-size:11px}.hdr-logout:hover{background:rgba(255,255,255,.2)}
.cnt{max-width:1440px;margin:0 auto;padding:20px 24px 40px}
.pt{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px}
.ptt{font-family:var(--FD);font-size:20px;color:var(--tx)}.ptr{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sb{position:relative}.sb input{padding-left:32px;width:260px}.si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px}
.stats-date-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:var(--cb);border:1px solid var(--bd);border-radius:var(--R);flex-wrap:wrap}
.sr{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.sc{background:var(--cb);border:1px solid var(--bd);border-radius:var(--R);padding:12px 20px;min-width:100px;text-align:center;border-top:3px solid var(--bd)}
.srd{border-top-color:var(--rd)}.sor{border-top-color:var(--or)}.sgr{border-top-color:var(--gn)}
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
.mdl{background:var(--cb);border-radius:var(--R);width:90%;max-width:680px;max-height:85vh;overflow-y:auto;overflow-x:hidden;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.2)}
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
.at{width:100%;border-collapse:collapse;min-width:600px}.at th,.at td{border:1px solid #e8e4de}
.ath-r{padding:6px 10px;background:#f9f7f4;font-size:12px;font-weight:700;width:60px;text-align:center}
.ath-t{padding:6px 8px;background:#f9f7f4;font-size:10px;font-weight:500;width:60px;color:var(--ts)}
.ath-d{padding:5px 3px;background:#f9f7f4;text-align:center;min-width:70px}
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
.adv-row{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:#f9f7f4;border-radius:var(--R);margin-bottom:6px;border:1px solid #e8e4de}
.adv-num{font-weight:700;color:var(--a);font-size:14px;min-width:24px;padding-top:18px}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fadeIn .25s ease-out}
@keyframes pulse-warn{0%,100%{opacity:1}50%{opacity:.5}}.nv-warn{animation:pulse-warn 1.5s ease-in-out infinite}
.mob-only{display:none}
.mob-card{background:var(--cb);border:1px solid var(--bd);border-radius:var(--R);padding:12px;margin-bottom:10px}
.mob-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.mob-guest{font-size:16px;font-weight:700;color:var(--tx);margin-bottom:6px}
.mob-row{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--ts);margin-bottom:3px}
.mob-money{display:flex;gap:8px;margin:8px 0;padding:8px;background:#f9f7f4;border-radius:6px}
.mob-money>div{flex:1;text-align:center}
.mob-lbl{display:block;font-size:9px;text-transform:uppercase;color:var(--mu);letter-spacing:.3px}
.mob-val{display:block;font-size:14px;font-weight:700}
.mob-actions{display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)}
@media(max-width:900px){.hab-detail{grid-template-columns:1fr}}
@media(max-width:768px){
.desk-only{display:none}.mob-only{display:block}
.hdr{flex-direction:column;padding:10px 12px;gap:6px;position:relative}
.hdr-l{gap:6px}.hdr-t{font-size:14px}.hdr-s{font-size:9px}
.hdr-nav{justify-content:center;flex-wrap:wrap;gap:1px;width:100%}
.nv{padding:5px 8px;font-size:11px;gap:2px}.ni{font-size:11px}
.hdr-user{margin-left:0;padding-left:0;border-left:none;border-top:1px solid rgba(255,255,255,.15);padding-top:6px;width:100%;justify-content:center}
.cnt{padding:10px 8px 30px}
.pt{flex-direction:column;align-items:flex-start;gap:8px}
.ptr{width:100%;flex-wrap:wrap}
.sb{width:100%}.sb input{width:100%}
.fg{grid-template-columns:1fr}
.sr{flex-wrap:wrap;gap:8px}.sc{min-width:70px;padding:8px 10px}.sn{font-size:18px}
.stats-date-row{flex-wrap:wrap}
.tw{font-size:11px}
.tb th{padding:6px 5px;font-size:9px}.tb td{padding:6px 5px;font-size:11px}
.mdl{width:95%;max-width:none;padding:16px;max-height:90vh}
.mdl h3{font-size:15px;margin-bottom:10px}
.mf{flex-direction:column}.mf button{width:100%;padding:12px}
.adv-row{flex-wrap:wrap;gap:4px}
.adv-num{padding-top:0;min-width:20px}
.fr{gap:3px}.fb{padding:4px 10px;font-size:11px}
.ba{padding:10px 16px;font-size:14px}
.lr{flex-direction:column;align-items:flex-start;gap:6px}
.lnfo{margin-left:0}
.at{min-width:400px}.ath-d{min-width:55px}
.conflict-grid{grid-template-columns:1fr!important}
}
@media(max-width:600px){.at{min-width:320px}.ath-d{min-width:48px}}
`;




