import { and, eq, like, not, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { idDeLaSesion, leerCuenta, type Cuenta } from '@/lib/auth/server'
import { marcar, type ContextoDelDueno } from '@/nucleo/identidad'

type Dueno = typeof esquema.duenos.$inferSelect
type Negocio = typeof esquema.negocios.$inferSelect

/** Quién puede darse de alta. Solo lo entrega `duenoActual`, y solo si nada dice que ya tiene Negocio. */
export type ParaAlta = { readonly id: string; readonly name: string | null; readonly email: string | null }

/** Una sesión tiene Dueño, puede darse de alta o espera. Quien espera no recibe ni un Negocio ni uno nuevo vacío. */
export type Sesion =
  | { dueno: Dueno; negocio: Negocio; ctx: ContextoDelDueno; paraAlta: null; enEspera: false }
  | { dueno: null; negocio: null; ctx: null; paraAlta: ParaAlta; enEspera: false }
  | { dueno: null; negocio: null; ctx: null; paraAlta: null; enEspera: true }

const EN_ESPERA: Sesion = { dueno: null, negocio: null, ctx: null, paraAlta: null, enEspera: true }

async function buscarPorUsuario(usuarioId: string) {
  const [fila] = await db
    .select({ dueno: esquema.duenos, negocio: esquema.negocios })
    .from(esquema.duenos)
    .innerJoin(esquema.negocios, eq(esquema.negocios.id, esquema.duenos.negocioId))
    .where(eq(esquema.duenos.usuarioId, usuarioId))
  return fila ?? null
}

function conDueno(fila: { dueno: Dueno; negocio: Negocio }): Sesion {
  return { dueno: fila.dueno, negocio: fila.negocio, ctx: contextoDe(fila.dueno), paraAlta: null, enEspera: false }
}

/** Un Dueño de antes de Clerk con ese correo. `duenos.email` nunca se verificó: esto solo frena un alta, no enlaza. */
async function hayDuenoSinPasar(email: string) {
  const [fila] = await db
    .select({ id: esquema.duenos.id })
    .from(esquema.duenos)
    .where(and(eq(sql`lower(${esquema.duenos.email})`, email.toLowerCase()), not(like(esquema.duenos.usuarioId, 'user\\_%'))))
    .limit(1)
  return Boolean(fila)
}

/**
 * Quien no tiene fila con su id de Clerk. Un Dueño importado trae el id viejo en `external_id`, y aquí su fila pasa al
 * id de Clerk una sola vez: el importador no toca la base, así que el orden entre importar y publicar no daña nada.
 * Cuando el importador no deje pendientes y todos hayan entrado, este camino se borra.
 */
async function sinFila(cuenta: Cuenta): Promise<Sesion> {
  if (!cuenta.emailVerified || !cuenta.email) return EN_ESPERA
  if (cuenta.idViejo) {
    // Una sola sentencia: si dos sondeos corren a la vez, el que pierde encuentra la fila del que ganó.
    await db.update(esquema.duenos).set({ usuarioId: cuenta.id }).where(eq(esquema.duenos.usuarioId, cuenta.idViejo))
    const enlazada = await buscarPorUsuario(cuenta.id)
    if (enlazada) return conDueno(enlazada)
  }
  if (await hayDuenoSinPasar(cuenta.email)) return EN_ESPERA
  return { dueno: null, negocio: null, ctx: null, paraAlta: { id: cuenta.id, name: cuenta.name, email: cuenta.email }, enEspera: false }
}

/**
 * El Dueño y su Negocio, sacados de la sesión. Es la única puerta: ninguna acción del Panel ni del
 * Agente del dueño recibe el Negocio como parámetro, así que nadie puede pedir el de otro. También es lo único
 * fuera de `src/nucleo` que acuña un `ContextoDelDueno`.
 */
export async function duenoActual(): Promise<Sesion | null> {
  const id = await idDeLaSesion()
  if (!id) return null
  const fila = await buscarPorUsuario(id)
  return fila ? conDueno(fila) : sinFila(await leerCuenta(id))
}

export function contextoDe(dueno: Dueno): ContextoDelDueno {
  return { negocio: marcar.negocio(dueno.negocioId), dueno: marcar.dueno(dueno.id), medio: 'web' }
}

/** Para las rutas que actúan sobre el Negocio (`aprobar`, `descartar`). Nunca da de alta: sin Dueño, null. */
export async function contextoDeLaSesion(): Promise<ContextoDelDueno | null> {
  return (await duenoActual())?.ctx ?? null
}
