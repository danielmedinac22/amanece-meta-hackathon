/**
 * Mide un Cambio de punta a punta por el camino real: el Dueño le escribe a su Agente del dueño
 * (`responderEnElHilo`), el agente propone (genera, corre aislado, guarda), el Dueño dice que sí y el
 * agente aplica. Cada llamada a Muse Spark y a Neon queda anotada por `entorno.mts`.
 *
 *   MEDIR_HOST_RAMA=... MEDIR_HOST_PROHIBIDO=... tsx scripts/medir/cambios.mts [--n 5] [--tipos regla,indicador,seccion] [--hilo-largo] [--salida resultados/x.json]
 *
 * Es una herramienta desechable: no es parte de Amanece.
 */
import { eventos, HOST_DE_LA_BASE, ponerCorrida, quietud, reloj, type Evento } from './entorno.mts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const { db, esquema } = await import('../../src/db')
const { and, asc, eq, gte, sql } = await import('drizzle-orm')
const cambios = await import('../../src/negocio/cambios')
const { mensajeDelDueno, responderEnElHilo } = await import('../../src/negocio/dueno-chat')
const { leerHilo } = await import('../../src/negocio/dueno-hilo')
const { costoUsd, MODELO_ID } = await import('../../src/lib/modelo')

const arg = (nombre: string, defecto?: string) => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? (process.argv[i + 1] ?? 'true') : defecto
}
const N = Number(arg('n', '5'))
const TIPOS = (arg('tipos', 'regla,indicador,seccion') as string).split(',')
const SALIDA = arg('salida', 'scripts/medir/resultados/corridas.json') as string
const NEGOCIO = arg('negocio', 'LADERA') as string

const PEDIDOS: Record<string, string> = {
  regla: 'Si preguntan por envíos fuera de la ciudad, no prometas fecha y abre un Caso.',
  indicador: 'Quiero ver los pedidos confirmados por día.',
  seccion: 'Quiero ver una lista de los pedidos con novedad.',
  // Pedidos más difíciles: algunos piden datos que `datos` no trae.
  margen: 'Quiero ver mi margen de ganancia por producto.',
  recompra: 'Quiero saber qué porcentaje de mis clientes me ha comprado más de una vez en los últimos 60 días.',
  clientes: 'Quiero una tabla con mis mejores clientes: cuánto me han comprado en total, de mayor a menor.',
  entrega: 'Quiero saber cuántos días tarda en promedio un pedido desde que se confirma hasta que se entrega.',
  conversaciones: 'Quiero una lista de las conversaciones de hoy con lo que escribió cada cliente.',
}
const HERRAMIENTA_ESPERADA: Record<string, string> = { regla: 'proponer_regla', indicador: 'proponer_indicador', seccion: 'proponer_seccion', margen: 'proponer_indicador', recompra: 'proponer_indicador', clientes: 'proponer_seccion', entrega: 'proponer_indicador', conversaciones: 'proponer_seccion' }

const usd = (e: Evento, modelo = MODELO_ID) => (e.uso ? costoUsd(e.uso.entrada, e.uso.salida, modelo) : 0)
const STANDARD = 'muse-spark-1.3'
const r1 = (n: number) => Math.round(n * 10) / 10

type Parte = { type: string; state?: string; input?: unknown; output?: unknown; errorText?: string; text?: string }

function herramientasDe(m: { parts: Parte[] } | undefined) {
  return (m?.parts ?? []).filter((p) => p.type.startsWith('tool-')).map((p) => ({ nombre: p.type.replace('tool-', ''), estado: p.state, entrada: p.input, salida: p.output, error: p.errorText }))
}
const textoDe = (m: { parts: Parte[] } | undefined) =>
  (m?.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ')

/** Un turno del Hilo, medido por dentro con los eventos que dejó. */
async function turno(negocio: any, dueno: any, texto: string, etiqueta: string) {
  ponerCorrida(etiqueta)
  const mensaje = mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })!
  const t0 = reloj()
  const respuesta = await responderEnElHilo({ negocio, dueno, mensaje })
  const tCabeceras = reloj()
  await respuesta.text()
  const t1 = reloj()
  await quietud()
  const evs = eventos.filter((e) => e.corrida === etiqueta)
  const hilo = await leerHilo(dueno.id)
  const ultimo = hilo.at(-1) as { parts: Parte[] } | undefined

  const modelos = evs.filter((e) => e.kind === 'modelo').sort((a, b) => a.t0 - b.t0)
  const dbs = evs.filter((e) => e.kind === 'db')
  const dueno_ = modelos.filter((e) => e.rol === 'dueno')
  const rel = (t: number) => r1(t - t0)

  // Las ventanas de herramienta son los huecos entre llamadas consecutivas del Agente del dueño.
  const ventanas = dueno_.slice(0, -1).map((e, i) => ({ desde: e.t1, hasta: dueno_[i + 1].t0 }))
  const dentro = (e: Evento, v: { desde: number; hasta: number }) => e.t0 >= v.desde - 1 && e.t1 <= v.hasta + 1
  const ventanaMs = ventanas.reduce((s, v) => s + (v.hasta - v.desde), 0)
  const enVentana = (f: (e: Evento) => boolean) => evs.filter((e) => ventanas.some((v) => dentro(e, v)) && f(e))

  const generador = enVentana((e) => e.rol === 'generador')
  const clientes = enVentana((e) => e.rol === 'clientes')
  const dbVentana = enVentana((e) => e.kind === 'db')

  // Para llamadas en paralelo (las dos simulaciones de una regla) cuenta el intervalo cubierto, no la suma.
  const cubierto = (lista: Evento[]) => {
    const orden = [...lista].sort((a, b) => a.t0 - b.t0)
    let total = 0
    let fin = -Infinity
    for (const e of orden) {
      const ini = Math.max(e.t0, fin)
      if (e.t1 > ini) total += e.t1 - ini
      fin = Math.max(fin, e.t1)
    }
    return total
  }

  const paso = (e: Evento) => ({ rol: e.rol, desde: rel(e.t0), ttfb: r1(e.ttfb - e.t0), ms: r1(e.t1 - e.t0), entrada: e.uso?.entrada ?? null, salida: e.uso?.salida ?? null, razonamiento: e.uso?.razonamiento ?? null, enCache: e.uso?.enCache ?? null, stream: e.stream, status: e.status })

  return {
    etiqueta,
    texto,
    ms: r1(t1 - t0),
    msHastaCabeceras: r1(tCabeceras - t0),
    herramientas: herramientasDe(ultimo),
    respuestaAlDueno: textoDe(ultimo),
    llamadasAlModelo: modelos.length,
    llamadasPorRol: Object.fromEntries(['dueno', 'generador', 'clientes', 'aviso', 'otro'].map((r) => [r, modelos.filter((e) => e.rol === r).length])),
    consultasADb: dbs.length,
    msEnDb: r1(dbs.reduce((s, e) => s + (e.t1 - e.t0), 0)),
    tokens: { entrada: modelos.reduce((s, e) => s + (e.uso?.entrada ?? 0), 0), salida: modelos.reduce((s, e) => s + (e.uso?.salida ?? 0), 0), razonamiento: modelos.reduce((s, e) => s + (e.uso?.razonamiento ?? 0), 0) },
    usd: modelos.reduce((s, e) => s + usd(e), 0),
    usdStandard: modelos.reduce((s, e) => s + usd(e, STANDARD), 0),
    usdPorRol: Object.fromEntries(['dueno', 'generador', 'clientes'].map((r) => [r, modelos.filter((e) => e.rol === r).reduce((s, e) => s + usd(e), 0)])),
    fases: {
      // Desde el mensaje del Dueño hasta que la primera llamada del agente termina (ahí ya decidió la herramienta).
      entender: dueno_[0] ? rel(dueno_[0].t1) : null,
      ventanaDeHerramienta: r1(ventanaMs),
      generar: r1(cubierto(generador)),
      simular: r1(cubierto(clientes)),
      dbEnLaVentana: r1(dbVentana.reduce((s, e) => s + (e.t1 - e.t0), 0)),
      responder: dueno_.length > 1 ? r1(dueno_.at(-1)!.t1 - dueno_.at(-1)!.t0) : null,
      primerTextoVisible: dueno_.length ? rel(dueno_.at(-1)!.ttfb) : null,
    },
    pasos: modelos.map(paso),
  }
}

async function foto(duenoId: string, negocioId: string, desde: Date) {
  const cs = await db.select().from(esquema.cambios).where(eq(esquema.cambios.duenoId, duenoId)).orderBy(asc(esquema.cambios.creado))
  const ts = await db.select().from(esquema.turnos).where(and(eq(esquema.turnos.negocioId, negocioId), gte(esquema.turnos.creado, desde)))
  return { cs, ts }
}

function resumirCambio(c: any) {
  const vp = (c.vistaPrevia ?? {}) as Record<string, any>
  return {
    id: c.id,
    tipo: c.tipo,
    estado: c.estado,
    resumen: c.resumen,
    tokensEntrada: c.tokensEntrada,
    tokensSalida: c.tokensSalida,
    costoUsdGuardado: c.costoUsd,
    msHastaPropuesta: c.msHastaPropuesta,
    msHastaAplicado: c.msHastaAplicado,
    intentos: vp.intentos ?? null,
    msQuickJS: vp.ms ?? null,
    totalFilas: vp.totalFilas ?? null,
    error: vp.error ?? null,
    herramientasAntes: vp.herramientasAntes ?? null,
    herramientasDespues: vp.herramientasDespues ?? null,
    antes: vp.antes ?? null,
    despues: vp.despues ?? null,
    resultado: vp.resultado ?? null,
    propuesta: c.propuesta,
  }
}

/** La verdad contra la que se compara lo que calculó el código generado, sacada de la base con SQL. */
async function verdad(negocioId: string) {
  const porDia = async (estados: string[]) => {
    const r = await db.execute(
      sql`select to_char((creado at time zone 'America/Bogota')::date, 'YYYY-MM-DD') as dia, count(*)::int as n from pedidos where negocio_id = ${negocioId} and estado in (${sql.join(estados.map((e) => sql`${e}`), sql`, `)}) group by 1`,
    )
    return Object.fromEntries((r.rows as { dia: string; n: number }[]).map((x) => [x.dia, x.n]))
  }
  const novedad = await db.execute(sql`select count(*)::int as n from pedidos where negocio_id = ${negocioId} and estado = 'novedad'`)
  return { amplia: await porDia(['confirmado', 'enviado', 'entregado', 'novedad']), estricta: await porDia(['confirmado']), novedad: (novedad.rows[0] as { n: number }).n }
}

function cotejarIndicador(resultado: any, v: Awaited<ReturnType<typeof verdad>>) {
  const serie = (resultado?.serie ?? []) as { etiqueta: string; valor: number }[]
  if (!serie.length) return { serie: false }
  const iguales = (m: Record<string, number>) => serie.every((p) => (m[p.etiqueta] ?? 0) === p.valor)
  return { serie: true, puntos: serie.length, suma: serie.reduce((s, p) => s + p.valor, 0), coincideConLaAmplia: iguales(v.amplia), coincideConLaEstricta: iguales(v.estricta) }
}

const corridas: unknown[] = []
function guardar() {
  mkdirSync(dirname(SALIDA), { recursive: true })
  writeFileSync(SALIDA, JSON.stringify({ modelo: MODELO_ID, base: HOST_DE_LA_BASE, generado: new Date().toISOString(), corridas }, null, 1))
}

const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, NEGOCIO))
if (!negocio) throw new Error(`No existe el Negocio ${NEGOCIO}`)
console.log(`Negocio ${negocio.nombre} en ${HOST_DE_LA_BASE}; modelo ${MODELO_ID}; ${N} corridas por tipo: ${TIPOS.join(', ')}`)

async function corrida(tipo: string, i: number) {
  const desde = new Date()
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: negocio.id, usuarioId: `medir-${tipo}-${i}-${Date.now()}`, nombre: 'Dueño de medición' }).returning()
  const inicio = Date.now()
  const t1 = await turno(negocio, dueno, PEDIDOS[tipo], `${tipo}-${i}-t1`)
  let { cs } = await foto(dueno.id, negocio.id, desde)
  const propuesto = cs.find((c) => c.estado === 'propuesto')

  let t2: Awaited<ReturnType<typeof turno>> | null = null
  if (propuesto) t2 = await turno(negocio, dueno, 'Sí, aplícalo.', `${tipo}-${i}-t2`)
  const { cs: tras, ts } = await foto(dueno.id, negocio.id, desde)
  cs = tras

  const aplicado = cs.find((c) => c.estado === 'aplicado')
  const v = await verdad(negocio.id)
  const detalle = cs.map(resumirCambio)
  const cotejo = (tipo === 'indicador' || tipo === 'seccion') && (aplicado || propuesto) ? (tipo === 'indicador' ? cotejarIndicador((cs.at(-1)!.vistaPrevia as any)?.resultado, v) : tipo === 'seccion' ? { totalFilas: (cs.at(-1)!.vistaPrevia as any)?.totalFilas ?? null, verdadNovedad: v.novedad } : null) : null

  // Se revierte para dejar el Negocio como estaba (y que la próxima corrida no parta de una pieza o regla ya activa).
  const tRev = reloj()
  for (const c of cs) if (c.estado === 'aplicado') await cambios.revertirCambio(negocio.id, c.id).catch((e: Error) => console.warn('no pude revertir', e.message))
  const msRevertir = r1(reloj() - tRev)

  const turnos = [t1, t2].filter(Boolean) as (typeof t1)[]
  const herramientaPrimera = t1.herramientas.map((h) => h.nombre)
  const errores = [...turnos.flatMap((t) => t.herramientas.filter((h) => h.error || (h.salida as any)?.ok === false).map((h) => `${h.nombre}: ${h.error ?? (h.salida as any)?.error ?? (h.salida as any)?.aviso ?? 'ok:false'}`)), ...cs.filter((c) => c.estado === 'descartado').map((c) => `descartado: ${(c.vistaPrevia as any)?.error}`)]
  const registro = {
    tipo,
    corrida: i,
    inicio: new Date(inicio).toISOString(),
    pedido: PEDIDOS[tipo],
    herramientasTurno1: herramientaPrimera,
    herramientaEsperada: HERRAMIENTA_ESPERADA[tipo],
    eligioLaHerramientaEsperada: herramientaPrimera.includes(HERRAMIENTA_ESPERADA[tipo]),
    cambiosCreados: detalle.length,
    estadoFinal: aplicado ? 'aplicado' : (cs.at(-1)?.estado ?? 'sin cambio'),
    aplicadoALaPrimera: Boolean(aplicado) && cs.length === 1 && (detalle[0].intentos ?? 1) === 1 && errores.length === 0,
    errores,
    msRevertir,
    msHastaAplicadoMaquina: aplicado && t2 ? r1(t1.ms + (t2.fases.entender ?? 0) + t2.fases.ventanaDeHerramienta) : null,
    msHastaVerAplicado: aplicado && t2 ? r1(t1.ms + t2.ms) : null,
    msTurno1: t1.ms,
    msTurno2: t2?.ms ?? null,
    llamadasAlModelo: t1.llamadasAlModelo + (t2?.llamadasAlModelo ?? 0),
    tokens: { entrada: t1.tokens.entrada + (t2?.tokens.entrada ?? 0), salida: t1.tokens.salida + (t2?.tokens.salida ?? 0), razonamiento: t1.tokens.razonamiento + (t2?.tokens.razonamiento ?? 0) },
    usd: t1.usd + (t2?.usd ?? 0),
    usdStandard: t1.usdStandard + (t2?.usdStandard ?? 0),
    usdPorRol: Object.fromEntries(['dueno', 'generador', 'clientes'].map((r) => [r, t1.usdPorRol[r] + (t2?.usdPorRol[r] ?? 0)])),
    guardadoEnCambios: { tokensEntrada: cs.reduce((s, c) => s + c.tokensEntrada, 0), tokensSalida: cs.reduce((s, c) => s + c.tokensSalida, 0), costoUsd: cs.reduce((s, c) => s + c.costoUsd, 0) },
    guardadoEnTurnos: { filas: ts.length, porAgente: Object.fromEntries(['dueno', 'generador', 'clientes'].map((a) => [a, ts.filter((t) => t.agente === a).length])), tokensEntrada: ts.reduce((s, t) => s + t.tokensEntrada, 0), tokensSalida: ts.reduce((s, t) => s + t.tokensSalida, 0), costoUsd: ts.reduce((s, t) => s + t.costoUsd, 0) },
    cotejo,
    cambios: detalle,
    turno1: t1,
    turno2: t2,
  }
  corridas.push(registro)
  guardar()
  console.log(
    `${tipo} #${i}: ${registro.estadoFinal}; ${registro.llamadasAlModelo} llamadas, ${registro.tokens.entrada}+${registro.tokens.salida} tokens, US$${registro.usd.toFixed(5)}; turno1 ${(t1.ms / 1000).toFixed(1)} s, turno2 ${t2 ? (t2.ms / 1000).toFixed(1) : '-'} s; ${registro.errores.length ? 'ERRORES: ' + registro.errores.join(' | ').slice(0, 200) : 'sin errores'}`,
  )
}

if (arg('hilo-largo')) {
  // Tres Cambios seguidos en el mismo Hilo: cuánto crece el contexto.
  const desde = new Date()
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: negocio.id, usuarioId: `medir-largo-${Date.now()}`, nombre: 'Dueño de medición' }).returning()
  const guion: [string, string][] = [
    ['indicador', PEDIDOS.indicador],
    ['si', 'Sí, aplícalo.'],
    ['seccion', PEDIDOS.seccion],
    ['si', 'Sí, aplícalo.'],
    ['regla', PEDIDOS.regla],
    ['si', 'Sí, aplícalo.'],
  ]
  const turnos = []
  for (const [k, texto] of guion) {
    const t = await turno(negocio, dueno, texto, `largo-${turnos.length + 1}-${k}`)
    turnos.push(t)
    console.log(`hilo largo ${turnos.length} (${k}): ${t.llamadasAlModelo} llamadas, entrada ${t.tokens.entrada}, salida ${t.tokens.salida}, ${(t.ms / 1000).toFixed(1)} s`)
  }
  const { cs } = await foto(dueno.id, negocio.id, desde)
  for (const c of cs) if (c.estado === 'aplicado') await cambios.revertirCambio(negocio.id, c.id).catch(() => undefined)
  corridas.push({ tipo: 'hilo-largo', turnos, cambios: cs.map(resumirCambio) })
  guardar()
} else {
  for (let i = 1; i <= N; i++) for (const tipo of TIPOS) await corrida(tipo, i)
}
guardar()
console.log(`Listo: ${SALIDA}`)
process.exit(0)
