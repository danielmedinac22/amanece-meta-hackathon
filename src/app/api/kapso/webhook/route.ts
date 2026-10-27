import { after } from 'next/server'
import { firmaValida, leerMensajeEntrante } from '@/lib/kapso'
import { recibirMensaje } from '@/negocio/whatsapp'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/** Mensajes que entran al número de Amanece (`whatsapp.message.received`). Responde ya y atiende después. */
export async function POST(request: Request) {
  // Mientras el webhook no esté registrado en Kapso no hay secreto, y sin secreto no se acepta nada.
  if (!process.env.KAPSO_WEBHOOK_SECRET) return new Response('Webhook sin configurar', { status: 503 })

  const cuerpo = await request.text()
  if (!firmaValida(cuerpo, request.headers.get('x-webhook-signature'))) {
    return new Response('Firma inválida', { status: 401 })
  }

  let evento: unknown
  try {
    evento = JSON.parse(cuerpo)
  } catch {
    return new Response('Cuerpo inválido', { status: 400 })
  }

  const mensaje = leerMensajeEntrante(evento)
  if (mensaje) {
    after(async () => {
      try {
        await recibirMensaje(mensaje)
      } catch (error) {
        console.error('[webhook] no se pudo atender el mensaje', mensaje.wamid, error)
      }
    })
  }
  return Response.json({ ok: true })
}
