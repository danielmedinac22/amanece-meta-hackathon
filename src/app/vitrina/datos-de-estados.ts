/** Datos inventados de los estados de cada pantalla. Solo `src/app/vitrina/` los importa. */
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { QUEDO_ANOTADO } from '@/negocio/partes-del-hilo'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Huella, Instante, PropuestaId } from '@/nucleo/identidad'
import type { GuionDePublicar } from './hilo-de-muestra'

const mensaje = (id: string, role: 'user' | 'assistant', ...parts: object[]) => ({ id, role, parts }) as UIMessage
const texto = (text: string) => ({ type: 'text', text })
const salida = (herramienta: string, output: object) => ({ type: `tool-${herramienta}`, toolCallId: `llamada-${herramienta}`, state: 'output-available', input: {}, output })

export const HILO_CAPACIDAD_FALTANTE: UIMessage[] = [
  mensaje('c1', 'user', texto('Quiero que mi agente cobre por Nequi')),
  mensaje('c2', 'assistant', texto('Cobrar por Nequi todavía no lo sé hacer. Tus Clientes siguen pagando como hasta ahora.'), salida('registrar_capacidad_faltante', { ok: true })),
  mensaje('c3', 'user', texto('Y muéstrame cuántos días tarda cada entrega')),
  mensaje('c4', 'assistant', salida('proponer', { resumen: `Eso no está en los datos que tengo: días de entrega. ${QUEDO_ANOTADO}; díselo al Dueño sin tecnicismos y sin prometer cuándo.`, tarjeta: null }), texto('Los días de entrega no los tengo guardados, así que ese número no te lo puedo mostrar.')),
  mensaje('c5', 'user', texto('Y que no le responda a los que escriben en la madrugada')),
  mensaje('c6', 'assistant', salida('proponer', { resumen: 'Falta decir desde qué hora. Pregúntaselo al Dueño.', tarjeta: null }), texto('¿Desde qué hora y hasta qué hora no quieres que responda?')),
]

const tarjeta = (propuesta: string, accion: TarjetaDeAprobacion['accion'], linea: string): TarjetaDeAprobacion => ({
  propuesta: propuesta as PropuestaId,
  huella: `huella-${propuesta}` as Huella,
  vence: '2030-01-01T00:00:00.000Z' as Instante,
  advertencias: [],
  lineas: [linea],
  accion,
})

const parte = (data: TarjetaDeAprobacion) => ({ type: 'data-tarjeta', data })
const espera = (accion: TarjetaDeAprobacion['accion']): EstadoDeTarjeta => ({ estado: 'espera_al_dueno', accion, aprobadaPor: null, asunto: null, publicada: false })

/** Todas se ven vivas porque la pantalla lleva rato abierta: lo que pasó se sabe al tocarlas. */
export const HILO_TARJETAS_QUE_VENCIERON: UIMessage[] = [
  mensaje('v1', 'assistant', texto('Esta regla lleva rato esperándote.'), parte(tarjeta('v-aplicar', 'aplicar', 'Envío gratis desde $100.000'))),
  mensaje('v2', 'assistant', texto('Y esta respuesta para un Cliente.'), parte(tarjeta('v-enviar', 'enviar', 'Responderle a Marcela: «Ya va en camino.»'))),
  mensaje('v3', 'assistant', texto('Otro Dueño ya resolvió esta.'), parte(tarjeta('v-otro', 'aplicar', 'Cerrar los domingos'))),
  mensaje('v4', 'assistant', texto('Y esta falla de red.'), parte(tarjeta('v-red', 'aplicar', 'Responder en menos de una hora'))),
]

export const TARJETAS_QUE_VENCIERON: Record<string, EstadoDeTarjeta> = { 'v-aplicar': espera('aplicar'), 'v-enviar': espera('enviar'), 'v-otro': espera('aplicar'), 'v-red': espera('aplicar') }

export const GUION_TARJETAS_QUE_VENCIERON: GuionDePublicar = {
  alAprobar: {
    'v-aplicar': { respuesta: { tipo: 'vencido' }, queda: 'vencida' },
    'v-enviar': { respuesta: { tipo: 'vencido' }, queda: 'vencida' },
    'v-otro': { respuesta: { tipo: 'no_existe' } },
    'v-red': { respuesta: { tipo: 'error', mensaje: 'No me pude conectar. Intenta de nuevo.' } },
  },
}
