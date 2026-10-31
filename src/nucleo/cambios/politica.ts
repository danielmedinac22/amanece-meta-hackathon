import type { ModoDelNegocio } from '../identidad'

/** Si lo que se propone llega a los Clientes o solo lo ve el Dueño. El 30-oct lo declara cada tipo de Elemento. */
export type Alcance = 'clientes' | 'panel'

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
