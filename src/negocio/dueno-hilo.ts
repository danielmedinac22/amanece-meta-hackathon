import { asc, desc, eq } from 'drizzle-orm'
import { generateId, type UIMessage } from 'ai'
import { db, esquema } from '@/db'

/**
 * El Hilo de un Dueño con su Agente del dueño: una fila por mensaje, guardado como `UIMessage` del SDK.
 * Cada Dueño tiene el suyo, aunque el Negocio tenga varios.
 */
export async function leerHilo(duenoId: string, ultimos?: number): Promise<UIMessage[]> {
  if (ultimos) {
    const filas = await db.select().from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, duenoId)).orderBy(desc(esquema.mensajesDueno.creado)).limit(ultimos)
    return filas.reverse().map((f) => f.mensaje as UIMessage)
  }
  const filas = await db.select().from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, duenoId)).orderBy(asc(esquema.mensajesDueno.creado))
  return filas.map((f) => f.mensaje as UIMessage)
}

export async function guardarEnElHilo(negocioId: string, duenoId: string, rol: 'dueno' | 'agente', mensaje: UIMessage) {
  await db.insert(esquema.mensajesDueno).values({ negocioId, duenoId, rol, mensaje })
}

/** Un mensaje del Agente del dueño que no salió de una respuesta del modelo, por ejemplo un aviso. */
export function mensajeDelAgente(texto: string, partesExtra: UIMessage['parts'] = []): UIMessage {
  return { id: generateId(), role: 'assistant', parts: [{ type: 'text', text: texto, state: 'done' }, ...partesExtra] }
}
