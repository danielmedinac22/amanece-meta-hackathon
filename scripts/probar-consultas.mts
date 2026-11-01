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
const { esErrorDeConsulta, explicar, validarConsulta } = await import('../src/nucleo/consultas/validar')
const { ataqueDe8, BUENAS_DE_M2, ESCAPES_DE_12, variantesDelAtaque } = await import('./consultas-de-prueba.mjs')
type TipoDeSalida = import('../src/nucleo/consultas/tipos').TipoDeSalida
type ErrorDeConsulta = import('../src/nucleo/consultas/tipos').ErrorDeConsulta

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

  console.log('\n=== 4. El validador ===')
  const valida = async (sql: string, salida: TipoDeSalida) => validarConsulta(sql, salida)
  for (const [id, salida, sql] of BUENAS_DE_M2) {
    const r = await valida(sql, salida)
    afirmar(`4 buena de M2: ${id} pasa como ${salida}`, !esErrorDeConsulta(r), esErrorDeConsulta(r) ? explicar(r) : undefined)
  }
  const ultimas24 = await valida("select count(*) as valor from clientes c, hoy where c.ultimo_mensaje > hoy.ahora - interval '24 hours'", 'numero')
  afirmar('4 buena: "las últimas 24 horas" con hoy.ahora menos un intervalo pasa', !esErrorDeConsulta(ultimas24), esErrorDeConsulta(ultimas24) ? explicar(ultimas24) : undefined)
  const masVendido = await valida('select producto as etiqueta, sum(cantidad) as valor from lineas_de_pedido where cuenta_como_venta group by producto order by valor desc limit 1', 'serie')
  afirmar(
    '4 buena: "el producto más vendido" sobre lineas_de_pedido pasa, usa sus campos y repite el orden afuera',
    !esErrorDeConsulta(masVendido) && masVendido.usa.includes('lineas_de_pedido.cantidad') && JSON.stringify(masVendido.orden) === JSON.stringify([{ columna: 'valor', descendente: true }]),
    masVendido,
  )

  const B = '00000000-0000-4000-8000-00000000000b'
  const rechazos: [string, string, TipoDeSalida, ErrorDeConsulta['tipo']][] = [
    ['el ataque de #8', ataqueDe8(B), 'numero', 'no_permitido'],
    ...variantesDelAtaque(B).map(([nombre, sql]): [string, string, TipoDeSalida, ErrorDeConsulta['tipo']] => [`variante del ataque ${nombre}`, sql, 'numero', 'no_permitido']),
    ['SET', "SET app.negocio_id = 'x'", 'numero', 'no_permitido'],
    ['RESET', 'RESET ALL', 'numero', 'no_permitido'],
    ['SET LOCAL ROLE', 'SET LOCAL ROLE neondb_owner', 'numero', 'no_permitido'],
    ['public.pedidos', 'select count(*) as valor from public.pedidos', 'numero', 'no_permitido'],
    ['pg_catalog.pg_roles', 'select rolname from pg_catalog.pg_roles', 'filas', 'no_permitido'],
    ['pg_class sin esquema', 'select relname from pg_class', 'filas', 'dato_inexistente'],
    ['information_schema', 'select table_name from information_schema.tables', 'filas', 'no_permitido'],
    ['pg_sleep', 'select pg_sleep(5) as valor from pedidos', 'numero', 'no_permitido'],
    ['pg_read_file', "select pg_read_file('/etc/passwd') as valor from pedidos", 'numero', 'no_permitido'],
    ['now()', "select count(*) as valor from pedidos where creado > now() - interval '1 day'", 'numero', 'no_permitido'],
    ['current_date', 'select count(*) as valor from pedidos where dia_local = current_date', 'numero', 'no_permitido'],
    ['INSERT', "insert into pedidos (id) values ('x')", 'numero', 'no_permitido'],
    ['UPDATE', 'update pedidos set total = 0', 'numero', 'no_permitido'],
    ['DELETE', 'delete from pedidos', 'numero', 'no_permitido'],
    ['DELETE dentro de una CTE', 'with x as (delete from pedidos returning id) select count(*) as valor from x', 'numero', 'no_permitido'],
    ['FOR UPDATE', 'select id from pedidos for update', 'filas', 'no_permitido'],
    ['SELECT INTO', 'select id into nueva from pedidos', 'filas', 'no_permitido'],
    ['WITH RECURSIVE', 'with recursive r as (select 1 as n from hoy union all select n + 1 from r where n < 5) select n from r', 'filas', 'no_permitido'],
    ['dos sentencias', 'select count(*) as valor from pedidos; select count(*) as valor from pedidos', 'numero', 'no_permitido'],
    ['EXPLAIN', 'explain select id from pedidos', 'filas', 'no_permitido'],
    ['COPY', "copy pedidos to '/tmp/x'", 'filas', 'no_permitido'],
    ['cast a regclass', "select 'pedidos'::regclass as valor from pedidos", 'numero', 'no_permitido'],
    ['operador jsonb', 'select items -> 0 as x from pedidos', 'filas', 'no_permitido'],
    ['una CTE con el nombre de una fuente', 'with pedidos as (select 1 as x from hoy) select x from pedidos', 'filas', 'no_permitido'],
    ['un parámetro', 'select id from pedidos where id = $1', 'filas', 'no_permitido'],
    ['TABLESAMPLE', 'select id from pedidos tablesample system (10)', 'filas', 'no_permitido'],
    ['VALUES como consulta', 'values (1), (2)', 'filas', 'no_permitido'],
    ['VALUES con una función prohibida', 'select x from (values (pg_sleep(1))) as v(x)', 'filas', 'no_permitido'],
    ['AT TIME ZONE', "select (creado at time zone 'America/Bogota')::date as d from pedidos", 'filas', 'definicion_del_nucleo'],
    ["el literal 'America/Bogota'", "select count(*) as valor from pedidos where ciudad <> 'America/Bogota'", 'numero', 'definicion_del_nucleo'],
    ["creado + interval '5 hours'", "select count(*) as valor from pedidos where creado + interval '5 hours' > hoy_local", 'numero', 'definicion_del_nucleo'],
    ["date_trunc sobre creado menos interval '5 hours'", "select date_trunc('day', creado) - interval '5 hours' as d from pedidos", 'filas', 'definicion_del_nucleo'],
    ['clientes.telefono', 'select telefono from clientes', 'filas', 'dato_inexistente'],
    ['p.direccion calificada', 'select p.direccion from pedidos p', 'filas', 'dato_inexistente'],
    ['texto de conversaciones', 'select texto from conversaciones', 'filas', 'dato_inexistente'],
    ['una fuente que no existe', 'select id from usuarios', 'filas', 'dato_inexistente'],
    ['select 0 as valor', 'select 0 as valor from hoy', 'numero', 'sin_datos'],
    ['avg(0)', 'select avg(0) as valor from hoy', 'numero', 'sin_datos'],
    ['numero con dos columnas', 'select count(*) as valor, count(*) as otro from pedidos', 'numero', 'forma'],
    ['serie sin etiqueta', 'select ciudad, count(*) as valor from pedidos group by 1', 'serie', 'forma'],
    ['filas con *', 'select * from pedidos', 'filas', 'forma'],
    ['sintaxis', 'select from where', 'filas', 'sintaxis'],
    ...ESCAPES_DE_12.map(([nombre, sentencias]): [string, string, TipoDeSalida, ErrorDeConsulta['tipo']] => [
      `escape de #12: ${nombre}`,
      sentencias.join('; '),
      'filas',
      nombre === 'leer pg_authid' ? 'dato_inexistente' : 'no_permitido',
    ]),
  ]
  for (const [nombre, sql, salida, tipo] of rechazos) {
    const r = await valida(sql, salida)
    afirmar(`4 rechaza ${nombre} como ${tipo}`, esErrorDeConsulta(r) && r.tipo === tipo, esErrorDeConsulta(r) ? r : 'pasó')
  }
  const sinPermitidas = await valida('select now() as valor from pedidos', 'numero')
  afirmar('4 el error de una función dice cuáles sí se permiten', esErrorDeConsulta(sinPermitidas) && sinPermitidas.tipo === 'no_permitido' && sinPermitidas.permitidas.includes('count') && explicar(sinPermitidas).includes('hoy.ahora'), sinPermitidas)
  const ordenAdentro = await valida('select ciudad as etiqueta, count(*) as valor from pedidos group by ciudad order by count(*) desc', 'serie')
  afirmar('4 un ORDER BY que no nombra una salida pasa y no se repite afuera', !esErrorDeConsulta(ordenAdentro) && ordenAdentro.orden.length === 0, ordenAdentro)
} catch (e) {
  afirmar('probar-consultas terminó sin error inesperado', false, e)
} finally {
  terminar()
}
