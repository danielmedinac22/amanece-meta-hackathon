import { marcar, NUMERO_DE_AMANECE, type Wamid } from '../identidad'

const BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0'

export type EnvioPorKapso =
  | { readonly tipo: 'enviado'; readonly wamid: Wamid | null }
  | { readonly tipo: 'simulado' }
  | { readonly tipo: 'fallo'; readonly error: string }

// La guarda vive en el adaptador y no en `despachar`: si se reescribe la salida, los `probar-*` no le escriben a teléfonos reales.
const simulado = () => process.env.ENVIO_SIMULADO === '1'

/** Nunca lanza: `despachar` decide si reintenta. La línea simulada lleva el texto entero, aunque Kapso corte en 4096. */
export async function enviarPorKapso(telefono: string, texto: string): Promise<EnvioPorKapso> {
  if (simulado()) {
    console.log(`[envío simulado a ${telefono}] ${texto}`)
    return { tipo: 'simulado' }
  }
  if (!NUMERO_DE_AMANECE.id) return { tipo: 'fallo', error: 'Falta KAPSO_PHONE_NUMBER_ID' }
  try {
    const respuesta = await fetch(`${BASE}/${NUMERO_DE_AMANECE.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.KAPSO_API_KEY ?? '' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: { body: texto.slice(0, 4096), preview_url: false },
      }),
    })
    if (!respuesta.ok) return { tipo: 'fallo', error: `Kapso respondió ${respuesta.status}: ${await respuesta.text()}` }
    const datos = (await respuesta.json()) as { messages?: { id: string }[] }
    const id = datos.messages?.[0]?.id
    return { tipo: 'enviado', wamid: id ? marcar.wamid(id) : null }
  } catch (error) {
    return { tipo: 'fallo', error: String(error) }
  }
}

/** Simulado cuenta como permitido: una prueba sin `KAPSO_PHONE_NUMBER_ID` no queda frenada cuando la compuerta haga cumplir. */
export function numeroListo(): boolean {
  return simulado() || NUMERO_DE_AMANECE.id !== ''
}
