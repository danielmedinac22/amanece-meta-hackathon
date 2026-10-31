import type { Alcance } from '../estado/elementos'
import { NOMBRE_TEMPORAL } from '@/negocio/alta'
import { valorDelDato, type EstadoDelNegocio } from '../estado'
import type { ModoDelNegocio } from '../identidad'

export type { Alcance }

export type Politica = 'se_aplica' | 'espera_al_dueno'

/**
 * La tabla de `tipos.ts`, en orden:
 *   con actos           → espera_al_dueno (responderle a un Cliente pide el botón)
 *   armando o en_sombra → se_aplica (no hay Clientes reales)
 *   origen panel        → se_aplica (el clic del Dueño es la aprobación)
 *   alcance panel       → se_aplica (Sección e Indicador: solo los ve el Dueño)
 *   alcance clientes    → espera_al_dueno (regla, conocimiento)
 */
export function politicaDeAprobacion(modo: ModoDelNegocio, alcance: Alcance, origen: 'hilo' | 'panel', conActos: boolean): Politica {
  if (conActos) return 'espera_al_dueno'
  if (modo === 'armando' || modo === 'en_sombra') return 'se_aplica'
  if (origen === 'panel') return 'se_aplica'
  return alcance === 'panel' ? 'se_aplica' : 'espera_al_dueno'
}

const AVISA = { ciudad: 'la ciudad', envios: 'los envíos', pagos: 'las formas de pago', horario: 'el horario' } as const

/**
 * Lo que falta para abrir el Negocio. Bloquean el nombre propio y un producto activo con precio; la ciudad, los
 * envíos, los pagos y el horario solo avisan. La voz y la zona no cuentan.
 */
export function queFaltaParaAbrir(estado: EstadoDelNegocio): { readonly bloquea: readonly string[]; readonly avisa: readonly string[] } {
  const bloquea = [
    ...(!estado.identidad.nombre.trim() || estado.identidad.nombre === NOMBRE_TEMPORAL ? ['el nombre del Negocio'] : []),
    ...(estado.vigentes('producto').some((v) => v.elemento.activo && v.elemento.precio > 0) ? [] : ['al menos un producto con su precio']),
  ]
  const avisa = (Object.keys(AVISA) as (keyof typeof AVISA)[]).filter((campo) => !valorDelDato(estado, campo)).map((campo) => AVISA[campo])
  return { bloquea, avisa }
}
