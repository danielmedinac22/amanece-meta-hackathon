/**
 * Mide el intérprete aislado (QuickJS) con el código que generó Muse Spark en `cambios.mts`: tiempo
 * y memoria sobre los datos sembrados, sobre el Negocio sintético de 10 mil pedidos que pasa por
 * `datosDelNegocio` (con sus topes) y sobre conjuntos más grandes en memoria, hasta que se rompen los
 * límites de `aislado.ts` (1 s, 32 MB). Replica `correrAislado` para poder leer la memoria antes de
 * destruir el runtime; la corrida real también se mide con `correrAislado` para compararla.
 *
 *   tsx scripts/medir/quickjs.mts [resultados/corridas.json] [salida.json]
 */
import './entorno.mts'
import { readFileSync, writeFileSync } from 'node:fs'
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'

const { db, esquema } = await import('../../src/db')
const { eq } = await import('drizzle-orm')
const { correrAislado } = await import('../../src/lib/aislado')
const { datosDelNegocio } = await import('../../src/negocio/datos')

const ENTRADA = process.argv[2] ?? 'scripts/medir/resultados/corridas.json'
const SALIDA = process.argv[3] ?? 'scripts/medir/resultados/quickjs.json'
const LIMITE_MS = 1000
const MB = 1024 * 1024
const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}
const r1 = (n: number) => Math.round(n * 10) / 10

type Pieza = { etiqueta: string; tipo: 'indicador' | 'seccion'; funcion: 'calcular' | 'consultar'; codigo: string }
const piezas: Pieza[] = []
const corridas = JSON.parse(readFileSync(ENTRADA, 'utf8')).corridas as any[]
for (const c of corridas) {
  if (c.tipo !== 'indicador' && c.tipo !== 'seccion') continue
  for (const cambio of c.cambios) {
    const codigo = cambio.propuesta?.codigo
    if (codigo && cambio.estado !== 'descartado') piezas.push({ etiqueta: `${c.tipo}#${c.corrida}`, tipo: c.tipo, funcion: c.tipo === 'indicador' ? 'calcular' : 'consultar', codigo })
  }
}
console.log(`${piezas.length} piezas generadas: ${piezas.map((p) => p.etiqueta).join(', ')}`)

/** Igual que `correrAislado`, más la lectura de memoria. `limite` en bytes. */
async function correr(codigo: string, funcion: string, datos: unknown, opciones: { limiteMemoria?: number; soloCargar?: boolean; json?: string } = {}) {
  const quickjs = await getQuickJS()
  const t0 = performance.now()
  const literal = JSON.stringify(opciones.json ?? JSON.stringify(datos))
  const tMarshal = performance.now()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(opciones.limiteMemoria ?? 32 * MB)
  runtime.setMaxStackSize(1024 * 1024)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + LIMITE_MS))
  const vm = runtime.newContext()
  try {
    const programa = opciones.soloCargar
      ? `"use strict"; const datos = JSON.parse(${literal}); ;JSON.stringify(1);`
      : `"use strict"; const datos = JSON.parse(${literal}); ${codigo}\n;JSON.stringify(${funcion}(datos));`
    const tEval = performance.now()
    const resultado = vm.evalCode(programa, 'pieza.js')
    const tFin = performance.now()
    if (resultado.error) {
      const e = vm.dump(resultado.error)
      resultado.error.dispose()
      return { ok: false as const, error: typeof e === 'object' ? `${e?.name}: ${e?.message}` : String(e), marshalMs: tMarshal - t0, evalMs: tFin - tEval, totalMs: tFin - t0, memoria: null, wasm: quickjs.getWasmMemory().buffer.byteLength, programaBytes: programa.length }
    }
    const texto = vm.getString(resultado.value)
    resultado.value.dispose()
    const manija = runtime.computeMemoryUsage()
    const uso = vm.dump(manija) as Record<string, number>
    manija.dispose()
    return { ok: true as const, bytesResultado: texto.length, marshalMs: tMarshal - t0, evalMs: tFin - tEval, totalMs: performance.now() - t0, memoria: { usada: uso.memory_used_size, malloc: uso.malloc_size }, wasm: quickjs.getWasmMemory().buffer.byteLength, programaBytes: programa.length }
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}

async function medir(codigo: string, funcion: string, datos: unknown, reps = 5) {
  const json = JSON.stringify(datos)
  const tS = performance.now()
  JSON.stringify(JSON.stringify(datos))
  const stringifyMs = performance.now() - tS
  const cargas: number[] = []
  const completas: number[] = []
  let ultima: Awaited<ReturnType<typeof correr>> | null = null
  for (let i = 0; i < reps; i++) {
    cargas.push((await correr(codigo, funcion, datos, { soloCargar: true, json })).evalMs)
    ultima = await correr(codigo, funcion, datos, { json })
    completas.push(ultima.evalMs)
  }
  // El mínimo de memoria con el que la corrida sale bien.
  let minimoMB: number | null = null
  for (const mb of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    const r = await correr(codigo, funcion, datos, { limiteMemoria: mb * MB, json })
    if (r.ok) {
      minimoMB = mb
      break
    }
  }
  const real = await correrAislado(codigo, funcion as 'calcular' | 'consultar', datos)
  return {
    bytesJson: json.length,
    stringifyDobleMs: r1(stringifyMs),
    cargaMs: { mediana: r1(mediana(cargas)), min: r1(Math.min(...cargas)), max: r1(Math.max(...cargas)) },
    evalMs: { mediana: r1(mediana(completas)), min: r1(Math.min(...completas)), max: r1(Math.max(...completas)) },
    calculoMs: r1(mediana(completas) - mediana(cargas)),
    correrAisladoMs: real.ms,
    correrAisladoOk: real.ok,
    errorEnLaUltima: ultima && !ultima.ok ? ultima.error : null,
    memoriaUsadaMB: ultima?.memoria ? r1(ultima.memoria.usada / MB) : null,
    mallocMB: ultima?.memoria ? r1(ultima.memoria.malloc / MB) : null,
    minimoMemoriaMB: minimoMB,
    wasmHeapMB: ultima ? r1(ultima.wasm / MB) : null,
    programaMB: ultima ? r1(ultima.programaBytes / MB) : null,
  }
}

const salida: Record<string, unknown> = { piezas: piezas.map((p) => p.etiqueta) }

// --- primera corrida del proceso (incluye la carga del WebAssembly) --------------------------------------
{
  const t = performance.now()
  await getQuickJS()
  salida.cargaDelWasmMs = r1(performance.now() - t)
  console.log(`getQuickJS() la primera vez: ${salida.cargaDelWasmMs} ms`)
}

// --- datos sembrados y Negocio sintético por el camino real ----------------------------------------------
const negocios: Record<string, string> = {}
for (const codigo of ['LADERA', 'TRIGO', 'SINTETICO']) {
  const [n] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, codigo))
  if (n) negocios[codigo] = n.id
}
const reales: Record<string, any> = {}
for (const [codigo, id] of Object.entries(negocios)) {
  const tiempos: number[] = []
  let datos: any
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    datos = await datosDelNegocio(id)
    tiempos.push(performance.now() - t)
  }
  reales[codigo] = datos
  salida[`datos_${codigo}`] = {
    filas: { pedidos: datos.pedidos.length, mensajes: datos.mensajes.length, casos: datos.casos.length, clientes: datos.clientes.length, productos: datos.productos.length },
    bytesJson: JSON.stringify(datos).length,
    cargaDesdeNeonMs: { mediana: r1(mediana(tiempos)), todas: tiempos.map(r1) },
  }
  console.log(codigo, JSON.stringify(salida[`datos_${codigo}`]))
}
// Lo que hay de verdad en la base del sintético, para ver el tope.
if (negocios.SINTETICO) {
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`select (select count(*)::int from pedidos where negocio_id = ${negocios.SINTETICO}) as pedidos, (select count(*)::int from mensajes_cliente where negocio_id = ${negocios.SINTETICO}) as mensajes, (select count(*)::int from casos where negocio_id = ${negocios.SINTETICO}) as casos`)
  salida.filasEnLaBaseDelSintetico = r.rows[0]
  console.log('filas en la base del sintético', JSON.stringify(r.rows[0]))
}

// --- cada pieza generada sobre cada conjunto real --------------------------------------------------------
const porPieza: Record<string, Record<string, unknown>> = {}
for (const p of piezas) {
  porPieza[p.etiqueta] = {}
  for (const [codigo, datos] of Object.entries(reales)) {
    porPieza[p.etiqueta][codigo] = await medir(p.codigo, p.funcion, datos, 5)
  }
  console.log(p.etiqueta, 'LADERA', JSON.stringify((porPieza[p.etiqueta] as any).LADERA?.evalMs), 'SINTETICO', JSON.stringify((porPieza[p.etiqueta] as any).SINTETICO?.evalMs))
}
salida.porPieza = porPieza

// --- sin topes: pedidos y mensajes en memoria, hasta romper los límites ----------------------------------
function sintetico(n: number) {
  const base = reales.LADERA
  const hoy = Date.parse(base.hoy)
  const estados = ['pendiente', 'confirmado', 'enviado', 'entregado', 'novedad', 'cancelado']
  const pedidos = Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    numero: i + 1,
    clienteId: base.clientes[i % base.clientes.length].id,
    items: [{ productoId: base.productos[i % base.productos.length].id, nombre: base.productos[i % base.productos.length].nombre, cantidad: 1 + (i % 3), precio: 38000 }],
    total: 38000 * (1 + (i % 3)),
    ciudad: ['Bogotá', 'Medellín', 'Cali'][i % 3],
    estado: estados[(i * 7) % 6],
    creado: new Date(hoy - (i / n) * 90 * 86400000).toISOString(),
  }))
  const mensajes = Array.from({ length: Math.round(n * 2.5) }, (_, i) => ({ clienteId: base.clientes[i % base.clientes.length].id, rol: i % 2 ? 'agente' : 'cliente', creado: new Date(hoy - (i / (n * 2.5)) * 90 * 86400000).toISOString() }))
  return { ...base, pedidos, mensajes }
}
const escala: unknown[] = []
const indicador = piezas.find((p) => p.tipo === 'indicador')
const seccion = piezas.find((p) => p.tipo === 'seccion')
for (const n of [1000, 2000, 5000, 10000, 20000, 50000, 100000]) {
  const datos = sintetico(n)
  for (const p of [indicador, seccion]) {
    if (!p) continue
    const m = await medir(p.codigo, p.funcion, datos, 3)
    escala.push({ pedidos: n, mensajes: datos.mensajes.length, pieza: p.etiqueta, ...m })
    console.log(`n=${n} ${p.etiqueta}: json ${(m.bytesJson / MB).toFixed(1)} MB, eval ${m.evalMs.mediana} ms (carga ${m.cargaMs.mediana}), memoria ${m.memoriaUsadaMB} MB, mínimo ${m.minimoMemoriaMB} MB, real ${m.correrAisladoOk ? 'ok' : 'FALLA'} ${m.correrAisladoMs} ms ${m.errorEnLaUltima ?? ''}`)
  }
}
salida.escala = escala
writeFileSync(SALIDA, JSON.stringify(salida, null, 1))
console.log(`Listo: ${SALIDA}`)
process.exit(0)
