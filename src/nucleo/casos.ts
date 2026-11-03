import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { TarjetaDeAprobacion } from './cambios'
import { marcar, type NegocioId } from './identidad'

/** La tarjeta de la última respuesta propuesta para cada Caso, sea cual sea su estado. Una nueva deja descartada a la anterior, así que la última es la que vale. */
export async function ultimasTarjetasDe(negocio: NegocioId, casos: readonly string[]): Promise<ReadonlyMap<string, TarjetaDeAprobacion>> {
  if (!casos.length) return new Map()
  const { propuestas: p } = esquema
  const caso = sql<string>`${p.actos}->0->>'caso'`
  const filas = await db
    .selectDistinctOn([caso], { caso, id: p.id, huella: p.huella, vence: p.vence, vistaPrevia: p.vistaPrevia })
    .from(p)
    .where(and(eq(p.negocioId, negocio), inArray(caso, [...casos])))
    .orderBy(caso, desc(p.creado))
  return new Map(
    filas.map((f) => [
      f.caso,
      { propuesta: marcar.propuesta(f.id), huella: f.huella as TarjetaDeAprobacion['huella'], vence: marcar.instante(f.vence), advertencias: f.vistaPrevia.advertencias ?? [], lineas: f.vistaPrevia.lineas, accion: 'enviar' },
    ]),
  )
}
