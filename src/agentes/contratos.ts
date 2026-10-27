/**
 * Contratos entre el Agente de clientes y el Agente del dueño. Cada lado vive en su archivo; aquí solo
 * van las formas que cruzan de uno a otro.
 */
import type { LanguageModelUsage } from 'ai'

export type TurnoDeCliente = { rol: 'cliente' | 'agente'; texto: string }

export type EntradaAgenteDeClientes = {
  negocioId: string
  /** `null` en simulación: no hay Cliente real. */
  clienteId: string | null
  historial: TurnoDeCliente[]
  texto: string
  /** En `simulacion` las herramientas no escriben en la base ni mandan nada por WhatsApp. */
  modo: 'real' | 'simulacion'
  /** Reglas que todavía no están aplicadas, para la vista previa de un Cambio. */
  reglasPropuestas?: string[]
}

export type SalidaAgenteDeClientes = {
  texto: string
  /** Nombres de las herramientas que usó, en orden. */
  herramientas: string[]
  uso: LanguageModelUsage
  ms: number
}
