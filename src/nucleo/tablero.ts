import { and, desc, eq, gte, ne, notExists, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { ORIGENES_DE_CLIENTE, type EstadoDePedido, type OrigenDeCliente } from '@/db/esquema'
import { CUENTA_COMO_VENTA } from './consultas/catalogo'
import { DIAS_QUE_ESPERA_UNA_CONFIRMACION, leerCifras } from './hoy'
import { vozDelRubro, type Cifras, type Voz } from './hoy-palabras'
import type { NegocioId } from './identidad'
import { lineaDeItems, nombreDelCliente } from './listas-palabras'

export type PedidoReciente = { id: string; numero: number; cliente: string; ciudad: string; items: string; total: number; estado: EstadoDePedido }
/** Lo mismo que `Necesita tu ojo` de Inicio, contado sin su límite. Un pedido con Caso abierto cuenta como Caso. */
export type PorAtender = { casos: number; novedad: number; pendiente: number }
/** `porDia` siempre trae los 7 días, también los de cero, del más viejo a hoy. `porOrigen` son todos los Clientes, sin ventana, solo los orígenes con alguno. */
export type DatosDelTablero = {
  voz: Voz
  cifras: Cifras
  porAtender: PorAtender
  porDia: { dia: string; pedidos: number }[]
  porOrigen: { origen: OrigenDeCliente; cuenta: number }[]
  recientes: PedidoReciente[]
}

const CUANTOS_RECIENTES = 5
const DIAS_DE_LA_GRAFICA = 7

export async function leerTablero(negocio: NegocioId, zona: string, rubro: string): Promise<DatosDelTablero> {
  const { casos, clientes, pedidos } = esquema
  const z = sql`${zona}::text`
  const atras = sql.raw(String(DIAS_DE_LA_GRAFICA - 1))
  const venta = sql.join(
    CUENTA_COMO_VENTA.map((e) => sql`${e}`),
    sql`, `,
  )
  const delCliente = and(eq(clientes.id, pedidos.clienteId), eq(clientes.negocioId, negocio))
  const desdeHaceUnaSemana = new Date(Date.now() - DIAS_QUE_ESPERA_UNA_CONFIRMACION * 86_400_000)
  const casoAbiertoDelPedido = db
    .select({ uno: sql`1` })
    .from(casos)
    .where(and(eq(casos.negocioId, negocio), eq(casos.pedidoId, pedidos.id), ne(casos.estado, 'resuelto')))

  const [cifras, casosAbiertos, [porAtender], dias, porOrigen, recientes] = await Promise.all([
    leerCifras(negocio, zona),
    db.$count(casos, and(eq(casos.negocioId, negocio), ne(casos.estado, 'resuelto'))),
    db
      .select({
        novedad: sql<number>`count(*) filter (where ${eq(pedidos.estado, 'novedad')})`.mapWith(Number),
        pendiente: sql<number>`count(*) filter (where ${and(eq(pedidos.estado, 'pendiente'), gte(pedidos.creado, desdeHaceUnaSemana))})`.mapWith(Number),
      })
      .from(pedidos)
      .innerJoin(clientes, delCliente)
      .where(and(eq(pedidos.negocioId, negocio), notExists(casoAbiertoDelPedido))),
    db.execute(sql`
      with t as (select (now() at time zone ${z})::date::timestamp as hoy)
      select to_char(d, 'YYYY-MM-DD') as dia, count(v.id)::int as pedidos
      from t cross join generate_series(t.hoy - interval '${atras} days', t.hoy, interval '1 day') as d
      left join (
        select p.id, (p.creado at time zone ${z})::date as dia
        from pedidos p join clientes c on c.id = p.cliente_id and c.negocio_id = ${negocio}
        where p.negocio_id = ${negocio} and p.estado in (${venta})
      ) v on v.dia = d::date
      group by d
      order by d
    `),
    db
      .select({ origen: clientes.origen, cuenta: sql<number>`count(*)`.mapWith(Number) })
      .from(clientes)
      .where(eq(clientes.negocioId, negocio))
      .groupBy(clientes.origen),
    db
      .select({ id: pedidos.id, numero: pedidos.numero, items: pedidos.items, ciudad: pedidos.ciudad, total: pedidos.total, estado: pedidos.estado, nombre: clientes.nombre, telefono: clientes.telefono })
      .from(pedidos)
      .innerJoin(clientes, delCliente)
      .where(eq(pedidos.negocioId, negocio))
      .orderBy(desc(pedidos.creado), desc(pedidos.numero))
      .limit(CUANTOS_RECIENTES),
  ])

  return {
    voz: vozDelRubro(rubro),
    cifras,
    porAtender: { casos: casosAbiertos, ...porAtender },
    porDia: dias.rows as DatosDelTablero['porDia'],
    porOrigen: ORIGENES_DE_CLIENTE.flatMap((origen) => porOrigen.filter((f) => f.origen === origen)),
    recientes: recientes.map((f) => ({ id: f.id, numero: f.numero, cliente: nombreDelCliente(f.nombre, f.telefono), ciudad: f.ciudad, items: lineaDeItems(f.items), total: f.total, estado: f.estado })),
  }
}
