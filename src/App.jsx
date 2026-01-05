import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, Receipt, UploadCloud, History, 
  Camera, LogOut, ShieldCheck, TrendingUp, AlertTriangle, Eye, FileSpreadsheet
} from 'lucide-react';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MESES_SISTEMA = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const COLOR_PIKHN = "#1e3563";
const COLOR_AZUL_CONTABLE = "#0096d2"; 
const COLOR_ACCENT = "#ffd100";

// CONFIGURACIÓN DE ACCESOS
const ADMIN_EMAIL = "administracion@procoopsa.com";
const CORES_ADMIN_EXTENDIDO = [
  ADMIN_EMAIL, 
  "cavendano@chorotega.hn", 
  "mrodriguez@chorotega.hn"
];

const HOY = new Date().toISOString().split('T')[0];

function App() {
  const [session, setSession] = useState(null);
  const [seccion, setSeccion] = useState('reportes');
  const [lineas, setLineas] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [tipoVista, setTipoVista] = useState('mensual');
  const [mesFiltro, setMesFiltro] = useState(MESES_SISTEMA[new Date().getMonth()]);
  const [tiendaFiltro, setTiendaFiltro] = useState('TODAS');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [archivoExcel, setArchivoExcel] = useState(null);

  const [compra, setCompra] = useState({ tiendaSeleccionada: '', lineaId: '', monto: '', desc: '', foto: null, fecha: HOY });

  const esAdmin = session?.user?.email && CORES_ADMIN_EXTENDIDO.includes(session.user.email.toLowerCase());
  
  const MAPA_ACCESOS = { 
    [ADMIN_EMAIL]: "Nacional",
    "cavendano@chorotega.hn": "Nacional",
    "mrodriguez@chorotega.hn": "Nacional",
    "pikhnsps@procoopsa.com": "SPS", 
    "pikhncholuteca@procoopsa.com": "Choluteca", 
    "pikhnva@procoopsa.com": "VA" 
  };
  
  const tiendaActiva = esAdmin ? tiendaFiltro : (MAPA_ACCESOS[session?.user?.email.toLowerCase()] || 'Nacional');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) obtenerDatos(); }, [session]);

  const obtenerDatos = async () => {
    const { data: p } = await supabase.from('presupuestos').select('*');
    const { data: c } = await supabase.from('compras').select('*, presupuestos(*)').order('fecha', { ascending: false });
    setLineas(p || []);
    setHistorial(c || []);
  };

  const importarExcelPikHN = async () => {
    if (!archivoExcel) return alert("Por favor, selecciona un archivo primero.");
    setLoading(true);
    const reader = new FileReader();
    reader.readAsArrayBuffer(archivoExcel);
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: 0 });
        const mapaMeses = {
          "enero": "Ene", "febrero": "Feb", "marzo": "Mar", "abril": "Abr",
          "mayo": "May", "junio": "Jun", "julio": "Jul", "agosto": "Ago",
          "septiembre": "Sep", "octubre": "Oct", "noviembre": "Nov", "diciembre": "Dic"
        };
        const filasParaSubir = [];
        json.forEach((filaRaw) => {
          const fila = Object.keys(filaRaw).reduce((acc, key) => {
            acc[key.toLowerCase().trim()] = filaRaw[key];
            return acc;
          }, {});
          const nombreLinea = fila["línea"] || fila["linea"];
          const responsableTienda = fila["responsable"] || fila["tienda"];
          if (nombreLinea && responsableTienda && !nombreLinea.toString().toLowerCase().includes("total")) {
            Object.keys(mapaMeses).forEach(mesExcel => {
              const mesSistema = mapaMeses[mesExcel];
              let valorRaw = fila[mesExcel];
              let monto = 0;
              if (valorRaw !== null && valorRaw !== undefined) {
                const limpio = valorRaw.toString().replace(/[^\d.]/g, "");
                monto = parseFloat(limpio) || 0;
              }
              filasParaSubir.push({
                linea_nombre: nombreLinea.toString().trim(),
                responsable: responsableTienda.toString().trim(),
                mes: mesSistema,
                monto_inicial: monto,
                monto_actual: monto
              });
            });
          }
        });
        if (filasParaSubir.length === 0) throw new Error("No se detectaron datos válidos.");
        await supabase.from('presupuestos').delete().neq('id', 0);
        const { error } = await supabase.from('presupuestos').insert(filasParaSubir);
        if (error) throw error;
        alert(`✅ Presupuesto cargado exitosamente.`);
        setArchivoExcel(null);
        obtenerDatos();
        setSeccion('reportes');
      } catch (err) { alert("Error: " + err.message); } finally { setLoading(false); }
    };
  };

  const stats = useMemo(() => {
    const filtradas = lineas.filter(l => {
      const tOk = (tiendaActiva === 'TODAS') || l.responsable === tiendaActiva;
      const fOk = tipoVista === 'anual' ? true : l.mes === mesFiltro;
      return tOk && fOk;
    });
    const tP = filtradas.reduce((a, b) => a + b.monto_inicial, 0);
    const tD = filtradas.reduce((a, b) => a + b.monto_actual, 0);
    const tG = tP - tD;
    const ranking = Object.values(filtradas.reduce((acc, curr) => {
      if (!acc[curr.linea_nombre]) acc[curr.linea_nombre] = { nombre: curr.linea_nombre, inicial: 0, actual: 0 };
      acc[curr.linea_nombre].inicial += curr.monto_inicial;
      acc[curr.linea_nombre].actual += curr.monto_actual;
      return acc;
    }, {})).sort((a, b) => (b.inicial - b.actual) - (a.inicial - a.actual));
    return { totalP: tP, totalG: tG, totalD: tD, ranking, porcGlobal: tP > 0 ? (tG / tP) * 100 : 0 };
  }, [lineas, tiendaActiva, mesFiltro, tipoVista]);

  const historialFiltrado = useMemo(() => {
    return historial.filter(h => {
      const tiendaOk = (tiendaActiva === 'TODAS') || h.presupuestos?.responsable === tiendaActiva;
      const mesOk = (tipoVista === 'anual') || h.presupuestos?.mes === mesFiltro;
      return tiendaOk && mesOk;
    });
  }, [historial, tiendaActiva, mesFiltro, tipoVista]);

  const descargarExcel = () => {
    const dataExport = stats.ranking.map(l => ({
      "Línea": l.nombre,
      "Tienda/Sede": tiendaActiva,
      "Presupuesto": l.inicial,
      "Gasto Real": l.inicial - l.actual,
      "Saldo Disponible": l.actual
    }));
    const ws = XLSX.utils.json_to_sheet(dataExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte");
    XLSX.writeFile(wb, `Reporte_PikHN_${tiendaActiva}.xlsx`);
  };

  const verFoto = (path) => {
    const { data } = supabase.storage.from('facturas').getPublicUrl(path);
    window.open(data.publicUrl, '_blank');
  };

  const registrarGasto = async () => {
    if (!compra.lineaId || !compra.monto || !compra.foto) return alert("Faltan datos");
    const montoGasto = parseFloat(compra.monto);
    const fechaObj = new Date(compra.fecha + 'T12:00:00');
    const mesGastoIdx = fechaObj.getMonth();
    const lineaSel = lineas.find(l => l.id.toString() === compra.lineaId.toString());
    const todasIguales = lineas.filter(l => l.linea_nombre === lineaSel.linea_nombre && l.responsable === lineaSel.responsable);
    
    const lineasDisponibles = todasIguales
      .filter(l => MESES_SISTEMA.indexOf(l.mes) <= mesGastoIdx)
      .sort((a, b) => MESES_SISTEMA.indexOf(a.mes) - MESES_SISTEMA.indexOf(b.mes));

    const totalDisponibleAcumulado = lineasDisponibles.reduce((a, b) => a + b.monto_actual, 0);

    if (montoGasto > totalDisponibleAcumulado) {
      alert(`🚫 FONDOS INSUFICIENTES: No se permiten sobregiros.\n\nDisponible acumulado (Ene - ${lineaSel.mes}): L${totalDisponibleAcumulado.toLocaleString()}\nIntentado: L${montoGasto.toLocaleString()}`);
      return;
    }

    setLoading(true);
    try {
      const ext = compra.foto.name.split('.').pop();
      const nombreFoto = `${Date.now()}.${ext}`;
      await supabase.storage.from('facturas').upload(nombreFoto, compra.foto);
      
      let restante = montoGasto;
      for (let l of lineasDisponibles) {
          if (restante <= 0) break;
          let disponibleEnMes = l.monto_actual;
          if (disponibleEnMes <= 0) continue;

          let aQuitar = Math.min(disponibleEnMes, restante);
          await supabase.from('presupuestos').update({ monto_actual: disponibleEnMes - aQuitar }).eq('id', l.id);
          restante -= aQuitar;
      }

      await supabase.from('compras').insert([{ 
        presupuesto_id: lineaSel.id, monto_lps: montoGasto, descripcion: compra.desc, fecha: compra.fecha, url_factura: nombreFoto, creado_por: session.user.email 
      }]);

      alert("✅ Gasto registrado con éxito.");
      setCompra({ ...compra, monto: '', desc: '', foto: null, lineaId: '' });
      obtenerDatos();
    } catch (e) { alert("Error: " + e.message); } finally { setLoading(false); }
  };

  if (!session) return (
    <div style={loginWrapper}>
      <div style={loginCard}>
        <h1 style={{color: COLOR_PIKHN, fontWeight:800}}>PIKHN</h1>
        <form onSubmit={async (e)=>{e.preventDefault(); const {error}=await supabase.auth.signInWithPassword({email, password}); if(error) alert("Credenciales incorrectas");}}>
          <input type="email" placeholder="Usuario" style={inputStyle} onChange={e=>setEmail(e.target.value)} />
          <input type="password" placeholder="Contraseña" style={inputStyle} onChange={e=>setPassword(e.target.value)} />
          <button type="submit" style={{...btn, background: COLOR_PIKHN}}>INGRESAR</button>
        </form>
      </div>
    </div>
  );

  return (
    <div style={appContainer}>
      <header style={headerStyle}>
        <div style={{display:'flex', alignItems:'center', gap:'10px'}}><ShieldCheck size={22} color={COLOR_ACCENT}/><span style={{fontWeight:800}}>CONTROL DE PRESPUESTO PIKHN</span></div>
        <button onClick={()=>supabase.auth.signOut()} style={logoutBtn}><LogOut size={18}/></button>
      </header>

      <main style={mainStyle}>
        {(seccion === 'reportes' || seccion === 'analisis') && (
            <div style={card}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                    <div style={toggleContainer}>
                        <button onClick={()=>setTipoVista('mensual')} style={tipoVista==='mensual'?toggleActive:toggleInactive}>MENSUAL</button>
                        <button onClick={()=>setTipoVista('anual')} style={tipoVista==='anual'?toggleActive:toggleInactive}>ANUAL</button>
                    </div>
                    <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                      <button onClick={descargarExcel} style={eyeBtn} title="Excel"><FileSpreadsheet size={18} color={COLOR_AZUL_CONTABLE}/></button>
                      {esAdmin && <select style={{...inputStyle, width:'auto', marginBottom:0}} value={tiendaFiltro} onChange={e=>setTiendaFiltro(e.target.value)}><option value="TODAS">TODAS</option><option value="SPS">SPS</option><option value="Choluteca">Choluteca</option><option value="VA">VA</option><option value="Nacional">Nacional</option></select>}
                    </div>
                </div>
                {tipoVista === 'mensual' && <select style={{...inputStyle, marginBottom:0}} value={mesFiltro} onChange={e=>setMesFiltro(e.target.value)}>{MESES_SISTEMA.map(m=><option key={m} value={m}>{m}</option>)}</select>}
            </div>
        )}

        {seccion === 'compras' && esAdmin && (
          <div style={card}>
            <h3 style={cardTitle}><Receipt size={18}/> NUEVO GASTO</h3>
            <input type="date" max={HOY} style={inputStyle} value={compra.fecha} onChange={e=>setCompra({...compra, fecha:e.target.value, lineaId:''})} />
            <select style={inputStyle} value={compra.tiendaSeleccionada} onChange={e=>setCompra({...compra, tiendaSeleccionada:e.target.value, lineaId:''})}><option value="">Tienda...</option><option value="SPS">SPS</option><option value="Choluteca">Choluteca</option><option value="VA">VA</option><option value="Nacional">Nacional</option></select>
            <select style={inputStyle} value={compra.lineaId} onChange={e=>setCompra({...compra, lineaId:e.target.value})} disabled={!compra.tiendaSeleccionada}>
                <option value="">Línea...</option>
                {lineas.filter(l => l.responsable === compra.tiendaSeleccionada && l.mes === MESES_SISTEMA[new Date(compra.fecha + 'T12:00:00').getMonth()] && l.monto_actual > 0).map(l => (
                    <option key={l.id} value={l.id}>{l.linea_nombre} (Saldo: L{l.monto_actual.toLocaleString()})</option>
                ))}
            </select>
            <input type="number" placeholder="Monto" style={inputStyle} value={compra.monto} onChange={e=>setCompra({...compra, monto:e.target.value})} />
            <input type="text" placeholder="Concepto" style={inputStyle} value={compra.desc} onChange={e=>setCompra({...compra, desc:e.target.value})} />
            <label style={cameraBtn}><Camera size={18}/> {compra.foto ? "LISTO ✅" : "ADJUNTAR"} <input type="file" accept="image/*" capture="environment" hidden onChange={e=>setCompra({...compra, foto:e.target.files[0]})} /></label>
            <button onClick={registrarGasto} style={{...btn, background: COLOR_PIKHN}} disabled={loading}>{loading ? "PROCESANDO..." : "REGISTRAR"}</button>
          </div>
        )}

        {seccion === 'reportes' && (
            <div style={{marginTop:'15px'}}>
                <div style={dashboardGrid}>
                    <div style={dashItemCard}><span style={dashLabel}>PRESUPUESTO</span><br/><b>L{stats.totalP.toLocaleString()}</b></div>
                    <div style={{...dashItemCard, borderLeft:'1px solid #eee', borderRight:'1px solid #eee'}}><span style={dashLabel}>GASTADO</span><br/><b style={{color:'#dc2626'}}>L{stats.totalG.toLocaleString()}</b></div>
                    <div style={dashItemCard}><span style={dashLabel}>DISPONIBLE</span><br/><b style={{color: COLOR_AZUL_CONTABLE}}>L{stats.totalD.toLocaleString()}</b></div>
                </div>
                <div style={{...card, marginTop:'15px'}}>
                    <h3 style={cardTitle}><History size={18}/> HISTORIAL</h3>
                    {historialFiltrado.slice(0,15).map(h => (
                        <div key={h.id} style={historyItem}>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:700, fontSize:'12px'}}>{h.presupuestos?.linea_nombre}</div>
                              <div style={{fontSize:'10px', color:'#94a3b8'}}>{h.fecha} • {h.creado_por || h.presupuestos?.responsable}</div>
                            </div>
                            <div style={{textAlign:'right', display:'flex', alignItems:'center', gap:'10px'}}>
                                <div style={{color:'#dc2626', fontWeight:800, fontSize:'12px'}}>-L{h.monto_lps.toLocaleString()}</div>
                                <button onClick={() => verFoto(h.url_factura)} style={eyeBtn}><Eye size={16}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {seccion === 'analisis' && (
            <div style={{marginTop:'15px'}}>
                <div style={card}>
                    <h3 style={cardTitle}><TrendingUp size={18}/> EJECUCIÓN GLOBAL</h3>
                    <div style={{marginTop:'15px'}}>
                        <div style={{width:'100%', background:'#f1f5f9', height:'24px', borderRadius:'6px', overflow:'hidden'}}>
                            <div style={{height:'100%', background: COLOR_PIKHN, width: `${Math.min(stats.porcGlobal, 100)}%`}}></div>
                        </div>
                        <p style={{fontSize:'11px', fontWeight:800, textAlign:'center', marginTop:'8px'}}>{stats.porcGlobal.toFixed(1)}% CONSUMIDO</p>
                    </div>
                </div>
                <div style={{...card, marginTop:'15px'}}>
                    <h3 style={cardTitle}><AlertTriangle size={18}/> DETALLE POR LÍNEA</h3>
                    {stats.ranking.slice(0, 10).map(linea => {
                        const gastado = linea.inicial - linea.actual;
                        const porc = linea.inicial > 0 ? (gastado / linea.inicial) * 100 : 0;
                        if (linea.inicial <= 0) return null;
                        return (
                            <div key={linea.nombre} style={{marginBottom:'18px'}}>
                                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}>
                                    <span style={{fontWeight:800, fontSize:'11px', color:COLOR_PIKHN}}>{linea.nombre.toUpperCase()}</span>
                                    <span style={{color:'#dc2626', fontWeight:800, fontSize:'11px'}}>L{gastado.toLocaleString()}</span>
                                </div>
                                <div style={{width:'100%', background:'#f1f5f9', height:'8px', borderRadius:'10px', overflow:'hidden'}}>
                                    <div style={{height:'100%', borderRadius:'10px', background: porc > 90 ? '#dc2626' : COLOR_PIKHN, width: `${Math.min(porc, 100)}%`}}></div>
                                </div>
                                <div style={{display:'flex', justifyContent:'space-between', fontSize:'9px', marginTop:'5px', fontWeight:600}}>
                                    <span>{porc.toFixed(1)}% Ejecutado</span>
                                    <span style={{color: COLOR_AZUL_CONTABLE}}>Saldo: L{linea.actual.toLocaleString()}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}

        {seccion === 'config' && esAdmin && (
          <div style={card}>
            <h3 style={cardTitle}><UploadCloud size={18}/> CARGAR EXCEL</h3>
            <input type="file" accept=".xlsx, .xls" style={{margin:'20px 0', fontSize:'12px'}} onChange={(e) => setArchivoExcel(e.target.files[0])} />
            <button onClick={importarExcelPikHN} style={{...btn, background: loading ? '#94a3b8' : COLOR_AZUL_CONTABLE}} disabled={loading}>{loading ? "PROCESANDO..." : "CARGAR PRESUPUESTO"}</button>
          </div>
        )}
      </main>

      <nav style={navBar}>
        {esAdmin && <button onClick={()=>setSeccion('compras')} style={seccion==='compras'?navBtnActive:navBtn}><Receipt size={24}/><span>Gasto</span></button>}
        <button onClick={()=>setSeccion('reportes')} style={seccion==='reportes'?navBtnActive:navBtn}><LayoutDashboard size={24}/><span>Panel</span></button>
        <button onClick={()=>setSeccion('analisis')} style={seccion==='analisis'?navBtnActive:navBtn}><TrendingUp size={24}/><span>Análisis</span></button>
        {esAdmin && <button onClick={()=>setSeccion('config')} style={seccion==='config'?navBtnActive:navBtn}><UploadCloud size={24}/><span>Excel</span></button>}
      </nav>
    </div>
  );
}

const appContainer = { minHeight:'100vh', background:'#f8fafc', paddingBottom:'110px', fontFamily:"'Plus Jakarta Sans', sans-serif" };
const loginWrapper = { display:'flex', height:'100vh', alignItems:'center', justifyContent:'center', background: COLOR_PIKHN };
const loginCard = { background:'white', padding:'40px', borderRadius:'30px', textAlign:'center', width:'340px' };
const headerStyle = { background: COLOR_PIKHN, color:'white', padding:'20px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:100 };
const mainStyle = { padding:'15px', maxWidth:'600px', margin:'0 auto' };
const card = { background:'white', padding:'20px', borderRadius:'24px', boxShadow:'0 1px 3px rgba(0,0,0,0.1)' };
const inputStyle = { width:'100%', padding:'12px', borderRadius:'12px', border:'1px solid #e2e8f0', marginBottom:'12px', fontSize:'13px', boxSizing:'border-box', fontWeight:600 };
const btn = { width:'100%', padding:'15px', color:'white', border:'none', borderRadius:'12px', fontWeight:800, cursor:'pointer' };
const cameraBtn = { display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', padding:'12px', background:'#f1f5f9', borderRadius:'12px', marginBottom:'15px', fontSize:'12px', cursor:'pointer', fontWeight:700 };
const dashboardGrid = { display:'flex', background:'white', borderRadius:'24px', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', overflow:'hidden' };
const dashItemCard = { padding:'20px', flex:1, textAlign:'center' };
const dashLabel = { fontSize:'9px', color:'#64748b', fontWeight:800 };
const cardTitle = { fontSize:'12px', fontWeight:800, display:'flex', alignItems:'center', gap:'8px', color: COLOR_PIKHN };
const toggleContainer = { display:'flex', background:'#f1f5f9', borderRadius:'12px', padding:'4px' };
const toggleActive = { border:'none', background:'white', padding:'8px 16px', borderRadius:'10px', fontSize:'10px', fontWeight:800, color:COLOR_PIKHN, boxShadow:'0 2px 4px rgba(0,0,0,0.1)' };
const toggleInactive = { border:'none', background:'none', padding:'8px 16px', borderRadius:'10px', fontSize:'10px', fontWeight:700, color:'#94a3b8' };
const navBar = { position:'fixed', bottom:0, width:'100%', background:'white', display:'flex', borderTop:'1px solid #f1f5f9', height:'90px', left:0, justifyContent:'space-around' };
const navBtn = { border:'none', background:'none', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:'10px', fontWeight:700, gap:'5px' };
const navBtnActive = { ...navBtn, color: COLOR_PIKHN };
const historyItem = { padding:'12px 0', borderBottom:'1px solid #f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' };
const logoutBtn = { background:'rgba(255,255,255,0.1)', border:'none', color:'white', padding:'8px', borderRadius:'10px' };
const eyeBtn = { background:'#f1f5f9', border:'none', padding:'8px', borderRadius:'8px', cursor:'pointer', color: COLOR_PIKHN };

export default App;