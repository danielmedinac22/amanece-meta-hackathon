import './entorno.mts'
const { db } = await import('../../src/db')
const { sql } = await import('drizzle-orm')
const r = await db.execute(sql`select dueno_id, count(*)::int as mensajes, sum(length(mensaje::text))::int as caracteres from mensajes_dueno group by 1 order by 3 desc limit 6`)
console.log(JSON.stringify(r.rows))
const t = await db.execute(sql`select agente, count(*)::int n, round(avg(tokens_entrada))::int entrada_media, round(avg(tokens_salida))::int salida_media, round(avg(ms))::int ms_medio, round(sum(costo_usd)::numeric, 4)::float usd from turnos where creado < now() - interval '2 hours' group by 1`)
console.log('turnos previos a la medición (copiados de main al crear la rama):', JSON.stringify(t.rows))
process.exit(0)
