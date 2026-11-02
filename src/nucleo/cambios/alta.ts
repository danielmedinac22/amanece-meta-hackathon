/**
 * La entrevista mientras el Negocio se arma, hasta que pase a `proponer` (semanas 1-2). Mismo `traducir` y mismo
 * `escribir`, con origen `entrevista` y sin fila en `propuestas`: no hay Clientes reales que esperen un botón.
 */
import { and, eq } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { conTransaccion } from '@/db/pool'
import { leerEstado } from '../estado'
import { escribir } from '../estado/escribir'
import type { Problema } from '../estado/elementos'
import type { ContextoDelDueno } from '../identidad'
import { queFaltaParaAbrir } from './politica'
import { traducir, type QuierePoner } from './traducir'

const SOLO_MIENTRAS_SE_ARMA: Problema = { tipo: 'solo_mientras_se_arma' }

export async function guardarEnElAlta(
  ctx: ContextoDelDueno,
  pedido: { readonly nombre: string | null; readonly rubro: string | null; readonly quiere: readonly QuierePoner[] },
): Promise<{ readonly guardado: readonly string[] } | { readonly problemas: readonly Problema[] }> {
  const t = pedido.quiere.length ? await traducir(await leerEstado(ctx.negocio), pedido.quiere) : null
  if (t && 'tipo' in t) return { problemas: t.tipo === 'corregir' ? t.problemas : [{ tipo: 'valor_invalido', campo: 'quiere', porQue: 'Eso todavía no lo sé hacer cumplir' }] }
  const identidad = { ...(pedido.nombre ? { nombre: pedido.nombre } : {}), ...(pedido.rubro ? { rubro: pedido.rubro } : {}) }
  const r = await conTransaccion<'escrito' | 'conflicto' | 'abierto' | { readonly problemas: readonly Problema[] }>(async (tx, deshacer) => {
    const [sigue] = await tx
      .select({ id: esquema.negocios.id })
      .from(esquema.negocios)
      .where(and(eq(esquema.negocios.id, ctx.negocio), eq(esquema.negocios.estado, 'armando')))
      .for('update')
    if (!sigue) return deshacer('abierto')
    if (Object.keys(identidad).length) await tx.update(esquema.negocios).set(identidad).where(eq(esquema.negocios.id, ctx.negocio))
    if (!t) return 'escrito'
    const w = await escribir(tx, ctx.negocio, { tipo: 'entrevista' }, t.escritura)
    if (w.tipo === 'invalida') return deshacer({ problemas: w.problemas })
    return w.tipo === 'conflicto' ? deshacer('conflicto') : 'escrito'
  })
  if (typeof r === 'object') return r
  if (r === 'abierto') return { problemas: [SOLO_MIENTRAS_SE_ARMA] }
  if (r === 'conflicto') return { problemas: [{ tipo: 'valor_invalido', campo: 'quiere', porQue: 'Otro cambio llegó primero: vuelve a intentarlo' }] }
  return {
    guardado: [...(pedido.nombre ? [`Nombre: «${pedido.nombre}»`] : []), ...(pedido.rubro ? [`Rubro: «${pedido.rubro}»`] : []), ...(t?.lineas ?? [])],
  }
}

/** Abre si nada bloquea. Lo que solo avisa vuelve para que el Agente del dueño se lo cuente al Dueño. */
export async function abrirEnElAlta(ctx: ContextoDelDueno): Promise<{ readonly abierto: false; readonly falta: readonly string[]; readonly avisos: readonly string[] } | { readonly abierto: true; readonly avisos: readonly string[] }> {
  const estado = await leerEstado(ctx.negocio)
  const { bloquea, avisa } = queFaltaParaAbrir(estado)
  if (estado.identidad.modo !== 'armando') return { abierto: true, avisos: [] }
  if (bloquea.length) return { abierto: false, falta: bloquea, avisos: avisa }
  await db.update(esquema.negocios).set({ estado: 'listo' }).where(and(eq(esquema.negocios.id, ctx.negocio), eq(esquema.negocios.estado, 'armando')))
  return { abierto: true, avisos: avisa }
}
