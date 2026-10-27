import type { LanguageModelUsage } from 'ai'
import { db, esquema } from '@/db'
import { costoUsd, MODELO_ID } from '@/lib/modelo'

/** Guarda tokens, costo y latencia de un turno de agente. La medición vuelve al mapa de Amanece. */
export async function registrarTurno(
  agente: 'clientes' | 'dueno' | 'generador',
  negocioId: string | null,
  uso: LanguageModelUsage,
  ms: number,
) {
  const entrada = uso.inputTokens ?? 0
  const salida = uso.outputTokens ?? 0
  const costo = costoUsd(entrada, salida)
  await db.insert(esquema.turnos).values({ agente, negocioId, modelo: MODELO_ID, tokensEntrada: entrada, tokensSalida: salida, costoUsd: costo, ms })
  return { entrada, salida, costo }
}
