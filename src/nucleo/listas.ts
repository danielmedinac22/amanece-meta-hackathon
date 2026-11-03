import { and, countDistinct, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { EstadoDePedido, ItemDePedido } from '@/db/esquema'
import { CUENTA_COMO_VENTA } from './consultas/catalogo'
import { leerCifras } from './hoy'
import { haceCuanto, type Cifras } from './hoy-palabras'
import type { NegocioId } from './identidad'
import { lineaDeItems, nombreDelCliente, ORDEN_DE_PEDIDOS, telefonoAparte } from './listas-palabras'

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

/** La conversación es la del Cliente, no la de ese pedido: nada liga un mensaje con un pedido. `null` si no ha escrito. */
export type DetalleDePedido = {
  id: string
  numero: number
  estado: EstadoDePedido
  total: number
  ciudad: string
  direccion: string
  hace: string
  items: Pick<ItemDePedido, 'nombre' | 'cantidad' | 'precio'>[]
  cliente: { id: string; nombre: string; telefono: string | null }
  conversacion: DetalleDeConversacion | null
}
export type PedidoDelCliente = Omit<FilaDePedido, 'cliente'> & { estado: EstadoDePedido }
/** `cuentaDeSuyos` son todos sus pedidos, también los no vendidos; `pedidos` y `total` cuentan lo vendido, como la tabla. */
export type DetalleDeCliente = FilaDeCliente & { telefono: string | null; cuentaDeSuyos: number; suyos: PedidoDelCliente[]; conversacion: DetalleDeConversacion | null }

export const CUANTOS_POR_GRUPO = 50
export const CUANTOS_CLIENTES = 100
export const CUANTAS_CONVERSACIONES = 100
export const CUANTOS_MENSAJES = 200
export const CUANTOS_MENSAJES_DEL_DETALLE = 20
export const CUANTOS_PEDIDOS_DEL_CLIENTE = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function leerPedidos(negocio: NegocioId, zona: string): Promise<DatosDePedidos> {
  const [grupos, cifras] = await Promise.all([leerGruposDePedidos(negocio, zona), leerCifras(negocio, zona)])
  return { cifras: { semana: cifras.semana, conversaciones: cifras.conversaciones }, grupos }
}

export async function leerGruposDePedidos(negocio: NegocioId, zona: string): Promise<GrupoDePedidos[]> {
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
  const filas = await db.select().from(numerados).where(lte(numerados.lugar, CUANTOS_POR_GRUPO)).orderBy(numerados.lugar)
  return ORDEN_DE_PEDIDOS.flatMap((estado) => {
    const delEstado = filas.filter((f) => f.estado === estado)
    if (!delEstado.length) return []
    return [
      {
        estado,
        cuenta: Number(delEstado[0].cuenta),
        filas: delEstado.map((f) => ({ id: f.id, numero: f.numero, cliente: nombreDelCliente(f.nombre, f.telefono), items: lineaDeItems(f.items), ciudad: f.ciudad, total: f.total, hace: haceCuanto(f.creado, ahora, zona) })),
      },
    ]
  })
}

/** `id` viene de la URL: uno que no es de este Negocio da `null`, aunque el pedido exista. */
export async function leerPedido(negocio: NegocioId, zona: string, id: string): Promise<DetalleDePedido | null> {
  if (!UUID.test(id)) return null
  const { clientes, pedidos } = esquema
  const [p] = await db
    .select({ id: pedidos.id, numero: pedidos.numero, estado: pedidos.estado, total: pedidos.total, ciudad: pedidos.ciudad, direccion: pedidos.direccion, creado: pedidos.creado, items: pedidos.items, clienteId: clientes.id, nombre: clientes.nombre, telefono: clientes.telefono })
    .from(pedidos)
    .innerJoin(clientes, and(eq(clientes.id, pedidos.clienteId), eq(clientes.negocioId, negocio)))
    .where(and(eq(pedidos.id, id), eq(pedidos.negocioId, negocio)))
  if (!p) return null
  return {
    id: p.id,
    numero: p.numero,
    estado: p.estado,
    total: p.total,
    ciudad: p.ciudad,
    direccion: p.direccion,
    hace: haceCuanto(p.creado, new Date(), zona),
    items: p.items.map(({ nombre, cantidad, precio }) => ({ nombre, cantidad, precio })),
    cliente: { id: p.clienteId, nombre: nombreDelCliente(p.nombre, p.telefono), telefono: telefonoAparte(p.nombre, p.telefono) },
    conversacion: await leerDetalle(negocio, p.clienteId, CUANTOS_MENSAJES_DEL_DETALLE),
  }
}

/**
 * `pedidos` y `total` cuentan lo vendido con `CUENTA_COMO_VENTA`, como Inicio y los Indicadores. La ciudad es la del
 * último pedido que dijo una, porque un Cliente no guarda ciudad, y `ultimo` es lo más reciente entre escribir y pedir.
 */
function consultaDeClientes(negocio: NegocioId, cliente?: string) {
  const { clientes, pedidos } = esquema
  const esVenta = inArray(pedidos.estado, CUENTA_COMO_VENTA)
  const ultimo = sql`greatest(max(${pedidos.creado}), ${clientes.ultimoMensajeEntrante}, ${clientes.creado})`.mapWith(clientes.creado)
  return db
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
    .where(and(eq(clientes.negocioId, negocio), cliente ? eq(clientes.id, cliente) : undefined))
    .groupBy(clientes.id)
    .orderBy(desc(ultimo), clientes.id)
}

const filaDeCliente = (f: Awaited<ReturnType<typeof consultaDeClientes>>[number], ahora: Date, zona: string): FilaDeCliente => ({ id: f.id, nombre: nombreDelCliente(f.nombre, f.telefono), ciudad: f.ciudad ?? '', pedidos: Number(f.pedidos), total: Number(f.total), ultimo: haceCuanto(f.ultimo, ahora, zona) })

export async function leerClientes(negocio: NegocioId, zona: string): Promise<DatosDeClientes> {
  const ahora = new Date()
  const [filas, cuenta] = await Promise.all([consultaDeClientes(negocio).limit(CUANTOS_CLIENTES), db.$count(esquema.clientes, eq(esquema.clientes.negocioId, negocio))])
  return { cuenta, filas: filas.map((f) => filaDeCliente(f, ahora, zona)) }
}

/** `id` viene de la URL: uno que no es de este Negocio da `null`, aunque el Cliente exista. */
export async function leerCliente(negocio: NegocioId, zona: string, id: string): Promise<DetalleDeCliente | null> {
  if (!UUID.test(id)) return null
  const { pedidos } = esquema
  const ahora = new Date()
  const suyos = and(eq(pedidos.negocioId, negocio), eq(pedidos.clienteId, id))
  const [[fila], filas, cuentaDeSuyos, conversacion] = await Promise.all([
    consultaDeClientes(negocio, id),
    db.select({ id: pedidos.id, numero: pedidos.numero, estado: pedidos.estado, items: pedidos.items, ciudad: pedidos.ciudad, total: pedidos.total, creado: pedidos.creado }).from(pedidos).where(suyos).orderBy(desc(pedidos.creado), desc(pedidos.numero)).limit(CUANTOS_PEDIDOS_DEL_CLIENTE),
    db.$count(pedidos, suyos),
    leerDetalle(negocio, id, CUANTOS_MENSAJES_DEL_DETALLE),
  ])
  if (!fila) return null
  return {
    ...filaDeCliente(fila, ahora, zona),
    telefono: telefonoAparte(fila.nombre, fila.telefono),
    cuentaDeSuyos,
    suyos: filas.map((p) => ({ id: p.id, numero: p.numero, estado: p.estado, items: lineaDeItems(p.items), ciudad: p.ciudad, total: p.total, hace: haceCuanto(p.creado, ahora, zona) })),
    conversacion,
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

async function leerDetalle(negocio: NegocioId, cliente: string, cuantos = CUANTOS_MENSAJES): Promise<DetalleDeConversacion | null> {
  const { casos, clientes, mensajesCliente: m } = esquema
  const suyos = and(eq(m.negocioId, negocio), eq(m.clienteId, cliente))
  const [[quien], mensajes, cuenta, [caso]] = await Promise.all([
    db.select({ nombre: clientes.nombre, telefono: clientes.telefono }).from(clientes).where(and(eq(clientes.id, cliente), eq(clientes.negocioId, negocio))),
    db.select({ id: m.id, de: m.rol, texto: m.texto }).from(m).where(suyos).orderBy(desc(m.creado)).limit(cuantos),
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
