import '../medir/entorno.mts'
import { neon } from '@neondatabase/serverless'
const q = neon(process.env.DATABASE_URL!)
const A = (await q.query(`select id from negocios where codigo='SQL10K'`))[0].id as string
const B = (await q.query(`select id from negocios where codigo='SQL10KB'`))[0].id as string
const log = (m: string, x?: unknown) => console.log(m, x === undefined ? '' : JSON.stringify(x).slice(0, 300))
log('privilegios tras el REVOKE', await q.query(`select has_function_privilege('neondb_owner','pg_catalog.set_config(text,text,boolean)','execute') as owner, has_function_privilege('amanece_consultas','pg_catalog.set_config(text,text,boolean)','execute') as consultas, (select proacl::text from pg_proc where proname='set_config') as acl`))
try { await q.query(`GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO neondb_owner`); log('GRANT al dueño de la conexión: aceptado') } catch (e: any) { log('GRANT rechazado: ' + e.message) }
log('privilegios', await q.query(`select has_function_privilege('neondb_owner','pg_catalog.set_config(text,text,boolean)','execute') as owner, has_function_privilege('amanece_consultas','pg_catalog.set_config(text,text,boolean)','execute') as consultas`))
const atado = async (extra: string) => {
  try {
    const r = await q.transaction([q.query(`SELECT set_config('app.negocio_id', $1, true)`, [A]), q.query(`SET LOCAL ROLE amanece_consultas`), q.query(`SET LOCAL statement_timeout = '2s'`), q.query(`select count(*)::int as n, count(distinct negocio_id)::int as negocios from public.pedidos p${extra}`)], { readOnly: true })
    return (r as any)[3]
  } catch (e: any) { return { error: e.message } }
}
log('orden nuevo (set_config como dueño, luego SET LOCAL ROLE): consulta normal', await atado(''))
log('orden nuevo: el SELECT intenta set_config(app.negocio_id, B)', await atado(`, (select set_config('app.negocio_id', '${B}', true)) s`))
log('orden nuevo: el SELECT intenta set_config(role, neondb_owner)', await atado(`, (select set_config('role', 'neondb_owner', true)) s`))
// ¿rompe a los demás? la app normal usa neondb_owner
log('el dueño de la conexión sigue funcionando', await q.query(`select set_config('app.x','1',true) as ok`))
process.exit(0)
