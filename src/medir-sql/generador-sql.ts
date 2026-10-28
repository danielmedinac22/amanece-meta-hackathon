import { generateText, Output } from 'ai'
import { z } from 'zod'
import { modelo } from '@/lib/modelo'
import { textoDelCatalogo } from './catalogo'
import { FORMA_TEXTO } from './peticiones'
import type { Forma } from './validar'

export const esquemaSql = z.object({
  decision: z.enum(['consulta', 'no_se_puede']).describe('consulta si el catálogo alcanza para responder; no_se_puede si falta un dato'),
  sql: z.string().describe('La consulta SELECT de Postgres. Vacío si decision es no_se_puede'),
  en_palabras: z.string().describe('Una frase en español que dice qué cuenta la consulta, con la ventana de tiempo que usó'),
  motivo: z.enum(['ninguno', 'dato_inexistente', 'fuera_de_la_lista']).describe('ninguno si hay consulta; dato_inexistente si el catálogo no trae el dato; fuera_de_la_lista si lo pedido no es una consulta de datos'),
  falta: z.string().describe('Si no_se_puede, qué dato falta. Vacío si hay consulta'),
})
export type SalidaSql = z.infer<typeof esquemaSql>

export function promptSql(texto: string, forma: Forma, intento?: { sql: string; error: string }) {
  const partes = [
    `Escribes la consulta SQL de un Indicador o una Sección para el Panel de un Negocio de venta contra entrega. Solo ves un catálogo (nombres, columnas, descripciones y lo que cada fuente NO trae). No ves filas.`,
    textoDelCatalogo(),
    `Reglas de la consulta:
- Una sola sentencia SELECT de Postgres (puede empezar con WITH). Sin punto y coma al final.
- Lee solo las fuentes del catálogo, por su nombre y sin esquema, con las columnas que el catálogo lista.
- Las fuentes ya vienen filtradas al Negocio: no filtres por Negocio.
- Forma de la salida: ${FORMA_TEXTO[forma.tipo]}.
${process.env.SIN_INSTRUCCION_DE_DECLINAR === '1' ? '' : `- No inventes datos. Si el pedido necesita algo que el catálogo dice que NO trae, o que no aparece en el catálogo, no escribas una consulta que lo aproxime: responde decision = "no_se_puede", motivo = "dato_inexistente", y en "falta" di qué dato falta.
`}- Si el pedido no dice cuántos días mirar, elige lo más natural para el Dueño y dilo en en_palabras.`,
    `Lo que pidió el Dueño: ${texto}`,
  ]
  if (intento) partes.push(`Tu intento anterior falló. Corrígelo y entrega la consulta completa.\nConsulta anterior:\n${intento.sql}\nError:\n${intento.error}`)
  return partes.join('\n\n')
}

export async function generarSql(texto: string, forma: Forma, intento?: { sql: string; error: string }) {
  const r = await generateText({ model: modelo, reasoning: 'low', output: Output.object({ schema: esquemaSql }), prompt: promptSql(texto, forma, intento) })
  return { salida: r.output, uso: r.totalUsage }
}
