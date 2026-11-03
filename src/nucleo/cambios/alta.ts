/**
 * La entrevista mientras el Negocio se arma, hasta que pase a `proponer` (semanas 1-2). Mismo `traducir` y mismo
 * `escribir`, con origen `entrevista` y sin fila en `propuestas`: no hay Clientes reales que esperen un botón. Lo que
 * se leyó de un enlace sí espera el botón (`lectura.ts`).
 */
import { and, eq } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { conTransaccion } from '@/db/pool'
import { leerAplicado } from '../estado'
import { escribir } from '../estado/escribir'
import { describirVigente, type Problema } from '../estado/elementos'
import type { ContextoDelDueno } from '../identidad'
import type { TarjetaDeAprobacion } from './fila'
import { cifrasDeLaTarjeta, lecturaPendiente, numerosDelDueno, origenDeLasCifras, rearmarLectura } from './lectura'
import { queFaltaParaAbrir, type Falta } from './politica'
import { traducir, type QuierePoner } from './traducir'

const SOLO_MIENTRAS_SE_ARMA: Problema = { tipo: 'solo_mientras_se_arma' }

export type ResultadoDelAlta =
  | {
      readonly guardado: readonly string[]
      /** Lo que se quiso guardar con una cifra que solo está en la tarjeta: el Dueño la confirma con el botón. */
      readonly porConfirmar: readonly string[]
      /** Lo que trae una cifra que nadie escribió: el Agente se lo pregunta al Dueño. */
      readonly sinFuente: readonly string[]
      /** La tarjeta de lectura rearmada, si lo que se guardó la cambió. */
      readonly tarjeta: TarjetaDeAprobacion | null
    }
  | { readonly problemas: readonly Problema[] }

/**
 * Antes de traducir, cada Elemento con cifras pasa por `origenDeLasCifras`: solo entra lo que el Dueño escribió. Una
 * línea que el Dueño no escribió no tumba a las demás. En la misma transacción, después de `escribir`, la tarjeta de
 * lectura pendiente pierde lo que el Dueño acaba de escribir.
 */
export async function guardarEnElAlta(
  ctx: ContextoDelDueno,
  pedido: { readonly nombre: string | null; readonly rubro: string | null; readonly quiere: readonly QuierePoner[] },
): Promise<ResultadoDelAlta> {
  const [estado, escritoPorElDueno, pendiente] = await Promise.all([leerAplicado(ctx.negocio), numerosDelDueno(ctx.dueno), lecturaPendiente(ctx.negocio)])
  const enLaTarjeta = cifrasDeLaTarjeta(pendiente?.escritura ?? null)
  const quedan: QuierePoner[] = []
  const porConfirmar: string[] = []
  const sinFuente: string[] = []
  for (const q of pedido.quiere) {
    const origen = origenDeLasCifras(q.elemento, escritoPorElDueno, enLaTarjeta, q.reemplaza ? (estado.vigente(q.reemplaza)?.elemento ?? null) : null)
    if (origen === 'dueno') quedan.push(q)
    else (origen === 'lectura' ? porConfirmar : sinFuente).push(describirVigente(q.elemento, estado))
  }
  const t = quedan.length ? await traducir(estado, quedan) : null
  if (t && 'tipo' in t) return { problemas: t.tipo === 'corregir' ? t.problemas : [{ tipo: 'valor_invalido', campo: 'quiere', porQue: 'Eso todavía no lo sé hacer cumplir' }] }
  const identidad = { ...(pedido.nombre ? { nombre: pedido.nombre } : {}), ...(pedido.rubro ? { rubro: pedido.rubro } : {}) }
  const r = await conTransaccion<{ readonly tarjeta: TarjetaDeAprobacion | null } | 'conflicto' | 'abierto' | { readonly problemas: readonly Problema[] }>(async (tx, deshacer) => {
    const [sigue] = await tx
      .select({ id: esquema.negocios.id })
      .from(esquema.negocios)
      .where(and(eq(esquema.negocios.id, ctx.negocio), eq(esquema.negocios.estado, 'armando')))
      .for('update')
    if (!sigue) return deshacer('abierto')
    if (Object.keys(identidad).length) await tx.update(esquema.negocios).set(identidad).where(eq(esquema.negocios.id, ctx.negocio))
    if (!t) return { tarjeta: null }
    const w = await escribir(tx, ctx.negocio, { tipo: 'entrevista' }, t.escritura, null)
    if (w.tipo === 'invalida') return deshacer({ problemas: w.problemas })
    if (w.tipo === 'conflicto') return deshacer('conflicto')
    return { tarjeta: await rearmarLectura(tx, ctx.negocio, await leerAplicado(ctx.negocio, tx)) }
  })
  if (r === 'abierto') return { problemas: [SOLO_MIENTRAS_SE_ARMA] }
  if (r === 'conflicto') return { problemas: [{ tipo: 'valor_invalido', campo: 'quiere', porQue: 'Otro cambio llegó primero: vuelve a intentarlo' }] }
  if ('problemas' in r) return r
  return {
    guardado: [...(pedido.nombre ? [`Nombre: «${pedido.nombre}»`] : []), ...(pedido.rubro ? [`Rubro: «${pedido.rubro}»`] : []), ...(t?.lineas ?? [])],
    porConfirmar,
    sinFuente,
    tarjeta: r.tarjeta,
  }
}

/** Abre si nada bloquea. Lo que solo avisa vuelve para que el Agente del dueño se lo cuente al Dueño. */
export async function abrirEnElAlta(ctx: ContextoDelDueno): Promise<{ readonly abierto: false; readonly falta: readonly Falta[]; readonly avisos: readonly Falta[] } | { readonly abierto: true; readonly avisos: readonly Falta[] }> {
  const estado = await leerAplicado(ctx.negocio)
  const { bloquea, avisa } = queFaltaParaAbrir(estado, (await lecturaPendiente(ctx.negocio))?.escritura ?? null)
  if (estado.identidad.modo !== 'armando') return { abierto: true, avisos: [] }
  if (bloquea.length) return { abierto: false, falta: bloquea, avisos: avisa }
  await db.update(esquema.negocios).set({ estado: 'listo' }).where(and(eq(esquema.negocios.id, ctx.negocio), eq(esquema.negocios.estado, 'armando')))
  return { abierto: true, avisos: avisa }
}
