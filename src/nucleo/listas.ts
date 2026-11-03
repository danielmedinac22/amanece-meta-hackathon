import { and, countDistinct, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { EstadoDePedido } from '@/db/esquema'
import { CUENTA_COMO_VENTA } from './consultas/catalogo'
import { leerCifras } from './hoy'
import { haceCuanto, type Cifras } from './hoy-palabras'
import type { NegocioId } from './identidad'
import { lineaDeItems, nombreDelCliente, ORDEN_DE_PEDIDOS } from './listas-palabras'

export type FilaDePedido = { id: string; numero: number; cliente: string; items: string; ciudad: string; total: number; hace: string }
/** `cuenta` son todos los del estado; `filas`, los más recientes hasta `CUANTOS_POR_GRUPO`. */
export type GrupoDePedidos = { estado: EstadoDePedido; cuenta: number; filas: FilaDePedido[] }
export type DatosDePedidos = { cifras: Pick<Cifras, 'semana' | 'conversaciones'>; grupos: GrupoDePedidos[] }

export type FilaDeCliente = { id: string; nombre: string; ciudad: string; pedidos: number; total: number; ultimo: string }
export type DatosDeClientes = { cuenta: number; filas: FilaDeCliente[] }

export type FilaDeConversacion = { cliente: string; nombre: string; ultima: string; hace: string }
export type MensajeDeConversacion = { id: string; de: 'cliente' | 'agente'; texto: string }
/** `cuenta` son todos los mensajes; `mensajes`, los últimos hasta `CUANTOS_MENSAJES`, del más viejo al más nuevo. `casoQueEspera` es el título de su Caso sin resolver. */
export type DetalleDeConversacion = { cliente: string; nombre: string; cuenta: number; mensajes: MensajeDeConversacion[]; casoQueEspera: string | null }
/** `detalle` es la elegida o, sin elegir, la más reciente. `enDetalle` dice si el Dueño la eligió: en teléfono se ve una pantalla a la vez. */
export type DatosDeConversaciones = { cuenta: number; filas: FilaDeConversacion[]; detalle: DetalleDeConversacion | null; enDetalle: boolean }

export const CUANTOS_POR_GRUPO = 50
export const CUANTOS_CLIENTES = 100
export const CUANTAS_CONVERSACIONES = 100
export const CUANTOS_MENSAJES = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function leerPedidos(negocio: NegocioId, zona: string): Promise<DatosDePedidos> {
  const { clientes, pedidos } = esquema
  const ahora = new Date()
  const numerados = db
    .select({
      id: pedidos.id,
      numero: pedidos.numero,
      items: pedidos.items,
      total: pedidos.total,
      ciudad: pedidos.ciudad,
      estado: pedidos.estado,
      creado: pedidos.creado,
      nombre: clientes.nombre,
      telefono: clientes.telefono,
      lugar: sql<number>`row_number() over (partition by ${pedidos.estado} order by ${pedidos.creado} desc, ${pedidos.numero} desc)`.as('lugar'),
      cuenta: sql<string>`count(*) over (partition by ${pedidos.estado})`.as('cuenta'),
    })
    .from(pedidos)
    .innerJoin(clientes, and(eq(clientes.id, pedidos.clienteId), eq(clientes.negocioId, negocio)))
    .where(eq(pedidos.negocioId, negocio))
    .as('numerados')
  const [filas, cifras] = await Promise.all([db.select().from(numerados).where(lte(numerados.lugar, CUANTOS_POR_GRUPO)).orderBy(numerados.lugar), leerCifras(negocio, zona)])
  return {
    cifras: { semana: cifras.semana, conversaciones: cifras.conversaciones },
    grupos: ORDEN_DE_PEDIDOS.flatMap((estado) => {
      const delEstado = filas.filter((f) => f.estado === estado)
      if (!delEstado.length) return []
      return [
        {
          estado,
          cuenta: Number(delEstado[0].cuenta),
          filas: delEstado.map((f) => ({ id: f.id, numero: f.numero, cliente: nombreDelCliente(f.nombre, f.telefono), items: lineaDeItems(f.items), ciudad: f.ciudad, total: f.total, hace: haceCuanto(f.creado, ahora, zona) })),
        },
      ]
    }),
  }
}

/**
 * `pedidos` y `total` cuentan lo vendido con `CUENTA_COMO_VENTA`, como Inicio y los Indicadores. La ciudad es la del
 * último pedido que dijo una, porque un Cliente no guarda ciudad, y `ultimo` es lo más reciente entre escribir y pedir.
 */
export async function leerClientes(negocio: NegocioId, zona: string): Promise<DatosDeClientes> {
  const { clientes, pedidos } = esquema
  const ahora = new Date()
  const esVenta = inArray(pedidos.estado, CUENTA_COMO_VENTA)
  const ultimo = sql`greatest(max(${pedidos.creado}), ${clientes.ultimoMensajeEntrante}, ${clientes.creado})`.mapWith(clientes.creado)
  const [filas, cuenta] = await Promise.all([
    db
      .select({
        id: clientes.id,
        nombre: clientes.nombre,
        telefono: clientes.telefono,
        ciudad: sql<string | null>`(array_agg(${pedidos.ciudad} order by ${pedidos.creado} desc) filter (where ${pedidos.ciudad} <> ''))[1]`,
        pedidos: sql<string>`count(*) filter (where ${esVenta})`,
        total: sql<string>`coalesce(sum(${pedidos.total}) filter (where ${esVenta}), 0)`,
        ultimo,
      })
      .from(clientes)
      .leftJoin(pedidos, and(eq(pedidos.clienteId, clientes.id), eq(pedidos.negocioId, negocio)))
      .where(eq(clientes.negocioId, negocio))
      .groupBy(clientes.id)
      .orderBy(desc(ultimo), clientes.id)
      .limit(CUANTOS_CLIENTES),
    db.$count(clientes, eq(clientes.negocioId, negocio)),
  ])
  return {
    cuenta,
    filas: filas.map((f) => ({ id: f.id, nombre: nombreDelCliente(f.nombre, f.telefono), ciudad: f.ciudad ?? '', pedidos: Number(f.pedidos), total: Number(f.total), ultimo: haceCuanto(f.ultimo, ahora, zona) })),
  }
}

/** `elegido` viene de la URL: un id que no es de este Negocio, o que no ha escrito, es como no elegir ninguno. */
export async function leerConversaciones(negocio: NegocioId, zona: string, elegido?: string): Promise<DatosDeConversaciones> {
  const { clientes, mensajesCliente: m } = esquema
  const ahora = new Date()
  const delNegocio = and(eq(clientes.id, m.clienteId), eq(clientes.negocioId, negocio))
  const ultimos = db.selectDistinctOn([m.clienteId], { clienteId: m.clienteId, texto: m.texto, creado: m.creado }).from(m).where(eq(m.negocioId, negocio)).orderBy(m.clienteId, desc(m.creado)).as('ultimos')
  const [filas, [{ cuenta }], pedida] = await Promise.all([
    db
      .select({ cliente: clientes.id, nombre: clientes.nombre, telefono: clientes.telefono, ultima: ultimos.texto, creado: ultimos.creado })
      .from(ultimos)
      .innerJoin(clientes, and(eq(clientes.id, ultimos.clienteId), eq(clientes.negocioId, negocio)))
      .orderBy(desc(ultimos.creado), clientes.id)
      .limit(CUANTAS_CONVERSACIONES),
    db.select({ cuenta: countDistinct(m.clienteId) }).from(m).innerJoin(clientes, delNegocio).where(eq(m.negocioId, negocio)),
    elegido && UUID.test(elegido) ? leerDetalle(negocio, elegido) : null,
  ])
  const detalle = pedida ?? (filas[0] ? await leerDetalle(negocio, filas[0].cliente) : null)
  return {
    cuenta,
    filas: filas.map((f) => ({ cliente: f.cliente, nombre: nombreDelCliente(f.nombre, f.telefono), ultima: f.ultima, hace: haceCuanto(f.creado, ahora, zona) })),
    detalle,
    enDetalle: pedida !== null,
  }
}

async function leerDetalle(negocio: NegocioId, cliente: string): Promise<DetalleDeConversacion | null> {
  const { casos, clientes, mensajesCliente: m } = esquema
  const suyos = and(eq(m.negocioId, negocio), eq(m.clienteId, cliente))
  const [[quien], mensajes, cuenta, [caso]] = await Promise.all([
    db.select({ nombre: clientes.nombre, telefono: clientes.telefono }).from(clientes).where(and(eq(clientes.id, cliente), eq(clientes.negocioId, negocio))),
    db.select({ id: m.id, de: m.rol, texto: m.texto }).from(m).where(suyos).orderBy(desc(m.creado)).limit(CUANTOS_MENSAJES),
    db.$count(m, suyos),
    db
      .select({ titulo: casos.titulo })
      .from(casos)
      .where(and(eq(casos.negocioId, negocio), eq(casos.clienteId, cliente), ne(casos.estado, 'resuelto')))
      .orderBy(desc(casos.creado))
      .limit(1),
  ])
  if (!quien || !mensajes.length) return null
  return { cliente, nombre: nombreDelCliente(quien.nombre, quien.telefono), cuenta, mensajes: mensajes.toReversed(), casoQueEspera: caso?.titulo ?? null }
}
