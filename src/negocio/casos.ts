import { and, desc, eq, exists, inArray, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import { ultimasTarjetasDe } from '@/nucleo/casos'
import { haceCuanto } from '@/nucleo/hoy-palabras'
import type { ContextoDelDueno } from '@/nucleo/identidad'
import { nombreDelCliente } from '@/nucleo/listas-palabras'
import { estadosDeTarjetas, type EstadoDeTarjeta } from './dueno-chat'

export type DecisionDeUnCaso = { tarjeta: TarjetaDeAprobacion; estado: EstadoDeTarjeta }
/** `decision` es la última respuesta que se le propuso al Dueño, viva o no; null si nunca hubo una. */
export type CasoQueEspera = { id: string; titulo: string; quien: string; detalle: string; propuesta: string; hace: string; decision: DecisionDeUnCaso | null }
/** `noSalio`: se aprobó la respuesta, pero nunca salió por WhatsApp. */
export type CasoResuelto = { id: string; titulo: string; resolucion: string; hace: string; noSalio: boolean }
export type DatosDeCasos = { cuentaQueEspera: number; esperan: CasoQueEspera[]; cuentaDeResueltos: number; resueltos: CasoResuelto[] }

export const CUANTOS_CASOS = 50

/** Un Caso solo se cierra enviando la respuesta: descartarla, o que venza, lo deja esperando. */
export async function casosDe(ctx: ContextoDelDueno, zona: string): Promise<DatosDeCasos> {
  const { casos: c, clientes, pedidos, mensajesSalientes: s } = esquema
  const ahora = new Date()
  const delNegocio = eq(c.negocioId, ctx.negocio)
  const espera = and(delNegocio, ne(c.estado, 'resuelto'))
  const resuelto = and(delNegocio, eq(c.estado, 'resuelto'))
  const [abiertos, cuentaQueEspera, cerrados, cuentaDeResueltos] = await Promise.all([
    db
      .select({ id: c.id, titulo: c.titulo, detalle: c.detalle, propuesta: c.propuesta, creado: c.creado, nombre: clientes.nombre, telefono: clientes.telefono, numero: pedidos.numero })
      .from(c)
      .leftJoin(clientes, and(eq(clientes.id, c.clienteId), eq(clientes.negocioId, ctx.negocio)))
      .leftJoin(pedidos, and(eq(pedidos.id, c.pedidoId), eq(pedidos.negocioId, ctx.negocio)))
      .where(espera)
      .orderBy(desc(c.creado))
      .limit(CUANTOS_CASOS),
    db.$count(c, espera),
    db
      .select({
        id: c.id,
        titulo: c.titulo,
        resolucion: c.resolucion,
        creado: c.creado,
        resuelto: c.resuelto,
        noSalio: sql<boolean>`${exists(db.select({ uno: sql`1` }).from(s).where(and(eq(s.casoId, c.id), eq(s.negocioId, ctx.negocio), inArray(s.estado, ['no_salio', 'por_enviar']))))}`,
      })
      .from(c)
      .where(resuelto)
      .orderBy(desc(c.resuelto))
      .limit(CUANTOS_CASOS),
    db.$count(c, resuelto),
  ])
  const decisiones = await ultimaDecisionDe(ctx, abiertos.map((a) => a.id))
  return {
    cuentaQueEspera,
    esperan: abiertos.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      quien: [a.telefono === null ? null : nombreDelCliente(a.nombre ?? '', a.telefono), a.numero === null ? null : `pedido #${a.numero}`].filter(Boolean).join(' · '),
      detalle: a.detalle,
      propuesta: a.propuesta,
      hace: haceCuanto(a.creado, ahora, zona),
      decision: decisiones.get(a.id) ?? null,
    })),
    cuentaDeResueltos,
    resueltos: cerrados.map((f) => ({ id: f.id, titulo: f.titulo, resolucion: f.resolucion, hace: haceCuanto(f.resuelto ?? f.creado, ahora, zona), noSalio: f.noSalio })),
  }
}

async function ultimaDecisionDe(ctx: ContextoDelDueno, casos: readonly string[]): Promise<ReadonlyMap<string, DecisionDeUnCaso>> {
  const tarjetas = await ultimasTarjetasDe(ctx.negocio, casos)
  const estados = await estadosDeTarjetas(ctx, [...tarjetas.values()].map((t) => t.propuesta))
  return new Map(
    [...tarjetas].flatMap(([caso, tarjeta]) => {
      const estado = estados[tarjeta.propuesta]
      return estado ? [[caso, { tarjeta, estado }] as const] : []
    }),
  )
}
