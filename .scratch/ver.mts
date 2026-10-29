import { config } from 'dotenv'
config({ path: '.env.local', quiet: true, override: true })
import { neon } from '@neondatabase/serverless'
const q = neon(process.env.DATABASE_URL!)
console.log(await q`select current_user, version()`)
console.log(await q`select table_name from information_schema.tables where table_schema='public' order by 1`)
console.log(await q`select rolname, rolbypassrls, rolsuper from pg_roles where rolname !~ '^pg_' order by 1`)
console.log(await q`select count(*)::int n from negocios`)
