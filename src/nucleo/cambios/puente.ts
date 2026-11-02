/**
 * El puente hasta el corte del 31-oct, y se borra ese día: lo único que conoce los Cambios viejos de
 * `src/negocio/cambios.ts`. Los propone, dice su alcance y los escribe. El corte cambia en `index.ts` las tres
 * llamadas marcadas CORTE (`proponerLoViejo`, `revertirLoViejo` y `escribirLoViejo`) y borra este archivo.
 *
 * `@/negocio/cambios` se importa al vuelo: importa al Agente de clientes, que importa `avisos.ts`, que importa
 * `@/nucleo/cambios`. Un import estático cerraría el ciclo.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, esquema } from '@/db'
import type { Cambio } from '@/negocio/cambios'
import type { DuenoId, NegocioId, PropuestaId } from '../identidad'
import type { Gasto, Problema } from './index'
import type { Alcance } from './politica'

const viejos = () => import('@/negocio/cambios')

const preguntaFrecuente = z.object({ pregunta: z.string(), respuesta: z.string() })

/** Sus `tipo` no chocan con los de la unión final (`poner`, `quitar`, `filas`): el 30-oct conviven y el 31-oct se van. */
export const ESQUEMAS_DEL_PUENTE = [
  z
    .object({
      tipo: z.literal('regla'),
      texto: z.string().describe('La regla como instrucción clara para el agente de clientes, por ejemplo "Si preguntan por envíos a otra ciudad, no prometas fecha de entrega y abre un Caso"'),
      preguntaDePrueba: z.string().describe('Un mensaje realista que un cliente escribiría y que muestre la diferencia que hace la regla'),
      reemplaza: z.string().optional().describe('El id de una regla activa (de ver_negocio) si esta la reemplaza'),
    })
    .describe('Una regla sobre cómo actúa el agente de clientes. Se prueba sin escribirle a nadie y espera el botón del Dueño.'),
  z
    .object({
      tipo: z.literal('conocimiento'),
      conocimiento: z
        .object({
          descripcion: z.string().optional(),
          ciudad: z.string().optional(),
          horario: z.string().optional(),
          envios: z.string().optional(),
          pagos: z.string().optional(),
          tono: z.string().optional(),
          preguntasNuevas: z.array(preguntaFrecuente).optional(),
        })
        .optional(),
      productos: z
        .object({
          agregar: z.array(z.object({ nombre: z.string(), descripcion: z.string().optional(), precio: z.number().int().positive() })).optional(),
          editar: z
            .array(z.object({ id: z.string(), nombre: z.string().optional(), descripcion: z.string().optional(), precio: z.number().int().positive().optional(), activo: z.boolean().optional() }))
            .optional(),
          desactivar: z.array(z.string()).optional().describe('Ids de productos que dejan de venderse'),
        })
        .optional(),
    })
    .describe('Datos del Negocio (horario, envíos, pagos, tono, preguntas frecuentes) o su catálogo (productos nuevos, precios, desactivar). Los ids de productos salen de ver_negocio. Espera el botón del Dueño.'),
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

const ALCANCE = { regla: 'clientes', conocimiento: 'clientes', seccion: 'panel', indicador: 'panel' } as const satisfies Record<Cambio['tipo'], Alcance>

type Listo = { readonly tipo: 'listo'; readonly alcance: Alcance; readonly lineas: readonly string[]; readonly gasto: Gasto }
type Corregir = { readonly tipo: 'corregir'; readonly problemas: readonly Problema[] }

const corregir = (campo: string, porQue: string): Corregir => ({ tipo: 'corregir', problemas: [{ tipo: 'valor_invalido', campo, porQue }] })

/** Las funciones viejas avisan con una excepción lo que el Agente del dueño tiene que corregir. */
async function intentar(campo: string, f: () => Promise<Cambio>): Promise<{ readonly cambio: Cambio } | Corregir> {
  try {
    return { cambio: await f() }
  } catch (e) {
    return corregir(campo, e instanceof Error ? e.message : String(e))
  }
}

/** Propone con las funciones de hoy y dice el Cambio que queda `propuesto`. Nunca aplica. */
export async function proponerLoViejo(
  quien: { readonly negocio: NegocioId; readonly pedidoPor: DuenoId | null },
  palabrasDelDueno: string,
  q: QuiereDelPuente,
): Promise<(Listo & { readonly cambio: string }) | Corregir | { readonly tipo: 'no_se_pudo'; readonly ultimoError: string; readonly gasto: Gasto }> {
  const v = await viejos()
  switch (q.tipo) {
    case 'regla': {
      const r = await intentar('reemplaza', () => v.proponerRegla(quien.negocio, quien.pedidoPor, palabrasDelDueno, q.texto, q.preguntaDePrueba, q.reemplaza))
      return 'cambio' in r ? listo(r.cambio, lineasDeRegla(q.texto, r.cambio.vistaPrevia), 2) : r
    }
    case 'conocimiento': {
      const r = await intentar('conocimiento', () => v.proponerConocimiento(quien.negocio, quien.pedidoPor, palabrasDelDueno, q.conocimiento ?? {}, q.productos ?? {}))
      return 'cambio' in r ? listo(r.cambio, (r.cambio.vistaPrevia as { cambios: string[] }).cambios, 0) : r
    }
    case 'seccion':
    case 'indicador': {
      const c = await v.proponerPieza(quien.negocio, quien.pedidoPor, q.queQuiereVer, q.tipo, q.nombre)
      const vista = c.vistaPrevia as { error?: string; intentos?: number; resultado?: unknown; totalFilas?: number }
      if (c.estado === 'descartado') return { tipo: 'no_se_pudo', ultimoError: vista.error ?? 'No se pudo generar', gasto: gastoDe(c, vista.intentos ?? 0) }
      return listo(c, lineasDePieza(q.tipo, q.nombre, (c.propuesta as { descripcion?: string }).descripcion ?? '', vista), vista.intentos ?? 1)
    }
  }
}

const gastoDe = (c: Cambio, llamadas: number): Gasto => ({ llamadas, usd: c.costoUsd, ms: c.msHastaPropuesta ?? 0 })

function listo(c: Cambio, lineas: readonly string[], llamadas: number): Listo & { readonly cambio: string } {
  return { tipo: 'listo', cambio: c.id, alcance: ALCANCE[c.tipo], lineas, gasto: gastoDe(c, llamadas) }
}

function lineasDeRegla(texto: string, vistaPrevia: unknown): string[] {
  const v = vistaPrevia as { preguntaDePrueba?: string; antes?: unknown; despues?: unknown; herramientasDespues?: unknown; nota?: string }
  if (typeof v.antes !== 'string' || typeof v.despues !== 'string') return ['Ojo: no la pude probar con una pregunta de ensayo.', `Regla: «${texto}»`]
  const abreCaso = Array.isArray(v.herramientasDespues) && v.herramientasDespues.some((h) => h === 'abrir_caso' || h === 'pasar_al_dueno')
  return [
    `Regla: «${texto}»`,
    `Si un cliente escribe «${v.preguntaDePrueba}»,`,
    `hoy respondería: «${v.antes}»`,
    `con la regla respondería: «${v.despues}»${abreCaso ? ' y te pasaría un Caso' : ''}`,
    ...(v.nota ? [v.nota] : []),
  ]
}

function lineasDePieza(tipo: 'seccion' | 'indicador', nombre: string, descripcion: string, vista: { resultado?: unknown; totalFilas?: number }): string[] {
  if (tipo === 'seccion') return [`Sección «${nombre}»: ${descripcion}`, `${vista.totalFilas ?? 0} filas hoy`]
  const r = (vista.resultado ?? {}) as { valor?: unknown; unidad?: string }
  return [`Indicador «${nombre}»: ${String(r.valor ?? '—')}${r.unidad ? ` ${r.unidad}` : ''}`]
}

/** Revertir un Cambio viejo es una propuesta más, con el alcance del Cambio que revierte. No crea otro Cambio. */
export async function revertirLoViejo(negocio: NegocioId, aplicada: { readonly propuesta: PropuestaId; readonly lineas: readonly string[] }): Promise<Listo | Corregir> {
  const [c] = await db
    .select({ tipo: esquema.cambios.tipo, estado: esquema.cambios.estado })
    .from(esquema.cambios)
    .where(and(eq(esquema.cambios.negocioId, negocio), eq(esquema.cambios.propuestaId, aplicada.propuesta)))
  if (!c || c.estado !== 'aplicado') return corregir('propuesta', 'Eso ya no está aplicado')
  return { tipo: 'listo', alcance: ALCANCE[c.tipo], lineas: [`Quitar: ${aplicada.lineas[0] ?? 'lo que se aplicó'}`], gasto: { llamadas: 0, usd: 0, ms: 0 } }
}

/** Para el mismo lote que inserta la propuesta: el Cambio queda atado a ella. */
export function vincular(cambio: string, propuesta: PropuestaId) {
  return db.update(esquema.cambios).set({ propuestaId: propuesta }).where(eq(esquema.cambios.id, cambio))
}

/**
 * Escribe mientras `aplicarConReclamo` sostiene el reclamo, pero por HTTP y fuera de su transacción: `aplicarCambio`
 * no sabe de `tx`. Si el Cambio ya quedó como debía, devuelve `escrito` sin escribir otra vez: así se reconcilia una
 * caída entre esta escritura y el COMMIT del reclamo. Una caída en medio de `aplicarCambio` deja la escritura a
 * medias, como hoy; lo cierra el corte, con `escribir(tx, …)` dentro del mismo reclamo.
 */
export async function escribirLoViejo(
  negocio: NegocioId,
  p: { readonly propuesta: PropuestaId; readonly revierte: PropuestaId | null },
): Promise<{ readonly tipo: 'escrito' } | { readonly tipo: 'ya_no_cabe'; readonly problemas: readonly Problema[] }> {
  const [c] = await db
    .select({ id: esquema.cambios.id, estado: esquema.cambios.estado })
    .from(esquema.cambios)
    .where(and(eq(esquema.cambios.negocioId, negocio), eq(esquema.cambios.propuestaId, p.revierte ?? p.propuesta)))
  const v = await viejos()
  if (c && p.revierte === null) {
    if (c.estado === 'propuesto') await v.aplicarCambio(negocio, c.id)
    if (c.estado === 'propuesto' || c.estado === 'aplicado') return { tipo: 'escrito' }
  }
  if (c && p.revierte !== null) {
    if (c.estado === 'aplicado') await v.revertirCambio(negocio, c.id)
    if (c.estado === 'aplicado' || c.estado === 'revertido') return { tipo: 'escrito' }
  }
  return { tipo: 'ya_no_cabe', problemas: [{ tipo: 'valor_invalido', campo: 'cambio', porQue: 'Ese Cambio ya no se puede aplicar' }] }
}
