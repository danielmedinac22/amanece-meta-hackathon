/** Pura y sin servidor: el navegador la corre con los mensajes en vivo. El paso sale de lo que se sabe, nunca del tiempo. */
import type { UIMessage } from 'ai'
import type { DatosDelArmado } from './armado'

export type PasoDelArmado = 'conociendo' | 'leyendo' | 'confirmar' | 'cobro' | 'listo'

const faltaCobrar = (d: DatosDelArmado) => d.filas.some((f) => f.dato === 'Cómo cobras' && f.estado === 'falta')

/**
 * Lo que se está leyendo gana a todo. Después, lo que espera el botón; luego lo que bloquea abrir. Cómo cobra solo avisa,
 * así que el Dueño puede dejarlo para después.
 */
export function pasoDelArmado(d: DatosDelArmado, ahora: { readonly leyendo: boolean; readonly pospusoElCobro: boolean }): PasoDelArmado {
  if (ahora.leyendo) return 'leyendo'
  if (d.lectura) return 'confirmar'
  if (d.faltaParaAbrir.length) return 'conociendo'
  return faltaCobrar(d) && !ahora.pospusoElCobro ? 'cobro' : 'listo'
}

export function titularDe(paso: PasoDelArmado, d: DatosDelArmado): string {
  switch (paso) {
    case 'leyendo':
      return 'Estoy leyendo tu negocio.'
    case 'confirmar':
      return d.lectura?.productos ? '¿Están bien estos productos?' : '¿Está bien lo que leí?'
    case 'cobro':
      return d.filas.filter((f) => f.estado === 'falta').length === 1 ? 'Solo me falta una cosa.' : 'Me falta saber cómo te pagan.'
    case 'listo':
      return `${d.nombre} puede abrir.`
    case 'conociendo':
      if (d.nombre) return '¿Qué vendes y a qué precio?'
      return d.filas.some((f) => f.dato === 'Productos' && f.estado === 'sabido') ? '¿Cómo se llama tu negocio?' : 'Cuéntame de tu negocio.'
  }
}

/**
 * Con lo que `Corregir` empieza el mensaje. Sin cifras ni datos de la tarjeta: lo que el Dueño envía cuenta como escrito
 * por él (`numerosDelDueno`), y un precio leído que viajara aquí quedaría guardado sin pasar por el botón.
 */
export const EMPIEZA_A_CORREGIR = 'Corrige lo que leíste: '

type ParteDeHerramienta = { readonly type: string; readonly state?: string; readonly output?: unknown }
const partes = (mensajes: readonly UIMessage[]) => mensajes.flatMap((m) => (m.role === 'assistant' ? (m.parts as readonly ParteDeHerramienta[]) : []))

/** El agente tiene un enlace en las manos: la herramienta arrancó y todavía no devuelve. */
const LEEN = new Set(['tool-leer_enlace', 'tool-leer_archivo'])

export const estaLeyendo = (mensajes: readonly UIMessage[]) => partes(mensajes).some((p) => LEEN.has(p.type) && !!p.state?.startsWith('input'))

/** El agente ya abrió el Negocio con su herramienta. */
export const abrioElAgente = (mensajes: readonly UIMessage[]) => partes(mensajes).some((p) => p.type === 'tool-abrir_negocio' && p.state === 'output-available' && (p.output as { ok?: unknown } | undefined)?.ok === true)

const GUARDAN = new Set([...LEEN, 'tool-guardar_conocimiento', 'tool-guardar_productos', 'tool-corregir_tarjeta'])

/** Cuántas veces ya guardó algo: cada una cambia lo que la carta sabe, aunque el turno siga. */
export const cuantoGuardo = (mensajes: readonly UIMessage[]) => partes(mensajes).filter((p) => GUARDAN.has(p.type) && p.state === 'output-available').length

/** Lo de antes y el último turno: desde lo último que dijo el Dueño. */
export function ultimoTurno(mensajes: readonly UIMessage[]): { readonly antes: readonly UIMessage[]; readonly turno: readonly UIMessage[] } {
  const i = mensajes.findLastIndex((m) => m.role === 'user')
  return i < 0 ? { antes: [], turno: mensajes } : { antes: mensajes.slice(0, i), turno: mensajes.slice(i) }
}
