import { config } from 'dotenv'
import { generateText, tool, isStepCount } from 'ai'
import { z } from 'zod'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
const { modelo, MODELO_ID } = await import('../src/lib/modelo')

try {
  const inicio = Date.now()
  const r = await generateText({
    model: modelo,
    system: 'Eres el agente de clientes de Café Ladera. Responde en español, breve.',
    prompt: '¿Cuánto vale la libra de café de tueste medio?',
    tools: {
      buscar_productos: tool({
        description: 'Busca productos del catálogo por texto',
        inputSchema: z.object({ texto: z.string() }),
        execute: async ({ texto }) => [{ nombre: 'Café Ladera tueste medio, 500 g', precio: 38000, moneda: 'COP', texto }],
      }),
    },
    stopWhen: isStepCount(4),
  })
  console.log(MODELO_ID, `${Date.now() - inicio} ms`)
  const herramientas = r.steps.map((s) => s.toolCalls.map((c) => c.toolName)).flat()
  console.log(herramientas)
  console.log(r.text)
  console.log(r.totalUsage)

  afirmar('llamó a buscar_productos', herramientas.includes('buscar_productos'), herramientas)
  afirmar('respondió con texto', r.text.trim().length > 0, r.text)
  afirmar('el uso reporta tokens de entrada y de salida', (r.totalUsage.inputTokens ?? 0) > 0 && (r.totalUsage.outputTokens ?? 0) > 0, r.totalUsage)
} catch (e) {
  afirmar('probar-modelo terminó sin error inesperado', false, e)
} finally {
  terminar()
}
