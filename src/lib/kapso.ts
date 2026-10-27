import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * WhatsApp por Kapso. La llave de Kapso es la de un proyecto que también tiene números en producción
 * de otros negocios, así que todo envío sale solo del número de Amanece y cualquier otro se rechaza.
 */
export const NUMERO_DE_AMANECE = process.env.KAPSO_PHONE_NUMBER_ID ?? ''

/** El número de Amanece para armar links `wa.me`, sin signos. */
export const TELEFONO_DE_AMANECE = process.env.NEXT_PUBLIC_TELEFONO_DE_AMANECE ?? '12058633828'

const BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0'

/** Firma de Kapso: HMAC-SHA256 del cuerpo crudo, en hex, en `X-Webhook-Signature` (a veces con `sha256=`). */
export function firmaValida(cuerpo: string, firma: string | null, secreto = process.env.KAPSO_WEBHOOK_SECRET ?? '') {
  if (!firma || !secreto) return false
  const recibida = Buffer.from(firma.trim().replace(/^sha256=/, ''), 'utf8')
  const esperada = Buffer.from(createHmac('sha256', secreto).update(cuerpo).digest('hex'), 'utf8')
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

export type MensajeEntrante = {
  wamid: string
  telefono: string
  nombre: string
  texto: string
}

/** Saca el mensaje de texto de un evento `whatsapp.message.received`. Lo demás devuelve `null`. */
export function leerMensajeEntrante(cuerpo: unknown): MensajeEntrante | null {
  // El cuerpo viene de afuera y cambia de forma; se lee campo por campo con cuidado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crudo = cuerpo as Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raiz = (crudo?.data && !crudo.message ? crudo.data : crudo) as Record<string, any>
  const mensaje = raiz?.message
  if (!mensaje?.id || !mensaje.from) return null
  if (raiz.phone_number_id && raiz.phone_number_id !== NUMERO_DE_AMANECE) return null
  // Un recibo de entrega viene con el estado dentro del mensaje; no es un mensaje del Cliente.
  if (mensaje.kapso?.status && mensaje.kapso.status !== 'received') return null

  const texto =
    mensaje.type === 'text'
      ? mensaje.text?.body
      : mensaje.type === 'button'
        ? mensaje.button?.text
        : mensaje.type === 'interactive'
          ? (mensaje.interactive?.button_reply?.title ?? mensaje.interactive?.list_reply?.title)
          : (mensaje.kapso?.transcript?.text ?? mensaje.kapso?.content)
  if (!texto || typeof texto !== 'string') return null

  return {
    wamid: mensaje.id,
    telefono: String(mensaje.from).replace(/\D/g, ''),
    nombre: raiz.conversation?.contact_name ?? raiz.conversation?.kapso?.contact_name ?? '',
    texto: texto.trim(),
  }
}

/** Manda un texto desde el número de Amanece. No revisa la ventana de 24 horas: eso lo hace `enviarAlCliente`. */
export async function enviarTexto(telefono: string, texto: string) {
  if (!NUMERO_DE_AMANECE) throw new Error('Falta KAPSO_PHONE_NUMBER_ID')
  const respuesta = await fetch(`${BASE}/${NUMERO_DE_AMANECE}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.KAPSO_API_KEY ?? '' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'text',
      text: { body: texto.slice(0, 4096), preview_url: false },
    }),
  })
  if (!respuesta.ok) throw new Error(`Kapso respondió ${respuesta.status}: ${await respuesta.text()}`)
  const datos = (await respuesta.json()) as { messages?: { id: string }[] }
  return datos.messages?.[0]?.id ?? null
}

/** Link `wa.me` con el código del Negocio ya escrito, para que el Cliente llegue a su Agente de clientes. */
export function linkDeWhatsapp(nombre: string, codigo: string) {
  return `https://wa.me/${TELEFONO_DE_AMANECE}?text=${encodeURIComponent(`Hola ${nombre} (${codigo})`)}`
}
