import type { LanguageModelUsage } from 'ai'
import { costoUsd, modelo } from '@/lib/modelo'

/** Se usa en el generador y en los avisos, que piden objetos con esquema. */
export const modeloEstructurado = modelo

/** Lo que gastó un Cambio: tokens, costo y milisegundos de modelo. */
export type Medida = { entrada: number; salida: number; costo: number; ms: number }

export const MEDIDA_VACIA: Medida = { entrada: 0, salida: 0, costo: 0, ms: 0 }

export function sumar(a: Medida, b: Medida): Medida {
  return { entrada: a.entrada + b.entrada, salida: a.salida + b.salida, costo: a.costo + b.costo, ms: a.ms + b.ms }
}

export function medidaDeUso(uso: LanguageModelUsage, ms: number): Medida {
  const entrada = uso.inputTokens ?? 0
  const salida = uso.outputTokens ?? 0
  return { entrada, salida, costo: costoUsd(entrada, salida), ms }
}
