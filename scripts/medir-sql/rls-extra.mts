/** Qué tan firme es el segundo anillo si el validador dejara pasar set_config: SET LOCAL ROLE contra un rol con login propio. */
import '../medir/entorno.mts'
import { neon } from '@neondatabase/serverless'
import { randomBytes } from 'node:crypto'
const owner = neon(process.env.DATABASE_URL!)
const A = (await owner.query(`select id from negocios where codigo='SQL10K'`))[0].id as string
const B = (await owner.query(`select id from negocios where codigo='SQL10KB'`))[0].id as string
const dir = (m: string) => console.log(m)

dir('== X1. SET LOCAL ROLE: el SELECT llama set_config(\'role\', ...) y vuelve a ser el dueño de la conexión')
{
  const q = owner
  const r = await q.transaction([q.query(`SET LOCAL ROLE amanece_consultas`), q.query(`SELECT set_config('app.negocio_id', $1, true)`, [A]), q.query(`select count(*)::int as n, count(distinct negocio_id)::int as negocios, max(current_user) as usuario from public.pedidos p, (select set_config('role', 'neondb_owner', true)) s`)], { readOnly: true }).catch((e) => [null, null, [{ error: String(e.message) }]])
  dir('   ' + JSON.stringify((r as any)[2]))
}
dir('== X2. Quitarle set_config al rol')
{
  try { await owner.query(`REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC`); dir('   REVOKE aceptado') } catch (e: any) { dir('   REVOKE rechazado: ' + e.message) }
}
dir('== X3. Un rol con login propio (sin membresía en el dueño): la misma trampa')
{
  const clave = randomBytes(18).toString('hex')
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amanece_consultas_login') THEN CREATE ROLE amanece_consultas_login LOGIN NOBYPASSRLS IN ROLE amanece_consultas; END IF; END $$`)
  await owner.query(`ALTER ROLE amanece_consultas_login WITH PASSWORD '${clave}'`)
  const u = new URL(process.env.DATABASE_URL!)
  u.username = 'amanece_consultas_login'
  u.password = clave
  const q = neon(u.toString())
  const probar = async (nombre: string, extra: string) => {
    try {
      const r = await q.transaction([q.query(`SELECT set_config('app.negocio_id', $1, true)`, [A]), q.query(`select count(*)::int as n, count(distinct negocio_id)::int as negocios, current_user as usuario from public.pedidos p${extra}`)], { readOnly: true })
      dir(`   ${nombre}: ${JSON.stringify((r as any)[1])}`)
    } catch (e: any) { dir(`   ${nombre}: error ${e.message}`) }
  }
  await probar('base (rol con login, sin SET ROLE)', '')
  await probar("set_config('role','neondb_owner')", `, (select set_config('role', 'neondb_owner', true)) s`)
  await probar("set_config('app.negocio_id', B) dentro del SELECT", `, (select set_config('app.negocio_id', '${B}', true)) s`)
  await owner.query(`DROP OWNED BY amanece_consultas_login`).catch(() => {})
  await owner.query(`DROP ROLE amanece_consultas_login`).then(() => dir('   rol de prueba borrado'))
}
process.exit(0)
