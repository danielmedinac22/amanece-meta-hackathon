/**
 * Le da login a `amanece_consultas`, con una contraseña nueva cada vez, y escribe `DATABASE_URL_CONSULTAS` en el archivo
 * de entorno que recibe. Corre como el dueño, con el `DATABASE_URL` de ese mismo archivo. Correrlo otra vez rota la
 * contraseña y reescribe la línea. Nunca imprime la contraseña ni la URL.
 *
 *   pnpm tsx scripts/rol-de-consultas.mts .env.local
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { parse } from 'dotenv'

const archivo = process.argv[2]
if (!archivo) {
  console.error('Falta el archivo de entorno: pnpm tsx scripts/rol-de-consultas.mts .env.local')
  process.exit(1)
}

const contenido = readFileSync(archivo, 'utf8')
const delDueno = parse(contenido).DATABASE_URL
if (!delDueno) {
  console.error(`${archivo} no trae DATABASE_URL`)
  process.exit(1)
}

const clave = randomBytes(32).toString('base64url')
try {
  const q = neon(delDueno)
  const [rol] = (await q.query(
    `select r.rolbypassrls as bypass, r.rolsuper as superusuario, (select count(*)::int from pg_auth_members m where m.member = r.oid) as pertenece_a from pg_roles r where r.rolname = 'amanece_consultas'`,
  )) as { bypass: boolean; superusuario: boolean; pertenece_a: number }[]
  if (!rol) throw new Error('amanece_consultas no existe: corre primero la migración 0004')
  if (rol.bypass || rol.superusuario) throw new Error('amanece_consultas tiene BYPASSRLS o es superusuario')
  if (rol.pertenece_a > 0) throw new Error('amanece_consultas pertenece a otro rol')

  // Por parámetro y con `DO`: ni el texto de la sentencia ni `pg_stat_statements` (track = top) llevan la contraseña.
  await q.transaction((t) => [
    t.query(`select set_config('amanece.clave_nueva', $1, true)`, [clave]),
    t.query(`do $$ begin execute format('ALTER ROLE amanece_consultas LOGIN PASSWORD %L', current_setting('amanece.clave_nueva')); end $$`),
  ])

  const url = new URL(delDueno)
  url.username = 'amanece_consultas'
  url.password = clave
  const lineas = contenido.split('\n').filter((l) => !l.startsWith('DATABASE_URL_CONSULTAS=') && l !== '')
  const temporal = `${archivo}.${process.pid}`
  writeFileSync(temporal, `${[...lineas, `DATABASE_URL_CONSULTAS=${url}`].join('\n')}\n`, { mode: 0o600 })
  renameSync(temporal, archivo)
  console.log(`listo: ${url.host}`)
} catch (e) {
  console.error(`no se pudo: ${(e instanceof Error ? e.message : String(e)).replaceAll(clave, '***')}`)
  process.exit(1)
}
