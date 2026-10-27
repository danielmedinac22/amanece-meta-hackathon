/**
 * Un Indicador de "los últimos 30 días" en el Negocio sintético (10 mil pedidos en 90 días), por el camino
 * directo (`proponerPieza` + `aplicarCambio`), con la verdad sacada de la base con SQL. Muestra qué pasa
 * cuando el Negocio tiene más pedidos que el tope de `datosDelNegocio`.
 *
 *   tsx scripts/medir/sintetico-cambio.mts [n] [salida.json]
 */
import { eventos, ponerCorrida, quietud } from './entorno.mts'
import { writeFileSync } from 'node:fs'

const { db, esquema } = await import('../../src/db')
const { eq, sql } = await import('drizzle-orm')
const cambios = await import('../../src/negocio/cambios')
const { generarPieza } = await import('../../src/agentes/generador')
const { datosDelNegocio } = await import('../../src/negocio/datos')
const { costoUsd } = await import('../../src/lib/modelo')

const N = Number(process.argv[2] ?? 3)
const SALIDA = process.argv[3] ?? 'scripts/medir/resultados/sintetico-cambio.json'
const [neg] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'SINTETICO'))
const [dueno] = await db.insert(esquema.duenos).values({ negocioId: neg.id, usuarioId: `medir-sint-${Date.now()}`, nombre: 'Dueño sintético' }).returning()

const datos = await datosDelNegocio(neg.id)
const masViejo = datos.pedidos.at(-1)!.creado
const masNuevo = datos.pedidos[0].creado
console.log(`datosDelNegocio ve ${datos.pedidos.length} pedidos, de ${masViejo} a ${masNuevo}`)

const dia = (iso: string) => new Date(Date.parse(iso) - 5 * 3600e3).toISOString().slice(0, 10)
const verdad = await db.execute(sql`select to_char((creado at time zone 'America/Bogota')::date, 'YYYY-MM-DD') as dia, count(*)::int as n from pedidos where negocio_id = ${neg.id} and estado in ('confirmado','enviado','entregado','novedad') and creado > now() - interval '30 days' group by 1`)
const verdadPorDia = Object.fromEntries((verdad.rows as { dia: string; n: number }[]).map((r) => [r.dia, r.n]))
const verdadTotal = Object.values(verdadPorDia).reduce((a, b) => a + b, 0)

const corridas: unknown[] = []
for (let i = 1; i <= N; i++) {
  ponerCorrida(`sint-${i}`)
  const marcas = { generar: 0 }
  const t0 = performance.now()
  const c = await cambios.proponerPieza(neg.id, dueno.id, 'Quiero ver los pedidos confirmados por día en los últimos 30 días', 'indicador', `Pedidos por día (30 días) ${i}`, async (entrada) => {
    const t = performance.now()
    const r = await generarPieza(entrada)
    marcas.generar += performance.now() - t
    return r
  })
  const msPropuesta = performance.now() - t0
  const vp = c.vistaPrevia as { resultado?: { serie?: { etiqueta: string; valor: number }[]; valor?: number; nota?: string }; ms?: number; intentos?: number; error?: string }
  const serie = vp.resultado?.serie ?? []
  const calculado = serie.reduce((s, p) => s + p.valor, 0)
  const diasDiferentes = serie.filter((p) => (verdadPorDia[p.etiqueta] ?? 0) !== p.valor).length
  const tA = performance.now()
  if (c.estado === 'propuesto') await cambios.aplicarCambio(neg.id, c.id)
  const msAplicar = performance.now() - tA
  const tR = performance.now()
  const tPanel = performance.now()
  const panel = await cambios.piezasActivas(neg.id)
  const msPanel = performance.now() - tPanel
  if (c.estado === 'propuesto') await cambios.revertirCambio(neg.id, c.id)
  await quietud()
  const modelos = eventos.filter((e) => e.corrida === `sint-${i}` && e.kind === 'modelo')
  const reg = {
    corrida: i,
    estado: c.estado,
    intentos: vp.intentos ?? null,
    error: vp.error ?? null,
    msPropuesta: Math.round(msPropuesta),
    msGenerar: Math.round(marcas.generar),
    msQuickJS: vp.ms ?? null,
    msResto: Math.round(msPropuesta - marcas.generar),
    msAplicar: Math.round(msAplicar),
    msPanelConUnaPieza: Math.round(msPanel),
    panelOk: panel.map((p) => p.resultado.ok),
    llamadas: modelos.length,
    tokensEntrada: modelos.reduce((s, e) => s + (e.uso?.entrada ?? 0), 0),
    tokensSalida: modelos.reduce((s, e) => s + (e.uso?.salida ?? 0), 0),
    usd: modelos.reduce((s, e) => s + (e.uso ? costoUsd(e.uso.entrada, e.uso.salida) : 0), 0),
    calculadoPorElIndicador: calculado,
    verdadSql: verdadTotal,
    diasConValorDistinto: diasDiferentes,
    diasEnLaSerie: serie.length,
    nota: vp.resultado?.nota ?? null,
    primerosDias: serie.slice(0, 4),
    primerosDiasVerdad: serie.slice(0, 4).map((p) => ({ etiqueta: p.etiqueta, valor: verdadPorDia[p.etiqueta] ?? 0 })),
  }
  void tR
  corridas.push(reg)
  console.log(JSON.stringify({ ...reg, primerosDias: undefined, primerosDiasVerdad: undefined }))
}
writeFileSync(SALIDA, JSON.stringify({ pedidosVistos: datos.pedidos.length, desde: masViejo, hasta: masNuevo, verdadTotal, corridas }, null, 1))
process.exit(0)
