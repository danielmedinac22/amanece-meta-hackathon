import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/** Los modelos de Meta por su API compatible con OpenAI. */
const meta = createOpenAICompatible({
  name: 'meta',
  baseURL: 'https://api.meta.ai/v1',
  apiKey: process.env.META_MODEL_API_KEY,
  includeUsage: true,
  // Muse Spark acepta `json_schema`; sin esto el SDK manda `json_object` y deja el esquema fuera.
  supportsStructuredOutputs: true,
})

/** `muse-spark-1.3-contributor` mientras probamos; `muse-spark-1.3` cuando lo prueben personas. */
export const MODELO_ID = process.env.MODEL_ID ?? 'muse-spark-1.3-contributor'

export const modelo = meta(MODELO_ID)

/** USD por millón de tokens. El plan Standard; el Contributor es mucho más barato. */
const PRECIOS: Record<string, { entrada: number; salida: number }> = {
  'muse-spark-1.3': { entrada: 1.25, salida: 4.25 },
  'muse-spark-1.3-contributor': { entrada: 0.1, salida: 0.2 },
}

export function costoUsd(tokensEntrada: number, tokensSalida: number, modeloId = MODELO_ID) {
  const p = PRECIOS[modeloId] ?? PRECIOS['muse-spark-1.3']
  return (tokensEntrada * p.entrada + tokensSalida * p.salida) / 1_000_000
}
