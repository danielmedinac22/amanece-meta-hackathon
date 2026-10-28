/** Segunda vía para atar al Negocio: el Pool por WebSocket de @neondatabase/serverless (transacción interactiva). */
import '../medir/entorno.mts'
import { Pool, neonConfig, neon } from '@neondatabase/serverless'

const owner = neon(process.env.DATABASE_URL!)
const A = (await owner.query(`select id from negocios where codigo='SQL10K'`))[0].id as string
const B = (await owner.query(`select id from negocios where codigo='SQL10KB'`))[0].id as string
console.log('WebSocket global en Node:', typeof WebSocket, '| neonConfig.webSocketConstructor:', neonConfig.webSocketConstructor ? 'definido' : 'sin definir')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
async function comoRol(negocio: string, texto: string) {
  const t0 = performance.now()
  const c = await pool.connect()
  try {
    await c.query('BEGIN READ ONLY')
    await c.query('SET LOCAL ROLE amanece_consultas')
    await c.query(`SELECT set_config('app.negocio_id', $1, true)`, [negocio])
    await c.query(`SET LOCAL statement_timeout = '2s'`)
    const r = await c.query(texto)
    await c.query('COMMIT')
    return { ok: true, filas: r.rows, ms: Math.round(performance.now() - t0) }
  } catch (e: any) {
    await c.query('ROLLBACK').catch(() => {})
    return { ok: false, error: e.message, ms: Math.round(performance.now() - t0) }
  } finally {
    c.release()
  }
}
const a = await comoRol(A, `select count(*)::int as n, count(distinct negocio_id)::int as negocios, current_user as usuario from public.pedidos`)
const b = await comoRol(B, `select count(*)::int as n, count(distinct negocio_id)::int as negocios from public.pedidos`)
const aVeB = await comoRol(A, `select count(*)::int as n from public.pedidos where negocio_id = '${B}'`)
const lento = await comoRol(A, `select pg_sleep(5)`)
console.log('A ve:', JSON.stringify(a))
console.log('B ve:', JSON.stringify(b))
console.log('A pide filas de B:', JSON.stringify(aVeB))
console.log('pg_sleep(5) con tope 2 s:', JSON.stringify(lento))
await pool.end()
process.exit(0)
