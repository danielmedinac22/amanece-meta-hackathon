/** Datos inventados de los estados de cada pantalla. Solo `src/app/vitrina/` los importa. */
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { QUEDO_ANOTADO } from '@/negocio/partes-del-hilo'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Huella, Instante, PropuestaId } from '@/nucleo/identidad'
import type { EnElRedactor } from '@/app/panel/adjuntos'
import type { Adjunto } from '@/nucleo/archivos'
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

const LISTA_DE_PRECIOS: Adjunto = { id: 'a1', clase: 'pdf', nombre: 'Lista de precios noviembre.pdf', paginas: 2, paginasDelOriginal: null }
const CATALOGO_LARGO: Adjunto = { id: 'a2', clase: 'pdf', nombre: 'Catálogo completo de cafés, molinos y accesorios de la temporada 2026.pdf', paginas: 20, paginasDelOriginal: 64 }
const FOTO_DEL_MENU: Adjunto = { id: 'a3', clase: 'foto', nombre: 'menu.jpg', paginas: null, paginasDelOriginal: null }
const archivo = (data: Adjunto) => ({ type: 'data-archivo', data })

const TARJETA_DE_UN_ARCHIVO = tarjeta('p-archivo', 'confirmar', 'Tu agente de clientes no lo usa hasta que lo confirmes.')

export const HILO_CON_ARCHIVOS: UIMessage[] = [
  mensaje('f1', 'user', texto('Estos son mis precios de este mes'), archivo(LISTA_DE_PRECIOS)),
  mensaje(
    'f2',
    'assistant',
    salida('leer_archivo', {
      resumen: 'Leí 2 cosas de tu PDF.',
      tarjeta: { ...TARJETA_DE_UN_ARCHIVO, lineas: ['Esto leí de tu PDF. A tus Clientes no les cambia nada hasta que lo apliques y toques Publicar.', 'Compara cada precio con tu PDF: leer un archivo puede fallar.', 'Tueste medio, grano 500 g · $42.000, antes $38.000 · lo leí', 'Molino manual · $96.000 · lo leí', 'Si algo está mal, descártala y dile a tu agente cómo es.'] },
    }),
    texto('Leí tu lista: trae 2 productos. Compáralos con tu PDF y toca el botón si están bien.'),
  ),
  mensaje('f3', 'user', archivo(FOTO_DEL_MENU)),
  mensaje('f4', 'assistant', salida('leer_archivo', { resumen: 'Es: una foto del menú.', tarjeta: null }), texto('Es tu menú del local. ¿Quieres que lo cargue a tu catálogo?')),
  mensaje('f5', 'user', texto('Y este es el catálogo entero'), archivo(CATALOGO_LARGO)),
  mensaje('f6', 'assistant', salida('leer_archivo', { resumen: 'Solo leí las primeras 20 de 64 páginas.', tarjeta: null }), texto('Leí las primeras 20 de 64 páginas. Si los precios están más adelante, mándame esas páginas.')),
]

export const ADJUNTOS_EN_EL_REDACTOR: readonly EnElRedactor[] = [
  { local: 'l1', nombre: 'Lista de precios noviembre.pdf', clase: 'pdf', estado: 'subiendo' },
  { local: 'l2', nombre: 'menu.jpg', clase: 'foto', estado: 'listo', adjunto: FOTO_DEL_MENU },
  { local: 'l3', nombre: 'Catálogo completo de cafés, molinos y accesorios de la temporada 2026.pdf', clase: 'pdf', estado: 'fallo', error: 'Pesa más de 4 MB. Prueba con uno más liviano.' },
]
