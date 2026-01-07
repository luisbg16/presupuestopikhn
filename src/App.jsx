import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, Receipt, UploadCloud, History, 
  Camera, LogOut, ShieldCheck, TrendingUp, AlertTriangle, Eye, FileSpreadsheet, BarChart3, ListFilter, Download
} from 'lucide-react';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MESES_SISTEMA = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const COLOR_PIKHN = "#1e3563";
const COLOR_AZUL_CONTABLE = "#0096d2"; 
const COLOR_ACCENT = "#ffd100";

const normalizar = (str) => str?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [archivoExcel, setArchivoExcel] = useState(null);

  const [compra, setCompra] = useState({ tiendaSeleccionada: '', lineaId: '', monto: '', desc: '', foto: null, fecha: HOY });

  const esAdmin = session?.user?.email && CORES_ADMIN_EXTENDIDO.includes(session.user.email.toLowerCase());
  const MAPA_ACCESOS = { [ADMIN_EMAIL]: "Nacional", "cavendano@chorotega.hn": "Nacional", "mrodriguez@chorotega.hn": "Nacional", "pikhnsps@procoopsa.com": "SPS", "pikhncholuteca@procoopsa.com": "Choluteca", "pikhnva@procoopsa.com": "VA" };
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
          const fila = Object.keys(filaRaw).reduce((acc, key) => { acc[key.toLowerCase().trim()] = filaRaw[key]; return acc; }, {});
          const nombreLinea = fila["línea"] || fila["linea"];
          const responsableTienda = fila["responsable"] || fila["tienda"];
          let tGasto = fila["tipo de gasto"] || fila["tipo"] || "Administracion";
          
          if (normalizar(tGasto).includes("administracion")) tGasto = "Administracion";
          if (normalizar(tGasto).includes("personal")) tGasto = "Personal";
          if (normalizar(tGasto).includes("venta")) tGasto = "Venta";

          if (nombreLinea && responsableTienda && !nombreLinea.toString().toLowerCase().includes("total")) {
            Object.keys(mapaMeses).forEach(mesExcel => {
              const mesSistema = mapaMeses[mesExcel];
              let monto = parseFloat(fila[mesExcel]?.toString().replace(/[^\d.]/g, "")) || 0;
              filasParaSubir.push({ linea_nombre: nombreLinea.toString().trim(), responsable: responsableTienda.toString().trim(), tipo_gasto: tGasto, mes: mesSistema, monto_inicial: monto, monto_actual: monto });
            });
          }
        });
        await supabase.from('presupuestos').delete().neq('id', 0);
        await supabase.from('presupuestos').insert(filasParaSubir);
        alert("✅ Presupuesto cargado exitosamente");
        obtenerDatos();
      } catch (err) { alert(err.message); } finally { setLoading(false); }
    };
  };

  const stats = useMemo(() => {
    const filtradas = lineas.filter(l => (tiendaActiva === 'TODAS' || l.responsable === tiendaActiva) && (tipoVista === 'anual' ? true : l.mes === mesFiltro));
    const tP = filtradas.reduce((a, b) => a + b.monto_inicial, 0);
    const tD = filtradas.reduce((a, b) => a + b.monto_actual, 0);
    
    const ranking = Object.values(filtradas.reduce((acc, curr) => {
      if (!acc[curr.linea_nombre]) acc[curr.linea_nombre] = { nombre: curr.linea_nombre, inicial: 0, actual: 0, tipo: curr.tipo_gasto };
      acc[curr.linea_nombre].inicial += curr.monto_inicial;
      acc[curr.linea_nombre].actual += curr.monto_actual;
      return acc;
    }, {}));

    const porTipoGasto = ["Administracion", "Personal", "Venta"].map(t => {
        const sub = filtradas.filter(l => normalizar(l.tipo_gasto) === normalizar(t));
        const ini = sub.reduce((a, b) => a + b.monto_inicial, 0);
        const act = sub.reduce((a, b) => a + b.monto_actual, 0);
        return { tipo: t, inicial: ini, gastado: ini - act };
    });

    return { totalP: tP, totalG: tP - tD, totalD: tD, ranking, porTipoGasto, porcGlobal: tP > 0 ? ((tP - tD) / tP) * 100 : 0 };
  }, [lineas, tiendaActiva, mesFiltro, tipoVista]);

  const descargarReporteCompleto = () => {
    const data = stats.ranking.map(l => {
        const gastado = l.inicial - l.actual;
        const cumplimiento = l.inicial > 0 ? ((gastado / l.inicial) * 100).toFixed(1) + "%" : "0%";
        return {
            "Línea de Gasto": l.nombre,
            "Tipo": l.tipo,
            "Tienda/Sede": tiendaActiva,
            "Presupuesto": l.inicial,
            "Gasto Real": gastado,
            "Saldo Disponible": l.actual,
            "% Cumplimiento": cumplimiento
        };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte_PikHN");
    XLSX.writeFile(wb, `Reporte_General_${tiendaActiva}.xlsx`);
  };

  const descargarDetalleExcel = (tipo) => {
    const data = stats.ranking.filter(l => normalizar(l.tipo) === normalizar(tipo)).map(l => ({
        "Línea": l.nombre,
        "Presupuesto": l.inicial,
        "Gasto Real": l.inicial - l.actual,
        "Saldo": l.actual,
        "% Cumplimiento": l.inicial > 0 ? (((l.inicial - l.actual) / l.inicial) * 100).toFixed(1) + "%" : "0%"
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo);
    XLSX.writeFile(wb, `Analisis_${tipo}_${tiendaActiva}.xlsx`);
  };

  const registrarGasto = async () => {
    if (!compra.lineaId || !compra.monto || !compra.foto) return alert("Faltan datos");
    const montoGasto = parseFloat(compra.monto);
    const fechaObj = new Date(compra.fecha + 'T12:00:00');
    const mesGastoIdx = fechaObj.getMonth();
    const lineaSel = lineas.find(l => l.id.toString() === compra.lineaId.toString());
    const lineasDisponibles = lineas.filter(l => l.linea_nombre === lineaSel.linea_nombre && l.responsable === lineaSel.responsable && MESES_SISTEMA.indexOf(l.mes) <= mesGastoIdx).sort((a, b) => MESES_SISTEMA.indexOf(a.mes) - MESES_SISTEMA.indexOf(b.mes));
    const disponible = lineasDisponibles.reduce((a, b) => a + b.monto_actual, 0);

    if (montoGasto > disponible) return alert("Saldo insuficiente.");
    setLoading(true);
    try {
      const nombreFoto = `${Date.now()}.${compra.foto.name.split('.').pop()}`;
      await supabase.storage.from('facturas').upload(nombreFoto, compra.foto);
      let restante = montoGasto;
      for (let l of lineasDisponibles) {
        if (restante <= 0) break;
        let quitar = Math.min(l.monto_actual, restante);
        await supabase.from('presupuestos').update({ monto_actual: l.monto_actual - quitar }).eq('id', l.id);
        restante -= quitar;
      }
      await supabase.from('compras').insert([{ presupuesto_id: lineaSel.id, monto_lps: montoGasto, descripcion: compra.desc, fecha: compra.fecha, url_factura: nombreFoto, creado_por: session.user.email }]);
      alert("✅ Gasto registrado"); setCompra({ ...compra, monto: '', desc: '', foto: null, lineaId: '' }); obtenerDatos();
    } catch (e) { alert(e.message); } finally { setLoading(false); }
  };

  const calcularSaldoParaSelect = (lineaNombre, responsable, fecha) => {
    const mesIdx = new Date(fecha + 'T12:00:00').getMonth();
    return lineas
      .filter(l => l.linea_nombre === lineaNombre && l.responsable === responsable && MESES_SISTEMA.indexOf(l.mes) <= mesIdx)
      .reduce((a, b) => a + b.monto_actual, 0);
  };

  if (!session) return (
    <div style={loginWrapper}>
      <div style={loginCard}>
        <h1 style={{color: COLOR_PIKHN, fontWeight:800}}>PIKHN</h1>
        <form onSubmit={async (e)=>{e.preventDefault(); const {error}=await supabase.auth.signInWithPassword({email, password}); if(error) alert("Error de acceso");}}>
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
        <div style={{display:'flex', alignItems:'center', gap:'10px'}}><ShieldCheck size={22} color={COLOR_ACCENT}/><span style={{fontWeight:800}}>PIKHN PRESUPUESTO</span></div>
        <button onClick={()=>supabase.auth.signOut()} style={logoutBtn}><LogOut size={18}/></button>
      </header>

      <main style={mainStyle}>
        {(seccion !== 'compras' && seccion !== 'config') && (
            <div style={card}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px'}}>
                    <div style={toggleContainer}>
                        <button onClick={()=>setTipoVista('mensual')} style={tipoVista==='mensual'?toggleActive:toggleInactive}>MES</button>
                        <button onClick={()=>setTipoVista('anual')} style={tipoVista==='anual'?toggleActive:toggleInactive}>AÑO</button>
                    </div>
                    <div style={{display:'flex', gap:'5px', flex:1, justifyContent:'flex-end'}}>
                      <button onClick={descargarReporteCompleto} style={eyeBtn} title="Descargar Reporte Completo"><FileSpreadsheet size={18} color={COLOR_AZUL_CONTABLE}/></button>
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
                    <h3 style={cardTitle}><History size={18}/> ÚLTIMOS GASTOS</h3>
                    {historial.filter(h => (tiendaActiva === 'TODAS' || h.presupuestos?.responsable === tiendaActiva) && (tipoVista === 'anual' || h.presupuestos?.mes === mesFiltro)).slice(0,10).map(h => (
                        <div key={h.id} style={historyItem}>
                            <div style={{flex:1}}><div style={{fontWeight:700, fontSize:'12px'}}>{h.presupuestos?.linea_nombre}</div><div style={{fontSize:'10px', color:'#94a3b8'}}>{h.fecha} • {h.presupuestos?.responsable}</div></div>
                            <div style={{textAlign:'right', display:'flex', alignItems:'center', gap:'10px'}}><div style={{color:'#dc2626', fontWeight:800, fontSize:'12px'}}>-L{h.monto_lps.toLocaleString()}</div><button onClick={() => window.open(supabase.storage.from('facturas').getPublicUrl(h.url_factura).data.publicUrl, '_blank')} style={eyeBtn}><Eye size={16}/></button></div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {seccion === 'ejecucion' && (
            <div style={{marginTop:'15px'}}>
                <div style={card}>
                    <h3 style={cardTitle}><TrendingUp size={18}/> EJECUCIÓN GLOBAL</h3>
                    <div style={{marginTop:'15px', textAlign:'center'}}>
                        <div style={{width:'100%', background:'#f1f5f9', height:'20px', borderRadius:'10px', overflow:'hidden'}}><div style={{height:'100%', background: COLOR_PIKHN, width: `${Math.min(stats.porcGlobal, 100)}%`}}></div></div>
                        <p style={{fontSize:'11px', fontWeight:800, marginTop:'8px'}}>{stats.porcGlobal.toFixed(1)}% CONSUMIDO</p>
                    </div>
                </div>
                <div style={{...card, marginTop:'15px'}}>
                    <h3 style={cardTitle}><AlertTriangle size={18}/> DETALLE POR LÍNEA</h3>
                    {stats.ranking
                      .filter(linea => tipoVista === 'anual' || linea.inicial > 0) // <--- FILTRO AGREGADO AQUÍ
                      .sort((a,b)=>(b.inicial-b.actual)-(a.inicial-a.actual)).slice(0, 20).map(linea => {
                        const gastado = linea.inicial - linea.actual;
                        const porc = linea.inicial > 0 ? (gastado / linea.inicial) * 100 : 0;
                        return (
                            <div key={linea.nombre} style={{marginBottom:'15px'}}>
                                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'4px'}}><span style={{fontWeight:800, fontSize:'11px'}}>{linea.nombre.toUpperCase()}</span><span style={{color:'#dc2626', fontWeight:800, fontSize:'11px'}}>L{gastado.toLocaleString()}</span></div>
                                <div style={{width:'100%', background:'#f1f5f9', height:'8px', borderRadius:'10px', overflow:'hidden'}}><div style={{height:'100%', background: porc > 90 ? '#dc2626' : COLOR_PIKHN, width: `${Math.min(porc, 100)}%`}}></div></div>
                                <div style={{display:'flex', justifyContent:'space-between', fontSize:'9px', marginTop:'4px'}}><span>{porc.toFixed(1)}% Cumplimiento</span><span style={{color: COLOR_AZUL_CONTABLE}}>Saldo: L{linea.actual.toLocaleString()}</span></div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}

        {seccion === 'analisis' && esAdmin && (
            <div style={{marginTop:'15px'}}>
                <h3 style={{...cardTitle, marginBottom:'10px'}}><BarChart3 size={18}/> ANÁLISIS DE CATEGORÍAS</h3>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', marginBottom:'15px'}}>
                    {stats.porTipoGasto.map(cat => (
                        <div key={cat.tipo} onClick={() => setTipoGastoFiltro(tipoGastoFiltro === cat.tipo ? null : cat.tipo)} style={{
                            background: tipoGastoFiltro === cat.tipo ? COLOR_PIKHN : 'white',
                            color: tipoGastoFiltro === cat.tipo ? 'white' : 'black',
                            padding:'15px 5px', borderRadius:'15px', textAlign:'center', cursor:'pointer', border: '1px solid #eee', boxShadow:'0 2px 4px rgba(0,0,0,0.05)', transition:'all 0.2s'
                        }}>
                            <div style={{fontSize:'8px', fontWeight:800, opacity:0.8}}>{cat.tipo.toUpperCase()}</div>
                            <div style={{fontSize:'11px', fontWeight:800, margin:'5px 0'}}>L{cat.gastado.toLocaleString()}</div>
                            <div style={{fontSize:'9px', fontWeight:800, color: tipoGastoFiltro === cat.tipo ? COLOR_ACCENT : COLOR_AZUL_CONTABLE}}>
                                {cat.inicial > 0 ? ((cat.gastado/cat.inicial)*100).toFixed(0) : 0}%
                            </div>
                        </div>
                    ))}
                </div>

                {!tipoGastoFiltro ? (
                    <div style={{...card, textAlign:'center', padding:'40px 20px', background:'#f8fafc', border:'2px dashed #cbd5e1'}}>
                        <ListFilter size={32} color="#94a3b8" style={{margin:'0 auto 10px'}}/>
                        <p style={{fontSize:'13px', fontWeight:700, color:'#64748b'}}>Seleccione una categoría arriba para desplegar el detalle</p>
                    </div>
                ) : (
                    <div style={card}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                            <h3 style={cardTitle}><ListFilter size={16}/> LÍNEAS: {tipoGastoFiltro.toUpperCase()}</h3>
                            <button onClick={() => descargarDetalleExcel(tipoGastoFiltro)} style={{...eyeBtn, display:'flex', gap:'5px', alignItems:'center', background:COLOR_AZUL_CONTABLE, color:'white', padding:'5px 10px'}}>
                                <Download size={14}/> <span style={{fontSize:'10px', fontWeight:800}}>EXCEL</span>
                            </button>
                        </div>
                        <div style={{overflowX:'auto'}}>
                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:'11px'}}>
                                <thead>
                                    <tr style={{borderBottom:'2px solid #f1f5f9', textAlign:'left'}}>
                                        <th style={{padding:'10px 5px'}}>LÍNEA</th>
                                        <th style={{padding:'10px 5px', textAlign:'right'}}>PRESP.</th>
                                        <th style={{padding:'10px 5px', textAlign:'right'}}>GASTO</th>
                                        <th style={{padding:'10px 5px', textAlign:'right'}}>SALDO</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.ranking.filter(l => normalizar(l.tipo) === normalizar(tipoGastoFiltro)).map(l => (
                                        <tr key={l.nombre} style={{borderBottom:'1px solid #f8fafc'}}>
                                            <td style={{padding:'10px 5px', fontWeight:700}}>{l.nombre}</td>
                                            <td style={{padding:'10px 5px', textAlign:'right'}}>L{l.inicial.toLocaleString()}</td>
                                            <td style={{padding:'10px 5px', textAlign:'right', color:'#dc2626', fontWeight:700}}>L{(l.inicial-l.actual).toLocaleString()}</td>
                                            <td style={{padding:'10px 5px', textAlign:'right', color:COLOR_AZUL_CONTABLE, fontWeight:700}}>L{l.actual.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
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
                    {lineas.filter(l => l.responsable === compra.tiendaSeleccionada && l.mes === MESES_SISTEMA[new Date(compra.fecha + 'T12:00:00').getMonth()] && l.monto_actual > 0).map(l => {
                        const saldoAcum = calcularSaldoParaSelect(l.linea_nombre, l.responsable, compra.fecha);
                        return (
                            <option key={l.id} value={l.id}>{l.linea_nombre} (Disponible: L{saldoAcum.toLocaleString()})</option>
                        );
                    })}
                </select>
                <input type="number" placeholder="Monto Lps" style={inputStyle} value={compra.monto} onChange={e=>setCompra({...compra, monto:e.target.value})} />
                <input type="text" placeholder="Concepto / Factura" style={inputStyle} value={compra.desc} onChange={e=>setCompra({...compra, desc:e.target.value})} />
                <label style={cameraBtn}><Camera size={18}/> {compra.foto ? "FACTURA LISTA ✅" : "ADJUNTAR FACTURA"} <input type="file" hidden onChange={e=>setCompra({...compra, foto:e.target.files[0]})} /></label>
                <button onClick={registrarGasto} style={{...btn, background: COLOR_PIKHN}} disabled={loading}>{loading ? "PROCESANDO..." : "REGISTRAR"}</button>
            </div>
        )}

        {seccion === 'config' && esAdmin && (
            <div style={card}>
                <h3 style={cardTitle}><UploadCloud size={18}/> CARGAR PRESUPUESTO</h3>
                <input type="file" accept=".xlsx, .xls" style={{margin:'20px 0', fontSize:'12px'}} onChange={e=>setArchivoExcel(e.target.files[0])} />
                <button onClick={importarExcelPikHN} style={{...btn, background: COLOR_AZUL_CONTABLE}} disabled={loading}>Cargar presupuesto</button>
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
const cameraBtn = { display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', padding:'12px', background:'#f1f5f9', borderRadius:'12px', marginBottom:'10px', fontSize:'12px', cursor:'pointer', fontWeight:700 };
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
const historyItem = { padding:'10px 0', borderBottom:'1px solid #f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' };
const logoutBtn = { background:'rgba(255,255,255,0.1)', border:'none', color:'white', padding:'6px', borderRadius:'8px' };
const eyeBtn = { background:'#f1f5f9', border:'none', padding:'6px', borderRadius:'6px', cursor:'pointer' };

export default App;