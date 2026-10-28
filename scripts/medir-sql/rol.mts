import '../medir/entorno.mts'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
const q = neon(process.env.DATABASE_URL!)
const texto = readFileSync(new URL('./rol.sql', import.meta.url), 'utf8')
const sentencias = texto.split(/;\s*\n/).map((s) => s.trim().replace(/;$/, '')).filter(Boolean).reduce<string[]>((acc, s) => (acc.length && acc[acc.length - 1].startsWith('DO $$') && !acc[acc.length - 1].endsWith('$$') ? ((acc[acc.length - 1] += ';\n' + s), acc) : (acc.push(s), acc)), [])
const res = await q.transaction(sentencias.map((s) => q.query(s)))
console.log(`${sentencias.length} sentencias ejecutadas en una transacción`)
console.log(await q.query(`select rolname, rolbypassrls, rolsuper, rolinherit from pg_roles where rolname='amanece_consultas'`))
console.log(await q.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`))
console.log(await q.query(`select tablename, policyname, roles, cmd, qual from pg_policies where schemaname='public' order by 1`))
console.log(await q.query(`select pg_has_role('neondb_owner','amanece_consultas','member') as miembro, pg_has_role('neondb_owner','amanece_consultas','usage') as usa_herencia, (select set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname='amanece_consultas' and u.rolname='neondb_owner') as set_option`))
process.exit(0)
