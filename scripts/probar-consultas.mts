/**
 * El SQL acotado sin modelo: el catálogo contra la base en los dos sentidos, el rol y sus políticas, y el validador.
 * No escribe nada.
 *
 *   pnpm tsx scripts/probar-consultas.mts
 */
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })

const { TIPOS_DE_MOTIVO } = await import('../src/db/esquema')
const { COLUMNAS, FUENTES, grantsDeConsultas, NOMBRES_DE_FUENTE, prologo } = await import('../src/nucleo/consultas/catalogo')

const q = neon(process.env.DATABASE_URL!)
const igual = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

try {
  console.log('\n=== 1. Catálogo contra la base ===')
  const privilegios = (await q.query(
    `select table_name as tabla, column_name as columna from information_schema.column_privileges where grantee = 'amanece_consultas' and privilege_type = 'SELECT' and table_schema = 'public'`,
  )) as { tabla: string; columna: string }[]
  const enLaBase = new Map<string, Set<string>>()
  for (const p of privilegios) enLaBase.set(p.tabla, (enLaBase.get(p.tabla) ?? new Set()).add(p.columna))
  const delCatalogo = grantsDeConsultas()
  afirmar('1 GRANT: las tablas con privilegio son las que lee el catálogo', igual(enLaBase.keys(), delCatalogo.keys()), { enLaBase: [...enLaBase.keys()], delCatalogo: [...delCatalogo.keys()] })
  for (const [tabla, columnas] of delCatalogo) {
    afirmar(`1 GRANT: ${tabla} tiene exactamente las columnas que lee el catálogo`, igual(enLaBase.get(tabla) ?? [], columnas), { enLaBase: [...(enLaBase.get(tabla) ?? [])], delCatalogo: [...columnas] })
  }
  const deTabla = (await q.query(`select count(*)::int as n from information_schema.table_privileges where grantee = 'amanece_consultas' and table_schema = 'public'`)) as { n: number }[]
  afirmar('1 GRANT: ningún privilegio de tabla entera', deTabla[0].n === 0, deTabla)

  const [negocio] = (await q.query(`select id, zona_horaria from negocios order by creado limit 1`)) as { id: string; zona_horaria: string }[]
  for (const f of NOMBRES_DE_FUENTE) {
    const r = await q.transaction(
      (t) => [
        t.query('RESET ALL'),
        t.query('SET LOCAL ROLE amanece_consultas'),
        t.query(`SELECT set_config('app.negocio_id', $1, true)`, [negocio.id]),
        t.query(`WITH ${prologo()}\nSELECT * FROM ${f} LIMIT 0`, [negocio.id, negocio.zona_horaria, '[]']),
      ],
      { readOnly: true, fullResults: true },
    )
    const columnas = r[3].fields.map((c) => c.name)
    afirmar(`1 CTE: ${f} da como amanece_consultas las columnas de sus campos, en orden`, JSON.stringify(columnas) === JSON.stringify(COLUMNAS[f]), { base: columnas, campos: COLUMNAS[f] })
  }
  afirmar('1 CTE: toda fuente que lee una tabla filtra por $1', NOMBRES_DE_FUENTE.every((f) => Object.keys(FUENTES[f].lee).length === 0 || FUENTES[f].cte.includes('negocio_id = $1::uuid')))

  console.log('\n=== 2. El rol y sus políticas ===')
  const [rol] = (await q.query(`select rolsuper, rolcanlogin, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb from pg_roles where rolname = 'amanece_consultas'`)) as Record<string, boolean>[]
  afirmar('2 rol: amanece_consultas existe, sin login, sin BYPASSRLS, sin superusuario', rol !== undefined && !rol.rolsuper && !rol.rolcanlogin && !rol.rolbypassrls && !rol.rolcreaterole && !rol.rolcreatedb, rol)
  const pertenencias = (await q.query(
    `select inherit_option as hereda, set_option as puede from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member where r.rolname = 'amanece_consultas' and m.rolname = current_user`,
  )) as { hereda: boolean; puede: boolean }[]
  afirmar('2 rol: el usuario de la aplicación puede SET ROLE amanece_consultas y no hereda sus privilegios', pertenencias.some((p) => p.puede) && pertenencias.every((p) => !p.hereda), pertenencias)
  const politicas = (await q.query(`select tablename as tabla, roles::text as roles, cmd, qual from pg_policies where schemaname = 'public'`)) as { tabla: string; roles: string; cmd: string; qual: string }[]
  const conPolitica = [...delCatalogo.keys()]
  afirmar(
    '2 RLS: una política SELECT para amanece_consultas por tabla leída, con app.negocio_id',
    igual(
      politicas.map((p) => p.tabla),
      conPolitica,
    ) && politicas.every((p) => p.roles === '{amanece_consultas}' && p.cmd === 'SELECT' && p.qual.includes("current_setting('app.negocio_id'")),
    politicas,
  )
  const rls = (await q.query(`select relname as tabla, relrowsecurity as activa, relforcerowsecurity as forzada from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)) as { tabla: string; activa: boolean; forzada: boolean }[]
  afirmar('2 RLS: activa justo en las tablas leídas y en ninguna forzada', igual(rls.filter((r) => r.activa).map((r) => r.tabla), conPolitica) && rls.every((r) => !r.forzada), rls.filter((r) => r.activa || r.forzada))

  console.log('\n=== 3. Capacidad faltante tipada ===')
  const [chequeo] = (await q.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'capacidades_faltantes_tipo'`)) as { def: string }[]
  const enElCheck = [...(chequeo?.def ?? '').matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1])
  afirmar('3 CHECK: capacidades_faltantes.tipo acepta exactamente TIPOS_DE_MOTIVO', igual(enElCheck, TIPOS_DE_MOTIVO), { enElCheck, TIPOS_DE_MOTIVO })
} catch (e) {
  afirmar('probar-consultas terminó sin error inesperado', false, e)
} finally {
  terminar()
}
