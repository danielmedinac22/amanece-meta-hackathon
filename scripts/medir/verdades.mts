import './entorno.mts'
const { db, esquema } = await import('../../src/db')
const { eq, sql } = await import('drizzle-orm')
const [A] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
const r = await db.execute(sql`
  with c as (select cliente_id, count(*) n from pedidos where negocio_id = ${A.id} and estado in ('confirmado','enviado','entregado','novedad') and creado > now() - interval '60 days' group by 1)
  select count(*)::int as clientes_con_compra, count(*) filter (where n > 1)::int as repiten, round(100.0 * count(*) filter (where n > 1) / count(*), 1) as porcentaje from c`)
console.log('recompra 60 días (SQL):', JSON.stringify(r.rows[0]))
const cols = await db.execute(sql`select table_name, string_agg(column_name, ', ' order by ordinal_position) as columnas from information_schema.columns where table_name in ('pedidos','mensajes_cliente') group by 1`)
console.log(JSON.stringify(cols.rows, null, 1))
const fuerte = await db.execute(sql`select cliente_id, count(*)::int n, sum(total)::int total from pedidos where negocio_id = ${A.id} and estado in ('confirmado','enviado','entregado','novedad') group by 1 order by 3 desc limit 2`)
console.log('top clientes (SQL):', JSON.stringify(fuerte.rows))
process.exit(0)
