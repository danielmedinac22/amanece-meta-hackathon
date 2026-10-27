import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as esquema from './esquema'

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema: esquema })
export { esquema }
