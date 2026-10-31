import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth/server'
import { db, esquema } from '@/db'
import { marcar, type ContextoDelDueno } from '@/nucleo/identidad'

/**
 * El Dueño y su Negocio, sacados de la sesión. Es la única puerta: ninguna acción del Panel ni del
 * Agente del dueño recibe el Negocio como parámetro, así que nadie puede pedir el de otro. También es lo único
 * fuera de `src/nucleo` que acuña un `ContextoDelDueno`.
 */
export async function duenoActual() {
  const { data: sesion } = await auth.getSession()
  const usuario = sesion?.user
  if (!usuario) return null
  const [fila] = await db
    .select({ dueno: esquema.duenos, negocio: esquema.negocios })
    .from(esquema.duenos)
    .innerJoin(esquema.negocios, eq(esquema.negocios.id, esquema.duenos.negocioId))
    .where(eq(esquema.duenos.usuarioId, usuario.id))
  return { usuario, dueno: fila?.dueno ?? null, negocio: fila?.negocio ?? null, ctx: fila ? contextoDe(fila.dueno) : null }
}

export function contextoDe(dueno: typeof esquema.duenos.$inferSelect): ContextoDelDueno {
  return { negocio: marcar.negocio(dueno.negocioId), dueno: marcar.dueno(dueno.id), medio: 'web' }
}

/** Para las rutas que actúan sobre el Negocio (`aprobar`, `descartar`). Nunca da de alta: sin Dueño, null. */
export async function contextoDeLaSesion(): Promise<ContextoDelDueno | null> {
  return (await duenoActual())?.ctx ?? null
}
