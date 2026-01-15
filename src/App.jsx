import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, Receipt, UploadCloud, History, 
  Camera, LogOut, ShieldCheck, TrendingUp, AlertTriangle, Eye, FileSpreadsheet, BarChart3, ListFilter, Download, Info, AlertCircle, Search, Check, List, ToggleRight, ToggleLeft
} from 'lucide-react';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MESES_SISTEMA = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const COLOR_PIKHN = "#1e3563";
const COLOR_AZUL_CONTABLE = "#0096d2"; 
const COLOR_ACCENT = "#ffd100";

const normalizar = (str) => str?.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() || "";

const ADMIN_EMAIL = "administracion@procoopsa.com";
const CORES_ADMIN_EXTENDIDO = [ADMIN_EMAIL, "cavendano@chorotega.hn", "mrodriguez@chorotega.hn"];
const HOY = new Date().toISOString().split('T')[0];

function App() {
  const [session, setSession] = useState(null);
  const [seccion, setSeccion] = useState('reportes');
  const [lineas, setLineas] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [tipoVista, setTipoVista] = useState('mensual');
  const [mesFiltro, setMesFiltro] = useState(MESES_SISTEMA[new Date().getMonth()]);
  const [tiendaFiltro, setTiendaFiltro] = useState('TODAS');
  const [tipoGastoFiltro, setTipoGastoFiltro] = useState(null); 
  const [consolidarAnalisis, setConsolidarAnalisis] = useState(false);
  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  const [busquedaEjecucion, setBusquedaEjecucion] = useState('');
  const [busquedaAnalisis, setBusquedaAnalisis] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [archivoExcel, setArchivoExcel] = useState(null);

  const [compra, setCompra] = useState({ tiendaSeleccionada: '', lineaId: '', monto: '', desc: '', foto: null, fecha: HOY });

  const esAdmin = session?.user?.email && CORES_ADMIN_EXTENDIDO.includes(session.user.email.toLowerCase());
  const MAPA_ACCESOS = { [ADMIN_EMAIL]: "Nacional", "pikhnsps@procoopsa.com": "SPS", "pikhncholuteca@procoopsa.com": "Choluteca", "pikhnva@procoopsa.com": "VA" };
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

  const registrarGasto = async () => {
    if (!compra.lineaId || !compra.monto || !compra.foto) return alert("Faltan datos");
    const montoGasto = parseFloat(compra.monto);
    const fechaObj = new Date(compra.fecha + 'T12:00:00');
    const mesGastoIdx = fechaObj.getMonth();
    const lineaSel = lineas.find(l => l.id.toString() === compra.lineaId.toString());
    if (!lineaSel) return alert("Línea no encontrada");

    const esEspecial = normalizar(lineaSel.linea_nombre).includes("energia") || normalizar(lineaSel.linea_nombre).includes("internet");
    
    const lineasAcumuladas = lineas.filter(l => l.linea_nombre === lineaSel.linea_nombre && l.responsable === lineaSel.responsable && MESES_SISTEMA.indexOf(l.mes) <= mesGastoIdx).sort((a, b) => MESES_SISTEMA.indexOf(a.mes) - MESES_SISTEMA.indexOf(b.mes));
    const disponibleMesActual = lineasAcumuladas.reduce((a, b) => a + b.monto_actual, 0);

    const todasLasLineasAno = lineas.filter(l => l.linea_nombre === lineaSel.linea_nombre && l.responsable === lineaSel.responsable);
    const disponibleTotalAno = todasLasLineasAno.reduce((a, b) => a + b.monto_actual, 0);

    if (montoGasto > disponibleTotalAno) return alert("Gasto excede el presupuesto anual disponible.");

    let requiereSobregiro = false;
    let montoMesActual = montoGasto;
    let montoAsobregirar = 0;
    let mesDestino = "";
    const refUnica = `REF-${Date.now()}`;

    if (montoGasto > disponibleMesActual) {
        if (!esEspecial) return alert("Saldo insuficiente. Esta línea no permite sobregiros.");
        requiereSobregiro = true;
        montoMesActual = disponibleMesActual;
        montoAsobregirar = montoGasto - disponibleMesActual;
        const sigMesIdx = mesGastoIdx + 1;
        mesDestino = sigMesIdx < 12 ? MESES_SISTEMA[sigMesIdx] : "Sig. Periodo";

        const confirmar = window.confirm(`🚨 SOBREGIRO\nTotal Factura: L${montoGasto.toLocaleString()}\nSe cargarán L${montoAsobregirar.toLocaleString()} al mes de ${mesDestino}.`);
        if (!confirmar) return;
    }

    setLoading(true);
    try {
      const nombreFoto = `${Date.now()}.${compra.foto.name.split('.').pop()}`;
      await supabase.storage.from('facturas').upload(nombreFoto, compra.foto);
      
      let restante = montoMesActual;
      let distLog = `Factura total: L${montoGasto.toLocaleString()}. `;

      for (let l of lineasAcumuladas) {
        if (restante <= 0) break;
        let quitar = Math.min(l.monto_actual, restante);
        await supabase.from('presupuestos').update({ monto_actual: l.monto_actual - quitar }).eq('id', l.id);
        distLog += `${l.mes}: L${quitar.toLocaleString()}. `;
        restante -= quitar;
      }
      
      if (requiereSobregiro) {
          const sigMesIdx = mesGastoIdx + 1;
          const lSiguiente = lineas.find(l => l.linea_nombre === lineaSel.linea_nombre && l.responsable === lineaSel.responsable && MESES_SISTEMA.indexOf(l.mes) === sigMesIdx);
          if (lSiguiente) {
              await supabase.from('presupuestos').update({ monto_actual: lSiguiente.monto_actual - montoAsobregirar }).eq('id', lSiguiente.id);
              await supabase.from('compras').insert([{ 
                presupuesto_id: lSiguiente.id, monto_lps: montoAsobregirar, descripcion: `${compra.desc} | REF:${refUnica}`, 
                fecha: compra.fecha, url_factura: nombreFoto, creado_por: "SISTEMA", es_arrastre: true, dist_info: distLog + `${mesDestino}: L${montoAsobregirar.toLocaleString()}.`
              }]);
          }
          await supabase.from('presupuestos').update({ sobregiro_monto: montoAsobregirar, sobregiro_mes_destino: mesDestino }).eq('id', lineaSel.id);
          distLog += `${mesDestino}: L${montoAsobregirar.toLocaleString()}.`;
      }

      await supabase.from('compras').insert([{ 
        presupuesto_id: lineaSel.id, monto_lps: montoMesActual, descripcion: `${compra.desc} | REF:${refUnica}`, 
        fecha: compra.fecha, url_factura: nombreFoto, creado_por: session.user.email,
        es_sobregiro: requiereSobregiro, monto_excedente: montoAsobregirar, mes_excedente: mesDestino, dist_info: distLog
      }]);

      alert("✅ Gasto registrado"); setCompra({ ...compra, monto: '', desc: '', foto: null, lineaId: '' }); obtenerDatos();
    } catch (e) { alert(e.message); } finally { setLoading(false); }
  };

  const importarExcelPikHN = async () => {
    if (!archivoExcel) return alert("Selecciona un archivo");
    setLoading(true);
    const reader = new FileReader();
    reader.readAsArrayBuffer(archivoExcel);
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: 0 });
        const mapaMeses = { "enero": "Ene", "febrero": "Feb", "marzo": "Mar", "abril": "Abr", "mayo": "May", "junio": "Jun", "julio": "Jul", "agosto": "Ago", "septiembre": "Sep", "octubre": "Oct", "noviembre": "Nov", "diciembre": "Dic" };
        const filasParaSubir = [];
        json.forEach((filaRaw) => {
          const fila = {};
          Object.keys(filaRaw).forEach(k => { fila[normalizar(k)] = filaRaw[k]; });
          const nombreLinea = fila["linea"] || fila["línea"];
          const responsableTienda = fila["responsable"] || fila["tienda"];
          let tGasto = fila["tipo de gasto"] || fila["tipo"] || "Administracion";
          if (nombreLinea && responsableTienda && !normalizar(nombreLinea).includes("total")) {
            Object.keys(mapaMeses).forEach(mesExcel => {
              if (fila[mesExcel] !== undefined) {
                const mesSistema = mapaMeses[mesExcel];
                let montoStr = fila[mesExcel]?.toString().replace(/[^\d.]/g, "") || "0";
                let monto = parseFloat(montoStr) || 0;
                filasParaSubir.push({ 
                  linea_nombre: nombreLinea.toString().trim(), responsable: responsableTienda.toString().trim(), 
                  tipo_gasto: tGasto, mes: mesSistema, monto_inicial: monto, monto_actual: monto,
                  sobregiro_monto: 0, sobregiro_mes_destino: null
                });
              }
            });
          }
        });
        await supabase.from('presupuestos').delete().neq('id', 0);
        await supabase.from('presupuestos').insert(filasParaSubir);
        alert(`✅ Presupuesto cargado con éxito`); obtenerDatos();
      } catch (err) { alert(err.message); } finally { setLoading(false); }
    };
  };

  const stats = useMemo(() => {
    const filtradas = (lineas || []).filter(l => (tiendaActiva === 'TODAS' || l.responsable === tiendaActiva) && (tipoVista === 'anual' ? true : l.mes === mesFiltro));
    const ranking = Object.values(filtradas.reduce((acc, curr) => {
      const key = (consolidarAnalisis) ? `${curr.linea_nombre}` : `${curr.linea_nombre}_${curr.responsable}`;
      if (!acc[key]) acc[key] = { ...curr, nombre: curr.linea_nombre, inicial: 0, actual: 0, tipo: curr.tipo_gasto, r: (consolidarAnalisis) ? 'Nacional' : curr.responsable };
      acc[key].inicial += curr.monto_inicial;
      acc[key].actual += curr.monto_actual;
      return acc;
    }, {}));
    const tP = filtradas.reduce((a, b) => a + b.monto_inicial, 0);
    const tD = filtradas.reduce((a, b) => a + b.monto_actual, 0);
    const porTipoGasto = ["Administracion", "Personal", "Venta"].map(t => {
        const sub = filtradas.filter(l => normalizar(l.tipo_gasto || "") === normalizar(t));
        const ini = sub.reduce((a, b) => a + b.monto_inicial, 0);
        const act = sub.reduce((a, b) => a + b.monto_actual, 0);
        return { tipo: t, inicial: ini, gastado: ini - act };
    });
    return { totalP: tP, totalG: tP - tD, totalD: tD, ranking, porTipoGasto, porcGlobal: tP > 0 ? ((tP - tD) / tP) * 100 : 0 };
  }, [lineas, tiendaActiva, mesFiltro, tipoVista, consolidarAnalisis]);

  const historialFinal = useMemo(() => {
    let base = (historial || []).filter(h => (tiendaActiva === 'TODAS' || h.presupuestos?.responsable === tiendaActiva));
    if (tipoVista === 'mensual') {
      base = base.filter(h => h.presupuestos?.mes === mesFiltro);
    } else {
      const agrupado = {};
      base.forEach(h => {
        const refMatch = h.descripcion?.match(/REF:(REF-\d+)/);
        const ref = refMatch ? refMatch[1] : `ID-${h.id}`;
        if (!agrupado[ref]) agrupado[ref] = { ...h, monto_lps: 0, mostrarInfoAnual: h.es_sobregiro || h.es_arrastre };
        agrupado[ref].monto_lps += h.monto_lps;
        if (h.es_sobregiro || h.es_arrastre) agrupado[ref].mostrarInfoAnual = true;
      });
      base = Object.values(agrupado);
    }
    return base.filter(h => 
        h.descripcion?.toLowerCase().includes(busquedaHistorial.toLowerCase()) || 
        h.presupuestos?.linea_nombre?.toLowerCase().includes(busquedaHistorial.toLowerCase())
    );
  }, [historial, tiendaActiva, tipoVista, mesFiltro, busquedaHistorial]);

  const calcularSaldoParaSelect = (lineaNombre, responsable, fecha) => {
    const mesIdx = new Date(fecha + 'T12:00:00').getMonth();
    return lineas.filter(l => l.linea_nombre === lineaNombre && l.responsable === responsable && MESES_SISTEMA.indexOf(l.mes) <= mesIdx).reduce((a, b) => a + b.monto_actual, 0);
  };

  if (!session) return (
    <div style={loginWrapper}>
      <div style={loginCard}><h1 style={{color: COLOR_PIKHN, fontWeight:800}}>PIKHN</h1><form onSubmit={async (e)=>{e.preventDefault(); const {error}=await supabase.auth.signInWithPassword({email, password}); if(error) alert("Error de acceso");}}><input type="email" placeholder="Usuario" style={inputStyle} onChange={e=>setEmail(e.target.value)} /><input type="password" placeholder="Contraseña" style={inputStyle} onChange={e=>setPassword(e.target.value)} /><button type="submit" style={{...btn, background: COLOR_PIKHN, color: 'white'}}>INGRESAR</button></form></div>
    </div>
  );

  return (
    <div style={appContainer}>
      <header style={headerStyle}>
        <div style={{display:'flex', alignItems:'center', gap:'10px'}}><ShieldCheck size={22} color={COLOR_ACCENT}/><span style={{fontWeight:800}}>PIKHN PRESUPUESTO</span></div>
        <button onClick={()=>supabase.auth.signOut()} style={logoutBtn}><LogOut size={18}/></button>
      </header>

      <main style={mainStyle}>
        {(seccion !== 'compras' && seccion !== 'config') && (
            <div style={card}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px'}}>
                    <div style={toggleContainer}><button onClick={()=>setTipoVista('mensual')} style={tipoVista==='mensual'?toggleActive:toggleInactive}>MES</button><button onClick={()=>setTipoVista('anual')} style={tipoVista==='anual'?toggleActive:toggleInactive}>AÑO</button></div>
                    <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                      <button onClick={() => {
                        const data = stats.ranking.map(l => ({ "Línea": l.nombre, "Tienda": l.r, "Presupuesto": l.inicial, "Gastado": l.inicial - l.actual, "Saldo": l.actual }));
                        const ws = XLSX.utils.json_to_sheet(data);
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, "Reporte");
                        XLSX.writeFile(wb, `Reporte_General.xlsx`);
                      }} style={{background:'none', border:'none', color:COLOR_AZUL_CONTABLE, cursor:'pointer'}}><FileSpreadsheet size={20}/></button>
                      {esAdmin && <select style={{...inputStyle, width:'auto', marginBottom:0, padding:'6px'}} value={tiendaFiltro} onChange={e=>setTiendaFiltro(e.target.value)}><option value="TODAS">TODAS</option><option value="SPS">SPS</option><option value="Choluteca">Choluteca</option><option value="VA">VA</option><option value="Nacional">Nacional</option></select>}
                    </div>
                </div>
                {tipoVista === 'mensual' && <select style={{...inputStyle, marginTop:'10px', marginBottom:0}} value={mesFiltro} onChange={e=>setMesFiltro(e.target.value)}>{MESES_SISTEMA.map(m=><option key={m} value={m}>{m}</option>)}</select>}
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
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                        <h3 style={cardTitle}><History size={18}/> {tipoVista === 'anual' ? 'RESUMEN ANUAL' : 'HISTORIAL'}</h3>
                        <div style={{display:'flex', alignItems:'center', gap:'6px', background:'#f1f5f9', padding:'4px 10px', borderRadius:'10px'}}>
                          <Search size={12} color="#94a3b8"/><input type="text" placeholder="Buscar..." style={{border:'none', background:'none', fontSize:'11px', outline:'none', width:'80px'}} value={busquedaHistorial} onChange={e=>setBusquedaHistorial(e.target.value)}/>
                        </div>
                    </div>
                    <div style={{maxHeight:'400px', overflowY:'auto'}}>
                    {historialFinal.slice(0,30).map(h => {
                        const descLimpia = h.descripcion?.split(' | REF:')[0];
                        const mostrarInfo = tipoVista === 'mensual' ? (h.es_sobregiro || h.es_arrastre) : h.mostrarInfoAnual;
                        return (
                            <div key={h.id} style={historyItem}>
                                <div style={{flex:1, paddingRight:'10px'}}>
                                    <div style={{display:'flex', alignItems:'center', gap:'5px', marginBottom:'2px'}}>
                                      <div style={{fontWeight:700, fontSize:'11px'}}>{h.presupuestos?.linea_nombre} {tiendaActiva === 'TODAS' && <span style={{fontSize:'8px', color:'#94a3b8'}}>({h.presupuestos?.responsable})</span>}</div>
                                      {h.es_sobregiro && tipoVista === 'mensual' && <span style={badgeSobre}>Sobregiro</span>}
                                      {h.es_arrastre && tipoVista === 'mensual' && <span style={badgeArrastre}>Arrastre</span>}
                                    </div>
                                    <div style={{fontSize:'10px', color:COLOR_PIKHN, fontWeight:600}}>{descLimpia}</div>
                                    <div style={{fontSize:'8px', color:'#94a3b8'}}>{h.fecha}</div>
                                </div>
                                <div style={{textAlign:'right', display:'flex', alignItems:'center', gap:'8px'}}>
                                    <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end'}}>
                                      <b style={{color: '#dc2626', fontWeight:800, fontSize:'12px'}}>-L{h.monto_lps.toLocaleString()}</b>
                                      {h.es_sobregiro && tipoVista === 'mensual' && <div style={{fontSize:'7px', color:'#dc2626', fontWeight:700}}>+ L{h.monto_excedente.toLocaleString()} en {h.mes_excedente}</div>}
                                    </div>
                                    <div style={{display:'flex', gap:'4px'}}>
                                      {mostrarInfo && <button onClick={()=>alert(`DETALLE:\n${h.dist_info?.replace(/\. /g, '\n') || 'Info no disponible'}`)} style={eyeBtn}><List size={14} color={COLOR_AZUL_CONTABLE}/></button>}
                                      <button onClick={() => window.open(supabase.storage.from('facturas').getPublicUrl(h.url_factura).data.publicUrl, '_blank')} style={eyeBtn}><Eye size={16}/></button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    </div>
                </div>
            </div>
        )}

        {seccion === 'ejecucion' && (
            <div style={{marginTop:'15px'}}>
                <div style={card}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                        <h3 style={cardTitle}><TrendingUp size={18}/> EJECUCIÓN</h3>
                        <div style={{display:'flex', alignItems:'center', gap:'6px', background:'#f1f5f9', padding:'4px 10px', borderRadius:'10px'}}>
                          <Search size={12} color="#94a3b8"/><input type="text" placeholder="Filtrar..." style={{border:'none', background:'none', fontSize:'11px', outline:'none', width:'100px'}} value={busquedaEjecucion} onChange={e=>setBusquedaEjecucion(e.target.value)}/>
                        </div>
                    </div>
                    <div style={{width:'100%', background:'#f1f5f9', height:'12px', borderRadius:'10px', overflow:'hidden'}}><div style={{height:'100%', background: COLOR_PIKHN, width: `${Math.min(stats.porcGlobal, 100)}%`}}></div></div>
                    <p style={{fontSize:'10px', fontWeight:800, marginTop:'8px', textAlign:'center'}}>{stats.porcGlobal.toFixed(1)}% CONSUMO {tiendaActiva}</p>
                </div>
                <div style={{...card, marginTop:'15px', maxHeight:'450px', overflowY:'auto'}}>
                    {stats.ranking.filter(l => normalizar(l.nombre).includes(normalizar(busquedaEjecucion))).sort((a,b)=>(b.inicial-b.actual)-(a.inicial-a.actual)).map(linea => {
                        const gastado = linea.inicial - linea.actual;
                        const porc = linea.inicial > 0 ? (gastado / linea.inicial) * 100 : 0;
                        const tieneSobre = tipoVista === 'mensual' && (linea.sobregiro_monto || 0) > 0;
                        return (
                            <div key={linea.nombre + (linea.r || '')} style={{marginBottom:'15px', borderBottom:'1px solid #f8fafc', paddingBottom:'10px'}}>
                                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'4px', alignItems:'center'}}>
                                    <span style={{fontWeight:800, fontSize:'10px'}}>{linea.nombre.toUpperCase()} ({linea.r})</span>
                                    {tieneSobre && <button onClick={() => alert(`AVISO:\nL${linea.sobregiro_monto.toLocaleString()} cargados a ${linea.sobregiro_mes_destino}.`)} style={{border:'none', background:'none', color:'#dc2626'}}><AlertCircle size={14}/></button>}
                                </div>
                                <div style={{width:'100%', background:'#f1f5f9', height:'6px', borderRadius:'10px', overflow:'hidden'}}><div style={{height:'100%', background: (porc > 90 || linea.actual < 0) ? '#dc2626' : COLOR_PIKHN, width: `${Math.min(porc, 100)}%`}}></div></div>
                                <div style={{display:'flex', justifyContent:'space-between', fontSize:'9px', marginTop:'4px'}}><span>{porc.toFixed(0)}% Uso</span><span style={{color: COLOR_AZUL_CONTABLE, fontWeight:700}}>Saldo: L{linea.actual.toLocaleString()}</span></div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}

        {seccion === 'analisis' && esAdmin && (
            <div style={{marginTop:'15px'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                  <h3 style={cardTitle}><BarChart3 size={18}/> CATEGORÍAS</h3>
                  <button onClick={() => setConsolidarAnalisis(!consolidarAnalisis)} style={{...consolidateBtn, color: consolidarAnalisis ? COLOR_AZUL_CONTABLE : '#94a3b8'}}>
                    {consolidarAnalisis ? <ToggleRight size={20}/> : <ToggleLeft size={20}/>}
                    <span style={{fontSize:'9px', fontWeight:800}}>UNIFICAR</span>
                  </button>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', marginBottom:'15px'}}>
                    {stats.porTipoGasto.map(cat => (
                        <div key={cat.tipo} onClick={() => setTipoGastoFiltro(tipoGastoFiltro === cat.tipo ? null : cat.tipo)} style={{
                            background: tipoGastoFiltro === cat.tipo ? COLOR_PIKHN : 'white',
                            color: tipoGastoFiltro === cat.tipo ? 'white' : 'black',
                            padding:'15px 5px', borderRadius:'15px', textAlign:'center', cursor:'pointer', border: '1px solid #eee'
                        }}>
                            <div style={{fontSize:'8px', fontWeight:800, opacity:0.8}}>{cat.tipo.toUpperCase()}</div>
                            <div style={{fontSize:'11px', fontWeight:800, margin:'5px 0'}}>L{cat.gastado.toLocaleString()}</div>
                        </div>
                    ))}
                </div>
                {tipoGastoFiltro && (
                    <div style={card}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                            <h3 style={cardTitle}><ListFilter size={16}/> {tipoGastoFiltro.toUpperCase()}</h3>
                            <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                              <div style={{display:'flex', alignItems:'center', gap:'4px', background:'#f1f5f9', padding:'3px 8px', borderRadius:'8px'}}>
                                <Search size={10} color="#94a3b8"/><input type="text" placeholder="Buscar..." style={{border:'none', background:'none', fontSize:'9px', outline:'none', width:'60px'}} value={busquedaAnalisis} onChange={e=>setBusquedaAnalisis(e.target.value)}/>
                              </div>
                              <button onClick={() => {
                                const data = stats.ranking.filter(l => normalizar(l.tipo) === normalizar(tipoGastoFiltro)).map(l => ({ "Línea": l.nombre, "Presupuesto": l.inicial, "Gasto": l.inicial - l.actual, "Saldo": l.actual }));
                                const ws = XLSX.utils.json_to_sheet(data);
                                const wb = XLSX.utils.book_new();
                                XLSX.utils.book_append_sheet(wb, ws, tipoGastoFiltro);
                                XLSX.writeFile(wb, `Analisis_${tipoGastoFiltro}.xlsx`);
                              }} style={{background:'none', border:'none', color:COLOR_AZUL_CONTABLE}}><Download size={18}/></button>
                            </div>
                        </div>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:'10px'}}>
                            <thead><tr style={{borderBottom:'2px solid #f1f5f9', textAlign:'left'}}><th>LÍNEA</th><th style={{textAlign:'right'}}>PRESP.</th><th style={{textAlign:'right'}}>GASTO</th><th style={{textAlign:'right'}}>SALDO</th></tr></thead>
                            <tbody>
                                {stats.ranking.filter(l => normalizar(l.tipo) === normalizar(tipoGastoFiltro)).filter(l => normalizar(l.nombre).includes(normalizar(busquedaAnalisis))).map(l => (
                                    <tr key={l.nombre + (l.r || '')} style={{borderBottom:'1px solid #f8fafc'}}>
                                        <td style={{padding:'10px 0'}}>{l.nombre} {tiendaActiva === 'TODAS' && !consolidarAnalisis && <span style={{fontSize:'8px', color:'#94a3b8'}}>({l.r})</span>}</td>
                                        <td style={{textAlign:'right', fontWeight:700}}>L{l.inicial.toLocaleString()}</td>
                                        <td style={{textAlign:'right', color:'#dc2626'}}>L{(l.inicial-l.actual).toLocaleString()}</td>
                                        <td style={{textAlign:'right', color:COLOR_AZUL_CONTABLE}}>L{l.actual.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        )}

        {seccion === 'compras' && esAdmin && (
            <div style={card}>
                <h3 style={cardTitle}><Receipt size={18}/> REGISTRAR GASTO</h3>
                <input type="date" style={inputStyle} value={compra.fecha} onChange={e=>setCompra({...compra, fecha:e.target.value, lineaId:''})} />
                <select style={inputStyle} value={compra.tiendaSeleccionada} onChange={e=>setCompra({...compra, tiendaSeleccionada:e.target.value, lineaId:''})}><option value="">Tienda...</option><option value="SPS">SPS</option><option value="Choluteca">Choluteca</option><option value="VA">VA</option><option value="Nacional">Nacional</option></select>
                <select style={inputStyle} value={compra.lineaId} onChange={e=>setCompra({...compra, lineaId:e.target.value})} disabled={!compra.tiendaSeleccionada}>
                    <option value="">Línea...</option>
                    {lineas?.length > 0 ? (
                      lineas.filter(l => l.responsable === compra.tiendaSeleccionada && l.mes === MESES_SISTEMA[new Date(compra.fecha + 'T12:00:00').getMonth()]).map(l => {
                        const saldo = calcularSaldoParaSelect(l.linea_nombre, l.responsable, compra.fecha);
                        const esEsp = normalizar(l.linea_nombre).includes("energia") || normalizar(l.linea_nombre).includes("internet");
                        return <option key={l.id} value={l.id} disabled={saldo <= 0 && !esEsp}>{l.linea_nombre} (L{saldo.toLocaleString()})</option>
                      })
                    ) : (
                      <option disabled>Suba el presupuesto primero</option>
                    )}
                </select>
                <input type="number" placeholder="Monto" style={inputStyle} value={compra.monto} onChange={e=>setCompra({...compra, monto:e.target.value})} />
                <input type="text" placeholder="Factura" style={inputStyle} value={compra.desc} onChange={e=>setCompra({...compra, desc:e.target.value})} />
                <label style={{...cameraBtn, background: compra.foto ? '#dcfce7' : '#f1f5f9', color: compra.foto ? '#16a34a' : '#475569'}}>{compra.foto ? <Check size={16}/> : <Camera size={16}/>} {compra.foto ? "LISTA" : "FOTO"} <input type="file" hidden onChange={e=>setCompra({...compra, foto:e.target.files[0]})} /></label>
                <button onClick={registrarGasto} style={{...btn, background: COLOR_PIKHN}} disabled={loading}>{loading ? "PROCESANDO..." : "REGISTRAR"}</button>
            </div>
        )}

        {seccion === 'config' && esAdmin && (
            <div style={card}>
                <h3 style={cardTitle}><UploadCloud size={18}/> CARGAR PRESUPUESTO</h3>
                <input type="file" onChange={e=>setArchivoExcel(e.target.files[0])} style={{margin:'15px 0', fontSize:'12px'}} />
                <button onClick={importarExcelPikHN} style={{...btn, background: COLOR_AZUL_CONTABLE}} disabled={loading}>{loading ? "CARGANDO..." : "CARGAR"}</button>
            </div>
        )}
      </main>

      <nav style={navBar}>
        {esAdmin && <button onClick={()=>setSeccion('compras')} style={seccion==='compras'?navBtnActive:navBtn}><Receipt size={24}/><span>Registrar</span></button>}
        <button onClick={()=>setSeccion('reportes')} style={seccion==='reportes'?navBtnActive:navBtn}><LayoutDashboard size={24}/><span>Panel</span></button>
        <button onClick={()=>setSeccion('ejecucion')} style={seccion==='ejecucion'?navBtnActive:navBtn}><TrendingUp size={24}/><span>Ejecución</span></button>
        {esAdmin && <button onClick={()=>setSeccion('analisis')} style={seccion==='analisis'?navBtnActive:navBtn}><BarChart3 size={24}/><span>Análisis</span></button>}
        {esAdmin && <button onClick={()=>setSeccion('config')} style={seccion==='config'?navBtnActive:navBtn}><UploadCloud size={24}/><span>Excel</span></button>}
      </nav>
    </div>
  );
}

// Estilos
const appContainer = { minHeight:'100vh', background:'#f8fafc', paddingBottom:'110px', fontFamily:"'Plus Jakarta Sans', sans-serif" };
const loginWrapper = { display:'flex', height:'100vh', alignItems:'center', justifyContent:'center', background: COLOR_PIKHN };
const loginCard = { background:'white', padding:'40px', borderRadius:'30px', textAlign:'center', width:'320px' };
const headerStyle = { background: COLOR_PIKHN, color:'white', padding:'15px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:100 };
const mainStyle = { padding:'15px', maxWidth:'500px', margin:'0 auto' };
const card = { background:'white', padding:'20px', borderRadius:'24px', boxShadow:'0 1px 3px rgba(0,0,0,0.05)' };
const inputStyle = { width:'100%', padding:'12px', borderRadius:'12px', border:'1px solid #e2e8f0', marginBottom:'10px', fontSize:'13px', boxSizing:'border-box', fontWeight:600 };
const btn = { width:'100%', padding:'15px', color:'white', border:'none', borderRadius:'12px', fontWeight:800, cursor:'pointer' };
const cameraBtn = { display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', padding:'12px', borderRadius:'12px', marginBottom:'10px', fontSize:'12px', cursor:'pointer', fontWeight:700 };
const dashboardGrid = { display:'flex', background:'white', borderRadius:'24px', overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.05)' };
const dashItemCard = { padding:'15px', flex:1, textAlign:'center' };
const dashLabel = { fontSize:'9px', color:'#64748b', fontWeight:800 };
const cardTitle = { fontSize:'12px', fontWeight:800, display:'flex', alignItems:'center', gap:'8px', color: COLOR_PIKHN };
const toggleContainer = { display:'flex', background:'#f1f5f9', borderRadius:'10px', padding:'3px' };
const toggleActive = { border:'none', background:'white', padding:'6px 12px', borderRadius:'8px', fontSize:'10px', fontWeight:800, color:COLOR_PIKHN };
const toggleInactive = { border:'none', background:'none', padding:'6px 12px', color:'#94a3b8', fontSize:'10px' };
const navBar = { position:'fixed', bottom:0, width:'100%', background:'white', display:'flex', borderTop:'1px solid #f1f5f9', height:'85px', left:0, justifyContent:'space-around' };
const navBtn = { border:'none', background:'none', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:'9px', fontWeight:700, gap:'4px' };
const navBtnActive = { ...navBtn, color: COLOR_PIKHN };
const historyItem = { padding:'12px 0', borderBottom:'1px solid #f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' };
const logoutBtn = { background:'rgba(255,255,255,0.1)', border:'none', color:'white', padding:'6px', borderRadius:'8px' };
const eyeBtn = { background:'#f1f5f9', border:'none', padding:'6px', borderRadius:'6px', cursor:'pointer' };
const consolidateBtn = { background:'none', border:'none', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer' };
const badgeBase = { fontSize:'8px', fontWeight:900, padding:'2px 6px', borderRadius:'4px' };
const badgeSobre = { ...badgeBase, background: '#fee2e2', color: '#dc2626' };
const badgeArrastre = { ...badgeBase, background: '#e0f2fe', color: '#0284c7' };

export default App;