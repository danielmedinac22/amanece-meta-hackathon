import type { UIMessage } from 'ai'
import type { DatosDeCasos } from '@/negocio/casos'
import type { AsuntoDeTarjeta, EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { EnvioDeRespuesta } from '@/nucleo/caso-palabras'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Huella, Instante, PropuestaId } from '@/nucleo/identidad'
import { NEGOCIO_FUNCIONANDO, type NegocioDeMuestra } from './datos'
import type { GuionDePublicar } from './hilo-de-muestra'

const CAMILA: Extract<AsuntoDeTarjeta, { tipo: 'caso' }> = {
  tipo: 'caso',
  titulo: 'La bolsa llegó rota',
  pedido: 31,
  cliente: 'Camila Rojas',
  escribio: 'Una de las bolsas llegó abierta y con café regado dentro de la caja.',
  respuesta: 'Hola Camila, qué pena. Te repongo la bolsa sin costo en el próximo despacho.',
  reglas: ['Si llega dañado, se repone sin costo'],
  porTuLado: 'Separar una bolsa de 500 g para el despacho del jueves.',
  envio: null,
}

const tarjeta = (propuesta: string): TarjetaDeAprobacion => ({
  propuesta: propuesta as PropuestaId,
  huella: `huella-${propuesta}` as Huella,
  vence: new Date('2030-01-01T00:00:00Z').toISOString() as Instante,
  advertencias: [],
  lineas: [`Responderle a Camila Rojas: «${CAMILA.respuesta}»`],
  accion: 'enviar',
})

const estado = (e: EstadoDeTarjeta['estado'], asunto: EstadoDeTarjeta['asunto'], aprobadaPor: string | null = null): EstadoDeTarjeta => ({ estado: e, accion: 'enviar', aprobadaPor, asunto, publicada: false })
const aviso = (id: string, propuesta: string) => ({ id, role: 'assistant', parts: [{ type: 'text', text: 'Camila dice que una bolsa llegó rota.' }, { type: 'data-tarjeta', data: tarjeta(propuesta) }] }) as UIMessage
const aprobada = (envio: EnvioDeRespuesta) => estado('aplicada', { ...CAMILA, envio }, 'Lucía')

export const HILO_CASO_CON_REGLA: UIMessage[] = [aviso('r1', 'p-con-regla')]
export const TARJETAS_CASO_CON_REGLA: Record<string, EstadoDeTarjeta> = { 'p-con-regla': estado('espera_al_dueno', CAMILA) }

export const HILO_CASO_VIEJO: UIMessage[] = [aviso('v1', 'p-viejo')]
export const TARJETAS_CASO_VIEJO: Record<string, EstadoDeTarjeta> = { 'p-viejo': estado('espera_al_dueno', { ...CAMILA, reglas: [], porTuLado: null }) }

export const HILO_DESENLACES_DEL_ENVIO: UIMessage[] = [aviso('d1', 'p-salio'), aviso('d2', 'p-no-la-tomo'), aviso('d3', 'p-no-salio'), aviso('d4', 'p-sin-saber')]
export const TARJETAS_DESENLACES_DEL_ENVIO: Record<string, EstadoDeTarjeta> = {
  'p-salio': aprobada({ tipo: 'salio' }),
  'p-no-la-tomo': aprobada({ tipo: 'no_la_tomo' }),
  'p-no-salio': aprobada({ tipo: 'no_salio', motivo: 'fuera_de_ventana' }),
  'p-sin-saber': aprobada({ tipo: 'sin_saber' }),
}

export const GUION_WHATSAPP_NO_LA_TOMA: GuionDePublicar = {
  alAprobar: { 'p-con-regla': { respuesta: { tipo: 'aplicado', resumen: 'Lucía aprobó la respuesta a Camila Rojas, pero WhatsApp no la tomó. Escríbele tú directamente.', envio: { tipo: 'no_la_tomo' }, version: null }, queda: 'aplicada' } },
}

const SECCION: DatosDeCasos = {
  cuentaQueEspera: 1,
  esperan: [
    {
      id: 'e-1',
      titulo: 'Pedido para fuera de Manizales',
      quien: 'Julián Ramírez · pedido #42',
      detalle: 'Julián Ramírez escribió: «¿Me lo mandan a Pasto?»',
      propuesta: 'Responderle: "Hola Julián, ya te confirmo si llegamos a Pasto."',
      reglas: ['Pedidos para fuera de Manizales'],
      porTuLado: 'Preguntarle a la transportadora si cubre Pasto.',
      hace: 'hace 20 min',
      decision: null,
    },
  ],
  cuentaDeResueltos: 5,
  resueltos: [
    { id: 'z-1', titulo: 'Salió', resolucion: 'Te la repongo sin costo.', hace: 'hace 1 h', envio: { tipo: 'salio' } },
    { id: 'z-2', titulo: 'WhatsApp no la tomó', resolucion: 'Te la repongo sin costo.', hace: 'hace 2 h', envio: { tipo: 'no_la_tomo' } },
    { id: 'z-3', titulo: 'No salió', resolucion: 'Te la repongo sin costo.', hace: 'hace 3 h', envio: { tipo: 'no_salio', motivo: 'fuera_de_ventana' } },
    { id: 'z-4', titulo: 'No consta', resolucion: 'Te la repongo sin costo.', hace: 'hace 4 h', envio: { tipo: 'sin_saber' } },
    { id: 'z-5', titulo: 'Resuelto antes de esta salida', resolucion: 'Se le explicó por teléfono.', hace: 'hace 9 días', envio: null },
  ],
}

export const NEGOCIO_CASOS_CON_ENVIO: NegocioDeMuestra = { ...NEGOCIO_FUNCIONANDO, seccionDeCasos: SECCION }
