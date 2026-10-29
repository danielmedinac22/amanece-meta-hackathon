import { config } from 'dotenv'
config({ path: '.env.local', quiet: true, override: true })
import { Pool, neonConfig } from '@neondatabase/serverless'
console.log('WebSocket global:', typeof WebSocket)
const pool = new Pool({ connectionString: process.env.DATABASE_URL! })
const c = await pool.connect()
await c.query('begin')
console.log((await c.query('select 1 as x')).rows)
await c.query('rollback')
c.release(); await pool.end()
