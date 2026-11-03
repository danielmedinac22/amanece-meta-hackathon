/**
 * Solo lo llama el botón (`ACCIONES.publicar`): el modelo no tiene herramienta y `QuienPuede` no le deja compilar a
 * nadie más.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { conTransaccion } from '@/db/pool'
import { avisarEnLosHilos } from '@/negocio/dueno-hilo'
import type { QuienPuede } from '../acciones'
import { huellaDeLoPendiente, leerAplicado, leerPublicado, loPendiente, quienEscribioLaUltima, type EstadoAplicado, type ItemPendiente } from '../estado'
import { sellar } from '../estado/escribir'
import type { DuenoId, Huella, NegocioId, PropuestaId } from '../identidad'
import { HUELLA } from './fila'

export type ItemDeLoPendiente = ItemPendiente & { readonly aplicadoPor: string | null }
export type LoPendiente = { readonly items: readonly ItemDeLoPendiente[]; readonly huella: Huella }

export type ResultadoDePublicar =
  | { readonly tipo: 'publicado'; readonly resumen: string }
  /** El doble clic o el otro Dueño llegaron antes: no queda nada por publicar. */
  | { readonly tipo: 'ya_estaba' }
  /** Lo de ahora no es lo que este Dueño vio: no se sella nada y vuelve la lista nueva. */
  | { readonly tipo: 'cambio'; readonly pendiente: LoPendiente }
  | { readonly tipo: 'no_existe' }

/** Lo primero que se lee es lo que notan los Clientes. */
const lineasEnOrden = (items: readonly ItemPendiente[]) => [...items.filter((i) => i.loNotan === 'clientes'), ...items.filter((i) => i.loNotan === 'equipo')].map((i) => i.linea)

async function nombresDeQuienAplico(negocio: NegocioId, propuestas: readonly PropuestaId[]): Promise<ReadonlyMap<string, string>> {
  if (!propuestas.length) return new Map()
  const { propuestas: p, duenos: d } = esquema
  // Un Indicador lo aplica la política, sin `aprobado_por`: lo aplicó quien lo pidió.
  const filas = await db
    .select({ propuesta: p.id, nombre: d.nombre })
    .from(p)
    .innerJoin(d, eq(d.id, sql`coalesce(${p.aprobadoPor}, ${p.pedidoPor})`))
    .where(and(eq(p.negocioId, negocio), inArray(p.id, [...propuestas])))
  return new Map(filas.filter((f) => f.nombre).map((f) => [f.propuesta, f.nombre]))
}

/** Sin candado: si estas lecturas se cruzan con una escritura, lo peor que pasa es un `cambio` de más al tocar el botón. */
export async function leerLoPendiente(aplicado: EstadoAplicado): Promise<LoPendiente> {
  const negocio = aplicado.identidad.id
  const publicado = await leerPublicado(negocio)
  const items = loPendiente(aplicado, publicado)
  const quien = await quienEscribioLaUltima(negocio, items.map((i) => i.clave))
  const nombres = await nombresDeQuienAplico(negocio, [...new Set([...quien.values()].flatMap((p) => (p ? [p] : [])))])
  return {
    items: items.map((i) => {
      const propuesta = quien.get(i.clave)
      return { ...i, aplicadoPor: (propuesta && nombres.get(propuesta)) || null }
    }),
    huella: huellaDeLoPendiente(aplicado, publicado),
  }
}

export async function publicar(quien: QuienPuede<'publicar'>, vista: string): Promise<ResultadoDePublicar> {
  if (!HUELLA.test(vista)) return { tipo: 'no_existe' }
  const r = await conTransaccion(async (tx) => {
    // Un primer clic colgado no deja esperando al segundo para siempre.
    await tx.execute(sql`set local lock_timeout = '10s'`)
    return sellar(tx, quien.negocio, vista)
  })
  switch (r.tipo) {
    case 'sin_nada':
      return { tipo: 'ya_estaba' }
    case 'cambio':
      return { tipo: 'cambio', pendiente: await leerLoPendiente(await leerAplicado(quien.negocio)) }
    case 'sellado': {
      const lineas = lineasEnOrden(r.items)
      // Ya hubo COMMIT: una falla al avisar no convierte lo publicado en un error para el Dueño.
      await avisarQuePublico(quien.negocio, quien.dueno, lineas).catch((e) => console.error('[publicar] no pude avisar en los Hilos', quien.negocio, e))
      return { tipo: 'publicado', resumen: `Publicado: ${lineas.join('; ')}` }
    }
  }
}

async function avisarQuePublico(negocio: NegocioId, por: DuenoId, lineas: readonly string[]): Promise<void> {
  const [quien] = await db.select({ nombre: esquema.duenos.nombre }).from(esquema.duenos).where(eq(esquema.duenos.id, por))
  await avisarEnLosHilos(negocio, `${quien?.nombre || 'Un Dueño'} publicó: ${lineas.join('; ')}`)
}
