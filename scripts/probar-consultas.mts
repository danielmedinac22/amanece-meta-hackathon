/**
 * El SQL acotado sin modelo: el catálogo contra la base en los dos sentidos, el rol y sus políticas, y el validador.
 * Lo único que escribe es la migración 0004, que corre dos veces para ver que deja lo mismo.
 *
 *   pnpm tsx scripts/probar-consultas.mts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from 'dotenv'
import { neon, Pool } from '@neondatabase/serverless'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })

const { TIPOS_DE_MOTIVO } = await import('../src/db/esquema')
const { COLUMNAS, FUENTES, grantsDeConsultas, NOMBRES_DE_FUENTE, prologo } = await import('../src/nucleo/consultas/catalogo')
const { esErrorDeConsulta, explicar, validarConsulta } = await import('../src/nucleo/consultas/validar')
const { armarLote, ejecutar, esNoDisponible, firmaDe, PREAMBULO } = await import('../src/nucleo/consultas/ejecutar')
const { pintarUna } = await import('../src/nucleo/panel')
const { redactarConsulta } = await import('../src/nucleo/cambios/redactar-consulta')
const { traducir } = await import('../src/nucleo/cambios/traducir')
const { leerEstado } = await import('../src/nucleo/estado')
const { marcar } = await import('../src/nucleo/identidad')
const { ataqueDe8, BUENAS_DE_M2, ESCAPES_DE_12, variantesDelAtaque } = await import('./consultas-de-prueba.mjs')
type TipoDeSalida = import('../src/nucleo/consultas/tipos').TipoDeSalida
type ErrorDeConsulta = import('../src/nucleo/consultas/tipos').ErrorDeConsulta
type ElementoDelPanel = import('../src/nucleo/panel').ElementoDelPanel
type Clave = import('../src/nucleo/estado/elementos').Clave

const q = neon(process.env.DATABASE_URL!)
const urlDelRol = process.env.DATABASE_URL_CONSULTAS
if (!urlDelRol) throw new Error('Falta DATABASE_URL_CONSULTAS: pnpm tsx scripts/rol-de-consultas.mts .env.local')
const comoRol = neon(urlDelRol)
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
  const firma = await firmaDe(negocio.id)
  for (const f of NOMBRES_DE_FUENTE) {
    const r = await comoRol.transaction(
      (t) => [
        t.query('RESET ALL'),
        t.query(`SELECT set_config('app.negocio_id', $1, true), set_config('app.firma', $2, true)`, [negocio.id, firma]),
        t.query(`WITH ${prologo()}\nSELECT * FROM ${f} LIMIT 0`, [negocio.id, negocio.zona_horaria, '[]']),
      ],
      { readOnly: true, fullResults: true },
    )
    const columnas = r[2].fields.map((c) => c.name)
    afirmar(`1 CTE: ${f} da como amanece_consultas las columnas de sus campos, en orden`, JSON.stringify(columnas) === JSON.stringify(COLUMNAS[f]), { base: columnas, campos: COLUMNAS[f] })
  }
  afirmar('1 CTE: toda fuente que lee una tabla filtra por $1', NOMBRES_DE_FUENTE.every((f) => Object.keys(FUENTES[f].lee).length === 0 || FUENTES[f].cte.includes('negocio_id = $1::uuid')))

  console.log('\n=== 2. El rol y sus políticas ===')
  const [rol] = (await q.query(`select rolsuper, rolcanlogin, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb from pg_roles where rolname = 'amanece_consultas'`)) as Record<string, boolean>[]
  afirmar('2 rol: amanece_consultas puede entrar, sin BYPASSRLS, sin superusuario', rol !== undefined && !rol.rolsuper && rol.rolcanlogin && !rol.rolbypassrls && !rol.rolcreaterole && !rol.rolcreatedb, rol)
  const [{ usuario }] = (await comoRol.query('select current_user as usuario')) as { usuario: string }[]
  afirmar('2 rol: la conexión real de DATABASE_URL_CONSULTAS entra como amanece_consultas', usuario === 'amanece_consultas', usuario)
  const [pertenece] = (await q.query(`select count(*)::int as n from pg_auth_members where member = 'amanece_consultas'::regrole`)) as { n: number }[]
  afirmar('2 rol: amanece_consultas no pertenece a ningún rol', pertenece.n === 0, pertenece)
  const [delDueno] = (await q.query(`select pg_has_role(current_user, 'amanece_consultas', 'SET') as puede, pg_has_role(current_user, 'amanece_consultas', 'USAGE') as hereda`)) as { puede: boolean; hereda: boolean }[]
  afirmar('2 rol: el dueño de la base no tiene SET ni USAGE sobre amanece_consultas', !delDueno.puede && !delDueno.hereda, delDueno)
  const funciones = (await q.query(
    `select p.proname as nombre, p.prosecdef as definer, p.proconfig as config,
       has_function_privilege('public', p.oid, 'execute') as publico,
       has_function_privilege('amanece_consultas', p.oid, 'execute') as rol
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('consultas_negocio', 'firmar_consulta')`,
  )) as { nombre: string; definer: boolean; config: string[] | null; publico: boolean; rol: boolean }[]
  afirmar('2 funciones: las dos existen, son SECURITY DEFINER y fijan search_path=pg_catalog', funciones.length === 2 && funciones.every((f) => f.definer && f.config?.includes('search_path=pg_catalog')), funciones)
  afirmar('2 funciones: PUBLIC no ejecuta ninguna de las dos', funciones.every((f) => !f.publico), funciones)
  afirmar('2 funciones: amanece_consultas ejecuta consultas_negocio y no firmar_consulta', funciones.some((f) => f.nombre === 'consultas_negocio' && f.rol) && funciones.some((f) => f.nombre === 'firmar_consulta' && !f.rol), funciones)
  const leerLaLlave = await comoRol.query('select clave from public.llave_de_consultas').then(
    () => 'la leyó',
    (e: { code?: string }) => e.code,
  )
  afirmar('2 llave: por la conexión real, amanece_consultas no lee llave_de_consultas (42501)', leerLaLlave === '42501', leerLaLlave)
  const politicas = (await q.query(`select tablename as tabla, roles::text as roles, cmd, qual from pg_policies where schemaname = 'public'`)) as { tabla: string; roles: string; cmd: string; qual: string }[]
  const conPolitica = [...delCatalogo.keys()]
  afirmar(
    '2 RLS: una política SELECT para amanece_consultas por tabla leída, con la firma de consultas_negocio',
    igual(
      politicas.map((p) => p.tabla),
      conPolitica,
    ) && politicas.every((p) => p.roles === '{amanece_consultas}' && p.cmd === 'SELECT' && p.qual.includes('consultas_negocio()')),
    politicas,
  )
  const rls = (await q.query(`select relname as tabla, relrowsecurity as activa, relforcerowsecurity as forzada from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)) as { tabla: string; activa: boolean; forzada: boolean }[]
  afirmar('2 RLS: activa justo en las tablas leídas y en ninguna forzada', igual(rls.filter((r) => r.activa).map((r) => r.tabla), conPolitica) && rls.every((r) => !r.forzada), rls.filter((r) => r.activa || r.forzada))

  console.log('\n=== 2 bis. La migración corre dos veces y deja lo mismo ===')
  const huella = async () => {
    const [h] = (await q.query(
      `select
        (select to_jsonb(r) from (select rolcanlogin, rolbypassrls, rolsuper, rolinherit, rolcreaterole, rolcreatedb from pg_roles where rolname = 'amanece_consultas') r) as rol,
        (select jsonb_agg(m order by m.roleid, m.member, m.grantor) from (select roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option from pg_auth_members where roleid = 'amanece_consultas'::regrole or member = 'amanece_consultas'::regrole) m) as miembros,
        (select jsonb_agg(p order by p.tablename) from (select tablename, roles::text, cmd, qual from pg_policies where schemaname = 'public') p) as politicas,
        (select jsonb_agg(f order by f.proname) from (select proname, prosecdef, provolatile, proconfig, proacl::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('consultas_negocio', 'firmar_consulta')) f) as funciones,
        (select jsonb_agg(c order by c.table_name, c.column_name) from (select table_name, column_name from information_schema.column_privileges where grantee = 'amanece_consultas') c) as columnas,
        (select count(*)::int from public.llave_de_consultas) as filas_de_la_llave,
        (select encode(public.digest(clave, 'sha256'), 'hex') from public.llave_de_consultas) as llave`,
    )) as Record<string, unknown>[]
    const { llave, ...resto } = h
    return { llave, resto: JSON.stringify(resto) }
  }
  const correrMigracion = async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL })
    try {
      await pool.query(readFileSync(new URL('../drizzle/0004_consultas.sql', import.meta.url), 'utf8'))
    } finally {
      await pool.end()
    }
  }
  const antes = await huella()
  await correrMigracion()
  const unaVez = await huella()
  await correrMigracion()
  const dosVeces = await huella()
  afirmar('2 bis: dos corridas dejan igual el rol, sus miembros, las políticas, las funciones y los GRANT', antes.resto === unaVez.resto && unaVez.resto === dosVeces.resto, { antes: antes.resto, dosVeces: dosVeces.resto })
  afirmar('2 bis: la llave sigue siendo una sola y la misma', antes.llave === dosVeces.llave && JSON.parse(dosVeces.resto).filas_de_la_llave === 1)
  afirmar('2 bis: el rol sigue con LOGIN', JSON.parse(dosVeces.resto).rol?.rolcanlogin === true, dosVeces.resto)
  const [{ sigue }] = (await comoRol.query('select current_user as sigue')) as { sigue: string }[]
  afirmar('2 bis: la conexión real sigue entrando con su contraseña', sigue === 'amanece_consultas', sigue)

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
    ['pg_class sin esquema', 'select relname from pg_class', 'filas', 'no_permitido'],
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
    ['date_trunc con zona', "select date_trunc('day', creado, 'America/Bogota') as d from pedidos", 'filas', 'definicion_del_nucleo'],
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
    ['constructor, del prototipo de FUNCIONES', 'select "constructor"(total) as x from pedidos', 'filas', 'no_permitido'],
    ['toString, del prototipo de FUNCIONES', 'select "toString"(total) as x from pedidos', 'filas', 'no_permitido'],
    ['constructor en FROM', 'select x from "constructor"(1) as x', 'filas', 'no_permitido'],
    ['lpad', 'select lpad(ciudad, 1000000000) as x from pedidos', 'filas', 'no_permitido'],
    ['rpad', 'select rpad(ciudad, 1000000000) as x from pedidos', 'filas', 'no_permitido'],
    ['una columna calculada sin AS', "select numero, case when estado = 'novedad' then 1 else total end from pedidos", 'filas', 'no_permitido'],
    ['una subconsulta sin AS', 'select numero, (select max(total) from pedidos) from pedidos', 'filas', 'no_permitido'],
    ['q como alias', 'select numero as q from pedidos', 'filas', 'no_permitido'],
    ['q que viene de una CTE', 'with x as (select id as q from pedidos) select q from x', 'filas', 'no_permitido'],
    ['p.* en la salida', 'select p.* from pedidos p', 'filas', 'forma'],
    ['p.* dentro de una expresión', 'select count(p.*) as valor from pedidos p', 'numero', 'forma'],
    ['la fila entera de un alias', 'select p from pedidos p', 'filas', 'no_permitido'],
    ['la fila entera de un alias que se llama como un campo', 'select total from clientes total', 'filas', 'no_permitido'],
    ['la fila entera de una CTE', 'with x as (select id from pedidos) select x from x', 'filas', 'no_permitido'],
  ]
  for (const [nombre, sql, salida, tipo] of rechazos) {
    const r = await valida(sql, salida)
    afirmar(`4 rechaza ${nombre} como ${tipo}`, esErrorDeConsulta(r) && r.tipo === tipo, esErrorDeConsulta(r) ? r : 'pasó')
  }
  const rechazaPor = async (nombre: string, sql: string, tipo: ErrorDeConsulta['tipo'], que: RegExp, salida: TipoDeSalida = 'filas') => {
    const r = await valida(sql, salida)
    const dice = esErrorDeConsulta(r) ? (r.tipo === 'no_permitido' ? r.que : r.tipo === 'dato_inexistente' ? r.fuente : r.tipo) : ''
    afirmar(`4 rechaza ${nombre} como ${tipo}, por ${que.source}`, esErrorDeConsulta(r) && r.tipo === tipo && que.test(dice), esErrorDeConsulta(r) ? r : 'pasó')
  }
  for (const [nombre, sentencias] of ESCAPES_DE_12) for (const [sql, que] of sentencias) await rechazaPor(`el escape de #12 ${nombre}, sentencia ${sql}`, sql, 'no_permitido', que)
  const comillas = (nombre: string) => `"${nombre.replaceAll('"', '""')}"`
  for (const alias of ['x",pg_sleep(60),"x', `x",current_setting('app.firma')::int,"x`, 'x",pg_terminate_backend(1),"x', 'x",(select count(*) from public.negocios),"x', 'x" --', 'x" offset 1 --', 'a", (select 1) --']) {
    const a = comillas(alias)
    await rechazaPor(`A1, el alias ${alias}`, `select id as x, id as ${a} from pedidos order by ${a}`, 'no_permitido', /^la columna/)
    await rechazaPor(`el alias ${alias} en colnames`, `select id from pedidos as p(${a})`, 'no_permitido', /^la columna/)
    await rechazaPor(`el alias ${alias} en aliascolnames`, `with c(${a}) as (select id from pedidos) select id from pedidos`, 'no_permitido', /^la columna/)
    await rechazaPor(`el alias ${alias} de una función en FROM`, `select id from pedidos, generate_series(1, 2) as ${a}`, 'no_permitido', /^la columna/)
  }
  const empalme = [comillas('a",/*'), comillas('*/(select count(*) from pg_class),"a')]
  await rechazaPor('A1, dos columnas empalmadas con un comentario', `select id as ${empalme[0]}, id as ${empalme[1]} from pedidos order by ${empalme[0]}, ${empalme[1]}`, 'no_permitido', /^la columna/)
  await rechazaPor('un alias con mayúscula', 'select id as "Id" from pedidos', 'no_permitido', /^la columna/)
  const CATALOGO_DE_POSTGRES: [string, string, RegExp][] = [
    ['A2 pg_class', 'select relname as relname, reltuples as reltuples from pg_class as pg_class', /^pg_class/],
    ['A2 pg_stat_activity', 'select query as query, pid as pid from pg_stat_activity as pg_stat_activity', /^pg_stat_activity/],
    ['A2 pg_roles', 'select rolname as rolname from pg_roles as pg_roles', /^pg_roles/],
    ['A2 pg_proc', 'select prosrc as prosrc from pg_proc as pg_proc', /^pg_proc/],
    ['A2 pg_authid', 'select rolpassword as rolpassword from pg_authid as pg_authid', /^pg_authid/],
    ['A2 una CTE fuera de alcance', 'select rolname as rolname from pg_roles, (with pg_roles as (select hoy_local as x from hoy) select x from pg_roles) s', /pg_roles/],
    ['B1 pg_settings', 'select pg_settings.name as name, pg_settings.setting as setting from pg_settings pg_settings', /^pg_settings/],
    ['B1 una CTE fuera de alcance', 'select x.relname as relname from (with pg_class as (select 1 as n from hoy) select n from pg_class) y, pg_class x', /pg_class/],
    ['una CTE llamada pg_algo', 'with pg_algo as (select hoy_local as x from hoy) select x from pg_algo', /pg_algo/],
  ]
  for (const [nombre, sql, que] of CATALOGO_DE_POSTGRES) await rechazaPor(nombre, sql, 'no_permitido', que)
  await rechazaPor('A2 llave_de_consultas con su propio alias', 'select count(*) as valor from llave_de_consultas as llave_de_consultas', 'dato_inexistente', /^llave_de_consultas$/, 'numero')
  await rechazaPor('un alias de otra tabla no vuelve válida una relación', 'select x.id from negocios x, pedidos negocios', 'dato_inexistente', /^negocios$/)
  const BUENAS_NUEVAS: [string, string, TipoDeSalida][] = [
    ["to_char con 'DD/MM'", "select to_char(dia_local, 'DD/MM') as etiqueta, count(*) as valor from pedidos group by 1", 'serie'],
    ["el literal 'Bogota/Chapinero'", "select count(*) as valor from pedidos where ciudad = 'Bogota/Chapinero'", 'numero'],
    ["el literal 'America/Bogota', que ya no define nada", "select count(*) as valor from pedidos where ciudad <> 'America/Bogota'", 'numero'],
    ['date_trunc con 2 argumentos', "select date_trunc('day', creado) as d from pedidos", 'filas'],
    ['una CTE que se llama como su columna', 'with ventas as (select sum(total) as ventas from pedidos) select ventas from ventas', 'filas'],
    ['creado::date, que la zona del lote deja bien', 'select creado::date as d from pedidos', 'filas'],
    ['una columna que viene de una función en FROM', 'select s from generate_series(1, 2) as s, pedidos', 'filas'],
  ]
  for (const [nombre, sql, salida] of BUENAS_NUEVAS) {
    const r = await valida(sql, salida)
    afirmar(`4 buena: ${nombre} pasa`, !esErrorDeConsulta(r), esErrorDeConsulta(r) ? explicar(r) : undefined)
  }
  const sinPermitidas = await valida('select now() as valor from pedidos', 'numero')
  afirmar('4 el error de una función dice cuáles sí se permiten', esErrorDeConsulta(sinPermitidas) && sinPermitidas.tipo === 'no_permitido' && sinPermitidas.permitidas.includes('count') && explicar(sinPermitidas).includes('hoy.ahora'), sinPermitidas)
  const ordenAdentro = await valida('select ciudad as etiqueta, count(*) as valor from pedidos group by ciudad order by count(*) desc', 'serie')
  afirmar('4 un ORDER BY que no nombra una salida pasa y no se repite afuera', !esErrorDeConsulta(ordenAdentro) && ordenAdentro.orden.length === 0, ordenAdentro)

  console.log('\n=== 5. Lo que vuelve de Postgres, saneado ===')
  const [ladera] = (await q.query(`select id from negocios where codigo = 'LADERA'`)) as { id: string }[]
  const estado = await leerEstado(marcar.negocio(ladera.id))
  const nombres = ((await q.query(`select nombre from clientes where negocio_id = $1 and nombre <> '' limit 50`, [ladera.id])) as { nombre: string }[]).map((c) => c.nombre)
  const correr = async (sql: string, salida: TipoDeSalida) => {
    const v = await valida(sql, salida)
    if (esErrorDeConsulta(v)) throw new Error(`no valida: ${explicar(v)}`)
    return ejecutar(estado, v)
  }
  const conNombre = await correr('select min(nombre::int) as valor from clientes', 'numero')
  afirmar(
    '5 un 22P02 vuelve con su SQLSTATE y sin el valor de la fila (el nombre de un Cliente)',
    conNombre.tipo === 'error' && conNombre.error.tipo === 'postgres' && conNombre.error.codigo === '22P02' && !nombres.some((n) => JSON.stringify(conNombre).includes(n)),
    conNombre,
  )
  const columna = await correr('select nombre from pedidos', 'filas')
  afirmar('5 un 42703 vuelve como dato_inexistente con los campos de la fuente', columna.tipo === 'error' && columna.error.tipo === 'dato_inexistente' && columna.error.campo === 'nombre' && columna.error.hay.includes('total'), columna)
  const lenta = await correr('select count(*) as valor from pedidos, generate_series(1, 100000000) as g(n)', 'numero')
  afirmar('5 el tope de 2 s corta una consulta pesada y vuelve como 57014', lenta.tipo === 'error' && lenta.error.tipo === 'postgres' && lenta.error.codigo === '57014' && lenta.ms < 4000, lenta)
  const contada = await correr('select count(*) as valor from pedidos', 'numero')
  afirmar('5 un count(*) sin columnas cuenta igual las filas de su fuente', contada.tipo === 'filas' && (contada.filasPorFuente.pedidos ?? 0) > 0, contada)

  console.log('\n=== 5 bis. El lote armado, parseado otra vez ===')
  const { loadModule, parseSync } = await import('libpg-query')
  await loadModule()
  const afueraDe = (texto: string) => {
    const [sentencia] = parseSync(texto).stmts ?? []
    return (sentencia?.stmt as { SelectStmt?: { sortClause?: { SortBy?: { node?: Record<string, unknown> } }[]; limitCount?: unknown; limitOffset?: unknown } } | undefined)?.SelectStmt
  }
  const consultaDelLote = (consulta: Parameters<typeof armarLote>[1]) => armarLote(estado, consulta, 'f'.repeat(64))[PREAMBULO].texto
  const sana = (texto: string) => {
    const a = afueraDe(texto)
    return Boolean(a?.limitCount) && !a?.limitOffset && (a?.sortClause ?? []).every((s) => Object.keys(s.SortBy?.node ?? {}).join() === 'ColumnRef')
  }
  for (const [id, salida, sql] of BUENAS_DE_M2) {
    const v = await valida(sql, salida)
    afirmar(`5 bis ${id}: el ORDER BY de afuera son solo columnas y hay LIMIT`, !esErrorDeConsulta(v) && sana(consultaDelLote(v)), esErrorDeConsulta(v) ? v : consultaDelLote(v).slice(-120))
  }
  const consultaConOrden = (columna: string) => ({ sql: 'select id as x from pedidos', fuentes: ['pedidos'], usa: [], columnas: ['x'], orden: [{ columna, descendente: true }] }) as unknown as Parameters<typeof armarLote>[1]
  for (const columna of ['x",pg_sleep(60),"x', 'x" --', 'x" offset 1 --']) afirmar(`5 bis armarLote escapa la columna ${columna} aunque llegara al lote`, sana(consultaDelLote(consultaConOrden(columna))), consultaDelLote(consultaConOrden(columna)).slice(-80))

  console.log('\n=== 6. Sin DATABASE_URL_CONSULTAS falla cerrado ===')
  const sqlDeUna = 'select count(*) as valor from pedidos'
  const validada = await valida(sqlDeUna, 'numero')
  if (esErrorDeConsulta(validada)) throw new Error(`no valida: ${explicar(validada)}`)
  const quitada = process.env.DATABASE_URL_CONSULTAS
  delete process.env.DATABASE_URL_CONSULTAS
  try {
    const sinUrl = await ejecutar(estado, validada)
    afirmar('6 ejecutar devuelve sin_configurar, sin tocar la base ni caer a la conexión del dueño', sinUrl.tipo === 'sin_configurar' && sinUrl.ms === 0, sinUrl)
    const elemento = { tipo: 'indicador', nombre: 'Pedidos', queQuiereVer: 'cuántos pedidos', consulta: { sql: sqlDeUna, enPalabras: 'Los pedidos', supuestos: [], catalogo: 1, usa: [], salida: { tipo: 'numero', unidad: { tipo: 'cantidad', nombre: 'pedidos' } } } } as unknown as ElementoDelPanel
    const pintada = await pintarUna(estado, 'indicador:prueba' as Clave, elemento)
    afirmar('6 la Sección dice que no se pudo calcular, con su motivo propio', pintada.resultado.tipo === 'no_se_pudo_calcular' && pintada.resultado.porQue === 'sin_configurar', pintada.resultado)
    let llamadas = 0
    const motor = async () => {
      llamadas++
      throw new Error('el redactor no debía llamar al modelo')
    }
    const redactada = await redactarConsulta(estado, { nombre: 'Pedidos', queQuiereVer: 'cuántos pedidos', salida: 'numero', anterior: null }, motor)
    afirmar('6 el redactor vuelve sin_configurar y no gasta ningún intento', redactada.tipo === 'sin_configurar' && redactada.gasto.llamadas === 0 && llamadas === 0, { redactada, llamadas })
    const traducida = await traducir(estado, [{ tipo: 'panel', que: 'indicador', nombre: 'Pedidos', queQuiereVer: 'cuántos pedidos', salida: 'numero', reemplaza: null }], motor)
    afirmar('6 la propuesta no se vuelve Capacidad faltante: vuelve a corregir', 'tipo' in traducida && traducida.tipo === 'corregir' && llamadas === 0, traducida)

    console.log('\n=== 6 bis. Una URL que no parsea: sin_configurar, y su texto no se loguea ===')
    const SECRETO = 'clave_de_mentira'
    const escuchar = async <T,>(f: () => Promise<T>): Promise<{ r: T; logueado: string }> => {
      const lineas: unknown[][] = []
      const originales = { log: console.log, warn: console.warn, error: console.error }
      for (const m of ['log', 'warn', 'error'] as const) console[m] = (...a: unknown[]) => void lineas.push(a)
      try {
        return { r: await f(), logueado: lineas.map((l) => l.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')).join('\n') }
      } finally {
        Object.assign(console, originales)
      }
    }
    const MALFORMADAS = [`"postgres://amanece_consultas:${SECRETO}@host.tld/db"`, `postgres://amanece_consultas:${SECRETO}@host con espacio/db`, `postgres://amanece_consultas:${SECRETO}@`, `mysql://amanece_consultas:${SECRETO}@host.tld/db`, `postgres://${SECRETO}@host.tld/db`, SECRETO]
    for (const url of MALFORMADAS) {
      process.env.DATABASE_URL_CONSULTAS = url
      const { r, logueado } = await escuchar(async () => {
        const corrida = await ejecutar(estado, validada)
        const pintada = await pintarUna(estado, 'indicador:prueba' as Clave, elemento)
        const redactada = await redactarConsulta(estado, { nombre: 'Pedidos', queQuiereVer: 'cuántos pedidos', salida: 'numero', anterior: null }, motor)
        return { corrida, pintada, redactada }
      })
      const todo = JSON.stringify(r) + logueado
      afirmar(`6 bis ${url.slice(0, 12)}…: sin_configurar en ejecutar, el Panel y el redactor, sin gastar intentos`, r.corrida.tipo === 'sin_configurar' && r.pintada.resultado.tipo === 'no_se_pudo_calcular' && r.pintada.resultado.porQue === 'sin_configurar' && r.redactada.tipo === 'sin_configurar' && r.redactada.gasto.llamadas === 0, r)
      afirmar(`6 bis ${url.slice(0, 12)}…: el texto de la URL no aparece en lo logueado ni en lo devuelto`, logueado.length > 0 && !todo.includes(SECRETO), logueado.slice(0, 200))
    }

    console.log('\n=== 6 ter. La base no atiende: no_disponible, una llamada y ninguna fila ===')
    const cuantasFaltantes = async () => ((await q.query('select count(*)::int as n from capacidades_faltantes where negocio_id = $1', [ladera.id])) as { n: number }[])[0].n
    const faltantesAntes = await cuantasFaltantes()
    let llamadasDeLaBuena = 0
    const motorBueno = async () => {
      llamadasDeLaBuena++
      return { salida: { decision: 'consulta' as const, sql: sqlDeUna, enPalabras: 'Los pedidos', ventana: 'no_aplica' as const, supuestos: [], unidad: 'cantidad' as const, nombreDeLaUnidad: 'pedidos', titulos: [], faltaEn: 'ninguna' as const, falta: '' }, uso: { inputTokens: 0, outputTokens: 0 } }
    }
    const sinServicio = async (nombre: string, url: string, codigos: readonly string[]) => {
      process.env.DATABASE_URL_CONSULTAS = url
      llamadasDeLaBuena = 0
      const { r, logueado } = await escuchar(async () => {
        const corrida = await ejecutar(estado, validada)
        const pintada = await pintarUna(estado, 'indicador:prueba' as Clave, elemento)
        const traducida = await traducir(estado, [{ tipo: 'panel', que: 'indicador', nombre: 'Pedidos', queQuiereVer: 'cuántos pedidos', salida: 'numero', reemplaza: null }], motorBueno)
        return { corrida, pintada, traducida }
      })
      afirmar(`6 ter ${nombre}: ejecutar da no_disponible con ${codigos.join(' o ')}`, r.corrida.tipo === 'no_disponible' && codigos.includes(r.corrida.codigo), r.corrida)
      afirmar(`6 ter ${nombre}: el Panel dice no_disponible y loguea su clave y su código`, r.pintada.resultado.tipo === 'no_se_pudo_calcular' && r.pintada.resultado.porQue === 'no_disponible' && logueado.includes('indicador:prueba') && codigos.some((c) => logueado.includes(c)), { resultado: r.pintada.resultado, logueado })
      afirmar(`6 ter ${nombre}: el redactor corta en la primera llamada y la propuesta vuelve a corregir`, llamadasDeLaBuena === 1 && 'tipo' in r.traducida && r.traducida.tipo === 'corregir', { llamadasDeLaBuena, traducida: r.traducida })
      const contrasena = new URL(url).password
      afirmar(`6 ter ${nombre}: la contraseña no aparece en lo logueado ni en lo devuelto`, !`${JSON.stringify(r)}${logueado}`.includes(contrasena), logueado.slice(0, 200))
    }
    const conOtraClave = new URL(quitada!)
    conOtraClave.password = SECRETO
    await sinServicio('contraseña mala', conOtraClave.href, ['sin_codigo'])
    await sinServicio('host que no responde', `postgres://amanece_consultas:${SECRETO}@localhost:1/db`, ['sin_codigo'])
    afirmar('6 ter ninguno de esos dejó una Capacidad faltante', (await cuantasFaltantes()) === faltantesAntes)

    const fetchReal = globalThis.fetch
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      String(url).includes('.invalid') ? new Promise((_, rechazar) => init?.signal?.addEventListener('abort', () => rechazar(init.signal?.reason))) : fetchReal(url, init)) as typeof fetch
    process.env.DATABASE_URL_CONSULTAS = `postgres://amanece_consultas:${SECRETO}@colgado.invalid/db`
    const colgada = await Promise.race([ejecutar(estado, validada), new Promise<'sigue colgada'>((listo) => setTimeout(() => listo('sigue colgada'), 8000))])
    globalThis.fetch = fetchReal
    afirmar('6 ter una petición colgada se corta sola en unos 5 s y da no_disponible', colgada !== 'sigue colgada' && colgada.tipo === 'no_disponible' && colgada.ms > 4500 && colgada.ms < 7000, colgada)

    process.env.DATABASE_URL_CONSULTAS = quitada
    const conIdRoto = { ...estado, identidad: { ...estado.identidad, id: 'no-es-un-uuid' } } as typeof estado
    const sinFirma = await ejecutar(conIdRoto, validada)
    afirmar('6 ter una falla de firmaDe da no_disponible y no llega al lote', sinFirma.tipo === 'no_disponible' && sinFirma.codigo === '22P02', sinFirma)
    const nula = firmaDe(null as unknown as string)
    const firmaNula = await nula.then(() => 'la aceptó', (e: Error) => e.message)
    const otraNula = firmaDe(null as unknown as string)
    await otraNula.catch(() => undefined)
    afirmar('6 ter una firma null lanza y no queda guardada', firmaNula === 'firmar_consulta no devolvió una firma' && otraNula !== nula, firmaNula)
    const CLASES: [string, { code?: string; message: string }, boolean][] = [
      ['sin code', { message: 'fetch failed' }, true],
      ['ECONNRESET no es un SQLSTATE', { code: 'ECONNRESET', message: 'x' }, true],
      ['08006', { code: '08006', message: 'x' }, true],
      ['28P01', { code: '28P01', message: 'x' }, true],
      ['3D000', { code: '3D000', message: 'x' }, true],
      ['53300', { code: '53300', message: 'x' }, true],
      ['57P01', { code: '57P01', message: 'x' }, true],
      ['42501', { code: '42501', message: 'consulta sin firma valida' }, true],
      ['42883 de consultas_negocio', { code: '42883', message: 'function public.consultas_negocio() does not exist' }, true],
      ['42883 de hmac', { code: '42883', message: 'function public.hmac(bytea, bytea, unknown) does not exist' }, true],
      ['42P01 de la llave', { code: '42P01', message: 'relation "public.llave_de_consultas" does not exist' }, true],
      ['42883 de la consulta', { code: '42883', message: 'function round(text) does not exist' }, false],
      ['42P01 de la consulta', { code: '42P01', message: 'relation "llave_de_consultas" does not exist' }, false],
      ['57014, el tope de la consulta', { code: '57014', message: 'x' }, false],
      ['22012', { code: '22012', message: 'x' }, false],
    ]
    for (const [nombre, e, espera] of CLASES) afirmar(`6 ter ${nombre}: ${espera ? 'no_disponible' : 'error de la consulta'}`, esNoDisponible(Object.assign(new Error(e.message), e)) === espera)

    const carpeta = mkdtempSync(join(tmpdir(), 'rol-de-consultas-'))
    const envRoto = join(carpeta, '.env')
    writeFileSync(envRoto, `DATABASE_URL="postgres://dueno:${SECRETO}@host con espacio/db"\n`)
    const rolRoto = spawnSync('tsx', [new URL('./rol-de-consultas.mts', import.meta.url).pathname, envRoto], { encoding: 'utf8' })
    rmSync(carpeta, { recursive: true })
    afirmar('6 ter rol-de-consultas con un DATABASE_URL malformado sale con 1 y no imprime la contraseña del dueño', rolRoto.status === 1 && !`${rolRoto.stdout}${rolRoto.stderr}`.includes(SECRETO), { status: rolRoto.status, stderr: rolRoto.stderr.slice(0, 200) })
  } finally {
    process.env.DATABASE_URL_CONSULTAS = quitada
  }
} catch (e) {
  afirmar('probar-consultas terminó sin error inesperado', false, e)
} finally {
  terminar()
}
