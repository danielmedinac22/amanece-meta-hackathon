import { and, desc, eq, gte, isNotNull, ne, notExists, or, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { EstadoDeCita } from '@/db/esquema'
import { CUENTA_COMO_VENTA } from './consultas/catalogo'
import { pesos } from './estado/elementos'
import { enPalabras } from './citas-palabras'
import { sinSuFicha } from './ficha'
import { haceCuanto, loQueEscribio, vozDelRubro, type Cifras, type Voz } from './hoy-palabras'
import type { NegocioId } from './identidad'
import { rutaDePedido } from './listas-palabras'

export type CosaDelOjo = { clave: string; titulo: string; detalle: string; accion: 'Decidir' | 'Ver el pedido'; ruta: string }
export type CosaReciente = { clave: string; texto: string; cuando: string }

export type Hoy = {
  voz: Voz
  /** Ningún Cliente ha escrito y no hay ni un pedido ni un Caso: Inicio muestra el link en vez de cifras en cero. */
  recienAbierto: boolean
  cifras: Cifras
  ojo: CosaDelOjo[]
  ultimo: CosaReciente[]
}

const CUANTOS_EN_EL_OJO = 10
const CUANTOS_RECIENTES = 5
/** Un pedido sin confirmar hace más de una semana ya no espera nada del Dueño. */
export const DIAS_QUE_ESPERA_UNA_CONFIRMACION = 7

const nombre = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] || 'Un cliente'
const completo = (n: string | null | undefined) => n?.trim() || 'un cliente'
const conMayuscula = (t: string) => t[0].toUpperCase() + t.slice(1)

export async function leerCifras(negocio: NegocioId, zona: string): Promise<Cifras & { alguienEscribio: boolean }> {
  const z = sql`${zona}::text`
  const venta = sql.join(
    CUENTA_COMO_VENTA.map((e) => sql`${e}`),
    sql`, `,
  )
  const { rows } = await db.execute(sql`
    with t as (
      select now() at time zone ${z} as ahora, date_trunc('week', now() at time zone ${z}) as lunes, (now() at time zone ${z})::date as dia
    ),
    ventas as (
      select p.total, p.creado at time zone ${z} as local from pedidos p
      where p.negocio_id = ${negocio} and p.estado in (${venta}) and p.creado > now() - interval '15 days'
    ),
    hablaron as (
      select distinct m.cliente_id from mensajes_cliente m, t
      where m.negocio_id = ${negocio} and m.rol = 'cliente' and (m.creado at time zone ${z})::date = t.dia
    )
    select
      (select coalesce(sum(total), 0) from ventas, t where local >= lunes)::float8 as ventas,
      (select count(*) from ventas, t where local >= lunes)::int as pedidos,
      (select coalesce(sum(total), 0) from ventas, t where local >= lunes - interval '7 days' and local < ahora - interval '7 days')::float8 as ventas_antes,
      (select count(*) from ventas, t where local >= lunes - interval '7 days' and local < ahora - interval '7 days')::int as pedidos_antes,
      (select count(distinct m.cliente_id) from mensajes_cliente m, t where m.negocio_id = ${negocio} and m.rol = 'cliente' and m.creado at time zone ${z} >= lunes)::int as clientes,
      (select count(*) from citas c, t where c.negocio_id = ${negocio} and c.estado <> 'cancelada' and c.inicio at time zone ${z} >= lunes and c.inicio at time zone ${z} < lunes + interval '7 days')::int as citas_semana,
      (select count(*) from citas c, t where c.negocio_id = ${negocio} and c.estado <> 'cancelada' and (c.inicio at time zone ${z})::date = t.dia)::int as citas_hoy,
      (select count(*) from hablaron)::int as total,
      (select count(*) from hablaron h, t
        where (select u.rol from mensajes_cliente u where u.cliente_id = h.cliente_id and u.negocio_id = ${negocio} order by u.creado desc limit 1) = 'agente'
          and not exists (
            select 1 from casos c
            where c.negocio_id = ${negocio} and c.cliente_id = h.cliente_id and (c.estado <> 'resuelto' or (c.creado at time zone ${z})::date = t.dia or (c.resuelto at time zone ${z})::date = t.dia)
          ))::int as resueltas,
      exists (select 1 from mensajes_cliente m where m.negocio_id = ${negocio} and m.rol = 'cliente')
        or exists (select 1 from pedidos p where p.negocio_id = ${negocio})
        or exists (select 1 from casos c where c.negocio_id = ${negocio}) as alguien_escribio
  `)
  const f = rows[0] as Record<'ventas' | 'pedidos' | 'ventas_antes' | 'pedidos_antes' | 'clientes' | 'citas_semana' | 'citas_hoy' | 'total' | 'resueltas', number> & { alguien_escribio: boolean }
  return {
    semana: { ventas: f.ventas, pedidos: f.pedidos, clientes: f.clientes },
    anterior: { ventas: f.ventas_antes, pedidos: f.pedidos_antes },
    conversaciones: { total: f.total, resueltas: f.resueltas },
    citas: { semana: f.citas_semana, hoy: f.citas_hoy },
    alguienEscribio: f.alguien_escribio,
  }
}

const COSA_DE_UN_PEDIDO = {
  novedad: (cliente: string, ciudad: string) => `${cliente} tiene una novedad con su envío${ciudad ? ` a ${ciudad}` : ''}`,
  pendiente: (cliente: string) => `${cliente} todavía no confirma su pedido`,
}

/** Lo que espera una decisión va primero: detrás de un Caso hay un Cliente esperando respuesta. */
async function leerElOjo(negocio: NegocioId, ahora: Date, zona: string): Promise<CosaDelOjo[]> {
  const { casos, pedidos, clientes } = esquema
  const [abiertos, pedidosDelOjo] = await Promise.all([
    db
      .select({ id: casos.id, titulo: casos.titulo, creado: casos.creado, cliente: clientes.nombre, numero: pedidos.numero, pedidoId: casos.pedidoId })
      .from(casos)
      .leftJoin(clientes, and(eq(clientes.id, casos.clienteId), eq(clientes.negocioId, negocio)))
      .leftJoin(pedidos, and(eq(pedidos.id, casos.pedidoId), eq(pedidos.negocioId, negocio)))
      .where(and(eq(casos.negocioId, negocio), ne(casos.estado, 'resuelto')))
      .orderBy(desc(casos.creado))
      .limit(CUANTOS_EN_EL_OJO),
    db
      .select({ id: pedidos.id, numero: pedidos.numero, total: pedidos.total, ciudad: pedidos.ciudad, estado: pedidos.estado, creado: pedidos.creado, cliente: clientes.nombre })
      .from(pedidos)
      .innerJoin(clientes, and(eq(clientes.id, pedidos.clienteId), eq(clientes.negocioId, negocio)))
      .where(
        and(
          eq(pedidos.negocioId, negocio),
          or(eq(pedidos.estado, 'novedad'), and(eq(pedidos.estado, 'pendiente'), gte(pedidos.creado, new Date(ahora.getTime() - DIAS_QUE_ESPERA_UNA_CONFIRMACION * 86_400_000)))),
          // Aquí y no después del límite: los pedidos con Caso abierto no le quitan el lugar a uno que no lo tiene.
          notExists(db.select({ uno: sql`1` }).from(casos).where(and(eq(casos.negocioId, negocio), eq(casos.pedidoId, pedidos.id), ne(casos.estado, 'resuelto')))),
        ),
      )
      .orderBy(sql`${pedidos.estado} = 'novedad' desc`, desc(pedidos.creado))
      .limit(CUANTOS_EN_EL_OJO),
  ])
  return [
    ...abiertos.map(
      (c): CosaDelOjo => ({
        clave: `caso-${c.id}`,
        titulo: c.titulo,
        detalle: [c.cliente?.trim(), c.numero !== null && `pedido #${c.numero}`].filter(Boolean).join(' · ') || haceCuanto(c.creado, ahora, zona),
        accion: 'Decidir',
        ruta: '/panel/casos',
      }),
    ),
    ...pedidosDelOjo.map(
        (p): CosaDelOjo => ({
          clave: `pedido-${p.id}`,
          titulo: p.estado === 'novedad' ? COSA_DE_UN_PEDIDO.novedad(nombre(p.cliente), p.ciudad) : COSA_DE_UN_PEDIDO.pendiente(nombre(p.cliente)),
          detalle: [`Pedido #${p.numero}`, p.estado === 'pendiente' && pesos(p.total), haceCuanto(p.creado, ahora, zona)].filter(Boolean).join(' · '),
          accion: 'Ver el pedido',
          ruta: rutaDePedido(p.id),
        }),
      ),
  ]
}

/** Una línea por cita, con lo último que le pasó. Los tres verbos: el agente agenda, el Cliente mueve y cancela, porque lo pidió él. */
function lineaDeCita(quien: string, c: { inicio: Date; estado: EstadoDeCita; movidaDe: Date | null }, zona: string): string {
  const cuando = enPalabras(c.inicio, zona)
  if (c.estado === 'cancelada') return `${conMayuscula(quien)} canceló su cita del ${cuando}`
  return c.movidaDe ? `${conMayuscula(quien)} movió su cita al ${cuando}` : `Tu agente le agendó una cita a ${quien}: ${cuando}`
}

/** Solo lo que dejó un registro con su hora. Un pedido confirmado antes de guardarse esa hora cuenta como tomado y nada más. */
async function leerLoUltimo(negocio: NegocioId, ahora: Date, zona: string): Promise<CosaReciente[]> {
  const { casos, citas, clientes, mensajesCliente: m, negocios, pedidos } = esquema
  const ultimos = db
    .selectDistinctOn([m.clienteId], { clienteId: m.clienteId, texto: m.texto, creado: m.creado })
    .from(m)
    .where(and(eq(m.negocioId, negocio), eq(m.rol, 'cliente')))
    .orderBy(m.clienteId, desc(m.creado))
    .as('ultimos')
  const [escribieron, tomados, confirmados, abiertos, resueltos, deCitas] = await Promise.all([
    db
      .select({ id: clientes.id, nombre: clientes.nombre, texto: ultimos.texto, cuando: ultimos.creado, codigo: negocios.codigo })
      .from(ultimos)
      .innerJoin(clientes, and(eq(clientes.id, ultimos.clienteId), eq(clientes.negocioId, negocio)))
      .innerJoin(negocios, eq(negocios.id, clientes.negocioId))
      .orderBy(desc(ultimos.creado))
      .limit(CUANTOS_RECIENTES),
    db
      .select({ id: pedidos.id, cuando: pedidos.creado, nombre: clientes.nombre })
      .from(pedidos)
      .innerJoin(clientes, and(eq(clientes.id, pedidos.clienteId), eq(clientes.negocioId, negocio)))
      .where(eq(pedidos.negocioId, negocio))
      .orderBy(desc(pedidos.creado))
      .limit(CUANTOS_RECIENTES),
    db
      .select({ id: pedidos.id, cuando: pedidos.confirmado, nombre: clientes.nombre })
      .from(pedidos)
      .innerJoin(clientes, and(eq(clientes.id, pedidos.clienteId), eq(clientes.negocioId, negocio)))
      .where(and(eq(pedidos.negocioId, negocio), isNotNull(pedidos.confirmado)))
      .orderBy(desc(pedidos.confirmado))
      .limit(CUANTOS_RECIENTES),
    db.select({ id: casos.id, titulo: casos.titulo, cuando: casos.creado }).from(casos).where(eq(casos.negocioId, negocio)).orderBy(desc(casos.creado)).limit(CUANTOS_RECIENTES),
    db
      .select({ id: casos.id, titulo: casos.titulo, cuando: casos.resuelto })
      .from(casos)
      .where(and(eq(casos.negocioId, negocio), isNotNull(casos.resuelto)))
      .orderBy(desc(casos.resuelto))
      .limit(CUANTOS_RECIENTES),
    db
      .select({ id: citas.id, inicio: citas.inicio, estado: citas.estado, movidaDe: citas.movidaDe, cuando: citas.actualizado, nombre: clientes.nombre })
      .from(citas)
      .innerJoin(clientes, and(eq(clientes.id, citas.clienteId), eq(clientes.negocioId, negocio)))
      .where(and(eq(citas.negocioId, negocio), ne(citas.estado, 'pasada')))
      .orderBy(desc(citas.actualizado))
      .limit(CUANTOS_RECIENTES),
  ])
  return [
    ...escribieron.map((e) => ({ clave: `escribio-${e.id}`, texto: loQueEscribio(conMayuscula(completo(e.nombre)), sinSuFicha(e.texto, e.codigo)), fecha: e.cuando })),
    ...tomados.map((p) => ({ clave: `pedido-${p.id}`, texto: `Tu agente le tomó un pedido a ${completo(p.nombre)}`, fecha: p.cuando })),
    ...confirmados.map((p) => ({ clave: `confirmado-${p.id}`, texto: `${conMayuscula(completo(p.nombre))} confirmó su pedido`, fecha: p.cuando! })),
    ...abiertos.map((c) => ({ clave: `abierto-${c.id}`, texto: `Tu agente abrió un Caso: ${c.titulo}`, fecha: c.cuando })),
    ...resueltos.map((c) => ({ clave: `resuelto-${c.id}`, texto: `Resolviste un Caso: ${c.titulo}`, fecha: c.cuando! })),
    ...deCitas.map((c) => ({ clave: `cita-${c.id}`, texto: lineaDeCita(completo(c.nombre), c, zona), fecha: c.cuando })),
  ]
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
    .slice(0, CUANTOS_RECIENTES)
    .map(({ clave, texto, fecha }) => ({ clave, texto, cuando: haceCuanto(fecha, ahora, zona) }))
}

/** Lo que dice Inicio, todo de la base y nada del modelo. El Negocio llega ya validado por la sesión. */
export async function leerHoy(negocio: NegocioId, zona: string, rubro: string): Promise<Hoy> {
  const ahora = new Date()
  const [{ alguienEscribio, ...cifras }, ojo, ultimo] = await Promise.all([leerCifras(negocio, zona), leerElOjo(negocio, ahora, zona), leerLoUltimo(negocio, ahora, zona)])
  return { voz: vozDelRubro(rubro), recienAbierto: !alguienEscribio, cifras, ojo, ultimo }
}
