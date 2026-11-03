import { altaDeDueno } from '@/negocio/alta'
import { leerHiloConTarjetas, mensajeDelDueno, responderEnElHilo } from '@/negocio/dueno-chat'
import { contextoDe, duenoActual } from '@/negocio/sesion'

// Un turno puede generar y probar código varias veces.
export const maxDuration = 300

/** Una cuenta que espera no recibe Negocio: un Dueño de antes de Clerk no debe terminar en uno vacío. */
const EN_ESPERA = 'en_espera'

/** La sesión y su Dueño. La primera vez que entra, se le arma el Negocio. */
async function sesionDelDueno() {
  const sesion = await duenoActual()
  if (!sesion) return null
  if (sesion.enEspera) return EN_ESPERA
  const { dueno, negocio } = sesion.paraAlta ? await altaDeDueno(sesion.paraAlta) : sesion
  return { dueno, negocio, ctx: contextoDe(dueno) }
}

/** El Hilo de este Dueño, del más viejo al más nuevo, y el estado vivo de sus tarjetas: `{ mensajes, tarjetas }`. */
export async function GET() {
  const sesion = await sesionDelDueno()
  if (!sesion) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  if (sesion === EN_ESPERA) return Response.json({ error: 'Tu cuenta todavía no está lista' }, { status: 409 })
  return Response.json(await leerHiloConTarjetas(sesion.ctx))
}

/**
 * Un turno de `useChat`. El Hilo vive en el servidor: del cuerpo solo se toma el último mensaje del Dueño
 * (`message`, o el último de `messages`), así que nadie puede reescribir el historial desde el navegador.
 */
export async function POST(req: Request) {
  const sesion = await sesionDelDueno()
  if (!sesion) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  if (sesion === EN_ESPERA) return Response.json({ error: 'Tu cuenta todavía no está lista' }, { status: 409 })

  const cuerpo = (await req.json().catch(() => null)) as { message?: unknown; messages?: unknown[] } | null
  const ultimo = cuerpo?.message ?? cuerpo?.messages?.at(-1)
  const mensaje = mensajeDelDueno(ultimo)
  if (!mensaje) return Response.json({ error: 'Escribe un mensaje' }, { status: 400 })

  return responderEnElHilo({ ...sesion, mensaje })
}
