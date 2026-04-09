/**
 * SCRIPT DE MIGRACIÓN — PIKHN PRESUPUESTO
 * ─────────────────────────────────────────
 * Qué hace:
 *   1. Lee todas las compras reales existentes en Supabase
 *   2. Agrupa por REF para saber el total real de cada factura
 *   3. Recalcula la distribución correcta: mes del gasto primero, luego anteriores, luego futuro si sobra
 *   4. Borra todos los registros viejos (compras + solicitudes)
 *   5. Restaura presupuestos y reinserta todo correctamente
 *
 * Uso:
 *   node migrar.mjs <SUPABASE_URL> <SUPABASE_ANON_KEY>
 *
 * Ejemplo:
 *   node migrar.mjs https://xxxx.supabase.co eyJhbGc...
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.argv[2];
const SUPABASE_KEY = process.argv[3];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌  Faltan parámetros.\n');
  console.error('   Uso: node migrar.mjs <SUPABASE_URL> <SUPABASE_ANON_KEY>\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const normalizar = (s) => s?.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() || "";
const sep = "─".repeat(60);

// ─── PASO 1: Obtener datos ────────────────────────────────────────────────────
async function obtenerDatos() {
  console.log('\n📥  Obteniendo datos de Supabase...');

  const { data: presupuestos, error: e1 } = await supabase.from('presupuestos').select('*');
  if (e1) throw new Error('presupuestos: ' + e1.message);

  const { data: compras, error: e2 } = await supabase
    .from('compras')
    .select('*, presupuestos(*)')
    .order('fecha', { ascending: true });
  if (e2) throw new Error('compras: ' + e2.message);

  console.log(`   ✔  ${presupuestos.length} líneas de presupuesto`);
  console.log(`   ✔  ${compras.length} registros de compras`);

  return { presupuestos, compras };
}

// ─── PASO 2: Identificar facturas únicas ─────────────────────────────────────
function identificarFacturas(compras) {
  const grupos = new Map();

  for (const c of compras) {
    const refMatch = c.descripcion?.match(/REF:(REF-\d+|APR-\d+)/);
    // Records sin REF se tratan individualmente (solo si no son arrastre)
    const ref = refMatch ? refMatch[1] : (c.es_arrastre ? null : `NOREF-${c.id}`);
    if (!ref) continue; // arrastres sin REF → se regeneran, se ignoran aquí

    if (!grupos.has(ref)) grupos.set(ref, { ref, records: [], main: null });
    const g = grupos.get(ref);
    g.records.push(c);

    // El registro principal es el creado por un usuario (no SISTEMA) y no es arrastre
    if (!c.es_arrastre && c.creado_por !== 'SISTEMA' && !g.main) {
      g.main = c;
    }
  }

  const facturas = [];

  for (const [, g] of grupos) {
    if (!g.main) continue; // sin registro principal → saltar

    // Total real de la factura = suma de todos los monto_lps del grupo
    // (incluye arrastres de meses anteriores y sobregiro al siguiente)
    const totalFactura = g.records.reduce((s, r) => s + (r.monto_lps || 0), 0);

    if (totalFactura <= 0) continue;

    facturas.push({
      ref:           g.ref,
      presupuesto_id: g.main.presupuesto_id,
      linea_nombre:  g.main.presupuestos?.linea_nombre,
      responsable:   g.main.presupuestos?.responsable,
      fecha:         g.main.fecha,
      mesIdx:        new Date(g.main.fecha + 'T12:00:00').getMonth(),
      total:         totalFactura,
      descripcion:   g.main.descripcion?.split(' | REF:')[0] || '',
      url_factura:   g.main.url_factura,
      creado_por:    g.main.creado_por,
    });
  }

  // Ordenar cronológicamente para que los saldos en memoria sean coherentes
  facturas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  console.log(`\n📋  Facturas únicas identificadas: ${facturas.length}`);
  return facturas;
}

// ─── PASO 3: Simular distribución correcta ───────────────────────────────────
function simularDistribucion(facturas, presupuestosOriginales) {
  // Trabajar con copia en memoria, partiendo de monto_inicial
  const mem = presupuestosOriginales.map(p => ({ ...p, monto_actual: p.monto_inicial }));

  const getLineas = (linea_nombre, responsable) =>
    mem.filter(p => p.linea_nombre === linea_nombre && p.responsable === responsable);

  const nuevasCompras = [];
  const problemas = [];

  console.log(`\n${sep}`);
  console.log('🔄  Recalculando distribuciones...');
  console.log(sep);

  for (const f of facturas) {
    const { ref, linea_nombre, responsable, fecha, mesIdx, total, descripcion, url_factura, creado_por, presupuesto_id } = f;
    const mesNombre = MESES[mesIdx];
    const esEspecial = normalizar(linea_nombre).includes("energia") || normalizar(linea_nombre).includes("internet");

    // Líneas hasta el mes actual, ordenadas DESC (más reciente = mes actual primero)
    const acumuladas = getLineas(linea_nombre, responsable)
      .filter(p => MESES.indexOf(p.mes) <= mesIdx)
      .sort((a, b) => MESES.indexOf(b.mes) - MESES.indexOf(a.mes));

    const todasAno = getLineas(linea_nombre, responsable);
    const disponibleAcum = acumuladas.reduce((s, p) => s + p.monto_actual, 0);
    const disponibleTotal = todasAno.reduce((s, p) => s + p.monto_actual, 0);

    if (total > disponibleTotal) {
      problemas.push(`⚠  ${ref}: L${total.toLocaleString()} excede presupuesto anual (L${disponibleTotal.toLocaleString()}) — omitida`);
      continue;
    }

    const requiereSobregiro = total > disponibleAcum;
    const montoADescontar   = requiereSobregiro ? disponibleAcum : total;
    const montoSobregiro    = requiereSobregiro ? total - disponibleAcum : 0;
    const mesSobreNombre    = mesIdx + 1 < 12 ? MESES[mesIdx + 1] : "Sig. Periodo";

    // ── Distribuir entre meses actuales y anteriores ───────────────────────
    let restante = montoADescontar;
    const descuentos = [];

    for (const p of acumuladas) {
      if (restante <= 0) break;
      const quitar = Math.min(p.monto_actual, restante);
      if (quitar > 0) {
        descuentos.push({ pres: p, quitar, esAnterior: p.mes !== mesNombre });
        restante -= quitar;
      }
    }

    const montoDeMes        = descuentos.filter(d => !d.esAnterior).reduce((s, d) => s + d.quitar, 0);
    const montoDeAnteriores = descuentos.filter(d =>  d.esAnterior).reduce((s, d) => s + d.quitar, 0);
    const usaSaldoAnterior  = montoDeAnteriores > 0;

    const resumenAnteriores = descuentos
      .filter(d => d.esAnterior)
      .map(d => `${d.pres.mes}: L${d.quitar.toLocaleString()}`)
      .join(', ');

    const resumenDistrib = [
      ...descuentos.filter(d => !d.esAnterior).map(d => `${d.pres.mes} (principal): L${d.quitar.toLocaleString()}`),
      ...descuentos.filter(d =>  d.esAnterior).map(d => `${d.pres.mes} (apoyo): L${d.quitar.toLocaleString()}`),
    ].join(' | ');

    const distLog = `Factura total: L${total.toLocaleString()}. ` +
      descuentos.map(d => `${d.pres.mes}: L${d.quitar.toLocaleString()}.`).join(' ');

    // ── Actualizar saldos en memoria ───────────────────────────────────────
    for (const d of descuentos) {
      d.pres.monto_actual -= d.quitar;
    }

    // ── Registro de arrastre en meses anteriores ───────────────────────────
    for (const d of descuentos.filter(d => d.esAnterior)) {
      nuevasCompras.push({
        presupuesto_id: d.pres.id,
        monto_lps:      d.quitar,
        descripcion:    `Cargo desde ${mesNombre} (${descripcion}) | REF:${ref}`,
        fecha,
        url_factura,
        creado_por:     'SISTEMA',
        es_arrastre:    true,
        dist_info:      `Factura de L${total.toLocaleString()} registrada en ${mesNombre}. Distribución: ${resumenDistrib}.`,
      });
    }

    // ── Sobregiro al mes siguiente ─────────────────────────────────────────
    if (requiereSobregiro) {
      const lSig = getLineas(linea_nombre, responsable)
        .find(p => MESES.indexOf(p.mes) === mesIdx + 1);
      if (lSig) {
        lSig.monto_actual -= montoSobregiro;
        nuevasCompras.push({
          presupuesto_id: lSig.id,
          monto_lps:      montoSobregiro,
          descripcion:    `${descripcion} | REF:${ref}`,
          fecha,
          url_factura,
          creado_por:     'SISTEMA',
          es_arrastre:    true,
          dist_info:      `Sobregiro desde ${mesNombre}. Total factura: L${total.toLocaleString()}.`,
        });
      }
    }

    // ── Registro principal ─────────────────────────────────────────────────
    nuevasCompras.push({
      presupuesto_id,
      monto_lps:              montoDeMes,
      descripcion:            `${descripcion} | REF:${ref}`,
      fecha,
      url_factura,
      creado_por,
      es_sobregiro:           requiereSobregiro && esEspecial,
      monto_excedente:        montoSobregiro || null,
      mes_excedente:          requiereSobregiro ? mesSobreNombre : null,
      dist_info:              distLog,
      usa_saldo_anterior:     usaSaldoAnterior,
      monto_saldo_anterior:   montoDeAnteriores || null,
      detalle_saldo_anterior: resumenAnteriores || null,
    });

    // Log de lo que se hizo
    const partes = descuentos.map(d => `${d.pres.mes}:L${d.quitar.toLocaleString()}`).join(' + ');
    const sobreStr = requiereSobregiro ? ` + ${mesSobreNombre}:L${montoSobregiro.toLocaleString()} (sobregiro)` : '';
    console.log(`   ✔  ${ref.padEnd(14)} L${total.toLocaleString().padStart(8)}  →  ${partes}${sobreStr}`);
  }

  if (problemas.length > 0) {
    console.log(`\n${sep}`);
    problemas.forEach(p => console.log('   ' + p));
  }

  return { nuevasCompras, presupuestosActualizados: mem };
}

// ─── PASO 4: Aplicar en la base de datos ─────────────────────────────────────
async function aplicarEnBD(nuevasCompras, presupuestosActualizados) {
  console.log(`\n${sep}`);
  console.log(`💾  Se escribirán ${nuevasCompras.length} registros en compras.`);
  console.log('🚨  Presioná Ctrl+C en los próximos 5 segundos para cancelar...\n');
  await new Promise(r => setTimeout(r, 5000));

  // Limpiar
  console.log('   Borrando solicitudes pendientes...');
  const { error: eS } = await supabase.from('solicitudes_sobregiro').delete().neq('id', 0);
  if (eS) throw new Error('solicitudes: ' + eS.message);

  console.log('   Borrando compras antiguas...');
  const { error: eC } = await supabase.from('compras').delete().neq('id', 0);
  if (eC) throw new Error('compras delete: ' + eC.message);

  // Restaurar presupuestos con los saldos recalculados
  console.log('   Restaurando saldos de presupuestos...');
  for (const p of presupuestosActualizados) {
    const { error } = await supabase.from('presupuestos').update({
      monto_actual:           p.monto_actual,
      sobregiro_monto:        0,
      sobregiro_mes_destino:  null,
    }).eq('id', p.id);
    if (error) throw new Error(`presupuesto id=${p.id}: ` + error.message);
  }

  // Insertar nuevas compras en lotes de 50
  console.log(`   Insertando ${nuevasCompras.length} registros...`);
  const BATCH = 50;
  for (let i = 0; i < nuevasCompras.length; i += BATCH) {
    const lote = nuevasCompras.slice(i, i + BATCH);
    const { error } = await supabase.from('compras').insert(lote);
    if (error) throw new Error(`batch ${i}: ` + error.message);
    process.stdout.write(`\r   ${Math.min(i + BATCH, nuevasCompras.length)}/${nuevasCompras.length} insertados...`);
  }

  console.log('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log(sep);
    console.log('  MIGRACIÓN PIKHN — Corrección de distribuciones');
    console.log(sep);

    const { presupuestos, compras } = await obtenerDatos();
    const facturas = identificarFacturas(compras);
    const { nuevasCompras, presupuestosActualizados } = simularDistribucion(facturas, presupuestos);
    await aplicarEnBD(nuevasCompras, presupuestosActualizados);

    console.log(sep);
    console.log('✅  Migración completada exitosamente.');
    console.log(sep + '\n');
  } catch (err) {
    console.error('\n❌  Error:', err.message);
    process.exit(1);
  }
})();
