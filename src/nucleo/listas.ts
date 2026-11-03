import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
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

export const CUANTOS_POR_GRUPO = 50
export const CUANTOS_CLIENTES = 100

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
