import { altaDeDueno } from '@/negocio/alta'
import { leerHiloConTarjetas, mensajeDelDueno, responderEnElHilo } from '@/negocio/dueno-chat'
import { contextoDe, duenoActual } from '@/negocio/sesion'

// Un turno puede generar y probar código varias veces.
export const maxDuration = 300

/** La sesión y su Dueño. La primera vez que entra, se le arma el Negocio. */
async function sesionDelDueno() {
  const sesion = await duenoActual()
  if (!sesion) return null
  const { dueno, negocio } = sesion.dueno && sesion.negocio ? { dueno: sesion.dueno, negocio: sesion.negocio } : await altaDeDueno(sesion.usuario)
  return { dueno, negocio, ctx: contextoDe(dueno) }
}

/** El Hilo de este Dueño, del más viejo al más nuevo, y el estado vivo de sus tarjetas: `{ mensajes, tarjetas }`. */
export async function GET() {
  const sesion = await sesionDelDueno()
  if (!sesion) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  return Response.json(await leerHiloConTarjetas(sesion.ctx))
}

/**
 * Un turno de `useChat`. El Hilo vive en el servidor: del cuerpo solo se toma el último mensaje del Dueño
 * (`message`, o el último de `messages`), así que nadie puede reescribir el historial desde el navegador.
 */
export async function POST(req: Request) {
  const sesion = await sesionDelDueno()
  if (!sesion) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })

  const cuerpo = (await req.json().catch(() => null)) as { message?: unknown; messages?: unknown[] } | null
  const ultimo = cuerpo?.message ?? cuerpo?.messages?.at(-1)
  const mensaje = mensajeDelDueno(ultimo)
  if (!mensaje) return Response.json({ error: 'Escribe un mensaje' }, { status: 400 })

  return responderEnElHilo({ ...sesion, mensaje })
}
