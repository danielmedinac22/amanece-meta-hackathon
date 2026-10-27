import { altaDeDueno } from '@/negocio/alta'
import { mensajeDelDueno, responderEnElHilo } from '@/negocio/dueno-chat'
import { leerHilo } from '@/negocio/dueno-hilo'
import { duenoActual } from '@/negocio/sesion'

// Un turno puede generar y probar código varias veces.
export const maxDuration = 300

/** La sesión y su Dueño. La primera vez que entra, se le arma el Negocio. */
async function sesionDelDueno() {
  const sesion = await duenoActual()
  if (!sesion) return null
  if (sesion.dueno && sesion.negocio) return { dueno: sesion.dueno, negocio: sesion.negocio }
  return altaDeDueno(sesion.usuario)
}

/** El Hilo de este Dueño, del más viejo al más nuevo, como `UIMessage[]`. */
export async function GET() {
  const sesion = await sesionDelDueno()
  if (!sesion) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  return Response.json(await leerHilo(sesion.dueno.id))
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
