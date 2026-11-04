import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { SIN_SABER, type EnvioDeRespuesta } from './caso-palabras'
import type { TarjetaDeAprobacion } from './cambios'
import { marcar, type NegocioId } from './identidad'
import { fueRechazado, type MotivoDeSilencio } from './salida'

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

export type FilaDelEnvio = { readonly estado: 'por_enviar' | 'enviado' | 'simulado' | 'no_salio'; readonly motivo: MotivoDeSilencio | null; readonly error: string | null }

export function envioDe(f: FilaDelEnvio): EnvioDeRespuesta {
  switch (f.estado) {
    case 'enviado':
    case 'simulado':
      return { tipo: 'salio' }
    case 'no_salio':
      return f.motivo ? { tipo: 'no_salio', motivo: f.motivo } : SIN_SABER
    case 'por_enviar':
      return f.error !== null && fueRechazado(f.error) ? { tipo: 'no_la_tomo' } : SIN_SABER
  }
}

export async function enviosDeCasos(negocio: NegocioId, casos: readonly string[]): Promise<ReadonlyMap<string, EnvioDeRespuesta>> {
  if (!casos.length) return new Map()
  const { mensajesSalientes: s } = esquema
  const filas = await db
    .selectDistinctOn([s.casoId], { caso: s.casoId, estado: s.estado, motivo: s.motivo, error: s.error })
    .from(s)
    .where(and(eq(s.negocioId, negocio), eq(s.clase, 'resolucion_de_caso'), inArray(s.casoId, [...casos])))
    .orderBy(s.casoId, desc(s.creado))
  return new Map(filas.flatMap((f) => (f.caso ? [[f.caso, envioDe(f)] as const] : [])))
}

/** Un Caso sin fila y sin respuesta aplicada no entra: se resolvió antes de esta salida y de su envío no se puede decir nada. */
export async function enviosDeResueltos(negocio: NegocioId, casos: readonly string[]): Promise<ReadonlyMap<string, EnvioDeRespuesta>> {
  if (!casos.length) return new Map()
  const { propuestas: p } = esquema
  const caso = sql<string>`${p.actos}->0->>'caso'`
  const [envios, aplicadas] = await Promise.all([
    enviosDeCasos(negocio, casos),
    db
      .selectDistinct({ caso })
      .from(p)
      .where(and(eq(p.negocioId, negocio), eq(p.estado, 'aplicada'), inArray(caso, [...casos]))),
  ])
  return new Map([...aplicadas.map((a) => [a.caso, SIN_SABER] as const), ...envios])
}
