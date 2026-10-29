import { config } from 'dotenv'
config({ path: '.env.local', quiet: true, override: true })
import { neon } from '@neondatabase/serverless'
const q = neon(process.env.DATABASE_URL!)
console.log(await q`select current_setting('max_connections') mc, current_setting('shared_buffers') sb, current_setting('neon.max_cluster_size', true) ms`)
console.log(await q`show max_connections`)
