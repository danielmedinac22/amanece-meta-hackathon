/**
 * Secciones e Indicadores con Muse Spark y Neon reales, con `ENVIO_SIMULADO=1`. Un Negocio desechable que atiende,
 * con 700 pedidos inventados; su Dueño le pide cosas del Panel al Agente del dueño. Afirma lo que queda en la base y
 * lo que pinta el Panel contra un SQL escrito a mano, nunca el texto del modelo. Mide el redactor y el lote. Borra
 * lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-panel.mts
 */
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { and, eq, gte, sql } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { leerHilo } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo } = await import('../src/negocio/dueno-chat')
const { leerEstado } = await import('../src/nucleo/estado')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')
const { pintarUna } = await import('../src/nucleo/panel')
const { validarConsulta, esErrorDeConsulta } = await import('../src/nucleo/consultas/validar')
const { ejecutar } = await import('../src/nucleo/consultas/ejecutar')
const { VENTANA_POR_DEFECTO } = await import('../src/nucleo/consultas/catalogo')

type ElementoDelPanel = import('../src/nucleo/panel').ElementoDelPanel
type SeccionPintada = import('../src/nucleo/panel').SeccionPintada

const titulo = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
const marca = String(Date.now()).slice(-7)
const inicio = new Date()
let negocioId: string | undefined

const PRODUCTOS = [
  { id: randomUUID(), nombre: 'Café molido 500 g', precio: 32000 },
  { id: randomUUID(), nombre: 'Café en grano 250 g', precio: 21000 },
  { id: randomUUID(), nombre: 'Prensa francesa', precio: 89000 },
]
const ESTADOS = ['confirmado', 'entregado', 'enviado', 'novedad', 'pendiente', 'cancelado', 'entregado'] as const
const CIUDADES = ['Manizales', 'Pereira', 'Armenia', 'Cali']

async function sembrar() {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Panel ${marca}`, codigo: `PANEL${marca}`, rubro: 'café', estado: 'listo' }).returning()
  negocioId = n.id
  const N = marcar.negocio(n.id)
  await conTransaccion((tx) =>
    escribir(tx, N, { tipo: 'entrevista' }, {
      elementos: PRODUCTOS.map((p) => ({ clave: el.claveDeProducto.deId(p.id), base: 'nueva' as const, despues: { tipo: 'producto', nombre: p.nombre, descripcion: '', precio: el.comoMonto(p.precio), activo: true } })),
      filas: [],
    }),
  )
  const clientes = await db
    .insert(esquema.clientes)
    .values(Array.from({ length: 15 }, (_, i) => ({ negocioId: n.id, telefono: `5739${marca}${String(i).padStart(2, '0')}`, nombre: `Cliente Panel ${i}` })))
    .returning()
  const ahora = Date.now()
  const pedidos = Array.from({ length: 700 }, (_, i) => {
    // El café molido va en uno de cada dos pedidos además del suyo: es el más vendido en cualquier ventana.
    const items = [PRODUCTOS[i % 3], ...(i % 2 === 0 ? [PRODUCTOS[0]] : [])].map((p, j) => ({ productoId: p.id, nombre: p.nombre, cantidad: 1 + ((i + j) % 3), precio: p.precio }))
    return {
      negocioId: n.id,
      clienteId: clientes[i % clientes.length].id,
      numero: i + 1,
      items,
      total: items.reduce((s, it) => s + it.cantidad * it.precio, 0),
      ciudad: CIUDADES[i % CIUDADES.length],
      estado: ESTADOS[i % ESTADOS.length],
      creado: new Date(ahora - (i % 60) * 86_400_000 - (i % 24) * 3_600_000),
    }
  })
  for (let i = 0; i < pedidos.length; i += 200) await db.insert(esquema.pedidos).values(pedidos.slice(i, i + 200))
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: n.id, usuarioId: `prueba-panel-${marca}`, nombre: 'Dueña de prueba' }).returning()
  return { negocio: n, dueno, N }
}

/** Un turno del Dueño contra su Hilo, como en la web. */
async function turno(s: Awaited<ReturnType<typeof sembrar>>, texto: string) {
  const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, s.negocio.id))
  const ctx = { negocio: s.N, dueno: marcar.dueno(s.dueno.id), medio: 'web' as const }
  const t0 = Date.now()
  const r = await responderEnElHilo({ ctx, negocio, dueno: s.dueno, mensaje: mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })! })
  await r.text()
  await new Promise((listo) => setTimeout(listo, 400))
  const ultimo = (await leerHilo(s.dueno.id)).at(-1)!
  const herramientas = ultimo.parts.filter((p) => p.type.startsWith('tool-')).map((p) => p.type.slice(5))
  console.log(`\nDueño: ${texto}\nAgente (${Date.now() - t0} ms, herramientas: ${herramientas.join(', ') || 'ninguna'}): ${ultimo.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ').slice(0, 300)}`)
  return herramientas
}

/** Lo del Panel que dejó el turno: los Elementos nuevos, cada uno pintado y con su propuesta. */
async function delPanelNuevos(N: ReturnType<typeof marcar.negocio>, vistos: Set<string>) {
  const estado = await leerEstado(N)
  const nuevos = [...estado.vigentes('indicador'), ...estado.vigentes('seccion')].filter((v) => !vistos.has(v.clave))
  for (const v of nuevos) vistos.add(v.clave)
  return Promise.all(
    nuevos.map(async (v) => {
      const propuesta = v.origen.tipo === 'propuesta' && v.origen.propuesta ? (await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, v.origen.propuesta)))[0] : undefined
      return { clave: v.clave, elemento: v.elemento as ElementoDelPanel, propuesta, pintada: await pintarUna(estado, v.clave, v.elemento as ElementoDelPanel) }
    }),
  )
}

const VENTA = sql`estado in ('confirmado', 'enviado', 'entregado', 'novedad')`

try {
  const s = await sembrar()
  const vistos = new Set<string>()
  const creados: Awaited<ReturnType<typeof delPanelNuevos>> = []

  titulo('1. "Los pedidos confirmados por día"')
  await turno(s, 'Quiero ver en mi Panel los pedidos confirmados por día.')
  const porDia = await delPanelNuevos(s.N, vistos)
  creados.push(...porDia)
  const [indicador] = porDia
  const aMano = (await db.execute(sql`select to_char((creado at time zone 'America/Bogota')::date, 'YYYY-MM-DD') as dia, count(*)::int as n from pedidos where negocio_id = ${s.negocio.id} and ${VENTA} group by 1`)).rows as { dia: string; n: number }[]
  const verdad = new Map(aMano.map((f) => [f.dia, f.n]))
  const puntos = indicador?.pintada.resultado.tipo === 'serie' ? indicador.pintada.resultado.puntos : []
  const conFecha = puntos.filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p.etiqueta))
  afirmar('1: queda un Indicador serie aplicado sin botón', porDia.length === 1 && indicador.elemento.tipo === 'indicador' && indicador.elemento.consulta.salida.tipo === 'serie' && indicador.propuesta?.estado === 'aplicada' && indicador.propuesta.aprobadoPor === null, porDia.map((c) => ({ tipo: c.elemento.tipo, sql: c.elemento.consulta.sql, propuesta: c.propuesta?.estado })))
  afirmar(
    '1: cada día de la serie coincide con el SQL escrito a mano',
    conFecha.length > 0 && conFecha.every((p) => (verdad.get(p.etiqueta.slice(0, 10)) ?? 0) === p.valor),
    conFecha.filter((p) => (verdad.get(p.etiqueta.slice(0, 10)) ?? 0) !== p.valor).slice(0, 5),
  )

  titulo('2. "El producto más vendido"')
  await turno(s, '¿Cuál es mi producto más vendido? Ponlo en el Panel.')
  const masVendido = await delPanelNuevos(s.N, vistos)
  creados.push(...masVendido)
  const [top] = (await db.execute(sql`select i->>'nombre' as nombre, sum((i->>'cantidad')::int)::int as unidades from pedidos, jsonb_array_elements(items) i where negocio_id = ${s.negocio.id} and ${VENTA} group by 1 order by 2 desc limit 1`)).rows as { nombre: string; unidades: number }[]
  afirmar(
    '2: queda aplicado algo del Panel que lee lineas_de_pedido y muestra el producto que da el SQL a mano',
    masVendido.length === 1 && masVendido[0].elemento.consulta.usa.some((u) => u.startsWith('lineas_de_pedido.')) && JSON.stringify(masVendido[0].pintada.resultado).includes(top.nombre) && masVendido[0].propuesta?.estado === 'aplicada',
    { top, creado: masVendido.map((c) => ({ sql: c.elemento.consulta.sql, resultado: JSON.stringify(c.pintada.resultado).slice(0, 300) })) },
  )

  titulo('3. Una lista de 700 pedidos: el recorte se avisa')
  await turno(s, 'Quiero una lista en el Panel con todos mis pedidos: número, ciudad y total.')
  const lista = await delPanelNuevos(s.N, vistos)
  creados.push(...lista)
  const recortada = lista.find((c) => c.pintada.advertencias.some((a) => a.tipo === 'filas_recortadas'))
  afirmar(
    '3: la Sección queda aplicada y avisa filas_recortadas al proponer y al pintar',
    recortada !== undefined && recortada.propuesta?.estado === 'aplicada' && (recortada.propuesta.vistaPrevia.panel ?? []).some((p) => p.advertencias.some((a) => a.tipo === 'filas_recortadas')) && recortada.pintada.total === 700,
    lista.map((c) => ({ sql: c.elemento.consulta.sql, total: c.pintada.total, advertencias: c.pintada.advertencias })),
  )

  titulo('4. "¿Cuánto he vendido?" sin periodo: el supuesto se dice')
  await turno(s, 'Ponme en el Panel cuánto he vendido.')
  const ventas = await delPanelNuevos(s.N, vistos)
  creados.push(...ventas)
  const conSupuesto = creados.filter((c) => c.pintada.advertencias.some((a) => a.tipo === 'supuesto'))
  afirmar(
    '4: lo que el redactor supuso sale como advertencia supuesto, al proponer y al pintar',
    conSupuesto.length > 0 && conSupuesto.every((c) => (c.propuesta?.vistaPrevia.advertencias ?? []).length > 0),
    creados.map((c) => ({ nombre: c.elemento.nombre, supuestos: c.elemento.consulta.supuestos })),
  )
  console.log(`  la ventana por defecto la usó: ${creados.filter((c) => c.elemento.consulta.supuestos.includes(VENTANA_POR_DEFECTO.supuesto)).map((c) => c.elemento.nombre).join(', ') || 'ninguno'}`)

  titulo('5. "¿Cuántos días pasan de confirmado a entregado?": Capacidad faltante tipada')
  const panelAntes = (await leerEstado(s.N)).vigentes('indicador').length + (await leerEstado(s.N)).vigentes('seccion').length
  await turno(s, 'Quiero ver en el Panel cuántos días pasan de confirmado a entregado.')
  const faltantes = await db.select().from(esquema.capacidadesFaltantes).where(and(eq(esquema.capacidadesFaltantes.negocioId, s.negocio.id), gte(esquema.capacidadesFaltantes.creado, inicio)))
  const despues = (await leerEstado(s.N)).vigentes('indicador').length + (await leerEstado(s.N)).vigentes('seccion').length
  afirmar(
    '5: queda una Capacidad faltante no_se_puede con su clave de agrupación, y nada nuevo en el Panel',
    faltantes.some((f) => f.tipo === 'no_se_puede' && f.claveDeAgrupacion.startsWith('no_se_puede:') && (f.detalle as { falta?: string } | null)?.falta) && despues === panelAntes,
    faltantes.map((f) => ({ tipo: f.tipo, clave: f.claveDeAgrupacion, detalle: f.detalle })),
  )

  titulo('Medido')
  const turnos = await db.select().from(esquema.turnos).where(and(eq(esquema.turnos.negocioId, s.negocio.id), eq(esquema.turnos.agente, 'generador')))
  const ms = turnos.map((t) => t.ms).sort((a, b) => a - b)
  const costo = turnos.reduce((x, t) => x + t.costoUsd, 0)
  console.log(`redactor: ${turnos.length} llamadas, ms p50 ${ms[Math.floor(ms.length / 2)]}, máx ${ms.at(-1)}; costo total US$${costo.toFixed(5)}, por llamada US$${(costo / Math.max(1, turnos.length)).toFixed(5)}`)
  const estado = await leerEstado(s.N)
  const lotes: number[] = []
  for (const c of creados) {
    const v = await validarConsulta(c.elemento.consulta.sql, c.elemento.consulta.salida.tipo)
    if (esErrorDeConsulta(v)) continue
    for (let i = 0; i < 10; i++) {
      const r = await ejecutar(estado, v)
      lotes.push(r.ms)
    }
  }
  lotes.sort((a, b) => a - b)
  console.log(`lote HTTP: ${lotes.length} corridas, ms p50 ${lotes[Math.floor(lotes.length / 2)]?.toFixed(0)}, p90 ${lotes[Math.floor(lotes.length * 0.9)]?.toFixed(0)}`)
  afirmar('medido: el redactor se registró como turno del generador', turnos.length >= creados.length, turnos.length)
  const pintadas: SeccionPintada[] = creados.map((c) => c.pintada)
  afirmar('el Panel pinta todo lo creado sin no_se_pudo_calcular', pintadas.every((p) => p.resultado.tipo !== 'no_se_pudo_calcular'), pintadas.map((p) => [p.nombre, p.resultado.tipo]))
} catch (e) {
  afirmar('probar-panel terminó sin error inesperado', false, e)
} finally {
  if (negocioId) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, negocioId))
  terminar()
}
