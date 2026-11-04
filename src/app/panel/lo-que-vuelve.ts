import type { UIMessage } from 'ai'
import type { Adjunto } from '@/nucleo/archivos'

export type Enviado = { readonly texto: string; readonly adjuntos: readonly Adjunto[] }
/** Un mensaje que no quedó en el Hilo: vuelve a la caja, y `aviso` dice por qué. */
export type Devuelto = Enviado & { readonly aviso: string }

export const NO_LLEGO = 'No me llegó tu mensaje. Te lo dejé en la caja para que lo envíes de nuevo.'

const suyos = (mensajes: readonly UIMessage[]) => mensajes.filter((m) => m.role === 'user').length

/** La ruta contesta `{ error }` con lo que el Dueño debe leer, y `useChat` lo entrega como el texto del error. */
function rechazoDe(error: Error): string | null {
  try {
    const dijo = (JSON.parse(error.message) as { error?: unknown }).error
    return typeof dijo === 'string' && dijo ? dijo : null
  } catch {
    return null
  }
}

/**
 * Pura. El Hilo vive en el servidor y le pone su propio id a cada mensaje, así que se comparan cuántos del Dueño hay.
 * `null` si el mensaje quedó guardado, porque la respuesta se cortó después: devolverlo lo repetiría. Sin `servidor`
 * no se sabe, y se devuelve: repetir un mensaje cuesta menos que perderlo. Un rechazo no devuelve los archivos, porque
 * las dos causas con archivos son que ya no están o una sesión vencida.
 */
export function loQueVuelve(enviado: Enviado, error: Error, local: readonly UIMessage[], servidor: readonly UIMessage[] | null): Devuelto | null {
  if (servidor && suyos(servidor) >= suyos(local)) return null
  const rechazo = rechazoDe(error)
  return rechazo ? { texto: enviado.texto, adjuntos: [], aviso: rechazo } : { ...enviado, aviso: NO_LLEGO }
}
