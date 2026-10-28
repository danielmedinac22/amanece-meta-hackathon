import { cargarParser, validarConsulta, explicar, type Forma } from '../../src/medir-sql/validar'
await cargarParser()
type Caso = [string, string, Forma, 'ok' | string]
const F: Forma = { tipo: 'filas' }
const casos: Caso[] = [
  ['ok: serie con CTE y alias', `with v as (select dia_local, count(*) n from pedidos where cuenta_como_venta group by 1) select dia_local::text as etiqueta, n as valor from v order by dia_local`, { tipo: 'serie' }, 'ok'],
  ['ok: numero con hoy', `select count(*) as valor from pedidos p, hoy h where p.cuenta_como_venta and p.dia_local > h.hoy_local - 30`, { tipo: 'numero' }, 'ok'],
  ['ok: autojoin items', `select a.producto, b.producto, count(distinct a.pedido_id) c from pedido_items a join pedido_items b on a.pedido_id = b.pedido_id and a.producto_id < b.producto_id group by 1,2 order by c desc limit 5`, F, 'ok'],
  ['ok: percentile', `select percentile_cont(0.5) within group (order by segundos_primera_respuesta) as mediana, percentile_cont(0.9) within group (order by segundos_primera_respuesta) as p90 from conversaciones`, F, 'ok'],
  ['ok: subconsulta correlacionada', `select c.nombre from clientes c where exists (select 1 from pedidos p where p.cliente_id = c.id and p.cuenta_como_venta)`, F, 'ok'],
  ['ok: window', `select ciudad, total, rank() over (partition by ciudad order by total desc) r from pedidos`, F, 'ok'],
  ['ok: generate_series', `select d::date as dia from hoy, generate_series(hoy_local - 6, hoy_local, interval '1 day') as g(d)`, F, 'ok'],
  ['ok: extract + interval + cast', `select extract(hour from creado)::int h, creado - interval '1 day' from pedidos`, F, 'ok'],
  ['ok: order by alias + group by alias', `select ciudad as c, count(*) n from pedidos group by c order by n desc`, F, 'ok'],
  ['ok: union', `select ciudad as etiqueta, 1 as valor from pedidos union all select estado, 2 from pedidos`, { tipo: 'serie' }, 'ok'],
  ['no: columna inexistente', `select entregado_en from pedidos`, F, 'dato_inexistente'],
  ['no: columna calificada inexistente', `select p.confirmado_en from pedidos p`, F, 'dato_inexistente'],
  ['no: fuente inexistente', `select * from usuarios`, F, 'dato_inexistente'],
  ['no: tabla real con esquema', `select * from public.pedidos`, F, 'no_permitido'],
  ['no: pg_catalog tabla', `select * from pg_catalog.pg_roles`, F, 'no_permitido'],
  ['no: pg_class sin esquema', `select relname from pg_class`, F, 'dato_inexistente'],
  ['no: information_schema', `select table_name from information_schema.tables`, F, 'no_permitido'],
  ['no: set_config', `select set_config('app.negocio_id', 'x', true) as valor`, { tipo: 'numero' }, 'no_permitido'],
  ['no: pg_catalog.set_config', `select pg_catalog.set_config('app.negocio_id', 'x', true) as valor from pedidos`, { tipo: 'numero' }, 'no_permitido'],
  ['no: current_setting', `select current_setting('app.negocio_id') from pedidos`, F, 'no_permitido'],
  ['no: pg_sleep', `select pg_sleep(5) from pedidos`, F, 'no_permitido'],
  ['no: pg_read_file', `select pg_read_file('/etc/passwd') from pedidos`, F, 'no_permitido'],
  ['no: now()', `select count(*) as valor from pedidos where creado > now() - interval '1 day'`, { tipo: 'numero' }, 'no_permitido'],
  ['no: current_date', `select count(*) as valor from pedidos where dia_local = current_date`, { tipo: 'numero' }, 'no_permitido'],
  ['no: at time zone', `select (creado at time zone 'America/Bogota')::date as d from pedidos`, F, 'no_permitido'],
  ['no: insert', `insert into pedidos(id) values (gen_random_uuid())`, F, 'no_permitido'],
  ['no: update', `update pedidos set total = 0`, F, 'no_permitido'],
  ['no: delete', `delete from pedidos`, F, 'no_permitido'],
  ['no: cte con delete', `with x as (delete from pedidos returning *) select * from x`, F, 'no_permitido'],
  ['no: for update', `select * from pedidos for update`, F, 'no_permitido'],
  ['no: select into', `select * into nueva from pedidos`, F, 'no_permitido'],
  ['no: dos sentencias', `select 1 from pedidos; select 2 from pedidos`, F, 'no_permitido'],
  ['no: drop', `drop table pedidos`, F, 'no_permitido'],
  ['no: copy', `copy pedidos to '/tmp/x'`, F, 'no_permitido'],
  ['no: explain', `explain select * from pedidos`, F, 'no_permitido'],
  ['no: recursive', `with recursive r as (select 1 as n from hoy union all select n+1 from r where n < 5) select n from r`, F, 'no_permitido'],
  ['no: cast a regclass', `select 'pedidos'::regclass from pedidos`, F, 'no_permitido'],
  ['no: cte con nombre de fuente', `with pedidos as (select 1 as x from hoy) select x from pedidos`, F, 'no_permitido'],
  ['no: parametro', `select * from pedidos where id = $1`, F, 'no_permitido'],
  ['no: jsonb op', `select items->0 from pedidos`, F, 'no_permitido'],
  ['no: columna no expuesta (direccion)', `select direccion from pedidos`, F, 'dato_inexistente'],
  ['no: texto de mensajes', `select texto from conversaciones`, F, 'dato_inexistente'],
  ['no: constante (sin_datos)', `select 0 as valor from hoy`, { tipo: 'numero' }, 'sin_datos'],
  ['no: avg(0) (sin_datos)', `select avg(0) as valor from hoy`, { tipo: 'numero' }, 'sin_datos'],
  ['no: forma numero con 2 columnas', `select count(*) as valor, count(*) as otro from pedidos`, { tipo: 'numero' }, 'forma'],
  ['no: forma serie sin etiqueta', `select ciudad, count(*) as valor from pedidos group by 1`, { tipo: 'serie' }, 'forma'],
  ['no: sintaxis', `select from where`, F, 'sintaxis'],
  ['no: tablesample', `select * from pedidos tablesample system (10)`, F, 'no_permitido'],
  ['no: union con tabla fuera', `select ciudad from pedidos union select rolname from pg_authid`, F, 'dato_inexistente'],
  ['no: lateral con funcion de conjunto', `select * from pedidos, lateral jsonb_array_elements(pedidos.items) i`, F, 'no_permitido'],
  ['no: dblink', `select * from dblink('x','select 1') as t(a int)`, F, 'no_permitido'],
  ['no: generate_series con pg_sleep', `select pg_sleep(1) from generate_series(1,3)`, F, 'no_permitido'],
  ['no: subselect en FROM con schema', `select * from (select * from public.pedidos) x`, F, 'no_permitido'],
  ['no: comentario sql', `select count(*) as valor from pedidos -- ; drop table pedidos`, { tipo: 'numero' }, 'ok'],
]
let bien = 0
for (const [nombre, sql, forma, esperado] of casos) {
  const r = validarConsulta(sql, forma)
  const obtenido = r.ok ? 'ok' : r.error.tipo
  const pasa = obtenido === esperado
  if (pasa) bien++
  console.log(`${pasa ? 'PASA ' : 'FALLA'} ${nombre.padEnd(46)} esperado=${esperado.padEnd(17)} obtenido=${obtenido}${r.ok ? '' : ' :: ' + explicar(r.error).slice(0, 110)}`)
}
console.log(`${bien}/${casos.length}`)
const extra: Caso[] = [
  ['ok: select distinct', `select distinct ciudad from pedidos`, F, 'ok'],
  ['ok: count distinct + distinct on', `select distinct on (cliente_id) cliente_id, total from pedidos order by cliente_id, total desc`, F, 'ok'],
  ['ok: values en from', `select h.hora, count(p.id) from (values (0),(1)) as h(hora) left join pedidos p on p.hora_local = h.hora group by 1`, F, 'ok'],
  ['no: generate_series solo con constantes (sin_datos)', `select generate_series(0, 23) as hora from hoy`, F, 'sin_datos'],
  ['ok: lpad', `select lpad(hora_local::text, 2, '0') as etiqueta, count(*) as valor from pedidos group by hora_local`, { tipo: 'serie' }, 'ok'],
  ['no: values como consulta', `values (1), (2)`, F, 'no_permitido'],
  ['no: values con función prohibida', `select * from (values (pg_sleep(1))) as v(x)`, F, 'no_permitido'],
]
for (const [nombre, sql, forma, esperado] of extra) {
  const r = validarConsulta(sql, forma)
  const obtenido = r.ok ? 'ok' : r.error.tipo
  console.log(`${obtenido === esperado ? 'PASA ' : 'FALLA'} ${nombre.padEnd(46)} esperado=${esperado.padEnd(17)} obtenido=${obtenido}${r.ok ? '' : ' :: ' + explicar(r.error).slice(0, 80)}`)
  if (obtenido === esperado) bien++
}
console.log(`total ${bien}/${casos.length + extra.length}`)
