/**
 * Medición desechable del ticket #12: cómo se aíslan los Negocios entre sí.
 *
 *  M1. Cola justa por Negocio: el reclamo FIFO global de #13 contra reclamos justos por Negocio.
 *  M2. Cupo atómico por Negocio: una sola sentencia de reserva contra leer y después escribir.
 *  M3. RLS + CTE bajo carga: el ligado de #8 con 500 lotes concurrentes, y cuánto cuesta RLS en una lectura simple.
 *
 * Solo corre contra una rama desechable de Neon creada con `--schema-only` (sin datos de Clientes): aborta si el host
 * de DATABASE_URL no empieza por MEDIR_HOST_ESPERADO o si la base trae Negocios que no son los inventados (AISL01 a
 * AISL10). No llama a ningún modelo ni a Kapso: el único destino de red permitido es Neon.
 *
 *   pnpm tsx scripts/medir-aislamiento.mts [--fase=red|m1|m2|m3|todo] [--sabotaje=<nombre>]
 *   Sabotajes (cada uno rompe a propósito una pieza; el script debe salir con 1):
 *     reclamo-en-dos-pasos  M1: el reclamo FIFO lee y después escribe, sin SKIP LOCKED (dobles reclamos)
 *     sin-cerrojo           M1: el reclamo con tope por Negocio sin el cerrojo (el tope se pasa)
 *     cupo-ingenuo          M2: la reserva atómica se cambia por leer y después escribir (el cupo se pasa)
 *     politica-true         M3: las políticas RLS pasan a `true` (hay fugas entre Negocios)
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true, override: true })
process.env.ENVIO_SIMULADO = '1'

// ---------------------------------------------------------------------------------------------------------------
// Salvaguardas: solo la rama desechable, sin Kapso, sin modelo.
// ---------------------------------------------------------------------------------------------------------------
const hostSinPooler = (h: string) => h.split('.')[0].replace(/-pooler$/, '')
const esperado = process.env.MEDIR_HOST_ESPERADO
for (const variable of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
  const host = new URL(process.env[variable] ?? 'postgres://nada@nada/nada').hostname
  if (!esperado || hostSinPooler(host) !== esperado) {
    console.error(`Aborto: el host de ${variable} (${hostSinPooler(host)}) no es el de la rama desechable.`)
    process.exit(2)
  }
}
if (process.env.KAPSO_API_KEY || process.env.KAPSO_PHONE_NUMBER_ID || process.env.META_MODEL_API_KEY) {
  console.error('Aborto: esta medición no debe tener llaves de Kapso ni del modelo.')
  process.exit(2)
}
if (process.env.NEON_AUTH_BASE_URL || process.env.NEON_AUTH_COOKIE_SECRET) {
  console.error('Aborto: neutraliza las NEON_AUTH_* en el .env.local de la medición.')
  process.exit(2)
}

let peticionesHttp = 0
const fetchReal = globalThis.fetch
globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  const host = new URL(url).hostname
  if (!host.endsWith('.neon.tech')) throw new Error(`fetch bloqueado por la medición: ${host}`)
  peticionesHttp++
  return fetchReal(entrada, init)
}) as typeof fetch

const { neon, Pool } = await import('@neondatabase/serverless')

const valorDe = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const fase = valorDe('fase') ?? 'todo'
const SABOTAJE = valorDe('sabotaje') ?? ''
const quiere = (nombre: string) => fase === 'todo' || fase === nombre
if (SABOTAJE && !['reclamo-en-dos-pasos', 'sin-cerrojo', 'cupo-ingenuo', 'politica-true'].includes(SABOTAJE)) {
  console.error(`Sabotaje desconocido: ${SABOTAJE}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------------------------------------------
// Utilidades de medida
// ---------------------------------------------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>
const sql = neon(process.env.DATABASE_URL!)
const q = (texto: string, params: unknown[] = []) => sql.query(texto, params) as Promise<Fila[]>
type Sentencia = [string, unknown[]?]
/** Un lote HTTP: una petición, una transacción. */
const lote = async (sentencias: Sentencia[], readOnly = false) =>
  (await sql.transaction(
    sentencias.map(([t, p]) => sql.query(t, p ?? [])),
    { readOnly },
  )) as Fila[][]

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))
const ahora = () => performance.now()

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const redondear = (n: number) => (Number.isNaN(n) ? '-' : Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1))
const resumen = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 0.5), p90: pct(xs, 0.9), p95: pct(xs, 0.95), min: Math.min(...xs), max: Math.max(...xs) })
function tabla(cabeceras: string[], filas: (string | number)[][]) {
  const linea = (celdas: (string | number)[]) => `| ${celdas.join(' | ')} |`
  console.log([linea(cabeceras), linea(cabeceras.map(() => '---')), ...filas.map(linea)].join('\n'))
}
const filaStats = (nombre: string, xs: number[]) => {
  const r = resumen(xs)
  return [nombre, r.n, redondear(r.p50), redondear(r.p90), redondear(r.p95), redondear(r.min), redondear(r.max)]
}
const CABECERA_STATS = ['medida (ms)', 'n', 'p50', 'p90', 'p95', 'mín', 'máx']

/** Azar determinista (mulberry32): las corridas repiten los mismos números. */
function crearAzar(semilla: number) {
  let a = semilla
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function barajar<T>(xs: T[], azar: () => number) {
  const r = [...xs]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

// ---------------------------------------------------------------------------------------------------------------
// Preparación: tablas, Negocios inventados
// ---------------------------------------------------------------------------------------------------------------
type Negocio = { id: string; codigo: string; k: number }
let negocios: Negocio[] = []
const [A, B, C] = [0, 1, 2]

async function aplicarSql() {
  const ruta = fileURLToPath(new URL('./medir-aislamiento.sql', import.meta.url))
  const trozos = readFileSync(ruta, 'utf8')
    .split(/^--;\s*$/m)
    .map((t) => t.trim())
    .filter((t) => t.replace(/--.*$/gm, '').trim().length > 0)
  for (const trozo of trozos) await q(trozo)
  // La app trae el esquema de Drizzle; si la rama no lo trae, esto no sigue.
  const [{ hay }] = await q(`select (to_regclass('public.pedidos') is not null and to_regclass('public.mensajes_cliente') is not null) as hay`)
  if (!hay) throw new Error('La rama no trae el esquema de la app (crea la rama con `--parent main --schema-only`).')
}

async function sembrarNegocios() {
  const ajenos = await q(`select count(*)::int as n from negocios where codigo not like 'AISL%'`)
  if (ajenos[0].n > 0) {
    console.error('Aborto: la base trae Negocios que no son los inventados de esta medición (¿es una rama con datos?).')
    process.exit(2)
  }
  for (let k = 1; k <= 10; k++) {
    const codigo = `AISL${String(k).padStart(2, '0')}`
    await q(`insert into negocios (nombre, rubro, codigo, estado) values ($1, 'inventado para medir', $2, 'listo') on conflict (codigo) do nothing`, [`Negocio inventado ${k}`, codigo])
  }
  const filas = await q(`select id, codigo from negocios where codigo like 'AISL%' order by codigo`)
  negocios = filas.map((f, i) => ({ id: f.id as string, codigo: f.codigo as string, k: i + 1 }))
  if (negocios.length !== 10) throw new Error(`Se esperaban 10 Negocios inventados y hay ${negocios.length}`)
  await q(`insert into cola_negocios (negocio_id) select id from negocios where codigo like 'AISL%' on conflict do nothing`)
}

// ---------------------------------------------------------------------------------------------------------------
// Red: lo que cuesta una ida y vuelta, para poder restarla
// ---------------------------------------------------------------------------------------------------------------
let rtt = { p50: 0, min: 0 }
async function red(momento: string) {
  await q('select 1')
  const http: number[] = []
  for (let i = 0; i < 30; i++) {
    const t0 = ahora()
    await q('select 1')
    http.push(ahora() - t0)
  }
  console.log(`### Red (${momento}): select 1 por el driver HTTP de Neon, 30 repeticiones tras una de calentamiento`)
  tabla(CABECERA_STATS, [filaStats('select 1 por el driver HTTP', http)])
  return http
}

// ===============================================================================================================
// M1. Cola justa por Negocio
// ===============================================================================================================
const LEASE_S = 30
const TURNO_MS = 200 // lo que simula un turno del agente
const CERROJO = 7001 // clave del cerrojo asesor que serializa los reclamos justos

type Variante = 'fifo' | 'fifo+tope' | 'rr' | 'tope'
const VARIANTES: Variante[] = ['fifo', 'fifo+tope', 'rr', 'tope']
const DESCRIPCION: Record<Variante, string> = {
  fifo: 'FIFO global (el reclamo de #13)',
  'fifo+tope': 'FIFO global + tope por Negocio contado en la misma sentencia, sin cerrojo (ingenuo)',
  rr: 'round-robin por Negocio (el que lleva más tiempo sin turno), SKIP LOCKED, cerrojo',
  tope: 'tope de en_curso por Negocio + el que tiene menos en curso, SKIP LOCKED, cerrojo',
}

type Trabajo = { id: string; negocio_id: string; clave: string; intentos: number }
const RETORNO = 'returning id, negocio_id, clave, intentos'
const MARCA_RECLAMO = `estado = 'en_curso', intentos = intentos + 1, reclamado_hasta = now() + make_interval(secs => $1::float8), reclamado_ts = clock_timestamp()`

/** El reclamo de #13, tal cual, más `negocio_id` en el retorno. */
const SQL_FIFO = `update trabajos set ${MARCA_RECLAMO}
  where id = (select id from trabajos
              where (estado = 'pendiente' or (estado = 'en_curso' and reclamado_hasta < now())) and disponible_desde <= now()
              order by disponible_desde for update skip locked limit 1)
  ${RETORNO}`

/** FIFO con el tope por Negocio contado en la misma sentencia: se ve bien y se pasa del tope bajo concurrencia. */
const SQL_FIFO_TOPE = `update trabajos set ${MARCA_RECLAMO}
  where id = (select t.id from trabajos t
              where t.estado = 'pendiente' and t.disponible_desde <= now()
                and (select count(*) from trabajos e where e.negocio_id = t.negocio_id and e.estado = 'en_curso' and e.reclamado_hasta > now()) < $2
              order by t.disponible_desde for update of t skip locked limit 1)
  ${RETORNO}`

/**
 * Reclamo justo. Elige el Negocio (el que lleva más tiempo sin turno; en `tope`, primero el de menos en curso y solo
 * si está bajo el tope), toma su trabajo más viejo con SKIP LOCKED y anota el turno. Va después de
 * `select pg_advisory_xact_lock(...)` en el mismo lote: en READ COMMITTED cada sentencia toma su foto al empezar, así
 * que contar `en_curso` dentro de la misma sentencia que espera el cerrojo vería un conteo viejo.
 */
const sqlJusto = (orden: 'rr' | 'tope') => `
  with cuenta as (
    select c.negocio_id, c.ultimo_servido,
           (select count(*) from trabajos e where e.negocio_id = c.negocio_id and e.estado = 'en_curso' and e.reclamado_hasta > now()) as en_curso
    from cola_negocios c
  ),
  elegido as materialized (
    select negocio_id from cuenta
    where en_curso < $2
      and exists (select 1 from trabajos p where p.negocio_id = cuenta.negocio_id and p.estado = 'pendiente' and p.disponible_desde <= now())
    order by ${orden === 'tope' ? 'en_curso, ultimo_servido nulls first' : 'ultimo_servido nulls first'}
    limit 1
  ),
  job as materialized (
    select t.id from trabajos t
    where t.negocio_id = (select negocio_id from elegido) and t.estado = 'pendiente' and t.disponible_desde <= now()
    order by t.disponible_desde for update skip locked limit 1
  ),
  servido as (
    update cola_negocios set ultimo_servido = clock_timestamp()
    where negocio_id in (select negocio_id from elegido) and exists (select 1 from job) returning 1
  )
  update trabajos set ${MARCA_RECLAMO} where id in (select id from job) ${RETORNO}`

const SIN_TOPE = 1_000_000_000

/** Las sentencias de un reclamo, en el orden en que viajan en un solo lote. `donde` dice cuál es la que reclama. */
function sentenciasDeReclamo(v: Variante, tope: number): { sentencias: Sentencia[]; donde: number } {
  if (v === 'fifo') return { sentencias: [[SQL_FIFO, [LEASE_S]]], donde: 0 }
  if (v === 'fifo+tope') return { sentencias: [[SQL_FIFO_TOPE, [LEASE_S, tope]]], donde: 0 }
  const cerrojo: Sentencia[] = SABOTAJE === 'sin-cerrojo' && v === 'tope' ? [] : [[`select pg_advisory_xact_lock(${CERROJO})`]]
  return { sentencias: [...cerrojo, [sqlJusto(v), [LEASE_S, v === 'rr' ? SIN_TOPE : tope]]], donde: cerrojo.length }
}

/** Un reclamo, como lo haría un drenador. */
async function reclamar(v: Variante, tope: number): Promise<Trabajo | null> {
  if (SABOTAJE === 'reclamo-en-dos-pasos' && v === 'fifo') {
    // Leer y después escribir, sin SKIP LOCKED ni guarda de estado: dos drenadores leen el mismo id.
    const [f] = await q(`select id from trabajos where estado = 'pendiente' and disponible_desde <= now() order by disponible_desde limit 1`)
    if (!f) return null
    const r = await q(`update trabajos set ${MARCA_RECLAMO} where id = $2 ${RETORNO}`, [LEASE_S, f.id])
    return (r[0] as Trabajo | undefined) ?? null
  }
  const { sentencias, donde } = sentenciasDeReclamo(v, tope)
  if (sentencias.length === 1) return ((await q(sentencias[0][0], sentencias[0][1] ?? []))[0] as Trabajo | undefined) ?? null
  const res = await lote(sentencias)
  return (res[donde][0] as Trabajo | undefined) ?? null
}

const terminarTrabajo = async (t: { id: string; intentos: number }) =>
  (await q(`update trabajos set estado = 'hecho', terminado = clock_timestamp(), reclamado_hasta = null where id = $1 and estado = 'en_curso' and intentos = $2 returning id`, [t.id, t.intentos])).length === 1

const limpiarCola = async () => {
  await q('delete from trabajos')
  await q('update cola_negocios set ultimo_servido = null')
}
const encolarMuchos = (negocioId: string, n: number, prefijo: string) =>
  q(`insert into trabajos (negocio_id, clave) select $1::uuid, $2::text || g::text from generate_series(1, $3::int) g`, [negocioId, prefijo, n])
const encolarUno = async (negocioId: string, clave: string) => (await q(`insert into trabajos (negocio_id, clave) values ($1, $2) returning id`, [negocioId, clave]))[0].id as string

type Reclamo = { drenador: number; trabajo: string; negocio: string; intentos: number }
type Control = { parar: boolean }
const quedaTrabajo = async () => Number((await q(`select count(*)::int as n from trabajos where estado in ('pendiente', 'en_curso')`))[0].n) > 0

async function drenar(id: number, v: Variante, tope: number, ctl: Control, bitacora: Reclamo[], turnoMs: number, saleCuandoVacio = false) {
  let perdidos = 0
  let vacios = 0
  while (!ctl.parar) {
    const tr = await reclamar(v, tope)
    if (!tr) {
      vacios++
      if (saleCuandoVacio && !(await quedaTrabajo())) break
      await dormir(40)
      continue
    }
    bitacora.push({ drenador: id, trabajo: tr.id, negocio: tr.negocio_id, intentos: tr.intentos })
    if (turnoMs) await dormir(turnoMs)
    if (!(await terminarTrabajo(tr))) perdidos++
  }
  return { perdidos, vacios }
}

/** Máximo de trabajos de un Negocio en curso a la vez, de los relojes del servidor: de reclamar a terminar. */
async function maximoEnCurso(negocioId: string) {
  const r = await q(
    `with ev as (
       select reclamado_ts as t, 1 as d from trabajos where negocio_id = $1 and reclamado_ts is not null
       union all select terminado, -1 from trabajos where negocio_id = $1 and terminado is not null
     ) select coalesce(max(c), 0)::int as maximo from (select sum(d) over (order by t, d) as c from ev) x`,
    [negocioId],
  )
  return Number(r[0].maximo)
}

type ResultadoEscenario = {
  variante: Variante
  drenadores: number
  tope: number
  segundos: number
  espera: Record<'B' | 'C', { reclamos: number; hastaReclamoMs: number; hastaHechoMs: number }>
  hechosA: number
  hechosTotal: number
  maxA: number
  dobles: number
  repetidosEnBitacora: number
  enCursoAlFinal: number
  perdidos: number
}

/** A encola 1.000 trabajos de golpe; 2 s después B y C encolan uno cada uno; n drenadores con turnos de 200 ms. */
async function escenarioCola(v: Variante, drenadores: number): Promise<ResultadoEscenario> {
  const tope = Math.max(1, Math.floor(drenadores / 2))
  await limpiarCola()
  await encolarMuchos(negocios[A].id, 1000, 'campana:')
  const ctl: Control = { parar: false }
  const bitacora: Reclamo[] = []
  const t0 = ahora()
  const hilos = Array.from({ length: drenadores }, (_, i) => drenar(i, v, tope, ctl, bitacora, TURNO_MS))
  await dormir(2000)
  const [idB, idC] = await Promise.all([encolarUno(negocios[B].id, 'b:uno'), encolarUno(negocios[C].id, 'c:uno')])
  const TOPE_S = 900
  const MINIMO_S = 12 // en las variantes justas, deja correr un rato para que el tope se ejercite
  for (;;) {
    const [{ n }] = await q(`select count(*) filter (where estado = 'hecho')::int as n from trabajos where id = any($1)`, [[idB, idC]])
    const seg = (ahora() - t0) / 1000
    if ((n === 2 && seg >= MINIMO_S) || seg > TOPE_S) break
    await dormir(250)
  }
  ctl.parar = true
  const fin = await Promise.all(hilos)
  const segundos = (ahora() - t0) / 1000

  const filas = await q(
    `select t.id, t.negocio_id, t.intentos, extract(epoch from (t.reclamado_ts - t.creado))::float8 * 1000 as reclamo_ms, extract(epoch from (t.terminado - t.creado))::float8 * 1000 as hecho_ms,
            (select count(*) from trabajos x where x.reclamado_ts > t.creado and x.reclamado_ts < t.reclamado_ts)::int as entre
     from trabajos t where t.id = any($1)`,
    [[idB, idC]],
  )
  const de = (id: string) => filas.find((f) => f.id === id)!
  const espera = (id: string) => ({ reclamos: Number(de(id).entre), hastaReclamoMs: Number(de(id).reclamo_ms), hastaHechoMs: Number(de(id).hecho_ms) })
  const [{ hechos_a }] = await q(`select count(*) filter (where estado = 'hecho')::int as hechos_a from trabajos where negocio_id = $1`, [negocios[A].id])
  const [{ hechos }] = await q(`select count(*) filter (where estado = 'hecho')::int as hechos from trabajos`)
  const [{ dobles }] = await q(`select count(*)::int as dobles from trabajos where intentos > 1`)
  const [{ en_curso }] = await q(`select count(*)::int as en_curso from trabajos where estado = 'en_curso'`)
  return {
    variante: v,
    drenadores,
    tope,
    segundos,
    espera: { B: espera(idB), C: espera(idC) },
    hechosA: Number(hechos_a),
    hechosTotal: Number(hechos),
    maxA: await maximoEnCurso(negocios[A].id),
    dobles: Number(dobles),
    repetidosEnBitacora: bitacora.length - new Set(bitacora.map((r) => r.trabajo)).size,
    enCursoAlFinal: Number(en_curso),
    perdidos: fin.reduce((a, f) => a + f.perdidos, 0),
  }
}

/** Dobles reclamos con mucha concurrencia: 8 drenadores sin espera sobre 200 trabajos de tres Negocios. */
async function estresDeDobles(v: Variante) {
  const tope = 2
  await limpiarCola()
  await encolarMuchos(negocios[A].id, 120, 'a:')
  await encolarMuchos(negocios[B].id, 40, 'b:')
  await encolarMuchos(negocios[C].id, 40, 'c:')
  const ctl: Control = { parar: false }
  const bitacora: Reclamo[] = []
  await Promise.all(Array.from({ length: 8 }, (_, i) => drenar(i, v, tope, ctl, bitacora, 30, true)))
  const [{ hechos }] = await q(`select count(*) filter (where estado = 'hecho')::int as hechos from trabajos`)
  const [{ dobles }] = await q(`select count(*)::int as dobles from trabajos where intentos > 1`)
  const repetidos = bitacora.length - new Set(bitacora.map((r) => r.trabajo)).size
  const maxA = await maximoEnCurso(negocios[A].id)
  afirmar(`M1 dobles [${v}]: 200 trabajos, 8 drenadores, ningún trabajo reclamado dos veces (bitácora ${bitacora.length} reclamos)`, repetidos === 0 && dobles === 0 && bitacora.length === 200, { repetidos, dobles, reclamos: bitacora.length })
  afirmar(`M1 dobles [${v}]: los 200 terminaron \`hecho\``, Number(hechos) === 200, { hechos })
  return { v, reclamos: bitacora.length, repetidos, dobles: Number(dobles), maxA }
}

/** El tope bajo una carrera: 24 reclamos a la vez sobre un solo Negocio con tope 2. */
async function carreraDelTope(v: Variante) {
  const tope = 2
  const maximos: number[] = []
  for (let ronda = 0; ronda < 5; ronda++) {
    await limpiarCola()
    await encolarMuchos(negocios[A].id, 100, 'a:')
    const logrados = (await Promise.all(Array.from({ length: 24 }, () => reclamar(v, tope)))).filter(Boolean).length
    const [{ n }] = await q(`select count(*)::int as n from trabajos where negocio_id = $1 and estado = 'en_curso'`, [negocios[A].id])
    maximos.push(Number(n))
    void logrados
  }
  return maximos
}

/** Costo de la sentencia de reclamo con N pendientes, por el lado del servidor y por HTTP. */
type Forma = 'vacío' | 'campaña' | 'repartido'
async function sembrarPendientes(forma: Forma, n: number) {
  await limpiarCola()
  if (forma === 'campaña') {
    await encolarMuchos(negocios[A].id, n, 'seed:')
    await encolarMuchos(negocios[B].id, 100, 'seedb:')
    await encolarMuchos(negocios[C].id, 100, 'seedc:')
  } else if (forma === 'repartido') {
    for (const neg of negocios) await encolarMuchos(neg.id, Math.round(n / negocios.length), `seed${neg.k}:`)
  }
  await q('vacuum (analyze) trabajos')
  await q('analyze cola_negocios')
}

async function costoDelReclamo(v: Variante, forma: Forma, n: number, repeticiones = 40) {
  await sembrarPendientes(forma, n)
  const tope = 2
  const { sentencias, donde } = sentenciasDeReclamo(v, tope)
  const reloj: Sentencia = [`select extract(epoch from clock_timestamp())::float8 as t`]
  const instrumentado: Sentencia[] = [reloj, ...sentencias, reloj]
  const wall: number[] = []
  const servidor: number[] = []
  let reclamados = 0
  for (let i = 0; i < repeticiones + 3; i++) {
    const t0 = ahora()
    const res = await lote(instrumentado)
    const ms = ahora() - t0
    const tr = (res[1 + donde][0] as Trabajo | undefined) ?? null
    if (i >= 3) {
      wall.push(ms)
      servidor.push((Number(res[res.length - 1][0].t) - Number(res[0][0].t)) * 1000)
    }
    if (tr) {
      reclamados++
      await terminarTrabajo(tr)
    }
  }
  return { wall, servidor, reclamados }
}

/** Los mismos reclamos en el servidor con más precisión que el milisegundo del reloj de JS: tiempo de ejecución del EXPLAIN. */
async function planDelReclamo(v: Variante, forma: Forma, n: number) {
  await sembrarPendientes(forma, n)
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED! })
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')
    if (v === 'rr' || v === 'tope') await cliente.query(`select pg_advisory_xact_lock(${CERROJO})`)
    const texto =
      v === 'fifo' ? SQL_FIFO : v === 'fifo+tope' ? SQL_FIFO_TOPE : sqlJusto(v)
    const literal = texto.replace(/\$1::float8/g, `${LEASE_S}::float8`).replace(/\$2/g, v === 'rr' ? String(SIN_TOPE) : '2')
    // Dos veces: la primera calienta el caché y el tiempo que muestra es de arranque en frío.
    let r = await cliente.query(`explain (analyze, buffers, costs off, timing off) ${literal}`)
    r = await cliente.query(`explain (analyze, buffers, costs off, timing off) ${literal}`)
    await cliente.query('rollback')
    return (r.rows as Fila[]).map((f) => String(f['QUERY PLAN']))
  } finally {
    cliente.release()
    await pool.end()
  }
}

async function m1() {
  console.log('\n## M1. Cola justa por Negocio\n')
  await limpiarCola()
  const sec = (s: string) => console.log(`\n### ${s}`)
  const on = (n: string) => (valorDe('m1') ?? '1,2,3,4,5').split(',').includes(n)
  const solo = valorDe('solo')?.split(',')

  // --- 1. El escenario ---------------------------------------------------------------------------------------
  const resultados: ResultadoEscenario[] = []
  const plan: [Variante, number][] = (SABOTAJE === 'sin-cerrojo' ? [['tope', 4]] : SABOTAJE || !on('1') ? [] : [2, 4].flatMap((d) => VARIANTES.map((v) => [v, d] as [Variante, number]))).filter(([v, d]) => !solo || solo.includes(`${v}:${d}`)) as [Variante, number][]
  {
    for (const [v, drenadores] of plan) {
      console.log(`-- ${DESCRIPCION[v]} · ${drenadores} drenadores · turno de ${TURNO_MS} ms`)
      const r = await escenarioCola(v, drenadores)
      resultados.push(r)
      console.log(`   listo en ${redondear(r.segundos)} s: B esperó ${r.espera.B.reclamos} reclamos y ${redondear(r.espera.B.hastaReclamoMs)} ms; C ${r.espera.C.reclamos} y ${redondear(r.espera.C.hastaReclamoMs)} ms; máximo de A en curso ${r.maxA}`)
    }
  }
  if (resultados.length) sec('1. A encola 1.000 trabajos de golpe; 2 s después B y C encolan uno cada uno')
  if (resultados.length) tabla(
    ['reclamo', 'drenadores', 'tope', 'B: reclamos que esperó', 'B: ms hasta el reclamo', 'B: ms hasta hecho', 'C: reclamos', 'C: ms hasta el reclamo', 'C: ms hasta hecho', 'A hechos', 'máx. de A en curso', 'dobles', 'duración (s)'],
    resultados.map((r) => [
      r.variante,
      r.drenadores,
      r.variante === 'fifo' || r.variante === 'rr' ? '-' : r.tope,
      r.espera.B.reclamos,
      redondear(r.espera.B.hastaReclamoMs),
      redondear(r.espera.B.hastaHechoMs),
      r.espera.C.reclamos,
      redondear(r.espera.C.hastaReclamoMs),
      redondear(r.espera.C.hastaHechoMs),
      r.hechosA,
      r.maxA,
      r.dobles + r.repetidosEnBitacora,
      redondear(r.segundos),
    ]),
  )
  for (const r of resultados) {
    const etiqueta = `[${r.variante}, ${r.drenadores} drenadores]`
    afirmar(`M1 ${etiqueta}: ningún trabajo reclamado dos veces (intentos > 1: ${r.dobles}, repetidos en la bitácora: ${r.repetidosEnBitacora})`, r.dobles === 0 && r.repetidosEnBitacora === 0, r)
    afirmar(`M1 ${etiqueta}: nada quedó en curso ni se perdió un \`terminar\``, r.enCursoAlFinal === 0 && r.perdidos === 0, { enCurso: r.enCursoAlFinal, perdidos: r.perdidos })
    if (r.variante === 'fifo') {
      afirmar(`M1 ${etiqueta}: control: con FIFO global B y C esperan detrás de la campaña (más de 300 reclamos)`, r.espera.B.reclamos > 300 && r.espera.C.reclamos > 300, r.espera)
    } else {
      const cota = r.drenadores + 2
      afirmar(
        `M1 ${etiqueta}: B y C se atienden de inmediato (a lo sumo ${cota} reclamos y menos de 1,5 s hasta el reclamo)`,
        r.espera.B.reclamos <= cota && r.espera.C.reclamos <= cota && r.espera.B.hastaReclamoMs < 1500 && r.espera.C.hastaReclamoMs < 1500,
        r.espera,
      )
    }
    if (r.variante === 'tope') afirmar(`M1 ${etiqueta}: el tope se respeta bajo concurrencia (A nunca más de ${r.tope} en curso; máximo visto ${r.maxA})`, r.maxA <= r.tope, { maxA: r.maxA, tope: r.tope })
  }

  // --- 2. Dobles reclamos con mucha concurrencia ---------------------------------------------------------------
  const dobles: Awaited<ReturnType<typeof estresDeDobles>>[] = []
  if (on('2')) {
    sec('2. Dobles reclamos con mucha concurrencia: 8 drenadores sin espera, 200 trabajos de tres Negocios')
    for (const v of SABOTAJE ? (['fifo', 'tope'] as Variante[]) : VARIANTES) dobles.push(await estresDeDobles(v))
  }
  if (dobles.length) tabla(['reclamo', 'reclamos', 'trabajos reclamados dos veces', 'intentos > 1', 'máx. de A en curso (tope 2)'], dobles.map((d) => [d.v, d.reclamos, d.repetidos, d.dobles, d.v === 'tope' ? d.maxA : '-']))
  const dTope = dobles.find((d) => d.v === 'tope')
  if (dTope) afirmar('M1 dobles [tope]: con 8 drenadores A nunca pasa de 2 en curso', dTope.maxA <= 2, dTope)

  // --- 3. El tope bajo una carrera ----------------------------------------------------------------------------
  if (on('3')) {
    sec('3. El tope bajo una carrera: 24 reclamos a la vez sobre A (100 pendientes, tope 2), cinco rondas')
    const filasCarrera: (string | number)[][] = []
    const maximosPorVariante = new Map<Variante, number[]>()
    for (const v of ['fifo+tope', 'tope'] as Variante[]) {
      const maximos = await carreraDelTope(v)
      maximosPorVariante.set(v, maximos)
      filasCarrera.push([v, maximos.join(', '), Math.max(...maximos)])
    }
    tabla(['reclamo', 'trabajos de A en curso tras cada ronda', 'máximo'], filasCarrera)
    afirmar('M1 carrera [tope]: con 24 reclamos a la vez A queda en exactamente 2 en curso en cada ronda', maximosPorVariante.get('tope')!.every((m) => m === 2), maximosPorVariante.get('tope'))
    afirmar('M1 carrera: control: el tope ingenuo (sin cerrojo) SÍ se pasa de 2 al menos en una ronda', Math.max(...maximosPorVariante.get('fifo+tope')!) > 2, maximosPorVariante.get('fifo+tope'))
  }

  // --- 4. Lo que cuesta el tope: A solo --------------------------------------------------------------------------
  if (!SABOTAJE && on('4')) {
    sec('4. Lo que cuesta el tope: A solo con 200 trabajos y 4 drenadores (turno de 200 ms)')
    const filasSolo: (string | number)[][] = []
    const ordenes: Variante[][] = [['fifo', 'rr', 'tope'], ['tope', 'rr', 'fifo']]
    for (const [vuelta, orden] of ordenes.entries()) {
      for (const v of orden) {
        await limpiarCola()
        await encolarMuchos(negocios[A].id, 200, 'a:')
        const ctl: Control = { parar: false }
        const t0 = ahora()
        await Promise.all(Array.from({ length: 4 }, (_, i) => drenar(i, v, 2, ctl, [], TURNO_MS, true)))
        const s = (ahora() - t0) / 1000
        filasSolo.push([v, vuelta + 1, redondear(s), redondear(200 / s), await maximoEnCurso(negocios[A].id)])
      }
    }
    tabla(['reclamo', 'vuelta', 'segundos para vaciar 200', 'trabajos por segundo', 'máx. de A en curso'], filasSolo.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1])))
  }

  // --- 5. El costo de la sentencia de reclamo -----------------------------------------------------------------------
  if (!SABOTAJE && on('5')) {
    sec('5. Costo de la sentencia de reclamo con 0, 1.000 y 10.000 pendientes de A (más 100 de B y 100 de C), o repartidos en 10 Negocios (40 reclamos cada fila; cada uno, en un lote HTTP con reloj del servidor)')
    const casos: [Forma, number][] = [['vacío', 0], ['campaña', 1000], ['campaña', 10000], ['repartido', 10000]]
    const filas: (string | number)[][] = []
    for (const v of VARIANTES) {
      for (const [forma, n] of casos) {
        const r = await costoDelReclamo(v, forma, n)
        filas.push([v, `${forma} ${n}`, r.reclamados, redondear(pct(r.wall, 0.5)), redondear(pct(r.wall, 0.95)), redondear(pct(r.wall, 0.5) - rtt.p50), redondear(pct(r.servidor, 0.5)), redondear(pct(r.servidor, 0.95))])
      }
    }
    tabla(['reclamo', 'pendientes', 'reclamos con trabajo', 'HTTP p50 (ms)', 'HTTP p95', 'HTTP p50 menos RTT', 'servidor p50 (ms)', 'servidor p95'], filas)

    sec('5b. Sin los índices por Negocio (solo el índice FIFO de #13): 10.000 pendientes de A y 100 de B y de C')
    await q('drop index trabajos_negocio_pendiente')
    await q('drop index trabajos_negocio_en_curso')
    const sinIndices: (string | number)[][] = []
    for (const v of ['rr', 'tope'] as Variante[]) {
      const r = await costoDelReclamo(v, 'campaña', 10000, 20)
      sinIndices.push([v, redondear(pct(r.wall, 0.5)), redondear(pct(r.wall, 0.95)), redondear(pct(r.servidor, 0.5)), redondear(pct(r.servidor, 0.95))])
      console.log(`-- plan de ${v} sin los índices por Negocio`)
      console.log((await planDelReclamo(v, 'campaña', 10000)).join('\n'))
    }
    await q(`create index trabajos_negocio_pendiente on trabajos (negocio_id, disponible_desde) where estado = 'pendiente'`)
    await q(`create index trabajos_negocio_en_curso on trabajos (negocio_id) where estado = 'en_curso'`)
    tabla(['reclamo', 'HTTP p50 (ms)', 'HTTP p95', 'servidor p50 (ms)', 'servidor p95'], sinIndices)

    sec('5c. EXPLAIN (ANALYZE, BUFFERS) del reclamo con 10.000 pendientes de A (y B y C con uno), con los índices')
    for (const v of VARIANTES) {
      console.log(`-- ${v}`)
      console.log((await planDelReclamo(v, 'campaña', 10000)).join('\n'))
    }
  }
  await limpiarCola()
}

// ===============================================================================================================
// M2. Cupo atómico por Negocio
// ===============================================================================================================
const TOPE_CUPO = 3000 // tokens por Negocio y ventana
const RECURSO = 'tokens'

type Peticion = { negocio: Negocio; n: number; caliente: boolean }

/** La reserva atómica: una sola sentencia; sin fila devuelta es que no cabe. */
const SQL_RESERVA = `update cupos set usado = usado + $4::bigint
  where negocio_id = $1 and recurso = $2 and ventana = $3 and usado + $4::bigint <= tope
  returning usado, tope`

/** La misma reserva creando la ventana en su primer uso. */
const SQL_RESERVA_UPSERT = `insert into cupos (negocio_id, recurso, ventana, tope, usado)
  select $1::uuid, $2::text, $3::text, $5::bigint, $4::bigint where $4::bigint <= $5::bigint
  on conflict (negocio_id, recurso, ventana) do update set usado = cupos.usado + $4::bigint where cupos.usado + $4::bigint <= cupos.tope
  returning usado, tope`

type Reserva = { concedida: boolean; usado?: number }

async function reservaAtomica(neg: string, recurso: string, ventana: string, n: number): Promise<Reserva> {
  if (SABOTAJE === 'cupo-ingenuo') return reservaIngenua(neg, recurso, ventana, n, 'incremento')
  const r = await q(SQL_RESERVA, [neg, recurso, ventana, n])
  return r.length ? { concedida: true, usado: Number(r[0].usado) } : { concedida: false }
}
async function reservaUpsert(neg: string, recurso: string, ventana: string, n: number): Promise<Reserva> {
  const r = await q(SQL_RESERVA_UPSERT, [neg, recurso, ventana, n, TOPE_CUPO])
  return r.length ? { concedida: true, usado: Number(r[0].usado) } : { concedida: false }
}
/**
 * Leer y después escribir. `incremento`: lee, decide en JS y suma `n` (el error de siempre). `absoluto`: además escribe
 * lo leído más `n`, así que dos reservas a la vez se pisan y el saldo no cuadra.
 */
async function reservaIngenua(neg: string, recurso: string, ventana: string, n: number, modo: 'incremento' | 'absoluto'): Promise<Reserva> {
  const [c] = await q(`select usado, tope from cupos where negocio_id = $1 and recurso = $2 and ventana = $3`, [neg, recurso, ventana])
  if (!c || Number(c.usado) + n > Number(c.tope)) return { concedida: false }
  if (modo === 'incremento') await q(`update cupos set usado = usado + $4::bigint where negocio_id = $1 and recurso = $2 and ventana = $3`, [neg, recurso, ventana, n])
  else await q(`update cupos set usado = $4::bigint where negocio_id = $1 and recurso = $2 and ventana = $3`, [neg, recurso, ventana, Number(c.usado) + n])
  return { concedida: true }
}

async function prepararCupos(ventana: string, recursos: string[] = [RECURSO], tope = TOPE_CUPO) {
  await q('delete from reservas')
  await q('delete from cupos')
  await q(`insert into cupos (negocio_id, recurso, ventana, tope) select n.id, r, $1::text, $2::bigint from negocios n, unnest($3::text[]) r where n.codigo like 'AISL%'`, [ventana, tope, recursos])
}

/** 10 Negocios, 500 reservas: el caliente (negocio 0) pide unas 10 veces más que cada uno de los otros nueve. */
function construirPeticiones(semilla: number, soloLosDemas = false): Peticion[] {
  const azar = crearAzar(semilla)
  const peticiones: Peticion[] = []
  const pedir = (neg: Negocio, cuantas: number, caliente: boolean) => {
    for (let i = 0; i < cuantas; i++) peticiones.push({ negocio: neg, n: 20 + Math.floor(azar() * 101), caliente })
  }
  pedir(negocios[0], soloLosDemas ? 0 : 266, true)
  for (const neg of negocios.slice(1)) pedir(neg, 26, false)
  return barajar(peticiones, azar)
}

type Ejecucion = { latencias: Map<'caliente' | 'demas', number[]>; concedidas: Map<string, number>; pedidas: Map<string, number>; granted: { neg: string; n: number; recurso: string }[]; denegadas: { neg: string; n: number }[]; usadoVisto: number[]; ms: number }

/** Lanza todas las reservas a la vez y mide cada una. `recursoDe` deja al caliente repartir su demanda en filas distintas. */
async function correrReservas(peticiones: Peticion[], ventana: string, reservar: typeof reservaAtomica, recursoDe: (p: Peticion, i: number) => string = () => RECURSO): Promise<Ejecucion> {
  const latencias = new Map<'caliente' | 'demas', number[]>([['caliente', []], ['demas', []]])
  const granted: Ejecucion['granted'] = []
  const denegadas: Ejecucion['denegadas'] = []
  const usadoVisto: number[] = []
  const t0 = ahora()
  await Promise.all(
    peticiones.map(async (p, i) => {
      const recurso = recursoDe(p, i)
      const t = ahora()
      const r = await reservar(p.negocio.id, recurso, ventana, p.n)
      latencias.get(p.caliente ? 'caliente' : 'demas')!.push(ahora() - t)
      if (r.concedida) {
        granted.push({ neg: p.negocio.id, n: p.n, recurso })
        if (r.usado !== undefined) usadoVisto.push(r.usado)
      } else denegadas.push({ neg: p.negocio.id, n: p.n })
    }),
  )
  const concedidas = new Map<string, number>()
  const pedidas = new Map<string, number>()
  for (const p of peticiones) pedidas.set(p.negocio.id, (pedidas.get(p.negocio.id) ?? 0) + p.n)
  for (const g of granted) concedidas.set(g.neg, (concedidas.get(g.neg) ?? 0) + g.n)
  return { latencias, concedidas, pedidas, granted, denegadas, usadoVisto, ms: ahora() - t0 }
}

const leerCupos = async (ventana: string) => (await q(`select negocio_id, recurso, usado::int as usado, tope::int as tope from cupos where ventana = $1`, [ventana])) as { negocio_id: string; recurso: string; usado: number; tope: number }[]

/** Reserva, devuelve lo que sobró y verifica que el saldo cuadra. */
const SQL_RESERVA_CON_LIBRO = `with c as (
    update cupos set usado = usado + $4::bigint
    where negocio_id = $1 and recurso = $2 and ventana = $3 and usado + $4::bigint <= tope
    returning negocio_id, recurso, ventana, usado
  )
  insert into reservas (negocio_id, recurso, ventana, cantidad) select negocio_id, recurso, ventana, $4::bigint from c
  returning id, (select usado from c) as usado`
const SQL_LIQUIDAR = `with r as (
    update reservas set estado = 'liquidada', consumido = $2::bigint where id = $1 and estado = 'reservada'
    returning negocio_id, recurso, ventana, cantidad
  )
  update cupos c set usado = c.usado - greatest(r.cantidad - $2::bigint, 0) from r
  where c.negocio_id = r.negocio_id and c.recurso = r.recurso and c.ventana = r.ventana
  returning c.usado, r.cantidad`

async function m2() {
  console.log('\n## M2. Cupo atómico por Negocio\n')
  const sec = (s: string) => console.log(`\n### ${s}`)
  const VENTANA = '2026-10-29'
  await q('analyze cupos')
  // Calentamiento (no cuenta): 500 conexiones abiertas a la vez, para que la primera variante no pague los apretones TLS.
  await prepararCupos(VENTANA)
  for (let i = 0; i < 2; i++) await Promise.all(Array.from({ length: 500 }, () => q('select 1')))

  // --- 1. El escenario: 500 reservas a la vez ---------------------------------------------------------------------
  const peticiones = construirPeticiones(2810)
  const calientes = peticiones.filter((p) => p.caliente).length
  sec(`1. 500 reservas a la vez por el driver HTTP: ${calientes} del Negocio caliente y ${peticiones.length - calientes} de los otros nueve (26 cada uno), tope de ${TOPE_CUPO} tokens por Negocio`)

  type Variante2 = { nombre: string; reservar: typeof reservaAtomica }
  const variantes: Variante2[] = [
    { nombre: 'atómica: UPDATE … WHERE usado + n <= tope', reservar: reservaAtomica },
    { nombre: 'ingenua: leer, decidir y sumar', reservar: (a, b, c, d) => reservaIngenua(a, b, c, d, 'incremento') },
    { nombre: 'ingenua: leer y escribir lo leído más n', reservar: (a, b, c, d) => reservaIngenua(a, b, c, d, 'absoluto') },
  ]
  const filas: (string | number)[][] = []
  const resultado = new Map<string, { sobrepasos: number; sobrante: number; descuadre: number; falsasNegaciones: number; dañoAOtros: number; ejec: Ejecucion }>()
  for (const v of variantes) {
    await prepararCupos(VENTANA)
    const ejec = await correrReservas(peticiones, VENTANA, v.reservar)
    const cupos = await leerCupos(VENTANA)
    const sobrepasos = cupos.filter((c) => c.usado > c.tope).length
    const sobrante = cupos.reduce((a, c) => a + Math.max(0, c.usado - c.tope), 0)
    const descuadre = cupos.reduce((a, c) => a + Math.abs(c.usado - (ejec.concedidas.get(c.negocio_id) ?? 0)), 0)
    // Una negación es injusta si el saldo final deja sitio para ella.
    const usadoDe = new Map(cupos.map((c) => [c.negocio_id, c.usado]))
    const falsasNegaciones = ejec.denegadas.filter((d) => (usadoDe.get(d.neg) ?? 0) + d.n <= TOPE_CUPO).length
    const dañoAOtros = negocios.slice(1).filter((neg) => (ejec.concedidas.get(neg.id) ?? 0) < (ejec.pedidas.get(neg.id) ?? 0)).length
    resultado.set(v.nombre, { sobrepasos, sobrante, descuadre, falsasNegaciones, dañoAOtros, ejec })
    const todas = [...ejec.latencias.get('caliente')!, ...ejec.latencias.get('demas')!]
    filas.push([v.nombre, sobrepasos, sobrante, descuadre, ejec.granted.length, ejec.denegadas.length, falsasNegaciones, redondear(pct(todas, 0.5)), redondear(pct(todas, 0.95)), redondear(ejec.ms)])
  }
  tabla(['reserva', 'Negocios por encima del tope', 'tokens por encima', 'saldo ≠ suma de lo concedido (tokens)', 'concedidas', 'denegadas', 'denegadas con sitio', 'p50 (ms)', 'p95 (ms)', 'las 500 en (ms)'], filas)
  const atomica = resultado.get(variantes[0].nombre)!
  const ing1 = resultado.get(variantes[1].nombre)!
  const ing2 = resultado.get(variantes[2].nombre)!
  afirmar('M2 atómica: ningún Negocio termina por encima del tope (0 veces se pasa)', atomica.sobrepasos === 0 && atomica.sobrante === 0, { sobrepasos: atomica.sobrepasos, sobrante: atomica.sobrante })
  afirmar('M2 atómica: cada `usado` que devolvió una reserva concedida es menor o igual al tope', atomica.ejec.usadoVisto.every((u) => u <= TOPE_CUPO), Math.max(...atomica.ejec.usadoVisto))
  afirmar('M2 atómica: el saldo final es exactamente la suma de lo concedido, en cada Negocio', atomica.descuadre === 0, { descuadre: atomica.descuadre })
  afirmar('M2 atómica: no se niega nada que cupiera (toda negación habría pasado el tope con el saldo final)', atomica.falsasNegaciones === 0, atomica.falsasNegaciones)
  afirmar('M2 atómica: el caliente no le quita nada a los otros nueve (todo lo que pidieron se concedió, su demanda cabía)', atomica.dañoAOtros === 0, { negociosRecortados: atomica.dañoAOtros })
  afirmar('M2 atómica: el caliente termina lleno (pidió mucho más que su tope)', (atomica.ejec.concedidas.get(negocios[0].id) ?? 0) > TOPE_CUPO - 120, atomica.ejec.concedidas.get(negocios[0].id))
  afirmar('M2 control: leer, decidir y sumar SÍ se pasa del tope con 500 reservas a la vez', ing1.sobrepasos > 0, { sobrepasos: ing1.sobrepasos, sobrante: ing1.sobrante })
  afirmar('M2 control: leer y escribir lo leído deja un saldo que no cuadra con lo concedido', ing2.descuadre > 0, { descuadre: ing2.descuadre })

  // --- 2. ¿El caliente frena a los demás? ----------------------------------------------------------------------------
  sec('2. ¿El Negocio caliente frena a los demás? Latencia de los otros nueve (234 reservas) en tres condiciones, 3 rondas cada una')
  const soloDemas = construirPeticiones(2811, true)
  const lat: Record<string, number[]> = { 'sin el caliente (234 reservas)': [], 'con el caliente repartido en 266 filas (500 reservas, sin punto caliente)': [], 'con el caliente en una sola fila (500 reservas)': [] }
  const calientesLat: number[] = []
  for (let ronda = 0; ronda < 3; ronda++) {
    // 1) sin el caliente
    await prepararCupos(VENTANA)
    lat['sin el caliente (234 reservas)'].push(...(await correrReservas(soloDemas, VENTANA, reservaAtomica)).latencias.get('demas')!)
    // 2) el caliente reparte su demanda en 266 recursos distintos: la misma carga HTTP, sin contención de fila
    const recursos = Array.from({ length: 266 }, (_, i) => `r${i}`)
    await prepararCupos(VENTANA, [RECURSO, ...recursos], TOPE_CUPO)
    let k = 0
    const e2 = await correrReservas(peticiones, VENTANA, reservaAtomica, (p) => (p.caliente ? recursos[k++ % recursos.length] : RECURSO))
    lat['con el caliente repartido en 266 filas (500 reservas, sin punto caliente)'].push(...e2.latencias.get('demas')!)
    // 3) el caliente en una sola fila
    await prepararCupos(VENTANA)
    const e3 = await correrReservas(peticiones, VENTANA, reservaAtomica)
    lat['con el caliente en una sola fila (500 reservas)'].push(...e3.latencias.get('demas')!)
    calientesLat.push(...e3.latencias.get('caliente')!)
  }
  tabla(CABECERA_STATS, [...Object.entries(lat).map(([k2, xs]) => filaStats(`otros nueve ${k2}`, xs)), filaStats('el caliente, en una sola fila', calientesLat)])
  const aislados = pct(lat['con el caliente repartido en 266 filas (500 reservas, sin punto caliente)'], 0.5)
  const juntos = pct(lat['con el caliente en una sola fila (500 reservas)'], 0.5)
  afirmar(
    `M2: el caliente no frena a los demás: con la misma carga HTTP, la fila caliente no sube el p50 de los otros más de 25 % (${redondear(aislados)} contra ${redondear(juntos)} ms)`,
    juntos <= aislados * 1.25 + 15,
    { aislados, juntos },
  )

  // --- 3. Costo de cada forma de reservar, una a una -------------------------------------------------------------------
  sec('3. Una reserva sola, 40 repeticiones (sin concurrencia), para restar la red')
  await prepararCupos(VENTANA, [RECURSO], 1_000_000_000)
  const sola: Record<string, number[]> = { 'UPDATE … WHERE (atómica)': [], 'INSERT … ON CONFLICT DO UPDATE … WHERE (crea la ventana)': [], 'UPDATE con libro de reservas (CTE)': [], 'leer y después escribir (2 peticiones)': [] }
  for (let i = 0; i < 43; i++) {
    const neg = negocios[i % 10].id
    let t = ahora()
    await reservaAtomica(neg, RECURSO, VENTANA, 1)
    if (i >= 3) sola['UPDATE … WHERE (atómica)'].push(ahora() - t)
    t = ahora()
    await q(SQL_RESERVA_UPSERT, [neg, RECURSO, `u${i}`, 1, 1_000_000_000])
    if (i >= 3) sola['INSERT … ON CONFLICT DO UPDATE … WHERE (crea la ventana)'].push(ahora() - t)
    t = ahora()
    await q(SQL_RESERVA_CON_LIBRO, [neg, RECURSO, VENTANA, 1])
    if (i >= 3) sola['UPDATE con libro de reservas (CTE)'].push(ahora() - t)
    t = ahora()
    await reservaIngenua(neg, RECURSO, VENTANA, 1, 'incremento')
    if (i >= 3) sola['leer y después escribir (2 peticiones)'].push(ahora() - t)
  }
  tabla(CABECERA_STATS, Object.entries(sola).map(([k2, xs]) => filaStats(k2, xs)))
  console.log(`RTT de select 1 (p50 de la fase de red): ${redondear(rtt.p50)} ms.`)

  // --- 4. La misma carga creando las ventanas en el primer uso ------------------------------------------------------------
  sec('4. Las 500 reservas con la sentencia INSERT … ON CONFLICT (la ventana no existe antes)')
  await q('delete from reservas')
  await q('delete from cupos')
  const eU = await correrReservas(peticiones, VENTANA, (a, b, c, d) => reservaUpsert(a, b, c, d))
  const cuposU = await leerCupos(VENTANA)
  const sobreU = cuposU.filter((c) => c.usado > c.tope).length
  const descuadreU = cuposU.reduce((a, c) => a + Math.abs(c.usado - (eU.concedidas.get(c.negocio_id) ?? 0)), 0)
  const todasU = [...eU.latencias.get('caliente')!, ...eU.latencias.get('demas')!]
  tabla(['reserva', 'Negocios por encima del tope', 'saldo ≠ suma de lo concedido', 'concedidas', 'denegadas', 'p50 (ms)', 'p95 (ms)'], [['INSERT … ON CONFLICT DO UPDATE … WHERE', sobreU, descuadreU, eU.granted.length, eU.denegadas.length, redondear(pct(todasU, 0.5)), redondear(pct(todasU, 0.95))]])
  afirmar('M2 upsert: sin pasarse del tope, con el saldo cuadrado, aun creando la ventana en el primer uso', sobreU === 0 && descuadreU === 0, { sobreU, descuadreU })
  afirmar('M2 upsert: una primera reserva más grande que el tope se niega', (await q(SQL_RESERVA_UPSERT, [negocios[0].id, RECURSO, 'enorme', TOPE_CUPO + 1, TOPE_CUPO])).length === 0)

  // --- 5. Reservar 1.000 y devolver lo que sobró ----------------------------------------------------------------------------
  sec('5. Reservar 1.000 tokens por turno y devolver lo que sobró (tope 100.000 en un Negocio; 150 turnos a la vez)')
  const V2 = 'devolucion'
  const neg = negocios[3]
  await q('delete from reservas')
  await q('delete from cupos')
  await q(`insert into cupos (negocio_id, recurso, ventana, tope) values ($1, $2, $3, 100000)`, [neg.id, RECURSO, V2])
  const consumo = (id: number) => 100 + ((id * 7919) % 801) // entre 100 y 900
  const olaDeReservas = async (cuantas: number) => {
    const rs = await Promise.all(Array.from({ length: cuantas }, async () => (await q(SQL_RESERVA_CON_LIBRO, [neg.id, RECURSO, V2, 1000]))[0] as Fila | undefined))
    return rs.filter((r): r is Fila => Boolean(r))
  }
  const saldo = async () => Number((await q(`select usado::int as u from cupos where negocio_id = $1 and recurso = $2 and ventana = $3`, [neg.id, RECURSO, V2]))[0].u)
  const ola1 = await olaDeReservas(150)
  const saldo1 = await saldo()
  afirmar('M2 devolución: de 150 reservas de 1.000 con tope 100.000 caben exactamente 100', ola1.length === 100 && saldo1 === 100000, { concedidas: ola1.length, saldo: saldo1 })
  afirmar('M2 devolución: ninguna reserva vio un saldo por encima del tope', ola1.every((r) => Number(r.usado) <= 100000), Math.max(...ola1.map((r) => Number(r.usado))))
  // Liquidar: cada turno usó entre 100 y 900.
  const consumos = ola1.map((_, i) => consumo(i))
  const liquidadas = await Promise.all(ola1.map((r, i) => q(SQL_LIQUIDAR, [r.id, consumos[i]])))
  const sumaConsumo = consumos.reduce((a, b) => a + b, 0)
  const saldo2 = await saldo()
  afirmar(`M2 devolución: tras liquidar las 100, el saldo es exactamente lo consumido (${sumaConsumo} de 100.000 reservados)`, liquidadas.every((l) => l.length === 1) && saldo2 === sumaConsumo, { saldo: saldo2, sumaConsumo })
  // Liquidar dos veces no devuelve dos veces.
  const repetidas = await Promise.all(ola1.map((r, i) => q(SQL_LIQUIDAR, [r.id, consumos[i]])))
  afirmar('M2 devolución: liquidar otra vez la misma reserva no devuelve nada (idempotente, 100 reintentos a la vez)', repetidas.every((l) => l.length === 0) && (await saldo()) === sumaConsumo, { saldo: await saldo() })
  // Liquidar con más de lo reservado no devuelve nada.
  const [extra] = await olaDeReservas(1)
  const exceso = await q(SQL_LIQUIDAR, [extra.id, 1500])
  afirmar('M2 devolución: si el consumo real supera lo reservado no se devuelve nada', exceso.length === 1 && (await saldo()) === sumaConsumo + 1000, { saldo: await saldo(), esperado: sumaConsumo + 1000 })
  // Lo devuelto vuelve a estar disponible.
  const libre = 100000 - (await saldo())
  const ola2 = await olaDeReservas(150)
  afirmar(`M2 devolución: lo devuelto se puede reservar de nuevo (cabían ${Math.floor(libre / 1000)} y se concedieron ${ola2.length})`, ola2.length === Math.floor(libre / 1000), { libre, concedidas: ola2.length })
  const finalSaldo = await saldo()
  afirmar('M2 devolución: el saldo final es lo consumido, más la reserva cuyo consumo superó lo reservado, más lo que sigue reservado sin liquidar, y no pasa del tope', finalSaldo === sumaConsumo + 1000 + ola2.length * 1000 && finalSaldo <= 100000, { finalSaldo, esperado: sumaConsumo + 1000 + ola2.length * 1000 })
  const [{ suma_libro }] = await q(`select coalesce(sum(case when estado = 'liquidada' then least(consumido, cantidad) else cantidad end), 0)::int as suma_libro from reservas where negocio_id = $1`, [neg.id])
  afirmar('M2 devolución: el saldo de `cupos` coincide con el libro de reservas (lo consumido hasta lo reservado, o lo reservado si sigue abierta)', finalSaldo === Number(suma_libro), { finalSaldo, suma_libro })
  tabla(
    ['paso', 'valor'],
    [
      ['reservas de 1.000 concedidas de 150 (tope 100.000)', ola1.length],
      ['saldo tras la primera ola', saldo1],
      ['tokens consumidos de verdad (suma de las 100)', sumaConsumo],
      ['saldo tras liquidar', saldo2],
      ['liquidaciones repetidas que devolvieron algo', repetidas.filter((l) => l.length > 0).length],
      ['reservas concedidas en la segunda ola', ola2.length],
      ['saldo final', finalSaldo],
    ],
  )
}

// ===============================================================================================================
// M3. RLS + CTE bajo carga
// ===============================================================================================================
const N_PEDIDOS = (k: number) => 9000 + 250 * (k - 1) // de 9.000 a 11.250: cada Negocio se distingue por sus totales
const N_CLIENTES = (k: number) => 400 + 20 * k
const COMO_VENTA = `('confirmado', 'enviado', 'entregado', 'novedad')`

async function sembrarDatos() {
  for (const neg of negocios) {
    const [{ n }] = await q(`select count(*)::int as n from pedidos where negocio_id = $1`, [neg.id])
    const [{ m }] = await q(`select count(*)::int as m from mensajes_cliente where negocio_id = $1`, [neg.id])
    if (n === N_PEDIDOS(neg.k) && m > 0) continue
    await q('delete from mensajes_cliente where negocio_id = $1', [neg.id])
    await q('delete from pedidos where negocio_id = $1', [neg.id])
    await q('delete from clientes where negocio_id = $1', [neg.id])
    await q(
      `insert into clientes (negocio_id, telefono, nombre) select $1::uuid, '57390' || lpad($2::text, 2, '0') || lpad(g::text, 5, '0'), 'Cliente inventado ' || g from generate_series(1, $3::int) g`,
      [neg.id, neg.k, N_CLIENTES(neg.k)],
    )
    await q(
      `with cl as (select array_agg(id order by telefono) as ids from clientes where negocio_id = $1::uuid)
       insert into pedidos (negocio_id, cliente_id, numero, items, total, ciudad, direccion, estado, creado)
       select $1::uuid, (cl.ids)[1 + (g % array_length(cl.ids, 1))], g,
         jsonb_build_array(jsonb_build_object('productoId', gen_random_uuid(), 'nombre', 'Producto ' || (g % 14), 'cantidad', 1 + (g % 3), 'precio', 20000 + ((g * 37) % 80000))),
         (1 + (g % 3)) * (20000 + ((g * 37) % 80000)),
         (array['Bogotá','Medellín','Cali','Barranquilla','Bucaramanga','Pereira','Manizales','Pasto'])[1 + (g % 8)],
         'Calle inventada ' || g,
         (array['pendiente','confirmado','enviado','entregado','novedad','cancelado'])[1 + ((g * 7) % 6)],
         now() - ((g % 180) * interval '1 day') - (((g * 7919) % 86400) * interval '1 second')
       from cl, generate_series(1, $2::int) g`,
      [neg.id, N_PEDIDOS(neg.k)],
    )
    await q(
      `insert into mensajes_cliente (negocio_id, cliente_id, rol, texto, creado)
       select $1::uuid, c.id, case when g % 2 = 0 then 'cliente' else 'agente' end, 'Mensaje inventado ' || g, now() - (g * interval '7 minutes')
       from (select id from clientes where negocio_id = $1::uuid order by telefono limit 300) c, generate_series(1, 30) g`,
      [neg.id],
    )
  }
  await q('analyze pedidos')
  await q('analyze clientes')
  await q('analyze mensajes_cliente')
}

type Verdad = { pedidos: number; ventasN: number; ventasSuma: number; top50: string[]; clientesConMensajes: string[] }
const verdad = new Map<string, Verdad>()
async function calcularVerdad() {
  for (const neg of negocios) {
    const [t] = await q(`select count(*)::int as pedidos, count(*) filter (where estado in ${COMO_VENTA})::int as n, coalesce(sum(total) filter (where estado in ${COMO_VENTA}), 0)::bigint as suma from pedidos where negocio_id = $1`, [neg.id])
    const top = await q(`select id from pedidos where negocio_id = $1 order by creado desc, id limit 50`, [neg.id])
    const cli = await q(`select cliente_id from mensajes_cliente where negocio_id = $1 group by cliente_id order by cliente_id limit 40`, [neg.id])
    verdad.set(neg.id, { pedidos: Number(t.pedidos), ventasN: Number(t.n), ventasSuma: Number(t.suma), top50: top.map((f) => f.id as string), clientesConMensajes: cli.map((f) => f.cliente_id as string) })
  }
}

// El ligado de #8: rol, variable del Negocio, tope de 2 s y la consulta con una CTE por fuente.
const ZONA = 'America/Bogota'
const cteSql = (conWhere: boolean) => `WITH pedidos AS (
  SELECT p.id, p.negocio_id, p.numero, p.cliente_id, p.ciudad, p.estado, p.total, p.creado,
    (p.creado AT TIME ZONE '${ZONA}')::date AS dia_local,
    (p.estado IN ${COMO_VENTA}) AS cuenta_como_venta
  FROM public.pedidos p${conWhere ? ' WHERE p.negocio_id = $1' : ''}
), clientes AS (
  SELECT c.id, c.negocio_id, c.nombre FROM public.clientes c${conWhere ? ' WHERE c.negocio_id = $1' : ''}
)`
type Forma3 = 'agregado' | 'filas'
const consulta = (forma: Forma3, conWhere: boolean) => {
  const cuerpo =
    forma === 'agregado'
      ? `SELECT p.ciudad, count(*)::int AS n, sum(p.total)::bigint AS suma, count(DISTINCT p.negocio_id)::int AS negocios, min(p.negocio_id::text) AS negocio
         FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE p.cuenta_como_venta GROUP BY p.ciudad ORDER BY p.ciudad`
      : `SELECT p.id, p.negocio_id, p.total, c.nombre FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ORDER BY p.creado DESC, p.id LIMIT 50`
  return `${cteSql(conWhere)}\nSELECT to_jsonb(q) AS r, count(*) OVER () AS total FROM (\n${cuerpo}\n) q LIMIT 500`
}

const prologoRls = (negocioId: string, rol = 'amanece_consultas'): Sentencia[] => [
  [`SET LOCAL ROLE ${rol}`],
  [`SELECT set_config('app.negocio_id', $1, true)`, [negocioId]],
  [`SET LOCAL statement_timeout = '2s'`],
]
const prologoSinRls: Sentencia[] = [[`SET LOCAL statement_timeout = '2s'`]]

type Intento = { ok: true; res: Fila[][]; ms: number } | { ok: false; error: string; ms: number }
async function intentar(sentencias: Sentencia[], readOnly = true): Promise<Intento> {
  const t0 = ahora()
  try {
    const res = await lote(sentencias, readOnly)
    return { ok: true, res, ms: ahora() - t0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: ahora() - t0 }
  }
}

function revisar(forma: Forma3, neg: Negocio, filas: Fila[]) {
  const v = verdad.get(neg.id)!
  const rs = filas.map((f) => f.r as Fila)
  if (forma === 'agregado') {
    const fugas = rs.filter((r) => r.negocios !== 1 || r.negocio !== neg.id).length
    const n = rs.reduce((a, r) => a + Number(r.n), 0)
    const suma = rs.reduce((a, r) => a + Number(r.suma), 0)
    return { fugas, discrepancia: n === v.ventasN && suma === v.ventasSuma ? 0 : 1 }
  }
  const fugas = rs.filter((r) => r.negocio_id !== neg.id).length
  const ids = new Set(rs.map((r) => r.id as string))
  const igual = ids.size === v.top50.length && v.top50.every((id) => ids.has(id))
  return { fugas, discrepancia: igual ? 0 : 1 }
}

type ResultadoCarga = { nombre: string; ms: number[]; lotes: number; errores: number; fugas: number; discrepancias: number; primerError?: string }
/** 500 lotes: 50 por Negocio, repartidos en 10 ráfagas de 50 en paralelo con los Negocios mezclados. */
async function carga(nombre: string, o: { rls: boolean; conWhere: boolean; semilla: number }): Promise<ResultadoCarga> {
  const azar = crearAzar(o.semilla)
  const tareas = negocios.flatMap((neg) => Array.from({ length: 50 }, (_, i) => ({ neg, forma: (i % 2 === 0 ? 'agregado' : 'filas') as Forma3 })))
  const mezcla = barajar(tareas, azar)
  const r: ResultadoCarga = { nombre, ms: [], lotes: 0, errores: 0, fugas: 0, discrepancias: 0 }
  for (let b = 0; b < 10; b++) {
    await Promise.all(
      mezcla.slice(b * 50, (b + 1) * 50).map(async (t) => {
        const sentencias: Sentencia[] = [...(o.rls ? prologoRls(t.neg.id) : prologoSinRls), [consulta(t.forma, o.conWhere), o.conWhere ? [t.neg.id] : []]]
        const x = await intentar(sentencias)
        r.lotes++
        if (!x.ok) {
          r.errores++
          r.primerError ??= x.error.slice(0, 120)
          return
        }
        r.ms.push(x.ms)
        const rev = revisar(t.forma, t.neg, x.res[x.res.length - 1])
        r.fugas += rev.fugas
        r.discrepancias += rev.discrepancia
      }),
    )
  }
  return r
}

const mutarPoliticas = async (usando: string) => {
  for (const tabla of ['pedidos', 'clientes']) {
    await q(`alter policy consultas_negocio on ${tabla} using (${usando})`)
  }
}
const POLITICA = `negocio_id = current_setting('app.negocio_id')::uuid`

function planDeRls(res: Fila[][]) {
  return res[res.length - 1].map((f) => String(f['QUERY PLAN']))
}

async function m3() {
  console.log('\n## M3. RLS + CTE bajo carga\n')
  const sec = (s: string) => console.log(`\n### ${s}`)
  console.log('Sembrando 10 Negocios inventados (pedidos, Clientes y mensajes sintéticos)…')
  await sembrarDatos()
  await calcularVerdad()
  tabla(
    ['Negocio', 'pedidos', 'ventas (confirmado, enviado, entregado, novedad)', 'suma de ventas (COP inventados)'],
    negocios.map((n) => [n.codigo, verdad.get(n.id)!.pedidos, verdad.get(n.id)!.ventasN, verdad.get(n.id)!.ventasSuma]),
  )
  if (SABOTAJE === 'politica-true') {
    console.log('SABOTAJE politica-true: las políticas RLS de pedidos y clientes pasan a `true`.')
    await mutarPoliticas('true')
  } else await mutarPoliticas(POLITICA)

  // --- 1. El ligado funciona --------------------------------------------------------------------------------------
  sec('1. El lote aplica rol, variable y tope juntos')
  {
    const x = await intentar([...prologoRls(negocios[A].id), [`select current_user as usuario, current_setting('app.negocio_id') as negocio, current_setting('statement_timeout') as tope, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls, (select count(*)::int from public.pedidos) as visibles`]])
    const f = x.ok ? x.res[3][0] : null
    console.log(f ?? (x as { error: string }).error)
    afirmar('M3 ligado: el lote corre como amanece_consultas, sin BYPASSRLS, con el Negocio de la sesión, tope de 2 s y solo ve los pedidos de A', Boolean(f) && f!.usuario === 'amanece_consultas' && f!.negocio === negocios[A].id && f!.tope === '2s' && f!.bypassrls === false && f!.visibles === verdad.get(negocios[A].id)!.pedidos, f)
  }

  // --- 2. Falla cerrado --------------------------------------------------------------------------------------------
  sec('2. Un lote sin `set_config` falla cerrado')
  const filasCierre: (string | number)[][] = []
  const cuenta = 'select count(*)::int as n from public.pedidos'
  const resumirIntento = (x: Intento) => (x.ok ? `0 errores, ${x.res[x.res.length - 1][0].n} filas visibles` : `error: ${x.error.slice(0, 80)}`)
  const sinVariable = await intentar([[`SET LOCAL ROLE amanece_consultas`], [`SET LOCAL statement_timeout = '2s'`], [cuenta]])
  filasCierre.push(['política estricta (como #8): sin `set_config`', resumirIntento(sinVariable)])
  const vacia = await intentar([[`SET LOCAL ROLE amanece_consultas`], [`SELECT set_config('app.negocio_id', '', true)`], [cuenta]])
  filasCierre.push(['política estricta: `set_config` con cadena vacía', resumirIntento(vacia)])
  const mala = await intentar([[`SET LOCAL ROLE amanece_consultas`], [`SELECT set_config('app.negocio_id', 'no-es-un-uuid', true)`], [cuenta]])
  filasCierre.push(['política estricta: `set_config` con un valor que no es uuid', resumirIntento(mala)])
  const cerrado = (x: Intento) => !x.ok || Number(x.res[x.res.length - 1][0].n) === 0
  afirmar('M3 falla cerrado: sin `set_config`, con cadena vacía y con un valor inválido nunca devuelve filas (error o 0 filas)', [sinVariable, vacia, mala].every(cerrado), [sinVariable, vacia, mala].map(resumirIntento))
  // Variante tolerante: `current_setting(..., true)` devuelve null y la política no deja pasar nada.
  await q(`alter policy consultas_negocio on pedidos using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)`)
  try {
    const tolerante = await intentar([[`SET LOCAL ROLE amanece_consultas`], [`SET LOCAL statement_timeout = '2s'`], [cuenta]])
    filasCierre.push(['política tolerante (`current_setting(…, true)`): sin `set_config`', resumirIntento(tolerante)])
    afirmar('M3 falla cerrado: con la política tolerante, sin `set_config` devuelve 0 filas (no error)', tolerante.ok && Number(tolerante.res[2][0].n) === 0, resumirIntento(tolerante))
  } finally {
    await q(`alter policy consultas_negocio on pedidos using (${SABOTAJE === 'politica-true' ? 'true' : POLITICA})`)
  }
  // Conexiones reutilizadas: lotes con y sin `set_config` mezclados no se contagian.
  {
    const nA = verdad.get(negocios[A].id)!.pedidos
    const con = await Promise.all(Array.from({ length: 100 }, () => intentar([...prologoRls(negocios[A].id), [cuenta]])))
    const mezcla = await Promise.all(
      Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? intentar([...prologoRls(negocios[A].id), [cuenta]]) : intentar([[`SET LOCAL ROLE amanece_consultas`], [`SET LOCAL statement_timeout = '2s'`], [cuenta]]))),
    )
    const sin = mezcla.filter((_, i) => i % 2 === 1)
    const conMezcla = mezcla.filter((_, i) => i % 2 === 0)
    filasCierre.push(['100 lotes con `set_config` de A y luego 100 sin él, mezclados a la vez (conexiones reutilizadas)', `los 100 sin él: ${sin.filter(cerrado).length} cerraron; los 100 con él: ${conMezcla.filter((x) => x.ok && Number(x.res[3][0].n) === nA).length} vieron exactamente los ${nA} pedidos de A`])
    afirmar('M3 falla cerrado: 100 lotes sin `set_config` mezclados con 100 con él (conexiones reutilizadas) nunca ven filas', sin.every(cerrado), sin.filter((x) => !cerrado(x)).slice(0, 2))
    afirmar('M3 falla cerrado: los lotes con `set_config` de A ven exactamente los pedidos de A', [...con, ...conMezcla].every((x) => x.ok && Number(x.res[3][0].n) === nA), [...con, ...conMezcla].filter((x) => !x.ok).slice(0, 2))
  }
  tabla(['caso', 'resultado'], filasCierre)

  // --- 3. Ataques desde dentro del rol --------------------------------------------------------------------------------
  sec('3. Qué frena la base sola, si el validador se saltara (el rol, ya con el Negocio A puesto)')
  const idB = negocios[B].id
  type Ataque = { nombre: string; sentencia: string; esperado: 'frenado' | 'limite'; ok?: (res: Fila[]) => boolean }
  const ataques: Ataque[] = [
    { nombre: 'leer una tabla sin permiso (`negocios`)', sentencia: `select * from public.negocios`, esperado: 'frenado' },
    { nombre: 'leer una columna no concedida (texto de los mensajes)', sentencia: `select texto from public.mensajes_cliente limit 1`, esperado: 'frenado' },
    { nombre: 'leer una columna no concedida (dirección del pedido)', sentencia: `select direccion from public.pedidos limit 1`, esperado: 'frenado' },
    { nombre: 'escribir (`update`)', sentencia: `update public.pedidos set total = 0`, esperado: 'frenado' },
    { nombre: 'borrar (`delete`)', sentencia: `delete from public.pedidos`, esperado: 'frenado' },
    { nombre: 'insertar', sentencia: `insert into public.clientes (negocio_id, telefono) values ('${negocios[A].id}', '573900000000')`, esperado: 'frenado' },
    { nombre: 'leer `pg_authid` (hashes de contraseña)', sentencia: `select rolname, rolpassword from pg_authid`, esperado: 'frenado' },
    { nombre: 'leer `pg_shadow`', sentencia: `select usename, passwd from pg_shadow`, esperado: 'frenado' },
    { nombre: 'leer un archivo del servidor (`pg_read_file`)', sentencia: `select pg_read_file('/etc/hostname')`, esperado: 'frenado' },
    { nombre: 'ver las consultas de otras sesiones (`pg_stat_activity.query`)', sentencia: `select count(*)::int as n from pg_stat_activity where usename is distinct from current_user and query not in ('<insufficient privilege>', '')`, esperado: 'frenado', ok: (res) => Number(res[0].n) === 0 },
    { nombre: 'pedir las filas de B con el Negocio A puesto', sentencia: `select count(*)::int as n from public.pedidos where negocio_id = '${idB}'`, esperado: 'frenado', ok: (res) => Number(res[0].n) === 0 },
    { nombre: 'pedir los Clientes de B con el Negocio A puesto', sentencia: `select count(*)::int as n from public.clientes where negocio_id = '${idB}'`, esperado: 'frenado', ok: (res) => Number(res[0].n) === 0 },
    { nombre: '`pg_sleep(5)` con el tope de 2 s', sentencia: `select pg_sleep(5)`, esperado: 'frenado' },
    { nombre: 'producto cartesiano de pedidos (tope de 2 s)', sentencia: `select count(*) from public.pedidos a, public.pedidos b, public.pedidos c`, esperado: 'frenado' },
    { nombre: 'listar los nombres de las tablas (`pg_class`, metadatos públicos)', sentencia: `select count(*)::int as n from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`, esperado: 'limite', ok: (res) => Number(res[0].n) > 0 },
    { nombre: 'listar los nombres de los roles (`pg_roles`)', sentencia: `select count(*)::int as n from pg_roles`, esperado: 'limite', ok: (res) => Number(res[0].n) > 0 },
    { nombre: '`SET ROLE neondb_owner` (volver al dueño de la sesión)', sentencia: `set local role neondb_owner`, esperado: 'limite' },
    { nombre: '`SET ROLE amanece_nucleo` (otro rol de la app)', sentencia: `set local role amanece_nucleo`, esperado: 'limite' },
    { nombre: '`SET ROLE neon_superuser`', sentencia: `set local role neon_superuser`, esperado: 'frenado' },
    { nombre: '`SET ROLE cloud_admin`', sentencia: `set local role cloud_admin`, esperado: 'frenado' },
  ]
  const filasAtaque: (string | number)[][] = []
  for (const a of ataques) {
    // Sin `readOnly`: lo que frene una escritura tiene que ser el privilegio, no la transacción de solo lectura.
    const x = await intentar([...prologoRls(negocios[A].id), [a.sentencia]], false)
    const filas = x.ok ? x.res[3] : []
    const cumple = a.ok ? x.ok && a.ok(filas) : undefined
    const detalle = x.ok ? `no dio error${a.ok ? (cumple ? ' y no devolvió filas ajenas' : ' y devolvió lo que no debía') : ''}; ${redondear(x.ms)} ms` : `${x.error.slice(0, 70)} (${redondear(x.ms)} ms)`
    const pasa = a.esperado === 'frenado' ? (a.ok ? Boolean(cumple) : !x.ok) : a.ok ? Boolean(cumple) : x.ok
    filasAtaque.push([a.nombre, a.esperado === 'frenado' ? (pasa ? 'frenado' : 'NO frenado') : x.ok ? 'no se frena (límite)' : 'frenado', detalle])
    afirmar(`M3 ataque${a.esperado === 'limite' ? ' (límite conocido, el validador es el anillo)' : ''}: ${a.nombre} → ${a.esperado === 'frenado' ? 'lo frena la base' : 'la base no lo frena'}`, pasa, detalle)
  }
  tabla(['intento desde dentro del rol', 'resultado', 'detalle'], filasAtaque)
  {
    // El hallazgo de #8: un `set_config` dentro del SELECT le da a A las filas de B.
    const x = await intentar([...prologoRls(negocios[A].id), [`select count(*)::int as n, count(distinct p.negocio_id)::int as negocios, min(p.negocio_id::text) as negocio from public.pedidos p, (select set_config('app.negocio_id', '${idB}', true)) s`]])
    const f = x.ok ? x.res[3][0] : null
    console.log(`set_config dentro del SELECT (sesión de A, pide B): ${f ? JSON.stringify(f) : (x as { error: string }).error.slice(0, 100)}`)
    const quienVio = f ? (f.negocio === idB ? 'filas de B' : f.negocio === negocios[A].id ? 'filas de A' : 'otra cosa') : 'error'
    afirmar(`M3 límite conocido de #8: un \`set_config\` dentro del SELECT ${quienVio === 'filas de B' ? 'SÍ cambia de Negocio (A ve filas de B)' : 'no cambia de Negocio en esta corrida (' + quienVio + ')'}; se registra para que el validador lo prohíba`, quienVio === 'filas de B', f)
  }

  // --- 3b. Estado de sesión entre peticiones -----------------------------------------------------------------------------
  sec('3b. ¿Sobrevive el estado de sesión entre peticiones HTTP? (una consulta que fija la variable o el rol sin `LOCAL`)')
  {
    const nB = verdad.get(idB)!.pedidos
    const N = 120
    const ejecutarSinVariable = () => Promise.all(Array.from({ length: N }, () => intentar([[`SET LOCAL ROLE amanece_consultas`], [`select count(*)::int as n from public.pedidos`]], false)))
    const contagiados = (rs: Intento[]) => rs.filter((x) => x.ok && Number(x.res[1][0].n) > 0).length
    await Promise.all(Array.from({ length: N }, () => q(`select set_config('app.negocio_id', $1, false)`, [idB])))
    const trasVariable = contagiados(await ejecutarSinVariable())
    await Promise.all(Array.from({ length: N * 3 }, () => q(`select set_config('app.negocio_id', '', false)`)))
    const trasLimpiar = contagiados(await ejecutarSinVariable())
    await Promise.all(Array.from({ length: N }, () => q(`set role amanece_nucleo`)))
    const conRolPegado = (await Promise.all(Array.from({ length: N }, () => q(`select current_user as u`)))).filter((r) => r[0].u !== 'neondb_owner').length
    await Promise.all(Array.from({ length: N * 3 }, () => q(`reset role`)))
    const trasResetRol = (await Promise.all(Array.from({ length: N }, () => q(`select current_user as u`)))).filter((r) => r[0].u !== 'neondb_owner').length
    tabla(
      ['qué se hizo', 'resultado'],
      [
        [`${N} peticiones sueltas fijan \`app.negocio_id\` = B con \`is_local = false\`; luego ${N} lotes con \`SET LOCAL ROLE\` y sin \`set_config\``, `${trasVariable} de ${N} lotes vieron filas (B tiene ${nB} pedidos)`],
        [`${N * 3} peticiones sueltas dejan la variable en cadena vacía; se repiten los ${N} lotes`, `${trasLimpiar} de ${N} lotes vieron filas`],
        [`${N} peticiones sueltas hacen \`SET ROLE amanece_nucleo\` sin LOCAL; luego ${N} \`select current_user\``, `${conRolPegado} de ${N} corrieron con un rol distinto de neondb_owner`],
        [`${N * 3} peticiones sueltas hacen \`RESET ROLE\`; se repiten los ${N} \`select current_user\``, `${trasResetRol} de ${N} con un rol distinto de neondb_owner`],
      ],
    )
    afirmar(`M3 estado de sesión: el estado fijado en una petición ${trasVariable === 0 && conRolPegado === 0 ? 'NO sobrevive' : 'SOBREVIVE'} en la siguiente (variable: ${trasVariable} de ${N} contagiados; rol: ${conRolPegado} de ${N})`, trasVariable === 0 && conRolPegado === 0, { trasVariable, conRolPegado })
    afirmar('M3 estado de sesión: después de la limpieza no queda ninguna conexión con la variable ni con el rol puestos', trasLimpiar === 0 && trasResetRol === 0, { trasLimpiar, trasResetRol })
  }

  // --- 4. EXPLAIN ---------------------------------------------------------------------------------------------------------
  sec('4. ¿La política usa el índice? EXPLAIN (ANALYZE, BUFFERS) dentro del lote, con el rol y el Negocio puestos')
  const planes: { nombre: string; texto: string[] }[] = []
  {
    const a = await lote([...prologoRls(negocios[A].id), [`explain (analyze, buffers, costs off) select count(*) from public.pedidos`]], true)
    planes.push({ nombre: 'solo la política, sin WHERE: `select count(*) from pedidos`', texto: planDeRls(a) })
    const b = await lote([...prologoRls(negocios[A].id), [`explain (analyze, buffers, costs off) ${consulta('agregado', true)}`, [negocios[A].id]]], true)
    planes.push({ nombre: 'la consulta del Indicador con la CTE `WHERE negocio_id = $1` (política y CTE a la vez)', texto: planDeRls(b) })
    const c = await lote([...prologoRls(negocios[A].id, 'amanece_nucleo'), [`explain (analyze, buffers, costs off) select rol, texto, creado from public.mensajes_cliente where cliente_id = $1 order by creado desc limit 20`, [verdad.get(negocios[A].id)!.clientesConMensajes[0]]]], true)
    planes.push({ nombre: 'últimos 20 mensajes de un Cliente, solo con la política (sin `negocio_id` en el WHERE)', texto: planDeRls(c) })
  }
  for (const p of planes) console.log(`-- ${p.nombre}\n${p.texto.join('\n')}`)
  afirmar('M3 EXPLAIN: la política sobre `pedidos` se resuelve con un índice por `negocio_id` (sin recorrido secuencial)', planes[0].texto.some((l) => /Index (Only )?Scan/.test(l)) && !planes[0].texto.some((l) => /Seq Scan on pedidos/.test(l)), planes[0].texto)
  afirmar('M3 EXPLAIN: la consulta del Indicador no recorre `pedidos` ni `clientes` en secuencial', !planes[1].texto.some((l) => /Seq Scan on (pedidos|clientes)/.test(l)), planes[1].texto)
  afirmar('M3 EXPLAIN: la lectura de mensajes con solo la política usa un índice (sin recorrido secuencial)', planes[2].texto.some((l) => /Index (Only )?Scan/.test(l)) && !planes[2].texto.some((l) => /Seq Scan on mensajes_cliente/.test(l)), planes[2].texto)

  // --- 5. 500 lotes concurrentes --------------------------------------------------------------------------------------------
  sec('5. 500 lotes concurrentes (50 por Negocio, en 10 ráfagas de 50 en paralelo, Negocios mezclados)')
  await carga('calentamiento', { rls: true, conWhere: true, semilla: 1 })
  const rondas: Record<'rls' | 'sin', ResultadoCarga[]> = { rls: [], sin: [] }
  for (let ronda = 0; ronda < 2; ronda++) {
    rondas.rls.push(await carga('con RLS + CTE', { rls: true, conWhere: true, semilla: 100 + ronda }))
    rondas.sin.push(await carga('sin RLS, solo CTE', { rls: false, conWhere: true, semilla: 100 + ronda }))
  }
  const juntar = (nombre: string, rs: ResultadoCarga[]): ResultadoCarga => ({
    nombre,
    ms: rs.flatMap((r) => r.ms),
    lotes: rs.reduce((a, r) => a + r.lotes, 0),
    errores: rs.reduce((a, r) => a + r.errores, 0),
    fugas: rs.reduce((a, r) => a + r.fugas, 0),
    discrepancias: rs.reduce((a, r) => a + r.discrepancias, 0),
    primerError: rs.find((r) => r.primerError)?.primerError,
  })
  const conRls = juntar('con RLS + CTE (producción)', rondas.rls)
  const sinRls = juntar('sin RLS, solo CTE', rondas.sin)
  const anillo = await carga('CTE sin WHERE + RLS (un error de la CTE)', { rls: true, conWhere: false, semilla: 300 })
  await mutarPoliticas('true')
  let mutacion: ResultadoCarga
  try {
    mutacion = await carga('CTE sin WHERE + política en `true` (mutación de control)', { rls: true, conWhere: false, semilla: 301 })
  } finally {
    await mutarPoliticas(SABOTAJE === 'politica-true' ? 'true' : POLITICA)
  }
  const todas = [conRls, sinRls, anillo, mutacion]
  tabla(
    ['configuración', 'lotes', 'errores', 'filas de otro Negocio (fugas)', 'totales ≠ verdad', 'p50 (ms)', 'p90', 'p95', 'mín', 'máx'],
    todas.map((r) => {
      const s = resumen(r.ms)
      return [r.nombre, r.lotes, r.errores, r.fugas, r.discrepancias, redondear(s.p50), redondear(s.p90), redondear(s.p95), redondear(s.min), redondear(s.max)]
    }),
  )
  const dif = resumen(conRls.ms).p50 - resumen(sinRls.ms).p50
  console.log(`Diferencia de p50, con RLS menos sin RLS: ${redondear(dif)} ms. Diferencia de p95: ${redondear(resumen(conRls.ms).p95 - resumen(sinRls.ms).p95)} ms. Un select 1 cuesta ${redondear(rtt.p50)} ms (p50).`)
  afirmar(`M3 carga: ${conRls.lotes} lotes con RLS + CTE sin un solo error`, conRls.errores === 0, conRls.primerError)
  afirmar('M3 carga: con RLS + CTE ninguna fila es de otro Negocio (fugas = 0)', conRls.fugas === 0, { fugas: conRls.fugas })
  afirmar('M3 carga: con RLS + CTE todos los totales y las listas coinciden con la verdad', conRls.discrepancias === 0, { discrepancias: conRls.discrepancias })
  afirmar('M3 carga: sin RLS (solo la CTE) tampoco hay fugas ni diferencias, así que la CTE sola ya liga bien', sinRls.errores === 0 && sinRls.fugas === 0 && sinRls.discrepancias === 0, { errores: sinRls.errores, fugas: sinRls.fugas, discrepancias: sinRls.discrepancias })
  afirmar('M3 anillo: con una CTE sin `WHERE` (el error), RLS deja a cada Negocio solo con lo suyo: fugas = 0 y totales correctos', anillo.errores === 0 && anillo.fugas === 0 && anillo.discrepancias === 0, { errores: anillo.errores, fugas: anillo.fugas, discrepancias: anillo.discrepancias })
  afirmar('M3 mutación de control: con la política en `true` y la CTE sin `WHERE`, la prueba de fugas SÍ detecta fugas (la afirmación puede fallar)', mutacion.fugas > 0 && mutacion.discrepancias > 0, { fugas: mutacion.fugas, discrepancias: mutacion.discrepancias })

  // --- 6. Cuánto cuesta envolver una lectura simple del núcleo en el lote con RLS -------------------------------------------------
  sec('6. Una lectura simple del núcleo (últimos 20 mensajes de un Cliente): suelta contra el lote con RLS')
  const leer = `select rol, texto, creado from public.mensajes_cliente where negocio_id = $1 and cliente_id = $2 order by creado desc limit 20`
  const leerSoloPolitica = `select rol, texto, creado from public.mensajes_cliente where cliente_id = $1 order by creado desc limit 20`
  const reloj: Sentencia = [`select extract(epoch from clock_timestamp())::float8 as t`]
  type Modo = { nombre: string; wall: () => Promise<Fila[]>; servidor: () => Promise<number> }
  const elegir = (i: number) => {
    const neg = negocios[i % 10]
    const cli = verdad.get(neg.id)!.clientesConMensajes[(i * 7) % 40]
    return { neg: neg.id, cli }
  }
  const comprobar20 = (filas: Fila[]) => {
    if (filas.length !== 20) throw new Error(`se esperaban 20 mensajes y llegaron ${filas.length}`)
    return filas
  }
  const modos = (i: number): Modo[] => {
    const { neg, cli } = elegir(i)
    const dif = (res: Fila[][]) => (Number(res[res.length - 1][0].t) - Number(res[0][0].t)) * 1000
    return [
      { nombre: 'suelta: una petición, `WHERE negocio_id = $1`', wall: async () => comprobar20(await q(leer, [neg, cli])), servidor: async () => dif(await lote([reloj, [leer, [neg, cli]], reloj], true)) },
      { nombre: 'lote sin RLS: transacción de solo lectura con tope', wall: async () => comprobar20((await lote([...prologoSinRls, [leer, [neg, cli]]], true))[1]), servidor: async () => dif(await lote([reloj, ...prologoSinRls, [leer, [neg, cli]], reloj], true)) },
      { nombre: 'lote con RLS: rol + variable + tope + `WHERE negocio_id = $1`', wall: async () => comprobar20((await lote([...prologoRls(neg, 'amanece_nucleo'), [leer, [neg, cli]]], true))[3]), servidor: async () => dif(await lote([reloj, ...prologoRls(neg, 'amanece_nucleo'), [leer, [neg, cli]], reloj], true)) },
      { nombre: 'lote con RLS, solo la política (sin `negocio_id` en el WHERE)', wall: async () => comprobar20((await lote([...prologoRls(neg, 'amanece_nucleo'), [leerSoloPolitica, [cli]]], true))[3]), servidor: async () => dif(await lote([reloj, ...prologoRls(neg, 'amanece_nucleo'), [leerSoloPolitica, [cli]], reloj], true)) },
      { nombre: 'lote sin RLS con 3 sentencias de relleno (`select 1`) en lugar del prólogo', wall: async () => comprobar20((await lote([[`select 1`], [`select 1`], [`select 1`], [leer, [neg, cli]]], true))[3]), servidor: async () => dif(await lote([reloj, [`select 1`], [`select 1`], [`select 1`], [leer, [neg, cli]], reloj], true)) },
    ]
  }
  const NOMBRES = modos(0).map((m) => m.nombre)
  const wall: Record<string, number[]> = Object.fromEntries(NOMBRES.map((n) => [n, []]))
  const servidor: Record<string, number[]> = Object.fromEntries(NOMBRES.map((n) => [n, []]))
  const REPS = 150
  for (let i = 0; i < REPS + 4; i++) {
    const orden = barajar(modos(i), crearAzar(500 + i)) // el orden cambia en cada repetición
    for (const m of orden) {
      const t = ahora()
      await m.wall()
      if (i >= 4) wall[m.nombre].push(ahora() - t)
    }
    for (const m of orden) {
      const s = await m.servidor()
      if (i >= 4) servidor[m.nombre].push(s)
    }
  }
  console.log('Por HTTP, desde esta máquina (ms):')
  tabla(CABECERA_STATS, NOMBRES.map((n) => filaStats(n, wall[n])))
  console.log('Tiempo en el servidor, de la primera a la última sentencia del lote (ms, reloj de Postgres):')
  tabla(CABECERA_STATS, NOMBRES.map((n) => filaStats(n, servidor[n])))
  const suelta = NOMBRES[0]
  const conRlsNombre = NOMBRES[2]
  const sobrecostoWall = pct(wall[conRlsNombre], 0.5) - pct(wall[suelta], 0.5)
  const sobrecostoServidor = pct(servidor[conRlsNombre], 0.5) - pct(servidor[NOMBRES[1]], 0.5)
  const rellenoServidor = pct(servidor[NOMBRES[4]], 0.5) - pct(servidor[NOMBRES[1]], 0.5)
  console.log(`Con RLS menos suelta: ${redondear(sobrecostoWall)} ms en p50 por HTTP (${redondear(pct(wall[conRlsNombre], 0.95) - pct(wall[suelta], 0.95))} ms en p95). En el servidor, el prólogo con RLS suma ${redondear(sobrecostoServidor)} ms en p50 sobre el mismo lote sin RLS; tres sentencias de relleno suman ${redondear(rellenoServidor)} ms, así que casi todo es el costo de tener más sentencias en el lote y ${redondear(sobrecostoServidor - rellenoServidor)} ms es el rol, la variable y la política.`)
  afirmar('M3 costo: las 4 formas devolvieron los mismos 20 mensajes (cada lectura comprobó que llegaron 20)', NOMBRES.every((n) => wall[n].length === REPS), NOMBRES.map((n) => wall[n].length))
  afirmar('M3 costo: envolver la lectura en el lote con RLS suma menos de 50 ms en p50 sobre la lectura suelta', sobrecostoWall < 50, { sobrecostoWall })

  // Bajo concurrencia: ráfagas de 50.
  console.log('Bajo concurrencia, 10 ráfagas de 50 lecturas a la vez (ms por lectura):')
  const rafagas: Record<string, number[]> = { [NOMBRES[0]]: [], [NOMBRES[2]]: [] }
  for (let b = 0; b < 10; b++) {
    for (const idx of b % 2 === 0 ? [0, 2] : [2, 0]) {
      await Promise.all(
        Array.from({ length: 50 }, async (_, j) => {
          const m = modos(b * 50 + j)[idx]
          const t = ahora()
          await m.wall()
          rafagas[m.nombre].push(ahora() - t)
        }),
      )
    }
  }
  tabla(CABECERA_STATS, Object.entries(rafagas).map(([n, xs]) => filaStats(n, xs)))
}

// ===============================================================================================================
// Principal
// ===============================================================================================================
console.log(`Medición del aislamiento · rama desechable de Neon · ENVIO_SIMULADO=${process.env.ENVIO_SIMULADO}${SABOTAJE ? ` · SABOTAJE ${SABOTAJE}` : ''} · fase ${fase}`)
console.log('Sin modelo y sin Kapso: el único destino de red permitido es Neon.')

try {
  await aplicarSql()
  await sembrarNegocios()
  const rondasDeRed: number[][] = []
  const primera = await red('al empezar')
  rondasDeRed.push(primera)
  rtt = { p50: pct(primera, 0.5), min: Math.min(...primera) }
  if (quiere('m1')) await m1()
  if (quiere('m2')) await m2()
  if (quiere('m3')) await m3()
  if (fase === 'red' || fase === 'todo') {
    rondasDeRed.push(await red('al terminar'))
    const todas = rondasDeRed.flat()
    console.log(`\nLectura de la red (${todas.length} repeticiones, antes y después): la consulta trivial tarda ${redondear(pct(todas, 0.5))} ms (p50), ${redondear(pct(todas, 0.95))} ms (p95) y ${redondear(Math.min(...todas))} ms como mínimo.`)
  }
  console.log(`\nPeticiones HTTP a Neon en este proceso: ${peticionesHttp}`)
} catch (error) {
  afirmar('la medición terminó sin error inesperado', false, error)
}
terminar()
