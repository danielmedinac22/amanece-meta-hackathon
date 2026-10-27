import { eventos, HOST_DE_LA_BASE, quietud } from './entorno.mts'
const { db, esquema } = await import('../../src/db')
const { sql } = await import('drizzle-orm')
const { generateText } = await import('ai')
const { modelo, MODELO_ID } = await import('../../src/lib/modelo')
console.log('base:', HOST_DE_LA_BASE, 'modelo:', MODELO_ID)
const negocios = await db.select({ id: esquema.negocios.id, codigo: esquema.negocios.codigo, nombre: esquema.negocios.nombre, estado: esquema.negocios.estado }).from(esquema.negocios)
console.log(negocios)
for (const t of ['pedidos', 'clientes', 'mensajes_cliente', 'casos', 'reglas', 'piezas', 'cambios', 'turnos', 'duenos', 'productos']) {
  const r = await db.execute(sql.raw(`select negocio_id, count(*)::int as n from ${t} group by negocio_id`))
  console.log(t, JSON.stringify(r.rows))
}
const r = await generateText({ model: modelo, prompt: 'Di "hola" en una palabra.' })
console.log(r.text, JSON.stringify(r.totalUsage))
await quietud()
console.log(JSON.stringify(eventos.map((e) => ({ kind: e.kind, rol: e.rol, ms: Math.round(e.t1 - e.t0), ttfb: Math.round(e.ttfb - e.t0), uso: e.uso?.crudo })), null, 1))
process.exit(0)
