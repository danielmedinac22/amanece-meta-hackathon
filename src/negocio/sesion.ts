import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth/server'
import { db, esquema } from '@/db'

/**
 * El Dueño y su Negocio, sacados de la sesión. Es la única puerta: ninguna acción del Panel ni del
 * Agente del dueño recibe el Negocio como parámetro, así que nadie puede pedir el de otro.
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
  return { usuario, dueno: fila?.dueno ?? null, negocio: fila?.negocio ?? null }
}
