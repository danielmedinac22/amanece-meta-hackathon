/** Mide con una llamada real si el modelo lee un archivo, y cuánto cuesta. Uso: pnpm tsx scripts/medir-adjuntos.mts <ruta> [<ruta>...]; sin rutas, el control sin archivo. */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { config } from 'dotenv'
import { generateText, type UserContent } from 'ai'

config({ path: '.env.local', quiet: true })
const { modelo, MODELO_ID, costoUsd } = await import('../src/lib/modelo')

const TIPOS: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.webp': 'image/webp' }
const PREGUNTA = 'Copia los productos y precios que trae el archivo adjunto. Si no puedes ver ningún archivo, responde exactamente NO_VEO_ARCHIVO.'

async function medir(ruta: string | null) {
  const content: UserContent = [{ type: 'text', text: PREGUNTA }]
  const bytes = ruta ? readFileSync(ruta) : null
  if (ruta && bytes) content.push({ type: 'file', data: bytes, mediaType: TIPOS[extname(ruta)] })
  const inicio = Date.now()
  try {
    const r = await generateText({ model: modelo, messages: [{ role: 'user', content }] })
    const { inputTokens = 0, outputTokens = 0 } = r.usage
    console.log(JSON.stringify({ ruta, bytes: bytes?.length ?? 0, ms: Date.now() - inicio, modelo: MODELO_ID, inputTokens, outputTokens, usd: costoUsd(inputTokens, outputTokens), usdStandard: costoUsd(inputTokens, outputTokens, 'muse-spark-1.3'), texto: r.text }))
  } catch (e) {
    const { statusCode, responseBody, message } = e as { statusCode?: number; responseBody?: string; message: string }
    console.log(JSON.stringify({ ruta, fallo: message, statusCode, responseBody: responseBody?.slice(0, 500) }))
  }
}

for (const ruta of process.argv.length > 2 ? process.argv.slice(2) : [null]) await medir(ruta)
