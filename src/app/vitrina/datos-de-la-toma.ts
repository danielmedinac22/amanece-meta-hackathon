import type { UIMessage } from 'ai'
import type { Atencion, ResultadoDeEscribir } from '@/nucleo/clientes/toma'
import { NEGOCIO_FUNCIONANDO, type NegocioDeMuestra } from './datos'

const CLIENTE = 'daniela'
const MINUTOS_28 = 28 * 60_000
const TUYA = { tipo: 'tuya', vez: 1, ventana: true, quedaMs: MINUTOS_28, sinContestar: null, agenteTerminando: false } as const satisfies Atencion

const conAtencion = (atencion: Atencion, alEscribir?: ResultadoDeEscribir): NegocioDeMuestra => ({ ...NEGOCIO_FUNCIONANDO, atenciones: { [CLIENTE]: atencion }, alEscribir })

const { detalle } = NEGOCIO_FUNCIONANDO.conversaciones
const conLoQueEscribio = detalle && { ...detalle, cuenta: 6, mensajes: [...detalle.mensajes, { id: 'd-1', de: 'dueno' as const, texto: 'Hola Daniela, soy Lucía. Te llamo en un momento para confirmar la dirección.' }, { id: 'd-2', de: 'cliente' as const, texto: 'Listo, gracias.' }] }

export const NEGOCIO_CON_LA_TOMA_TUYA: NegocioDeMuestra = {
  ...conAtencion({ ...TUYA, sinContestar: 'w-1' }),
  conversaciones: { ...NEGOCIO_FUNCIONANDO.conversaciones, detalle: conLoQueEscribio },
  detalles: { ...NEGOCIO_FUNCIONANDO.detalles, ...(conLoQueEscribio ? { [CLIENTE]: conLoQueEscribio } : {}) },
}
export const NEGOCIO_TOMADA_CON_EL_AGENTE_TERMINANDO = conAtencion({ ...TUYA, agenteTerminando: true })
export const NEGOCIO_DE_OTRO_DUENO = conAtencion({ tipo: 'de_otro', vez: 1, quien: 'Marcela', quedaMs: 12 * 60_000 })
export const NEGOCIO_TUYA_SIN_VENTANA = conAtencion({ ...TUYA, ventana: false })
export const NEGOCIO_SIN_VENTANA = conAtencion({ tipo: 'agente', vez: 0, ventana: false, espera: false })
export const NEGOCIO_CLIENTE_ESPERA = conAtencion({ tipo: 'agente', vez: 2, ventana: true, espera: true })
export const NEGOCIO_POR_VENCER = conAtencion({ ...TUYA, quedaMs: 2000 })
export const NEGOCIO_SE_ACABO_EL_TIEMPO = conAtencion(TUYA, { tipo: 'ya_no_la_tienes' })
export const NEGOCIO_NO_SALIO = conAtencion(TUYA, { tipo: 'no_salio', porQue: 'pasaron más de 24 horas desde su último mensaje y WhatsApp no deja escribirle hasta que vuelva a escribir.' })
export const NEGOCIO_WHATSAPP_NO_LO_TOMA = conAtencion(TUYA, { tipo: 'no_la_tomo' })

export const HILO_AVISO_DE_LA_TOMA: UIMessage[] = [
  { id: 'toma-1', role: 'assistant', parts: [{ type: 'text', text: 'Un Cliente te escribió en la conversación que tienes tomada. Tu agente no le contesta. Si la conversación vuelve a él sin que le respondas, le contesta cuando abras el Panel o cuando escriba de nuevo.' }, { type: 'data-toma', data: { cliente: CLIENTE, nombre: 'Daniela Quintero' } }] },
]
