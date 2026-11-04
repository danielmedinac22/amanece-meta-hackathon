/**
 * Lo que una plantilla le deja al armado. Es cómo trabajar, nunca datos: por eso aquí no hay negocios, personas ni
 * cifras, y lo inventado de las tarjetas vive aparte en `plantillas-datos.ts`, donde nada del servidor lo lee. Sin
 * lecturas de la base: ningún dato de un Negocio puede llegar a una plantilla.
 */
import type { UIMessage } from 'ai'
import type { ElementoDe } from './estado/elementos'

export const IDS_DE_PLANTILLA = ['tienda', 'logistica', 'agenda'] as const
export type IdDePlantilla = (typeof IDS_DE_PLANTILLA)[number]

export const esIdDePlantilla = (x: unknown): x is IdDePlantilla => IDS_DE_PLANTILLA.includes(x as IdDePlantilla)

export type Partida = {
  readonly nombre: string
  /** El Rubro con que nace, si el Dueño no ha dicho el suyo. Decide cómo habla Inicio (`vozDelRubro`). */
  readonly rubro: string
  /** Solo lo que hace cierta la promesa de la tarjeta. Sin cifras: `guardarEnElAlta` rechaza las que nadie escribió. */
  readonly reglas: readonly ElementoDe<'regla'>[]
  /** Lo que dice el agente en el Hilo. El Dueño lo lee y el modelo también: de aquí sabe qué preguntar primero. */
  readonly primero: string
  /** Lo que se le pide al agente ya abierto. Pasa por `proponer` y su redactor, como cualquier Sección o Indicador. */
  readonly alAbrir: readonly string[]
}

const TRAE = 'trae cómo trabajo, no datos: nada del ejemplo entra a tu negocio. Para armarlo con lo tuyo necesito'

export const PARTIDAS: Readonly<Record<IdDePlantilla, Partida>> = {
  tienda: {
    nombre: 'Venta contra entrega',
    rubro: 'venta contra entrega',
    reglas: [],
    primero: `Venta contra entrega ${TRAE} tus productos con su precio, a dónde envías, cuánto cuesta y cuánto demora.`,
    alAbrir: ['Quiero ver los pedidos confirmados por día', 'Muéstrame los pedidos por confirmar'],
  },
  logistica: {
    nombre: 'Envíos y paquetería',
    rubro: 'envíos y paquetería',
    reglas: [],
    primero: `Envíos y paquetería ${TRAE} tus tarifas, cada una con su precio y lo que cobra (por ejemplo, por kilo a cada destino), cuánto demora cada envío y qué no transportas. Las guardo como tus productos. Respondo con las tarifas que me des: todavía no calculo un total por peso.`,
    alAbrir: ['Muéstrame mis productos con su precio en una Sección', 'Quiero ver cuántas conversaciones tengo por día'],
  },
  agenda: {
    nombre: 'Servicios con agenda',
    rubro: 'servicios con agenda',
    reglas: [],
    primero: `Servicios con agenda ${TRAE} tus servicios con su precio y tu horario. Propongo una hora libre, guardo la cita cuando el Cliente la acepta y la ves en Agenda, con quien la pidió. No mando recordatorios ni cobro por la cita.`,
    alAbrir: ['Muéstrame quién me escribió esta semana', 'Quiero ver cuántas conversaciones tengo por día'],
  },
}

/** La parte del Hilo que dice de qué plantilla parte. El modelo no la ve: lee el texto que la acompaña. */
export const PARTE_DE_PLANTILLA = 'data-plantilla'

export function plantillaDelHilo(mensajes: readonly UIMessage[]): IdDePlantilla | null {
  for (const m of mensajes) {
    for (const p of m.parts) {
      if (p.type !== PARTE_DE_PLANTILLA) continue
      const id = (p as { data?: { id?: unknown } }).data?.id
      if (esIdDePlantilla(id)) return id
    }
  }
  return null
}
