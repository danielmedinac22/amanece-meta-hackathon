import '../medir/entorno.mts'
import { neon } from '@neondatabase/serverless'
import { PETICIONES } from '../../src/medir-sql/peticiones'
const q = neon(process.env.DATABASE_URL!)
const A = (await q.query(`select id from negocios where codigo='SQL10K'`))[0].id
for (const p of PETICIONES) {
  if (!p.verdad) { console.log(`${p.id.padEnd(26)} (declinar)`); continue }
  const t0 = performance.now()
  const filas = (await q.query(`select to_jsonb(x) as r from (${p.verdad}) x`, [A])).map((f) => f.r)
  console.log(`${p.id.padEnd(26)} ${String(filas.length).padStart(4)} filas ${(performance.now() - t0).toFixed(0)}ms  ${JSON.stringify(filas.slice(0, 3)).slice(0, 230)}`)
}
// empates en el borde de los top N
const emp = async (nombre: string, sql: string) => console.log(nombre, JSON.stringify(await q.query(sql, [A])))
await emp('empate top10 clientes', `select c.nombre, sum(p.total) t from pedidos p join clientes c on c.id=p.cliente_id where p.negocio_id=$1 and p.estado in ('confirmado','enviado','entregado','novedad') group by c.id,c.nombre order by 2 desc, 1 offset 8 limit 4`)
await emp('empate top5 pares', `with it as (select p.id pid, i->>'nombre' n from pedidos p cross join lateral jsonb_array_elements(p.items) i where p.negocio_id=$1 and p.estado in ('confirmado','enviado','entregado','novedad')) select a.n, b.n, count(*) c from it a join it b on a.pid=b.pid and a.n<b.n group by 1,2 order by 3 desc offset 3 limit 4`)
process.exit(0)
