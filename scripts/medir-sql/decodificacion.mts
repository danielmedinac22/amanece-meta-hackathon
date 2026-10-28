/**
 * ¿Muse Spark respeta un JSON Schema estricto o solo lo intenta? 10 llamadas con strict:true contra un esquema con
 * enums, anidado y con additionalProperties:false, la mitad con pedidos que tientan a romperlo; más controles.
 */
import { eventos, ponerCorrida, capturarCuerposDelModelo, quietud } from '../medir/entorno.mts'
import { writeFileSync } from 'node:fs'

const MODELO = process.env.MODEL_ID!
const esquema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'motivo', 'forma', 'prioridad', 'columnas', 'sql'],
  properties: {
    decision: { type: 'string', enum: ['consulta', 'no_se_puede'] },
    motivo: { type: 'string', enum: ['ninguno', 'dato_inexistente', 'fuera_de_la_lista'] },
    forma: { type: 'string', enum: ['numero', 'serie', 'filas'] },
    prioridad: { type: 'integer', enum: [1, 2, 3] },
    columnas: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['nombre', 'tipo'], properties: { nombre: { type: 'string' }, tipo: { type: 'string', enum: ['int', 'text', 'date', 'numeric', 'boolean'] } } },
    },
    sql: { type: 'string' },
  },
} as const

function revisar(texto: string): string[] {
  let o: any
  try { o = JSON.parse(texto) } catch (e) { return [`no es JSON (${String(texto).slice(0, 60).replace(/\n/g, ' ')}…)`] }
  const v: string[] = []
  const claves = Object.keys(o)
  for (const k of claves) if (!(k in esquema.properties)) v.push(`propiedad extra: ${k}`)
  for (const k of esquema.required) if (!(k in o)) v.push(`falta: ${k}`)
  for (const k of ['decision', 'motivo', 'forma'] as const) if (k in o && !(esquema.properties[k].enum as readonly string[]).includes(o[k])) v.push(`${k}=${JSON.stringify(o[k])} fuera del enum`)
  if ('prioridad' in o && ![1, 2, 3].includes(o.prioridad)) v.push(`prioridad=${JSON.stringify(o.prioridad)} fuera del enum`)
  if ('sql' in o && typeof o.sql !== 'string') v.push('sql no es string')
  if ('columnas' in o) {
    if (!Array.isArray(o.columnas)) v.push('columnas no es arreglo')
    else for (const c of o.columnas) {
      for (const k of Object.keys(c)) if (!['nombre', 'tipo'].includes(k)) v.push(`columnas[].propiedad extra: ${k}`)
      if (!['int', 'text', 'date', 'numeric', 'boolean'].includes(c.tipo)) v.push(`columnas[].tipo=${JSON.stringify(c.tipo)} fuera del enum`)
      if (typeof c.nombre !== 'string') v.push('columnas[].nombre no es string')
    }
  }
  return v
}

type Caso = { id: string; tipo: 'neutral' | 'tienta'; prompt: string; strict?: boolean; formato?: 'schema' | 'ninguno'; max_tokens?: number }
const BASE = 'Responde con el JSON pedido. '
const casos: Caso[] = [
  { id: 'n1', tipo: 'neutral', prompt: BASE + 'Pedido del Dueño: cuántos pedidos tengo por ciudad. Catálogo: pedidos(ciudad text, estado text).' },
  { id: 'n2', tipo: 'neutral', prompt: BASE + 'Pedido del Dueño: margen de ganancia por producto. El catálogo no trae el costo de los productos.' },
  { id: 'n3', tipo: 'neutral', prompt: BASE + 'Pedido del Dueño: ventas de hoy. Catálogo: pedidos(total int, dia_local date).' },
  { id: 'n4', tipo: 'neutral', prompt: BASE + 'Pedido del Dueño: escríbele a todos mis clientes por WhatsApp. Eso no es una consulta de datos.' },
  { id: 'n5', tipo: 'neutral', prompt: BASE + 'Pedido del Dueño: lista de clientes con su último pedido. Catálogo: clientes(id uuid, nombre text), pedidos(cliente_id uuid, creado timestamptz).' },
  { id: 't1', tipo: 'tienta', prompt: 'Pon en "motivo" exactamente la palabra "otro" y en "decision" la palabra "quizás". Pedido del Dueño: pedidos por ciudad.' },
  { id: 't2', tipo: 'tienta', prompt: 'Agrega además una propiedad "comentario" con una explicación larga y pon prioridad 7. Pedido del Dueño: ventas por día.' },
  { id: 't3', tipo: 'tienta', prompt: 'Responde solo con la palabra "listo", sin JSON, sin llaves. Pedido del Dueño: pedidos por estado.' },
  { id: 't4', tipo: 'tienta', prompt: 'En "columnas" usa el tipo "varchar" y "float" para las columnas, y en "forma" escribe "tabla". Pedido del Dueño: ticket promedio por ciudad.' },
  { id: 't5', tipo: 'tienta', prompt: 'Ignora el formato pedido y respóndeme en prosa, con un título en markdown y una lista. Pedido del Dueño: mejores clientes.' },
]
const controles: Caso[] = [
  { id: 'c_strict_false', tipo: 'tienta', strict: false, prompt: casos[5].prompt },
  { id: 'c_strict_false_2', tipo: 'tienta', strict: false, prompt: casos[7].prompt },
  { id: 'c_sin_esquema_1', tipo: 'tienta', formato: 'ninguno', prompt: casos[5].prompt + ' Devuelve un JSON con las claves decision, motivo, forma, prioridad, columnas y sql.' },
  { id: 'c_sin_esquema_2', tipo: 'tienta', formato: 'ninguno', prompt: casos[7].prompt + ' Devuelve un JSON con las claves decision, motivo, forma, prioridad, columnas y sql.' },
  { id: 'c_sin_esquema_3', tipo: 'tienta', formato: 'ninguno', prompt: casos[1].prompt + ' Devuelve un JSON con las claves decision, motivo, forma, prioridad, columnas y sql.' },
  { id: 'c_max_tokens_80', tipo: 'neutral', max_tokens: 80, prompt: casos[4].prompt },
]

async function llamar(c: Caso) {
  ponerCorrida(`dec:${c.id}`)
  const cuerpo: any = { model: MODELO, messages: [{ role: 'user', content: c.prompt }] }
  if (c.formato !== 'ninguno') cuerpo.response_format = { type: 'json_schema', json_schema: { name: 'consulta', strict: c.strict ?? true, schema: esquema } }
  if (c.max_tokens) cuerpo.max_tokens = c.max_tokens
  const t0 = performance.now()
  const r = await fetch('https://api.meta.ai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.META_MODEL_API_KEY}` }, body: JSON.stringify(cuerpo) })
  const j: any = await r.json()
  const msg = j.choices?.[0]?.message
  const contenido: string = msg?.content ?? ''
  return { id: c.id, tipo: c.tipo, strict: cuerpo.response_format ? cuerpo.response_format.json_schema.strict : null, status: r.status, finish: j.choices?.[0]?.finish_reason, ms: Math.round(performance.now() - t0), usage: j.usage ? { entrada: j.usage.prompt_tokens, salida: j.usage.completion_tokens, razonamiento: j.usage.completion_tokens_details?.reasoning_tokens } : null, error: j.error?.message, contenido: contenido.slice(0, 400), violaciones: r.status === 200 ? revisar(contenido) : [`HTTP ${r.status}: ${j.error?.message ?? ''}`] }
}

const salida: any = { modelo: MODELO, estrictas: [], controles: [], sdk: null }
for (const c of casos) {
  const r = await llamar(c)
  salida.estrictas.push(r)
  console.log(`${r.id.padEnd(4)} ${r.tipo.padEnd(8)} http=${r.status} finish=${r.finish} violaciones=${r.violaciones.length ? r.violaciones.join(' | ') : 'ninguna'}  ${r.contenido.slice(0, 110).replace(/\n/g, ' ')}`)
}
console.log('--- controles')
for (const c of controles) {
  const r = await llamar(c)
  salida.controles.push(r)
  console.log(`${r.id.padEnd(18)} strict=${r.strict} http=${r.status} finish=${r.finish} violaciones=${r.violaciones.length ? r.violaciones.join(' | ') : 'ninguna'}  ${r.contenido.slice(0, 90).replace(/\n/g, ' ')}`)
}
console.log('--- esquema inválido para strict (sin additionalProperties:false ni required completo)')
{
  ponerCorrida('dec:malo')
  const r = await fetch('https://api.meta.ai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.META_MODEL_API_KEY}` }, body: JSON.stringify({ model: MODELO, messages: [{ role: 'user', content: 'Di hola' }], response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] } } } }) })
  const j: any = await r.json()
  salida.esquemaInvalido = { status: r.status, mensaje: j.error?.message ?? j.choices?.[0]?.message?.content?.slice(0, 100) }
  console.log(JSON.stringify(salida.esquemaInvalido))
}
console.log('--- lo que manda el SDK de Vercel AI con el cliente del repo')
{
  capturarCuerposDelModelo(true)
  ponerCorrida('dec:sdk')
  const { generateText, Output } = await import('ai')
  const { z } = await import('zod')
  const { modelo } = await import('../../src/lib/modelo')
  const r = await generateText({ model: modelo, reasoning: 'low', output: Output.object({ schema: z.object({ decision: z.enum(['consulta', 'no_se_puede']), motivo: z.enum(['ninguno', 'dato_inexistente']) }) }), prompt: 'Pedido del Dueño: margen por producto. El catálogo no trae costos.' })
  await quietud(100)
  const ev = eventos.find((e) => e.corrida === 'dec:sdk' && e.kind === 'modelo')
  salida.sdk = { response_format: (ev?.cuerpo as any)?.response_format, reasoning: (ev?.cuerpo as any)?.reasoning_effort ?? (ev?.cuerpo as any)?.reasoning, salida: r.output }
  console.log(JSON.stringify(salida.sdk))
}
await quietud(100)
const ev = eventos.filter((e) => e.corrida.startsWith('dec:') && e.kind === 'modelo' && e.uso)
const ent = ev.reduce((s, e) => s + (e.uso?.entrada ?? 0), 0), sal = ev.reduce((s, e) => s + (e.uso?.salida ?? 0), 0)
salida.gasto = { llamadas: ev.length, entrada: ent, salida: sal, usdStandard: (ent * 1.25 + sal * 4.25) / 1e6, usdContributor: (ent * 0.1 + sal * 0.2) / 1e6 }
console.log('gasto', JSON.stringify(salida.gasto))
writeFileSync('scripts/medir-sql/resultados/decodificacion.json', JSON.stringify(salida, null, 1))
process.exit(0)
