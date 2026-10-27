import 'dotenv/config'
import { generateText, tool, isStepCount } from 'ai'
import { z } from 'zod'
import { modelo, MODELO_ID } from '../src/lib/modelo'

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
console.log(r.steps.map((s) => s.toolCalls.map((c) => c.toolName)).flat())
console.log(r.text)
console.log(r.totalUsage)
