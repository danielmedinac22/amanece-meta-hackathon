/**
 * Medición desechable del ticket #13: cuánto cuesta volver durable el turno del Agente de clientes.
 *
 *  1. Línea base: `recibirMensaje` tal cual, 20 turnos de Clientes sintéticos distintos.
 *  2. Camino durable: los mismos 20 turnos por una cola de Postgres (`trabajos` + `salientes`).
 *  3. Fallas: dos drenadores a la vez, reentregas y fallas inyectadas; afirma con `afirmar`.
 *  4. Red: ida y vuelta de una consulta trivial por el driver HTTP de Neon.
 *
 * Solo corre contra una rama desechable de Neon: aborta si el host de DATABASE_URL no empieza por
 * MEDIR_HOST_ESPERADO. El envío es siempre simulado y los mensajes son inventados.
 *
 *   pnpm tsx scripts/medir-turno-durable.mts [--fase=red|micro|latencia|fallas|todo] [--pares=20]
 *   MEDIR_SIN_MODELO=1 simula el modelo en la capa HTTP, solo para depurar el arnés sin gastar llamadas.
 *   MEDIR_TOPE_MODELO=N corta la corrida si pasa de N peticiones al modelo.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { connect } from 'node:net'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { afirmar, capturarEnvios, capturarErrores, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true, override: true })
process.env.ENVIO_SIMULADO = '1'

const esHijo = process.argv.includes('--hijo')
if (esHijo) console.log = (...a: unknown[]) => void writeSync(1, `${a.map(String).join(' ')}\n`)

const hostDeBase = new URL(process.env.DATABASE_URL ?? 'postgres://nada@nada/nada').hostname
const hostSinPooler = (h: string) => h.split('.')[0].replace(/-pooler$/, '')
const esperado = process.env.MEDIR_HOST_ESPERADO
for (const variable of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
  const host = new URL(process.env[variable] ?? 'postgres://nada@nada/nada').hostname
  if (!esperado || hostSinPooler(host) !== esperado) {
    console.error(`Aborto: el host de ${variable} (${hostSinPooler(host)}) no es el de la rama desechable.`)
    process.exit(2)
  }
}
if (process.env.KAPSO_API_KEY || process.env.KAPSO_PHONE_NUMBER_ID) {
  console.error('Aborto: esta medición no debe tener llaves de Kapso.')
  process.exit(2)
}

// Cronómetro de red. Cada petición HTTP se clasifica por destino y se mide con su cuerpo, para repartir el
// tiempo de un turno entre modelo y base de datos sin adivinar. Va antes de importar nada que haga `fetch`.
type Destino = 'db' | 'modelo' | 'otro'
type Intervalo = { destino: Destino; ini: number; fin: number }
const intervalos: Intervalo[] = []
let peticionesAlModelo = 0
const TOPE_MODELO = Number(process.env.MEDIR_TOPE_MODELO ?? 100)
const SIN_MODELO = process.env.MEDIR_SIN_MODELO === '1'
const fetchReal = globalThis.fetch

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  const destino: Destino = url.includes('api.meta.ai') ? 'modelo' : url.includes('neon.tech') ? 'db' : 'otro'
  const ini = performance.now()
  try {
    if (destino === 'modelo') {
      if (SIN_MODELO) {
        await dormir(300)
        return Response.json({
          id: 'sim',
          object: 'chat.completion',
          created: 0,
          model: 'sim',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Respuesta simulada del arnés.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      }
      if (++peticionesAlModelo > TOPE_MODELO) throw new Error(`Tope de ${TOPE_MODELO} peticiones al modelo`)
    }
    const respuesta = await fetchReal(entrada, init)
    const cuerpo = await respuesta.arrayBuffer()
    return new Response(cuerpo.byteLength ? cuerpo : null, { status: respuesta.status, statusText: respuesta.statusText, headers: respuesta.headers })
  } finally {
    intervalos.push({ destino, ini, fin: performance.now() })
  }
}) as typeof fetch

const { neon } = await import('@neondatabase/serverless')
const { db, esquema } = await import('../src/db')
const { responderComoAgenteDeClientes, esperarTrabajosEnSegundoPlano } = await import('../src/agentes/clientes')
const { recibirMensaje, enviarAlCliente } = await import('../src/negocio/whatsapp')
const { MODELO_ID } = await import('../src/lib/modelo')
const { eq, and, ne, desc, gte } = await import('drizzle-orm')
type MensajeEntrante = import('../src/lib/kapso').MensajeEntrante

const sql = neon(process.env.DATABASE_URL!)
type Fila = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const redondear = (n: number) => (Number.isNaN(n) ? '-' : n >= 100 ? String(Math.round(n)) : n.toFixed(1))
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

function unir(trozos: { ini: number; fin: number }[], desde: number, hasta: number) {
  let total = 0
  let fin = desde
  for (const t of [...trozos].sort((a, b) => a.ini - b.ini)) {
    const ini = Math.max(t.ini, fin, desde)
    const f = Math.min(t.fin, hasta)
    if (f > ini) total += f - ini
    fin = Math.max(fin, f)
  }
  return total
}

/** Reparte una ventana de tiempo entre modelo, base de datos y lo demás (CPU, armado del prompt, esperas). */
function desglose(marca: number, desde: number, hasta: number) {
  const dentro = intervalos.slice(marca).filter((i) => i.fin > desde && i.ini < hasta)
  const modelo = dentro.filter((i) => i.destino === 'modelo')
  const base = dentro.filter((i) => i.destino === 'db')
  const total = hasta - desde
  return {
    total,
    modelo: unir(modelo, desde, hasta),
    db: unir(base, desde, hasta),
    otro: total - unir(dentro, desde, hasta),
    llamadasDb: base.length,
    llamadasModelo: modelo.length,
  }
}

const LEASE_TRABAJO_S = Number(process.env.MEDIR_LEASE_S ?? 30)
const LEASE_SALIDA_S = 6
const MAX_INTENTOS = 5

let registro: Record<string, number> | null = null
async function medir<T>(nombre: string, trabajo: () => Promise<T>): Promise<T> {
  const ini = performance.now()
  try {
    return await trabajo()
  } finally {
    if (registro) registro[nombre] = (registro[nombre] ?? 0) + performance.now() - ini
  }
}

type Trabajo = { id: string; clave: string; carga: MensajeEntrante; intentos: number }

const encolar = (m: MensajeEntrante, prefijo = 'entrada') =>
  medir('encolar', async () => {
    const filas = await sql`insert into trabajos (clave, tipo, carga) values (${`${prefijo}:${m.wamid}`}, 'entrada', ${JSON.stringify(m)}::jsonb)
      on conflict (clave) do nothing returning id`
    return filas.length === 1
  })

/** Ingreso y reclamo en una sola sentencia: el webhook se queda con su propio trabajo sin pasar por la cola. */
const encolarReclamado = (m: MensajeEntrante) =>
  medir('encolar_reclamado', async () => {
    const filas = await sql`insert into trabajos (clave, tipo, carga, estado, intentos, reclamado_hasta)
      values (${`entrada:${m.wamid}`}, 'entrada', ${JSON.stringify(m)}::jsonb, 'en_curso', 1, now() + make_interval(secs => ${LEASE_TRABAJO_S}::float8))
      on conflict (clave) do nothing returning id, clave, carga, intentos`
    return (filas[0] as Trabajo | undefined) ?? null
  })

const reclamar = () =>
  medir('reclamar', async () => {
    const filas = await sql`update trabajos set estado = 'en_curso', intentos = intentos + 1, reclamado_hasta = now() + make_interval(secs => ${LEASE_TRABAJO_S}::float8)
      where id = (select id from trabajos
                  where (estado = 'pendiente' or (estado = 'en_curso' and reclamado_hasta < now())) and disponible_desde <= now()
                  order by disponible_desde for update skip locked limit 1)
      returning id, clave, carga, intentos`
    return (filas[0] as Trabajo | undefined) ?? null
  })

const terminarTrabajo = (tr: Trabajo) =>
  medir('terminar', async () => {
    const filas = await sql`update trabajos set estado = 'hecho', terminado = now(), reclamado_hasta = null
      where id = ${tr.id} and estado = 'en_curso' and intentos = ${tr.intentos} returning id`
    return filas.length === 1
  })

const fallar = (tr: Trabajo, error: string, esperaS: number) =>
  medir('fallar', async () => {
    await sql`update trabajos set estado = case when intentos >= ${MAX_INTENTOS} then 'muerto' else 'pendiente' end, reclamado_hasta = null,
      disponible_desde = now() + make_interval(secs => ${esperaS}::float8), ultimo_error = ${error.slice(0, 300)}
      where id = ${tr.id} and estado = 'en_curso' and intentos = ${tr.intentos}`
  })

type EstadoSaliente = 'pendiente' | 'enviando' | 'enviada' | 'incierta'
type Saliente = { id: string; en_respuesta_a: string; negocio_id: string; cliente_id: string; texto: string; estado: EstadoSaliente; wamid: string | null; vence_en_s: number | null }

const crearSaliente = (wamid: string, negocioId: string, clienteId: string, texto: string) =>
  medir('saliente_crear', async () => {
    const filas = await sql`insert into salientes (en_respuesta_a, negocio_id, cliente_id, texto) values (${wamid}, ${negocioId}, ${clienteId}, ${texto})
      on conflict (en_respuesta_a) do update set en_respuesta_a = excluded.en_respuesta_a
      returning id, en_respuesta_a, negocio_id, cliente_id, texto, estado, wamid, extract(epoch from (reclamado_hasta - now()))::float8 as vence_en_s`
    return filas[0] as Saliente
  })

const leerSaliente = (wamid: string) =>
  medir('saliente_leer', async () => {
    const filas = await sql`select id, en_respuesta_a, negocio_id, cliente_id, texto, estado, wamid, extract(epoch from (reclamado_hasta - now()))::float8 as vence_en_s
      from salientes where en_respuesta_a = ${wamid}`
    return (filas[0] as Saliente | undefined) ?? null
  })

const reclamarSaliente = (id: string) =>
  medir('saliente_reclamar', async () => {
    const filas = await sql`update salientes set estado = 'enviando', reclamado_hasta = now() + make_interval(secs => ${LEASE_SALIDA_S}::float8)
      where id = ${id} and estado = 'pendiente' returning id`
    return filas.length === 1
  })

/** También acepta `incierta`: una confirmación tardía de quien sí envió corrige el estado. */
const marcarEnviada = (id: string, wamid: string | null) =>
  medir('saliente_marcar', async () => {
    const filas = await sql`update salientes set estado = 'enviada', wamid = ${wamid}, enviado = now(), reclamado_hasta = null
      where id = ${id} and estado in ('enviando', 'incierta') returning id`
    return filas.length === 1
  })

const barrerSalientes = () =>
  medir('saliente_barrer', async () => {
    const filas = await sql`update salientes set estado = 'incierta' where estado = 'enviando' and reclamado_hasta < now() returning en_respuesta_a`
    return filas.map((f) => f.en_respuesta_a as string)
  })

/** Qué hace un reintento según el estado en que encuentra la salida de su mensaje. */
type Accion = 'enviar' | 'nada' | 'esperar' | 'declarar_incierta'
const SEGUN_ESTADO: Record<EstadoSaliente, (s: Saliente) => Accion> = {
  pendiente: () => 'enviar',
  enviada: () => 'nada',
  incierta: () => 'nada',
  enviando: (s) => ((s.vence_en_s ?? 0) > 0 ? 'esperar' : 'declarar_incierta'),
}

type Punto = 'p1' | 'p2x' | 'p2' | 'p3a' | 'p3b'
type Falla = { punto: Punto; modo: 'lanzar' | 'cortar' | 'matar' }
type Plan = (tr: Trabajo) => Falla | undefined
type Ctx = { tr: Trabajo; plan?: Plan; tRespuesta?: number }

class Corte extends Error {}
class SalidaEnCurso extends Error {
  constructor(public venceEnS: number) {
    super('La salida de este mensaje está reclamada por otro proceso')
  }
}

const llamadasPorWamid = new Map<string, number>()

function inyectar(punto: Punto, ctx: Ctx) {
  const falla = ctx.plan?.(ctx.tr)
  if (!falla || falla.punto !== punto || ctx.tr.intentos !== 1) return
  if (falla.modo === 'lanzar') throw new Error(`falla inyectada en ${punto}`)
  if (falla.modo === 'cortar') throw new Corte(punto)
  console.log(`[hijo] wamid=${ctx.tr.carga.wamid} punto=${punto} modelo=${peticionesAlModelo}`)
  process.kill(process.pid, 'SIGKILL')
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const HISTORIAL = 20

/** Pasos 2 a 6 de `recibirMensaje`, repetibles: el mensaje entrante se guarda con un upsert que devuelve su id. */
async function redactar(ctx: Ctx): Promise<Saliente> {
  const m = ctx.tr.carga
  const negocios = await db.select().from(esquema.negocios)
  const negocio = negocios
    .filter((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(n.codigo)}($|[^\\p{L}\\p{N}])`, 'iu').test(m.texto))
    .sort((a, b) => b.codigo.length - a.codigo.length)[0]
  if (!negocio) throw new Error('El mensaje sintético no trae el código de un Negocio')
  await db
    .insert(esquema.sesionesWhatsapp)
    .values({ telefono: m.telefono, negocioId: negocio.id })
    .onConflictDoUpdate({ target: esquema.sesionesWhatsapp.telefono, set: { negocioId: negocio.id, actualizado: new Date() } })

  const [cliente] = await db
    .insert(esquema.clientes)
    .values({ negocioId: negocio.id, telefono: m.telefono, nombre: m.nombre, ultimoMensajeEntrante: new Date() })
    .onConflictDoUpdate({
      target: [esquema.clientes.negocioId, esquema.clientes.telefono],
      set: { ultimoMensajeEntrante: new Date() },
    })
    .returning()

  const [guardado] = await db
    .insert(esquema.mensajesCliente)
    .values({ negocioId: negocio.id, clienteId: cliente.id, rol: 'cliente', texto: m.texto, wamid: m.wamid })
    .onConflictDoUpdate({ target: esquema.mensajesCliente.wamid, set: { wamid: m.wamid } })
    .returning({ id: esquema.mensajesCliente.id })

  inyectar('p1', ctx)

  const anteriores = await db
    .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto })
    .from(esquema.mensajesCliente)
    .where(and(eq(esquema.mensajesCliente.clienteId, cliente.id), ne(esquema.mensajesCliente.id, guardado.id)))
    .orderBy(desc(esquema.mensajesCliente.creado))
    .limit(HISTORIAL)

  llamadasPorWamid.set(m.wamid, (llamadasPorWamid.get(m.wamid) ?? 0) + 1)
  const respuesta = await responderComoAgenteDeClientes({
    negocioId: negocio.id,
    clienteId: cliente.id,
    historial: anteriores.reverse(),
    texto: m.texto,
    modo: 'real',
  })

  inyectar('p2x', ctx)
  return crearSaliente(m.wamid, negocio.id, cliente.id, respuesta.texto)
}

async function entregar(s: Saliente, ctx: Ctx) {
  const accion = SEGUN_ESTADO[s.estado](s)
  if (accion === 'nada') return
  if (accion === 'esperar') throw new SalidaEnCurso(s.vence_en_s ?? 1)
  if (accion === 'declarar_incierta') {
    await barrerSalientes()
    return
  }
  if (!(await reclamarSaliente(s.id))) return
  inyectar('p3a', ctx)
  const { wamid } = await enviarAlCliente(s.cliente_id, s.texto)
  ctx.tRespuesta = performance.now()
  inyectar('p3b', ctx)
  await marcarEnviada(s.id, wamid)
}

async function atender(ctx: Ctx) {
  const previa = ctx.tr.intentos > 1 ? await leerSaliente(ctx.tr.carga.wamid) : null
  const salida = previa ?? (await redactar(ctx))
  inyectar('p2', ctx)
  await entregar(salida, ctx)
  await esperarTrabajosEnSegundoPlano()
}

type Reclamo = { trabajo: string; intentos: number; drenador: string; ini: number; fin: number; resultado: 'hecho' | 'falla' | 'corte' | 'diferido' | 'perdido' }
type Drenado = { nombre: string; reclamos: number; hechos: number; fallas: number; cortes: number; diferidos: number; perdidos: number }

/** Un drenador: reclama de a uno hasta que no queda nada reclamable. Un corte deja el trabajo `en_curso` y otra invocación sigue. */
async function drenador(nombre: string, bitacora: Reclamo[], plan?: Plan, maximo = Infinity): Promise<Drenado> {
  const r: Drenado = { nombre, reclamos: 0, hechos: 0, fallas: 0, cortes: 0, diferidos: 0, perdidos: 0 }
  while (r.reclamos < maximo) {
    const tr = await reclamar()
    if (!tr) return r
    r.reclamos++
    const ctx: Ctx = { tr, plan }
    const ini = performance.now()
    const anotar = (resultado: Reclamo['resultado']) =>
      bitacora.push({ trabajo: tr.id, intentos: tr.intentos, drenador: nombre, ini, fin: performance.now(), resultado })
    try {
      await atender(ctx)
      if (await terminarTrabajo(tr)) {
        r.hechos++
        anotar('hecho')
      } else {
        r.perdidos++
        anotar('perdido')
      }
    } catch (error) {
      if (error instanceof Corte) {
        r.cortes++
        anotar('corte')
      } else if (error instanceof SalidaEnCurso) {
        await fallar(tr, 'salida en curso', error.venceEnS + 0.5)
        r.diferidos++
        anotar('diferido')
      } else {
        await fallar(tr, error instanceof Error ? error.message : String(error), Math.min(2 * tr.intentos, 30))
        r.fallas++
        anotar('falla')
      }
    }
  }
  return r
}

const corrida = String(Date.now() % 10000).padStart(4, '0')
const telefonoSintetico = (etiqueta: '1' | '2' | '3' | '4', i: number) => `57390${corrida}${etiqueta}${String(i).padStart(2, '0')}`

const PREGUNTAS = [
  '¿Qué cafés tienen y cuánto cuestan?',
  '¿Hacen envíos a Bucaramanga? ¿Cuánto se demoran?',
  '¿Cuál es el horario de atención?',
  '¿Cómo puedo pagar? ¿Reciben tarjeta?',
  '¿Qué café me recomiendas para greca?',
  '¿Tienen café molido o solo en grano?',
  '¿Qué diferencia hay entre el tueste claro y el oscuro?',
  '¿Tienen alguna opción para regalar?',
  '¿Hacen envíos fuera de Colombia?',
  '¿El envío tiene costo adicional?',
  '¿Qué molinos manuales venden y cuánto valen?',
  '¿Qué tan fresco es el café? ¿Cuándo lo tuestan?',
  '¿Tienen café descafeinado?',
  '¿De qué fincas viene el café que venden?',
  '¿Atienden los domingos?',
  '¿Cuál es el café más económico que tienen?',
  '¿Puedo pagar contra entrega en Medellín?',
  '¿Cuánto tarda un pedido a Cali?',
  '¿Cómo preparo bien un café en prensa francesa?',
  '¿Venden suscripciones mensuales de café?',
]
const mensajeSintetico = (etiqueta: '1' | '2' | '3' | '4', i: number, wamid: string): MensajeEntrante => ({
  wamid,
  telefono: telefonoSintetico(etiqueta, i),
  nombre: `Cliente sintético ${etiqueta}${i}`,
  texto: `Hola Café Ladera (LADERA). ${PREGUNTAS[i % PREGUNTAS.length]}`,
})

async function tcpRtt(ip: string, puerto: number) {
  const ini = performance.now()
  await new Promise<void>((resolver, rechazar) => {
    const s = connect({ host: ip, port: puerto }, () => (s.destroy(), resolver()))
    s.on('error', rechazar)
  })
  return performance.now() - ini
}

async function red(etiqueta: string) {
  await sql`select 1`
  const http: number[] = []
  for (let i = 0; i < 30; i++) {
    const ini = performance.now()
    await sql`select 1`
    http.push(performance.now() - ini)
  }
  const { address } = await lookup(hostDeBase, { family: 4 })
  await tcpRtt(address, 443)
  const tcp: number[] = []
  for (let i = 0; i < 30; i++) tcp.push(await tcpRtt(address, 443))
  console.log(`\n### Red (${etiqueta}): host de la rama desechable, 30 repeticiones tras una de calentamiento`)
  tabla(CABECERA_STATS, [filaStats('select 1 por el driver HTTP de Neon', http), filaStats('TCP connect al puerto 443 (solo red)', tcp)])
  return { http, tcp }
}

async function micro(reps = 30) {
  const [ref] = (await sql`select id, negocio_id from clientes order by creado limit 1`) as Fila[]
  const acumulado: Record<string, number[]> = {}
  const tomar = async <T,>(trabajo: () => Promise<T>) => {
    const r: Record<string, number> = {}
    registro = r
    try {
      return await trabajo()
    } finally {
      registro = null
      for (const [k, v] of Object.entries(r)) (acumulado[k] ??= []).push(v)
    }
  }
  for (let i = 0; i < reps; i++) {
    const m: MensajeEntrante = { wamid: `bench.${corrida}.${i}`, telefono: '0', nombre: '', texto: 'x' }
    await tomar(() => encolar(m, 'bench'))
    await tomar(() => medir('encolar_duplicado', () => sql`insert into trabajos (clave, tipo, carga) values (${`bench:${m.wamid}`}, 'entrada', '{}'::jsonb) on conflict (clave) do nothing returning id`))
    const tr = await tomar(() => reclamar())
    if (tr) await tomar(() => terminarTrabajo(tr))
    await tomar(() => encolarReclamado({ ...m, wamid: `benchr.${corrida}.${i}` }))
    const s = await tomar(() => crearSaliente(`bench.${corrida}.${i}`, ref.negocio_id, ref.id, 'texto de prueba'))
    await tomar(() => reclamarSaliente(s.id))
    await tomar(() => marcarEnviada(s.id, null))
  }
  await tomar(() => barrerSalientes())
  await sql`delete from trabajos where clave like 'bench:%' or clave like 'entrada:benchr.%'`
  await sql`delete from salientes where en_respuesta_a like 'bench.%'`
  console.log(`\n### Cada sentencia por separado, base en reposo (${reps} repeticiones, desde esta máquina)`)
  const orden = ['encolar', 'encolar_duplicado', 'reclamar', 'terminar', 'encolar_reclamado', 'saliente_crear', 'saliente_reclamar', 'saliente_marcar', 'saliente_barrer']
  tabla(CABECERA_STATS, orden.filter((k) => acumulado[k]).map((k) => filaStats(k, acumulado[k])))
  return acumulado
}

const FALLBACKS = ['Tuve un problema técnico', 'Dame un momento, se me enredó algo']

async function respuestasDe(telefono: string) {
  return db
    .select({ texto: esquema.mensajesCliente.texto })
    .from(esquema.mensajesCliente)
    .innerJoin(esquema.clientes, eq(esquema.clientes.id, esquema.mensajesCliente.clienteId))
    .where(and(eq(esquema.clientes.telefono, telefono), eq(esquema.mensajesCliente.rol, 'agente')))
}

const ahoraDeLaBase = async () => (await sql`select now() as ahora`)[0].ahora as Date

async function latencia(pares: number) {
  const errores = capturarErrores()
  const envios = capturarEnvios()
  const base: ReturnType<typeof desglose>[] = []
  type Durable = ReturnType<typeof desglose> & { hastaRespuesta: ReturnType<typeof desglose>; sentencias: Record<string, number> }
  const durable: Durable[] = []
  const falsos: unknown[] = []
  const inicioFase = await ahoraDeLaBase()
  const peticionesAntes = peticionesAlModelo

  const verificar = async (via: string, m: MensajeEntrante) => {
    const r = await respuestasDe(m.telefono)
    const sinDisculpa = r.length === 1 && !FALLBACKS.some((f) => r[0].texto.startsWith(f))
    if (!sinDisculpa || envios.filter((e) => e.telefono === m.telefono).length !== 1) falsos.push({ via, telefono: m.telefono, respuestas: r.map((x) => x.texto.slice(0, 60)) })
  }

  const turnoBase = async (i: number) => {
    const m = mensajeSintetico('1', i, `wamid.MEDIR.${corrida}.base${i}`)
    const marca = intervalos.length
    const t0 = performance.now()
    await recibirMensaje(m)
    const t1 = performance.now()
    await verificar('base', m)
    return desglose(marca, t0, t1)
  }

  const turnoDurable = async (i: number): Promise<Durable> => {
    const m = mensajeSintetico('2', i, `wamid.MEDIR.${corrida}.dur${i}`)
    const sentencias: Record<string, number> = {}
    registro = sentencias
    const marca = intervalos.length
    const t0 = performance.now()
    await encolar(m)
    const tr = await reclamar()
    if (!tr) throw new Error('La cola no devolvió el trabajo recién encolado')
    const ctx: Ctx = { tr }
    await atender(ctx)
    const hecho = await terminarTrabajo(tr)
    const t1 = performance.now()
    registro = null
    if (!hecho) throw new Error('terminar no encontró su reclamo')
    const resultado = { ...desglose(marca, t0, t1), hastaRespuesta: desglose(marca, t0, ctx.tRespuesta ?? t1), sentencias }
    await verificar('durable', m)
    const [fila] = await sql`select estado, intentos from trabajos where clave = ${`entrada:${m.wamid}`}`
    if (fila?.estado !== 'hecho' || fila.intentos !== 1) falsos.push({ via: 'durable', trabajo: fila })
    return resultado
  }

  console.log('\nCalentamiento de cada lado (no cuenta)…')
  await turnoBase(pares)
  await turnoDurable(pares)
  for (let i = 0; i < pares; i++) {
    if (i % 2 === 0) {
      base.push(await turnoBase(i))
      durable.push(await turnoDurable(i))
    } else {
      durable.push(await turnoDurable(i))
      base.push(await turnoBase(i))
    }
    console.log(`  par ${i + 1}/${pares}: base ${Math.round(base[i].total)} ms · durable ${Math.round(durable[i].hastaRespuesta.total)} ms hasta la respuesta, ${Math.round(durable[i].total)} ms hasta terminar`)
  }

  const turnos = await db
    .select({ ms: esquema.turnos.ms })
    .from(esquema.turnos)
    .where(and(eq(esquema.turnos.agente, 'clientes'), gte(esquema.turnos.creado, inicioFase)))
    .orderBy(esquema.turnos.creado)
  const esperados = 2 * (pares + 1)
  afirmar('latencia: cada turno dejó una fila en `turnos`', turnos.length === esperados, { turnos: turnos.length, esperados })
  afirmar('latencia: cada Cliente recibió una sola respuesta, que no es una disculpa, y salió un solo envío simulado', falsos.length === 0, falsos)
  afirmar('latencia: ningún `console.error` durante los turnos (recibirMensaje se traga los fallos)', errores.length === 0, errores.slice(0, 3))

  // Las filas de `turnos` salen en el orden en que corrieron: dos calentamientos y luego cada par, alterno.
  const sinCalentar = turnos.slice(2).map((t) => t.ms)
  const msBase: number[] = []
  const msDurable: number[] = []
  for (let i = 0; i < pares; i++) {
    const [a, b] = [sinCalentar[2 * i], sinCalentar[2 * i + 1]]
    const [deBase, deDurable] = i % 2 === 0 ? [a, b] : [b, a]
    msBase.push(deBase)
    msDurable.push(deDurable)
  }

  console.log(`\n### 1. Línea base: \`recibirMensaje\` tal cual (${pares} turnos, modelo ${MODELO_ID})`)
  tabla(CABECERA_STATS, [
    filaStats('desde que entra hasta la fila de respuesta', base.map((b) => b.total)),
    filaStats('  de eso, modelo (peticiones a api.meta.ai)', base.map((b) => b.modelo)),
    filaStats('  de eso, base de datos (peticiones a Neon)', base.map((b) => b.db)),
    filaStats('  de eso, otro (CPU, armado del prompt, esperas)', base.map((b) => b.otro)),
    filaStats('`turnos.ms` (modelo + lecturas del turno)', msBase),
    filaStats('peticiones a Neon por turno (cuenta)', base.map((b) => b.llamadasDb)),
    filaStats('peticiones al modelo por turno (cuenta)', base.map((b) => b.llamadasModelo)),
  ])

  const cola = (s: Record<string, number>) => s.encolar + s.reclamar + s.terminar
  const salida = (s: Record<string, number>) => s.saliente_crear + s.saliente_reclamar + s.saliente_marcar
  const antesDeResponder = (s: Record<string, number>) => s.encolar + s.reclamar + s.saliente_crear + s.saliente_reclamar
  console.log(`\n### 2. Camino durable: los mismos ${pares} turnos por \`trabajos\` y \`salientes\``)
  tabla(CABECERA_STATS, [
    filaStats('de punta a punta, hasta la fila de respuesta', durable.map((d) => d.hastaRespuesta.total)),
    filaStats('de punta a punta, hasta terminar el trabajo', durable.map((d) => d.total)),
    filaStats('  hasta la respuesta, de eso modelo', durable.map((d) => d.hastaRespuesta.modelo)),
    filaStats('  hasta la respuesta, de eso base de datos', durable.map((d) => d.hastaRespuesta.db)),
    filaStats('`turnos.ms` (modelo + lecturas del turno)', msDurable),
    filaStats('peticiones a Neon por turno, hasta terminar (cuenta)', durable.map((d) => d.llamadasDb)),
    filaStats('encolar', durable.map((d) => d.sentencias.encolar)),
    filaStats('reclamar', durable.map((d) => d.sentencias.reclamar)),
    filaStats('terminar', durable.map((d) => d.sentencias.terminar)),
    filaStats('sobrecosto de la cola: encolar + reclamar + terminar', durable.map((d) => cola(d.sentencias))),
    filaStats('salida: crear + reclamar + marcar enviada', durable.map((d) => salida(d.sentencias))),
    filaStats('sobrecosto total (cola + salida), 6 sentencias', durable.map((d) => cola(d.sentencias) + salida(d.sentencias))),
    filaStats('sobrecosto que el Cliente espera (antes de responder, 4 sentencias)', durable.map((d) => antesDeResponder(d.sentencias))),
    filaStats('diferencia emparejada: durable (hasta la respuesta) menos base', durable.map((d, i) => d.hastaRespuesta.total - base[i].total)),
  ])
  console.log(`\nPeticiones al modelo en esta fase: ${peticionesAlModelo - peticionesAntes} (${esperados} turnos).`)
  return { base, durable, msBase, msDurable }
}

async function aplicarSql() {
  const texto = readFileSync(fileURLToPath(new URL('./medir-turno-durable.sql', import.meta.url)), 'utf8')
  for (const trozo of texto.split(/^--;\s*$/m)) {
    if (trozo.replace(/^--.*$/gm, '').trim()) await sql.query(trozo)
  }
  await sql`delete from trabajos`
  await sql`delete from salientes`
}

function lanzarHijo(punto: Punto) {
  return new Promise<{ senal: string | null; codigo: number | null; salida: string }>((resolver) => {
    const proceso = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--hijo'], {
      env: { ...process.env, MEDIR_HIJO_PUNTO: punto, MEDIR_TOPE_MODELO: '5' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let salida = ''
    proceso.stdout.on('data', (d) => (salida += String(d)))
    proceso.on('exit', (codigo, senal) => resolver({ codigo, senal, salida }))
  })
}

const PUNTOS_DE_HIJOS = ['p1', 'p2', 'p3a', 'p3b'] as const

async function fallas() {
  const envios = capturarEnvios()
  const inicioFase = await ahoraDeLaBase()
  const peticionesAntes = peticionesAlModelo
  const prefijo = `wamid.MEDIR.${corrida}.f`
  const bitacora: Reclamo[] = []
  const wamidDe = (i: number) => `${prefijo}${String(i).padStart(2, '0')}`
  const N = 30

  console.log('\n### 3. Fallas')
  console.log('\n-- Camino actual: el proceso muere después de guardar el wamid y Kapso reentrega')
  {
    const m = mensajeSintetico('4', 90, `wamid.MEDIR.${corrida}.actual`)
    const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
    const [cliente] = await db.insert(esquema.clientes).values({ negocioId: ladera.id, telefono: m.telefono, nombre: m.nombre, ultimoMensajeEntrante: new Date() }).returning()
    await db.insert(esquema.mensajesCliente).values({ negocioId: ladera.id, clienteId: cliente.id, rol: 'cliente', texto: m.texto, wamid: m.wamid })
    const antes = envios.length
    await recibirMensaje(m)
    const respuestas = await db.$count(esquema.mensajesCliente, and(eq(esquema.mensajesCliente.clienteId, cliente.id), eq(esquema.mensajesCliente.rol, 'agente')))
    afirmar('camino actual: la reentrega de un wamid ya reclamado se descarta y el Cliente queda sin respuesta (el hueco que cierra la cola)', respuestas === 0 && envios.length === antes, { respuestas, envios: envios.length - antes })
  }

  console.log('\n-- Cortes reales: cuatro procesos hijos se matan con SIGKILL, uno en cada punto')
  const hijos = PUNTOS_DE_HIJOS.map((_, k) => mensajeSintetico('4', k, `wamid.MEDIR.${corrida}.h${k}`))
  for (const m of hijos) await encolar(m)
  const salidasHijos = await Promise.all(PUNTOS_DE_HIJOS.map((punto) => lanzarHijo(punto)))
  const puntoDe = new Map<string, Punto>()
  let modeloDeHijos = 0
  for (const [k, s] of salidasHijos.entries()) {
    afirmar(`corte real en ${PUNTOS_DE_HIJOS[k]}: el proceso murió por SIGKILL`, s.senal === 'SIGKILL', { senal: s.senal, codigo: s.codigo })
    for (const linea of s.salida.split('\n')) {
      const e = /^\[envío simulado a ([^\]]+)\] ([\s\S]*)$/.exec(linea)
      if (e) envios.push({ telefono: e[1], texto: e[2] })
      const h = /^\[hijo\] wamid=(\S+) punto=(\S+) modelo=(\d+)$/.exec(linea)
      if (h) {
        puntoDe.set(h[1], h[2] as Punto)
        modeloDeHijos += Number(h[3])
      }
    }
  }
  afirmar('cortes reales: cada hijo reclamó un trabajo distinto antes de morir', puntoDe.size === hijos.length, [...puntoDe])
  console.log(`Puntos de muerte por wamid: ${[...puntoDe].map(([w, p]) => `${w.split('.').pop()}=${p}`).join(' ')} · peticiones al modelo de los hijos antes de morir: ${modeloDeHijos}`)

  console.log(`\n-- ${N} mensajes con dos drenadores a la vez, 5 wamid entregados dos veces y fallas inyectadas`)
  const plan = new Map<string, Falla>([
    [wamidDe(3), { punto: 'p1', modo: 'lanzar' }],
    [wamidDe(4), { punto: 'p1', modo: 'cortar' }],
    [wamidDe(10), { punto: 'p2', modo: 'lanzar' }],
    [wamidDe(11), { punto: 'p2', modo: 'cortar' }],
    [wamidDe(12), { punto: 'p2x', modo: 'cortar' }],
    [wamidDe(20), { punto: 'p3a', modo: 'lanzar' }],
    [wamidDe(21), { punto: 'p3a', modo: 'cortar' }],
    [wamidDe(25), { punto: 'p3b', modo: 'lanzar' }],
    [wamidDe(26), { punto: 'p3b', modo: 'cortar' }],
  ])
  const planDe: Plan = (tr) => plan.get(tr.carga.wamid)
  const concurrentes = [2, 13]
  const tardias = [7, 19, 26]
  const mensajes = Array.from({ length: N }, (_, i) => mensajeSintetico('3', i, wamidDe(i)))

  const ingreso = await Promise.all(mensajes.flatMap((m, i) => (concurrentes.includes(i) ? [encolar(m), encolar(m)] : [encolar(m)])))
  const tardiasInsertadas: boolean[] = []
  const reentrega = (async () => {
    await dormir(4000)
    for (const i of tardias) tardiasInsertadas.push(await encolar(mensajes[i]))
  })()

  const t0 = performance.now()
  const [a, b] = await Promise.all([drenador('A (after)', bitacora, planDe), drenador('B (cron)', bitacora, planDe)])
  await reentrega
  console.log(`Primera pasada en ${Math.round(performance.now() - t0)} ms: ${JSON.stringify([a, b])}`)

  const rondasDelBarredor: string[] = []
  for (let ronda = 1; ronda <= 8; ronda++) {
    const [{ restan, en_s }] = (await sql`select count(*)::int as restan,
        coalesce(min(extract(epoch from (case when estado = 'en_curso' then reclamado_hasta else disponible_desde end) - now())), 0)::float8 as en_s
      from trabajos where estado in ('pendiente', 'en_curso')`) as Fila[]
    if (restan === 0) break
    await dormir(Math.max(0, en_s) * 1000 + 400)
    const barridas = await barrerSalientes()
    const [x, y] = await Promise.all([drenador('A (after)', bitacora, planDe), drenador('B (cron)', bitacora, planDe)])
    rondasDelBarredor.push(`ronda ${ronda}: quedaban ${restan} trabajos, esperó ${Math.max(0, en_s).toFixed(1)} s, salidas declaradas inciertas ${barridas.length}, reclamos ${x.reclamos + y.reclamos}`)
  }
  const sobrantes = await barrerSalientes()
  console.log(rondasDelBarredor.join('\n') || '(el barredor no tuvo nada que hacer)')
  console.log(`Duración de la fase: ${Math.round(performance.now() - t0)} ms.`)

  const todos = [...mensajes, ...hijos]
  const wamids = todos.map((m) => m.wamid)
  const telefonoDe = new Map(todos.map((m) => [m.wamid, m.telefono]))
  const trabajos = (await sql`select clave, estado, intentos from trabajos where clave = any(${wamids.map((w) => `entrada:${w}`)})`) as Fila[]
  const salientes = (await sql`select en_respuesta_a, estado, texto from salientes where en_respuesta_a = any(${wamids})`) as Fila[]
  const filasDeTrabajos = Number((await sql`select count(*)::int as n from trabajos`)[0].n)
  const filasDeSalientes = Number((await sql`select count(*)::int as n from salientes`)[0].n)
  const sumaDeIntentos = Number((await sql`select coalesce(sum(intentos), 0)::int as n from trabajos`)[0].n)

  const descartadas = ingreso.filter((x) => !x).length + tardiasInsertadas.filter((x) => !x).length
  afirmar(`reentrega: las ${concurrentes.length + tardias.length} entregas repetidas (${concurrentes.length} a la vez, ${tardias.length} tarde) fueron descartadas por \`clave\``, descartadas === concurrentes.length + tardias.length, { descartadas })
  afirmar('reentrega: la cola tiene exactamente una fila por wamid', filasDeTrabajos === todos.length, { filas: filasDeTrabajos, esperadas: todos.length })
  afirmar('todo trabajo terminó `hecho` (ninguno pendiente, en curso ni muerto)', trabajos.length === todos.length && trabajos.every((t) => t.estado === 'hecho'), trabajos.filter((t) => t.estado !== 'hecho'))
  afirmar('cada mensaje entrante tiene exactamente una respuesta (una fila en `salientes`)', salientes.length === todos.length && filasDeSalientes === todos.length && new Set(salientes.map((s) => s.en_respuesta_a)).size === todos.length, { salientes: salientes.length, filas: filasDeSalientes, esperadas: todos.length })

  const enviosDe = (w: string) => envios.filter((e) => e.telefono === telefonoDe.get(w))
  const conDosEnvios = wamids.filter((w) => enviosDe(w).length > 1)
  afirmar('ningún wamid produjo dos envíos (envíos simulados por Cliente)', conDosEnvios.length === 0, conDosEnvios)
  const agentes = (await sql`select c.telefono, count(*)::int as n from mensajes_cliente m join clientes c on c.id = m.cliente_id
    where m.rol = 'agente' and c.telefono = any(${[...telefonoDe.values()]}) group by 1`) as Fila[]
  afirmar('ningún Cliente tiene dos mensajes del agente guardados', agentes.every((x) => x.n === 1), agentes.filter((x) => x.n !== 1))

  const estadoDe = new Map(salientes.map((s) => [s.en_respuesta_a as string, s.estado as EstadoSaliente]))
  const perdidos = wamids.filter((w) => enviosDe(w).length === 0 && estadoDe.get(w) !== 'incierta')
  afirmar('no hay pérdida silenciosa: todo wamid sin envío real quedó `incierta` y visible', perdidos.length === 0, perdidos.map((w) => [w, estadoDe.get(w)]))
  const enviadasMal = wamids.filter((w) => estadoDe.get(w) === 'enviada' && enviosDe(w).length !== 1)
  afirmar('toda salida `enviada` corresponde a exactamente un envío real', enviadasMal.length === 0, enviadasMal)

  const inciertas = salientes.filter((s) => s.estado === 'incierta')
  const dePuntoTres = new Set([wamidDe(20), wamidDe(21), wamidDe(25), wamidDe(26), ...[...puntoDe].filter(([, p]) => p === 'p3a' || p === 'p3b').map(([w]) => w)])
  afirmar('las salidas inciertas son exactamente las reclamadas sin confirmar (cortes en 3a y 3b)', inciertas.length === dePuntoTres.size && inciertas.every((s) => dePuntoTres.has(s.en_respuesta_a)), { inciertas: inciertas.map((s) => s.en_respuesta_a), esperadas: [...dePuntoTres] })
  afirmar('después del barredor no quedan salidas `enviando` por declarar', sobrantes.length === 0, sobrantes)

  const conFalla = new Set([...plan.keys(), ...hijos.map((h) => h.wamid)])
  const reintentados = trabajos.filter((t) => t.intentos > 1)
  const claveSola = (t: Fila) => String(t.clave).replace('entrada:', '')
  afirmar(`se reintentaron exactamente los ${conFalla.size} trabajos con falla inyectada`, reintentados.length === conFalla.size && reintentados.every((t) => conFalla.has(claveSola(t))), reintentados.map((t) => [t.clave, t.intentos]))
  const sinFalla = trabajos.filter((t) => !conFalla.has(claveSola(t)))
  afirmar('los trabajos sin falla se atendieron en el primer reclamo', sinFalla.every((t) => t.intentos === 1), sinFalla.filter((t) => t.intentos !== 1).map((t) => [t.clave, t.intentos]))

  const turnos = await db.$count(esquema.turnos, and(eq(esquema.turnos.agente, 'clientes'), gte(esquema.turnos.creado, inicioFase)))
  afirmar(`el modelo corrió ${todos.length + 1} veces: una por mensaje y una más por el corte antes de persistir la salida (p2x)`, turnos === todos.length + 1, { turnos, esperadas: todos.length + 1 })
  const repetidos = [...llamadasPorWamid].filter(([w, n]) => w.startsWith(prefijo) && n !== (w === wamidDe(12) ? 2 : 1))
  afirmar('en proceso, solo el corte antes de persistir la salida repitió el modelo; con la salida persistida el reintento no lo llama otra vez', repetidos.length === 0, repetidos)

  const porTrabajo = new Map<string, Reclamo[]>()
  for (const r of bitacora) porTrabajo.set(r.trabajo, [...(porTrabajo.get(r.trabajo) ?? []), r])
  const solapados = [...porTrabajo.values()].filter((rs) => {
    const orden = [...rs].sort((x, y) => x.ini - y.ini)
    return orden.some((r, i) => i > 0 && r.ini < orden[i - 1].fin)
  })
  afirmar('ningún trabajo fue atendido por dos drenadores a la vez', solapados.length === 0, solapados)
  const parejas = bitacora.map((r) => `${r.trabajo}:${r.intentos}`)
  afirmar('ningún reclamo se repitió (cada trabajo e intento salió una sola vez)', new Set(parejas).size === parejas.length)
  afirmar('los dos drenadores trabajaron a la vez (los dos hicieron reclamos en la primera pasada)', a.reclamos > 0 && b.reclamos > 0, { a: a.reclamos, b: b.reclamos })
  afirmar('ningún `terminar` perdió su reclamo (la cerca por `intentos` no se activó)', bitacora.every((r) => r.resultado !== 'perdido'))

  console.log('\nResultado de las fallas:')
  tabla(
    ['medida', 'valor'],
    [
      ['mensajes entrantes (30 en proceso + 4 cortes reales)', todos.length],
      ['entregas repetidas de Kapso descartadas por `clave`', descartadas],
      ['trabajos reintentados (intentos > 1)', reintentados.length],
      ['reclamos totales (sin fallas serían 34)', sumaDeIntentos],
      ['máximo de intentos de un trabajo', Math.max(...trabajos.map((t) => t.intentos))],
      ['salidas `enviada`', salientes.filter((s) => s.estado === 'enviada').length],
      ['salidas `incierta` (reclamadas sin confirmación de envío)', inciertas.length],
      ['  de esas, el mensaje sí había salido (corte tras enviar, 3b)', inciertas.filter((s) => enviosDe(s.en_respuesta_a).length === 1).length],
      ['  de esas, el mensaje nunca salió (corte antes de enviar, 3a)', inciertas.filter((s) => enviosDe(s.en_respuesta_a).length === 0).length],
      ['envíos reales duplicados', conDosEnvios.length],
      ['turnos del modelo (filas en `turnos`)', turnos],
      ['peticiones al modelo de este proceso en la fase', peticionesAlModelo - peticionesAntes],
    ],
  )
  console.log('\nSalidas inciertas, visibles para quien las revise (el diseño no las reenvía):')
  tabla(['en respuesta a', 'estado', 'envíos reales', 'texto'], inciertas.map((s) => [s.en_respuesta_a, s.estado, enviosDe(s.en_respuesta_a).length, String(s.texto).slice(0, 40).replace(/\n/g, ' ')]))
}

async function hijo() {
  const punto = process.env.MEDIR_HIJO_PUNTO as Punto
  await drenador('hijo', [], () => ({ punto, modo: 'matar' }), 1)
  console.log('[hijo] terminó sin morir')
}

if (esHijo) {
  await hijo()
  process.exit(0)
}

const valorDe = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const fase = valorDe('fase') ?? 'todo'
const pares = Number(valorDe('pares') ?? 20)
const quiere = (nombre: string) => fase === 'todo' || fase === nombre

console.log(`Medición del turno durable · modelo ${MODELO_ID}${SIN_MODELO ? ' (SIMULADO en la capa HTTP, solo depuración)' : ''} · rama desechable de Neon · corrida ${corrida}`)
console.log(`Reclamo del trabajo ${LEASE_TRABAJO_S} s, reclamo de la salida ${LEASE_SALIDA_S} s, máximo de intentos ${MAX_INTENTOS}. ENVIO_SIMULADO=${process.env.ENVIO_SIMULADO}.`)

try {
  await aplicarSql()
  const rondasDeRed: Awaited<ReturnType<typeof red>>[] = []
  if (quiere('red')) rondasDeRed.push(await red('al empezar'))
  if (quiere('micro')) await micro()
  if (quiere('latencia')) await latencia(pares)
  if (quiere('fallas')) await fallas()
  if (quiere('red')) rondasDeRed.push(await red('al terminar'))
  if (rondasDeRed.length) {
    const http = rondasDeRed.flatMap((r) => r.http)
    const tcp = rondasDeRed.flatMap((r) => r.tcp)
    console.log(
      `\nLectura de la red (60 repeticiones, antes y después): la consulta trivial tarda ${redondear(pct(http, 0.5))} ms (p50) y un TCP connect al mismo host ${redondear(pct(tcp, 0.5))} ms (p50). ` +
        `Diferencia de p50: ${redondear(pct(http, 0.5) - pct(tcp, 0.5))} ms. Diferencia de mínimos: ${redondear(Math.min(...http) - Math.min(...tcp))} ms. ` +
        `El proxy y el cómputo de Neon no se distinguen de la red desde aquí.`,
    )
  }
  console.log(`\nPeticiones al modelo en este proceso: ${peticionesAlModelo}`)
} catch (error) {
  afirmar('la medición terminó sin error inesperado', false, error)
}
terminar()
