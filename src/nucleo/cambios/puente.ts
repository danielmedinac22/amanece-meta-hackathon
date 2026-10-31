/**
 * El puente hasta el 2-nov, cuando Sección e Indicador pasen a Elementos: lo único que conoce los Cambios viejos de
 * `src/negocio/cambios.ts`. Propone, revierte y escribe piezas. Un Cambio viejo de regla o conocimiento que quedó
 * pendiente de antes del corte ya no se aplica: se pide de nuevo.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, esquema } from '@/db'
import { aplicarCambio, proponerPieza, revertirCambio, type Cambio } from '@/negocio/cambios'
import type { DuenoId, NegocioId, PropuestaId } from '../identidad'
import type { Gasto, Problema } from './index'
import type { Alcance } from './politica'

export const ESQUEMAS_DEL_PUENTE = [
  z
    .object({
      tipo: z.literal('seccion'),
      nombre: z.string().describe('Un nombre corto para el Panel, por ejemplo "Pedidos con novedad". Si ya existe, es una nueva versión'),
      queQuiereVer: z.string().describe('Lo que quiere ver el Dueño, en sus palabras'),
    })
    .describe('Una lista o tabla en el Panel (por ejemplo pedidos con novedad). Queda de una: solo la ve el Dueño.'),
  z
    .object({
      tipo: z.literal('indicador'),
      nombre: z.string().describe('Un nombre corto para el Panel. Si ya existe, es una nueva versión'),
      queQuiereVer: z.string().describe('Lo que quiere medir el Dueño, en sus palabras'),
    })
    .describe('Un número o una serie en el Panel (por ejemplo pedidos por día). Queda de una: solo lo ve el Dueño.'),
] as const

export type QuiereDelPuente = z.output<(typeof ESQUEMAS_DEL_PUENTE)[number]>

const esPieza = (tipo: Cambio['tipo']) => tipo === 'seccion' || tipo === 'indicador'
const ALCANCE: Alcance = 'panel'
const PIDELO_DE_NUEVO = 'Eso se pidió antes del cambio de sistema: pídelo de nuevo'

type Listo = { readonly tipo: 'listo'; readonly alcance: Alcance; readonly lineas: readonly string[]; readonly gasto: Gasto }
type Corregir = { readonly tipo: 'corregir'; readonly problemas: readonly Problema[] }

const corregir = (campo: string, porQue: string): Corregir => ({ tipo: 'corregir', problemas: [{ tipo: 'valor_invalido', campo, porQue }] })

/** Propone una pieza y dice el Cambio que queda `propuesto`. Nunca aplica. */
export async function proponerLoViejo(
  quien: { readonly negocio: NegocioId; readonly pedidoPor: DuenoId | null },
  q: QuiereDelPuente,
): Promise<(Listo & { readonly cambio: string }) | { readonly tipo: 'no_se_pudo'; readonly ultimoError: string; readonly gasto: Gasto }> {
  const c = await proponerPieza(quien.negocio, quien.pedidoPor, q.queQuiereVer, q.tipo, q.nombre)
  const vista = c.vistaPrevia as { error?: string; intentos?: number; resultado?: unknown; totalFilas?: number }
  const gasto: Gasto = { llamadas: vista.intentos ?? 0, usd: c.costoUsd, ms: c.msHastaPropuesta ?? 0 }
  if (c.estado === 'descartado') return { tipo: 'no_se_pudo', ultimoError: vista.error ?? 'No se pudo generar', gasto }
  return { tipo: 'listo', cambio: c.id, alcance: ALCANCE, lineas: lineasDePieza(q.tipo, q.nombre, (c.propuesta as { descripcion?: string }).descripcion ?? '', vista), gasto }
}

function lineasDePieza(tipo: 'seccion' | 'indicador', nombre: string, descripcion: string, vista: { resultado?: unknown; totalFilas?: number }): string[] {
  if (tipo === 'seccion') return [`Sección «${nombre}»: ${descripcion}`, `${vista.totalFilas ?? 0} filas hoy`]
  const r = (vista.resultado ?? {}) as { valor?: unknown; unidad?: string }
  return [`Indicador «${nombre}»: ${String(r.valor ?? '—')}${r.unidad ? ` ${r.unidad}` : ''}`]
}

/** Revertir una pieza es una propuesta más. No crea otro Cambio. */
export async function revertirLoViejo(negocio: NegocioId, aplicada: { readonly propuesta: PropuestaId; readonly lineas: readonly string[] }): Promise<Listo | Corregir> {
  const [c] = await db
    .select({ tipo: esquema.cambios.tipo, estado: esquema.cambios.estado })
    .from(esquema.cambios)
    .where(and(eq(esquema.cambios.negocioId, negocio), eq(esquema.cambios.propuestaId, aplicada.propuesta)))
  if (!c || c.estado !== 'aplicado') return corregir('propuesta', 'Eso ya no está aplicado')
  if (!esPieza(c.tipo)) return corregir('propuesta', PIDELO_DE_NUEVO)
  return { tipo: 'listo', alcance: ALCANCE, lineas: [`Quitar: ${aplicada.lineas[0] ?? 'lo que se aplicó'}`], gasto: { llamadas: 0, usd: 0, ms: 0 } }
}

/** Para el mismo lote que inserta la propuesta: el Cambio queda atado a ella. */
export function vincular(cambio: string, propuesta: PropuestaId) {
  return db.update(esquema.cambios).set({ propuestaId: propuesta }).where(eq(esquema.cambios.id, cambio))
}

/**
 * Escribe la pieza mientras `aplicarConReclamo` sostiene el reclamo, por HTTP: `aplicarCambio` no sabe de `tx`. Si
 * el Cambio ya quedó como debía, devuelve `escrito` sin escribir otra vez: así se reconcilia una caída entre esta
 * escritura y el COMMIT del reclamo.
 */
export async function escribirLoViejo(
  negocio: NegocioId,
  p: { readonly propuesta: PropuestaId; readonly revierte: PropuestaId | null },
): Promise<{ readonly tipo: 'escrito' } | { readonly tipo: 'ya_no_cabe'; readonly problemas: readonly Problema[] }> {
  const [c] = await db
    .select({ id: esquema.cambios.id, tipo: esquema.cambios.tipo, estado: esquema.cambios.estado })
    .from(esquema.cambios)
    .where(and(eq(esquema.cambios.negocioId, negocio), eq(esquema.cambios.propuestaId, p.revierte ?? p.propuesta)))
  if (c && !esPieza(c.tipo)) return { tipo: 'ya_no_cabe', problemas: [{ tipo: 'valor_invalido', campo: 'cambio', porQue: PIDELO_DE_NUEVO }] }
  if (c && p.revierte === null) {
    if (c.estado === 'propuesto') await aplicarCambio(negocio, c.id)
    if (c.estado === 'propuesto' || c.estado === 'aplicado') return { tipo: 'escrito' }
  }
  if (c && p.revierte !== null) {
    if (c.estado === 'aplicado') await revertirCambio(negocio, c.id)
    if (c.estado === 'aplicado' || c.estado === 'revertido') return { tipo: 'escrito' }
  }
  return { tipo: 'ya_no_cabe', problemas: [{ tipo: 'valor_invalido', campo: 'cambio', porQue: 'Ese Cambio ya no se puede aplicar' }] }
}
