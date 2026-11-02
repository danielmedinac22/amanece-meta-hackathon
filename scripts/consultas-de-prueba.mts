/**
 * Las consultas que comparten probar-consultas (el validador) y probar-aislamiento (el lote crudo).
 */
type TipoDeSalida = import('../src/nucleo/consultas/tipos').TipoDeSalida

/** Las 19 consultas finales de M2 que dieron respuesta (rep1), con pedido_items renombrada a lineas_de_pedido. */
export const BUENAS_DE_M2: readonly (readonly [id: string, salida: TipoDeSalida, sql: string])[] = [
  ["confirmados_por_dia", "serie", "SELECT p.dia_local::TEXT AS etiqueta, COUNT(*) AS valor FROM pedidos p CROSS JOIN hoy h WHERE p.cuenta_como_venta = TRUE AND p.dia_local > h.hoy_local - 30 GROUP BY p.dia_local ORDER BY p.dia_local"],
  ["confirmados_30_dias", "serie", "WITH h AS (SELECT hoy_local FROM hoy) SELECT to_char(d.dia, 'YYYY-MM-DD') AS etiqueta, COUNT(p.id) AS valor FROM (SELECT (hoy_local - s)::date AS dia FROM h CROSS JOIN generate_series(0, 29) AS s) AS d LEFT JOIN pedidos AS p ON p.dia_local = d.dia AND p.cuenta_como_venta = true GROUP BY d.dia ORDER BY d.dia"],
  ["novedad_lista", "filas", "SELECT p.numero AS numero_pedido, p.id AS pedido_id, p.cliente_id, p.ciudad, p.estado, p.total, p.creado, p.dia_local FROM pedidos p CROSS JOIN hoy h WHERE p.estado = 'novedad' AND p.dia_local > h.hoy_local - 7 ORDER BY p.creado DESC"],
  ["recompra_60", "numero", "WITH compradores AS (SELECT p.cliente_id, COUNT(*) AS n FROM pedidos AS p CROSS JOIN hoy AS h WHERE p.cuenta_como_venta = true AND p.dia_local > h.hoy_local - 60 GROUP BY p.cliente_id) SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE 100.0 * COUNT(*) FILTER (WHERE n > 1) / COUNT(*) END AS valor FROM compradores"],
  ["mejores_clientes", "filas", "SELECT c.id AS cliente_id, c.nombre AS cliente, SUM(p.total) AS total_comprado, COUNT(*) AS numero_pedidos FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE p.cuenta_como_venta = true GROUP BY c.id, c.nombre ORDER BY total_comprado DESC LIMIT 10"],
  ["contadores_estado", "serie", "SELECT estado AS etiqueta, COUNT(*) AS valor FROM pedidos GROUP BY estado ORDER BY estado"],
  ["contadores_producto", "serie", "SELECT p.nombre AS etiqueta, COALESCE(SUM(pi.cantidad), 0) AS valor FROM productos p LEFT JOIN lineas_de_pedido pi ON pi.producto_id = p.id AND pi.cuenta_como_venta = true GROUP BY p.nombre ORDER BY valor DESC, etiqueta ASC"],
  ["ventas_dia_ciudad", "filas", "SELECT p.dia_local AS dia, p.ciudad AS ciudad, SUM(p.total) AS ventas_pesos FROM pedidos p CROSS JOIN hoy h WHERE p.cuenta_como_venta = true AND p.dia_local > h.hoy_local - 14 AND p.dia_local <= h.hoy_local GROUP BY p.dia_local, p.ciudad ORDER BY p.dia_local, p.ciudad"],
  ["ticket_ciudad", "serie", "SELECT p.ciudad AS etiqueta, ROUND(AVG(p.total)) AS valor FROM pedidos AS p JOIN hoy AS h ON p.dia_local > h.hoy_local - 30 WHERE p.cuenta_como_venta = true GROUP BY p.ciudad ORDER BY valor DESC"],
  ["primera_respuesta", "filas", "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos_primera_respuesta)::numeric AS mediana_segundos, percentile_cont(0.9) WITHIN GROUP (ORDER BY segundos_primera_respuesta)::numeric AS percentil_90_segundos FROM conversaciones, hoy WHERE conversaciones.dia_local > hoy.hoy_local - 30 AND conversaciones.segundos_primera_respuesta IS NOT NULL"],
  ["se_compran_juntos", "filas", "SELECT a.producto AS producto_1, b.producto AS producto_2, COUNT(*) AS numero_pedidos FROM lineas_de_pedido AS a JOIN lineas_de_pedido AS b ON b.pedido_id = a.pedido_id AND b.producto_id > a.producto_id WHERE a.cuenta_como_venta = true AND b.cuenta_como_venta = true GROUP BY a.producto_id, b.producto_id, a.producto, b.producto ORDER BY numero_pedidos DESC LIMIT 5"],
  ["cohortes_retencion", "filas", "WITH primera AS ( SELECT cliente_id, MIN(dia_local) AS primera_fecha, MIN(mes_local) AS mes_cohorte FROM pedidos WHERE cuenta_como_venta = true GROUP BY cliente_id ), retencion_cliente AS ( SELECT pr.cliente_id, pr.mes_cohorte, MAX(CASE WHEN p.dia_local > pr.primera_fecha AND p.dia_local <= pr.primera_fecha + 30 THEN 1 ELSE 0 END) AS volvio_30d, MAX(CASE WHEN p.dia_local > pr.primera_fecha AND p.dia_local <= pr.primera_fecha + 60 THEN 1 ELSE 0 END) AS volvio_60d, MAX(CASE WHEN p.dia_local > pr.primera_fecha AND p.dia_local <= pr.primera_fecha + 90 THEN 1 ELSE 0 END) AS volvio_90d FROM primera pr LEFT JOIN pedidos p ON p.cliente_id = pr.cliente_id AND p.cuenta_como_venta = true AND p.dia_local > pr.primera_fecha GROUP BY pr.cliente_id, pr.mes_cohorte ) SELECT mes_cohorte AS mes_primera_compra, COUNT(*) AS clientes_nuevos, COUNT(*) FILTER (WHERE volvio_30d = 1) AS volvieron_30d, ROUND(100.0 * COUNT(*) FILTER (WHERE volvio_30d = 1) / COUNT(*), 1) AS pct_volvieron_30d, COUNT(*) FILTER (WHERE volvio_60d = 1) AS volvieron_60d, ROUND(100.0 * COUNT(*) FILTER (WHERE volvio_60d = 1) / COUNT(*), 1) AS pct_volvieron_60d, COUNT(*) FILTER (WHERE volvio_90d = 1) AS volvieron_90d, ROUND(100.0 * COUNT(*) FILTER (WHERE volvio_90d = 1) / COUNT(*), 1) AS pct_volvieron_90d FROM retencion_cliente GROUP BY mes_cohorte ORDER BY mes_cohorte"],
  ["clientes_inactivos", "numero", "SELECT COUNT(*) AS valor FROM (SELECT cliente_id FROM pedidos WHERE cuenta_como_venta = true GROUP BY cliente_id HAVING MAX(dia_local) < (SELECT hoy_local - 45 FROM hoy)) AS t"],
  ["cancelados_ciudad", "serie", "SELECT p.ciudad AS etiqueta, ROUND(100.0 * COUNT(*) FILTER (WHERE p.estado = 'cancelado') / COUNT(*), 2) AS valor FROM pedidos p CROSS JOIN hoy h WHERE p.dia_local > h.hoy_local - 30 GROUP BY p.ciudad ORDER BY p.ciudad"],
  ["pedidos_por_hora", "serie", "WITH horas AS (SELECT generate_series(0, 23) AS h) SELECT horas.h::text AS etiqueta, COUNT(p.id) AS valor FROM horas LEFT JOIN pedidos p ON p.hora_local = horas.h AND p.dia_local > (SELECT hoy_local - 30 FROM hoy) GROUP BY horas.h ORDER BY horas.h"],
  ["casos_resolucion", "numero", "SELECT AVG(EXTRACT(EPOCH FROM (resuelto - creado)) / 3600.0) AS valor FROM casos WHERE resuelto IS NOT NULL"],
  ["ventas_semana", "filas", "SELECT SUM(CASE WHEN p.dia_local > h.hoy_local - 7 THEN p.total ELSE 0 END) AS ventas_ultimos_7_dias, SUM(CASE WHEN p.dia_local <= h.hoy_local - 7 AND p.dia_local > h.hoy_local - 14 THEN p.total ELSE 0 END) AS ventas_7_dias_anteriores FROM pedidos p, hoy h WHERE p.cuenta_como_venta = true AND p.dia_local > h.hoy_local - 14"],
  ["clientes_nuevos_mes", "serie", "SELECT to_char(mes_local, 'YYYY-MM') AS etiqueta, COUNT(*) AS valor FROM clientes GROUP BY mes_local ORDER BY mes_local"],
  ["pendientes_viejos", "filas", "SELECT p.numero AS numero_pedido, p.id AS pedido_id, p.cliente_id, p.ciudad, p.total, p.creado, p.dia_local AS dia_creado, (hoy.hoy_local - p.dia_local) AS dias_pendientes FROM pedidos p CROSS JOIN hoy WHERE p.estado = 'pendiente' AND p.dia_local < hoy.hoy_local - 3 ORDER BY p.creado ASC"],
]

const SET = /^SET y RESET/
const SET_CONFIG = /^set_config\(\)/

/**
 * Los 13 escapes de #12 (medir-segundo-anillo.mts), con neondb_owner donde decía n_B: aquí no hay rol por Negocio.
 * amanece_negocio no existe en esta base y un rol inexistente no prueba nada: en su lugar va neon_auth, el dueño de las cuentas. Neon frena antes, con otro mensaje, a neon_superuser y a los pg_*.
 * Cada uno es la lista de sentencias que corre crudo dentro del lote, cada sentencia con lo que el validador dice de ella.
 */
export const ESCAPES_DE_12: readonly (readonly [nombre: string, sentencias: readonly (readonly [sql: string, que: RegExp])[]])[] = [
  ['SET ROLE neondb_owner', [['SET ROLE neondb_owner', SET]]],
  ["set_config('role', 'neondb_owner', false)", [["select set_config('role', 'neondb_owner', false)", SET_CONFIG]]],
  ["SET LOCAL ROLE amanece_consultas y luego set_config('role', 'neondb_owner', true)", [['SET LOCAL ROLE amanece_consultas', SET], ["select set_config('role', 'neondb_owner', true)", SET_CONFIG]]],
  ['SET LOCAL ROLE amanece_consultas y luego SET ROLE neondb_owner', [['SET LOCAL ROLE amanece_consultas', SET], ['SET ROLE neondb_owner', SET]]],
  ['SET SESSION AUTHORIZATION neondb_owner', [['SET SESSION AUTHORIZATION neondb_owner', SET]]],
  ['SET ROLE neon_auth', [['SET ROLE neon_auth', SET]]],
  ['SET ROLE amanece_consultas', [['SET ROLE amanece_consultas', SET]]],
  ['ALTER ROLE amanece_consultas BYPASSRLS', [['ALTER ROLE amanece_consultas BYPASSRLS', /AlterRoleStmt/]]],
  ['leer pg_authid', [['select count(*) from pg_authid', /^pg_authid/]]],
  ['leer public.negocios', [['select count(*) from public.negocios', /^public\.negocios/]]],
  ['crear una función en public', [["create function public.f() returns int language sql as 'select 1'", /CreateFunctionStmt/]]],
  ['firmar_consulta(B)', [["select public.firmar_consulta('00000000-0000-4000-8000-00000000000b'::uuid)", /public\.firmar_consulta/]]],
  ['leer llave_de_consultas', [['select clave from public.llave_de_consultas', /^public\.llave_de_consultas/]]],
]

/** El ataque de #8: `set_config` dentro del SELECT cambia de Negocio en la misma sentencia. */
export const ataqueDe8 = (b: string) => `select count(*) as valor from pedidos p, (select set_config('app.negocio_id', '${b}', true)) s`

/** El mismo ataque escrito de otras maneras: el validador tiene que frenarlas todas. */
export const variantesDelAtaque = (b: string): readonly (readonly [nombre: string, sql: string])[] => [
  ['en mayúsculas', `SELECT COUNT(*) AS valor FROM pedidos p, (SELECT SET_CONFIG('app.negocio_id', '${b}', TRUE)) s`],
  ['con el nombre entre comillas', `select count(*) as valor from pedidos p, (select "set_config"('app.negocio_id', '${b}', true)) s`],
  ['con pg_catalog', `select count(*) as valor from pedidos p, (select pg_catalog.set_config('app.negocio_id', '${b}', true)) s`],
  ['anidado en una CTE', `with x as (select set_config('app.negocio_id', '${b}', true) as v) select count(*) as valor from pedidos, x`],
  ['en una subconsulta escalar', `select count(*) as valor from pedidos where (select set_config('app.negocio_id', '${b}', true)) is not null`],
  ['como argumento de otra función', `select count(*) as valor from pedidos where length(set_config('app.negocio_id', '${b}', true)) > 0`],
  ['con U&"…"', `select count(*) as valor from pedidos p, (select U&"set\\005fconfig"('app.negocio_id', '${b}', true)) s`],
  ["set_config('role', 'none', true)", "select count(*) as valor from pedidos p, (select set_config('role', 'none', true)) s"],
  ['current_setting', "select count(*) as valor from pedidos where current_setting('app.negocio_id') is not null"],
  ['en FROM como función', `select count(*) as valor from pedidos, set_config('app.negocio_id', '${b}', true) as s`],
]
