import { config } from 'dotenv'
config({ path: '.env.local', quiet: true, override: true })
import { neon } from '@neondatabase/serverless'
const q = neon(process.env.DATABASE_URL!)
await Promise.all(Array.from({ length: 300 }, () => q.query('select 1')))
for (const n of [20, 50, 100, 200, 400]) {
  const t0 = performance.now()
  await Promise.all(Array.from({ length: n }, () => q.query('select pg_sleep(0.5)')))
  console.log(n, 'sleep(0.5) simultáneos:', Math.round(performance.now() - t0), 'ms')
}
// y con lotes
for (const n of [50, 200]) {
  const t0 = performance.now()
  await Promise.all(Array.from({ length: n }, () => q.transaction([q.query('select pg_sleep(0.5)')])))
  console.log(n, 'lotes sleep(0.5):', Math.round(performance.now() - t0), 'ms')
}
