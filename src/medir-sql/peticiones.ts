/**
 * Los pedidos del Dueño y su verdad. La verdad es SQL escrito a mano sobre las tablas reales (no sobre las CTE del
 * catálogo), con la zona de Bogotá a la vista, así que también comprueba el catálogo. `$1` es el id del Negocio.
 */
import type { Forma } from './validar'

const L = (c: string) => `(${c} AT TIME ZONE 'America/Bogota')::date`
const HOY = `(now() AT TIME ZONE 'America/Bogota')::date`
const VENTA = `estado IN ('confirmado','enviado','entregado','novedad')`

export type Comparador =
  | { tipo: 'filas'; tolAbs?: number; mes?: boolean }
  | { tipo: 'ventana_libre'; minimoDeDias: number }
  | { tipo: 'valores'; tolAbs?: number }

export type Peticion = {
  id: string
  origen: 'medida antes' | 'pedida' | 'propia'
  texto: string
  forma: Forma
  esperado: 'respuesta' | 'declinar'
  verdad: string | null
  comparador: Comparador
  nota?: string
}

export const PETICIONES: Peticion[] = [
  {
    id: 'confirmados_por_dia', origen: 'medida antes', texto: 'Quiero ver los pedidos confirmados por día.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT to_char(${L('creado')},'YYYY-MM-DD') AS etiqueta, count(*) AS valor FROM pedidos WHERE negocio_id = $1 AND ${VENTA} GROUP BY 1`,
    comparador: { tipo: 'ventana_libre', minimoDeDias: 7 }, nota: 'El pedido no dice cuántos días: vale cualquier ventana si cada día coincide con la base.',
  },
  {
    id: 'confirmados_30_dias', origen: 'pedida', texto: 'Quiero ver los pedidos confirmados por día en los últimos 30 días.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT to_char(${L('creado')},'YYYY-MM-DD') AS etiqueta, count(*) AS valor FROM pedidos WHERE negocio_id = $1 AND ${VENTA} AND ${L('creado')} > ${HOY} - 30 GROUP BY 1`,
    comparador: { tipo: 'filas' }, nota: 'Es el caso que dio 1656 en vez de 2752 con el generador JS actual.',
  },
  {
    id: 'novedad_lista', origen: 'medida antes', texto: 'Quiero ver una lista de los pedidos con novedad de los últimos 7 días.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `SELECT numero FROM pedidos WHERE negocio_id = $1 AND estado = 'novedad' AND ${L('creado')} > ${HOY} - 7`,
    comparador: { tipo: 'filas' },
  },
  {
    id: 'recompra_60', origen: 'medida antes', texto: 'Porcentaje de clientes que me compró más de una vez en los últimos 60 días.', forma: { tipo: 'numero' }, esperado: 'respuesta',
    verdad: `WITH c AS (SELECT cliente_id, count(*) n FROM pedidos WHERE negocio_id = $1 AND ${VENTA} AND ${L('creado')} > ${HOY} - 60 GROUP BY 1) SELECT round(100.0 * count(*) FILTER (WHERE n > 1) / count(*), 1) AS valor FROM c`,
    comparador: { tipo: 'filas', tolAbs: 0.51 },
  },
  {
    id: 'mejores_clientes', origen: 'medida antes', texto: 'Mis 10 mejores clientes por total comprado.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `SELECT c.nombre, sum(p.total) AS total FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE p.negocio_id = $1 AND c.negocio_id = $1 AND p.${VENTA} GROUP BY c.id, c.nombre ORDER BY 2 DESC, 1 LIMIT 10`,
    comparador: { tipo: 'filas' },
  },
  {
    id: 'margen_producto', origen: 'medida antes', texto: 'Margen de ganancia por producto.', forma: { tipo: 'filas' }, esperado: 'declinar', verdad: null, comparador: { tipo: 'filas' },
    nota: 'productos.noTrae: costo y margen.',
  },
  {
    id: 'dias_confirmado_entregado', origen: 'medida antes', texto: 'Días promedio de confirmado a entregado.', forma: { tipo: 'numero' }, esperado: 'declinar', verdad: null, comparador: { tipo: 'filas' },
    nota: 'pedidos.noTrae: cuándo se confirmó o se entregó. Con JS dio 0 días y el sistema lo aceptó.',
  },
  {
    id: 'lo_que_escribio', origen: 'medida antes', texto: 'Conversaciones de hoy con lo que escribió cada cliente.', forma: { tipo: 'filas' }, esperado: 'declinar', verdad: null, comparador: { tipo: 'filas' },
    nota: 'conversaciones.noTrae: el texto. Con JS dio 0 filas y el agente dijo que mostraba lo que escribieron.',
  },
  {
    id: 'contadores_estado', origen: 'pedida', texto: 'Cuántos pedidos tengo en cada estado.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT estado AS etiqueta, count(*) AS valor FROM pedidos WHERE negocio_id = $1 GROUP BY 1`, comparador: { tipo: 'filas' },
  },
  {
    id: 'contadores_producto', origen: 'pedida', texto: 'Cuántas unidades he vendido de cada producto.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT i->>'nombre' AS etiqueta, sum((i->>'cantidad')::int) AS valor FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.items) i WHERE p.negocio_id = $1 AND p.${VENTA} GROUP BY 1`,
    comparador: { tipo: 'filas' },
  },
  {
    id: 'ventas_dia_ciudad', origen: 'pedida', texto: 'Ventas en pesos por día y por ciudad de los últimos 14 días.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `SELECT ${L('creado')} AS dia, ciudad, sum(total) AS ventas FROM pedidos WHERE negocio_id = $1 AND ${VENTA} AND ${L('creado')} > ${HOY} - 14 GROUP BY 1, 2`, comparador: { tipo: 'filas' },
  },
  {
    id: 'ticket_ciudad', origen: 'pedida', texto: 'Ticket promedio por ciudad.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT ciudad AS etiqueta, avg(total) AS valor FROM pedidos WHERE negocio_id = $1 AND ${VENTA} GROUP BY 1`, comparador: { tipo: 'filas', tolAbs: 1 },
  },
  {
    id: 'primera_respuesta', origen: 'pedida', texto: 'Tiempo de primera respuesta del agente: mediana y percentil 90, en segundos, de los últimos 30 días.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `WITH m AS (SELECT cliente_id, rol, creado, ${L('creado')} AS d FROM mensajes_cliente WHERE negocio_id = $1),
      ini AS (SELECT cliente_id, d, min(creado) FILTER (WHERE rol = 'cliente') AS inicio FROM m GROUP BY 1, 2),
      resp AS (SELECT i.cliente_id, i.d, i.inicio, min(m.creado) FILTER (WHERE m.rol = 'agente' AND m.creado >= i.inicio) AS r FROM ini i JOIN m ON m.cliente_id = i.cliente_id AND m.d = i.d WHERE i.inicio IS NOT NULL GROUP BY 1, 2, 3)
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r - inicio)) AS mediana, percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM r - inicio)) AS p90 FROM resp WHERE r IS NOT NULL AND d > ${HOY} - 30`,
    comparador: { tipo: 'valores', tolAbs: 0.5 },
  },
  {
    id: 'se_compran_juntos', origen: 'pedida', texto: 'Qué pares de productos se compran juntos con más frecuencia en pedidos confirmados. Dame los 5 pares más frecuentes y en cuántos pedidos aparece cada par.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `WITH it AS (SELECT p.id AS pid, i->>'nombre' AS n FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.items) i WHERE p.negocio_id = $1 AND p.${VENTA})
      SELECT a.n AS producto_a, b.n AS producto_b, count(*) AS pedidos FROM it a JOIN it b ON a.pid = b.pid AND a.n < b.n GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2 LIMIT 5`,
    comparador: { tipo: 'filas' },
  },
  {
    id: 'cohortes_retencion', origen: 'pedida', texto: 'Cohortes de retención: para cada mes de primera compra, cuántos clientes empezaron ese mes y qué porcentaje volvió a comprar dentro de los 30, 60 y 90 días siguientes a su primera compra. Usa todos los meses, aunque estén incompletos.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `WITH v AS (SELECT cliente_id, ${L('creado')} AS d FROM pedidos WHERE negocio_id = $1 AND ${VENTA}),
      p AS (SELECT cliente_id, min(d) AS d0 FROM v GROUP BY 1),
      r AS (SELECT p.cliente_id, date_trunc('month', p.d0)::date AS mes,
        bool_or(v.d > p.d0 AND v.d <= p.d0 + 30) AS r30, bool_or(v.d > p.d0 AND v.d <= p.d0 + 60) AS r60, bool_or(v.d > p.d0 AND v.d <= p.d0 + 90) AS r90
        FROM p JOIN v USING (cliente_id) GROUP BY 1, 2)
      SELECT mes, count(*) AS clientes, round(100.0 * count(*) FILTER (WHERE r30) / count(*), 1) AS ret30, round(100.0 * count(*) FILTER (WHERE r60) / count(*), 1) AS ret60, round(100.0 * count(*) FILTER (WHERE r90) / count(*), 1) AS ret90 FROM r GROUP BY mes`,
    comparador: { tipo: 'filas', tolAbs: 0.51, mes: true },
  },
  {
    id: 'clientes_inactivos', origen: 'propia', texto: 'Cuántos clientes que ya me compraron llevan más de 45 días sin comprar.', forma: { tipo: 'numero' }, esperado: 'respuesta',
    verdad: `SELECT count(*) AS valor FROM (SELECT cliente_id, max(${L('creado')}) AS ult FROM pedidos WHERE negocio_id = $1 AND ${VENTA} GROUP BY 1) x WHERE ult < ${HOY} - 45`, comparador: { tipo: 'filas' },
  },
  {
    id: 'cancelados_ciudad', origen: 'propia', texto: 'Porcentaje de pedidos cancelados por ciudad en los últimos 30 días.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT ciudad AS etiqueta, round(100.0 * count(*) FILTER (WHERE estado = 'cancelado') / count(*), 1) AS valor FROM pedidos WHERE negocio_id = $1 AND ${L('creado')} > ${HOY} - 30 GROUP BY 1`, comparador: { tipo: 'filas', tolAbs: 0.51 },
  },
  {
    id: 'pedidos_por_hora', origen: 'propia', texto: 'Cuántos pedidos me llegan en cada hora del día, en hora local.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT extract(hour FROM creado AT TIME ZONE 'America/Bogota')::int AS etiqueta, count(*) AS valor FROM pedidos WHERE negocio_id = $1 GROUP BY 1`, comparador: { tipo: 'filas' },
    nota: 'Pone a prueba la zona: en UTC las horas salen corridas 5.',
  },
  {
    id: 'casos_resolucion', origen: 'propia', texto: 'Cuántas horas tardan en promedio en resolverse los Casos que ya se resolvieron.', forma: { tipo: 'numero' }, esperado: 'respuesta',
    verdad: `SELECT avg(extract(epoch FROM resuelto - creado) / 3600) AS valor FROM casos WHERE negocio_id = $1 AND resuelto IS NOT NULL`, comparador: { tipo: 'filas', tolAbs: 0.06 },
  },
  {
    id: 'ventas_semana', origen: 'propia', texto: 'Ventas en pesos de los últimos 7 días y de los 7 días anteriores a esos.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `SELECT sum(total) FILTER (WHERE ${L('creado')} > ${HOY} - 7) AS ultimos_7, sum(total) FILTER (WHERE ${L('creado')} > ${HOY} - 14 AND ${L('creado')} <= ${HOY} - 7) AS anteriores_7 FROM pedidos WHERE negocio_id = $1 AND ${VENTA}`, comparador: { tipo: 'valores' },
  },
  {
    id: 'clientes_nuevos_mes', origen: 'propia', texto: 'Cuántos clientes nuevos me entraron cada mes.', forma: { tipo: 'serie' }, esperado: 'respuesta',
    verdad: `SELECT date_trunc('month', creado AT TIME ZONE 'America/Bogota')::date AS etiqueta, count(*) AS valor FROM clientes WHERE negocio_id = $1 GROUP BY 1`, comparador: { tipo: 'filas', mes: true },
  },
  {
    id: 'pendientes_viejos', origen: 'propia', texto: 'Lista de pedidos que siguen pendientes y llevan más de 3 días.', forma: { tipo: 'filas' }, esperado: 'respuesta',
    verdad: `SELECT numero FROM pedidos WHERE negocio_id = $1 AND estado = 'pendiente' AND ${L('creado')} < ${HOY} - 3`, comparador: { tipo: 'filas' },
  },
  {
    id: 'costo_envios', origen: 'propia', texto: 'Cuánto he gastado en envíos este mes.', forma: { tipo: 'numero' }, esperado: 'declinar', verdad: null, comparador: { tipo: 'filas' },
    nota: 'pedidos.noTrae: costo de envío.',
  },
]

export const FORMA_TEXTO: Record<Forma['tipo'], string> = {
  numero: 'una sola fila con una sola columna llamada valor',
  serie: 'filas con exactamente dos columnas: etiqueta y valor',
  filas: 'una tabla: las columnas que hagan falta, con nombres claros en español',
}

type Valor = string | number | boolean | null

function canon(v: unknown, mes: boolean): Valor {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  const s = String(v).trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^\d{1,2}:00$/.test(s)) return Number(s.slice(0, s.indexOf(':')))
  if (mes && /^\d{4}-\d{2}/.test(s)) return s.slice(0, 7)
  return s.toLowerCase()
}

function iguales(g: Valor, m: Valor, tolAbs: number): boolean {
  if (typeof g === 'number' && typeof m === 'number') {
    const t = tolAbs > 0 ? tolAbs : Number.isInteger(g) ? 0 : 0.05
    return Math.abs(g - m) <= t + (t > 0 ? 0.001 * Math.abs(g) : 0) + 1e-9
  }
  return g === m
}

/** Cada fila de la verdad tiene que estar contenida en una fila distinta del resultado (que puede traer columnas de más). */
export function comparar(verdad0: Record<string, unknown>[], obtenido0: Record<string, unknown>[], c: Comparador, ignorarCeros = false): { ok: boolean; razon: string } {
  const sinCeros = (xs: Record<string, unknown>[]) => (ignorarCeros ? xs.filter((f) => !('valor' in f) || Number(f.valor) !== 0) : xs)
  const verdad = sinCeros(verdad0)
  const obtenido = sinCeros(obtenido0)
  if (c.tipo === 'ventana_libre') {
    const mapa = new Map(verdad.map((r) => [String(r.etiqueta), Number(r.valor)]))
    if (obtenido.length < c.minimoDeDias) return { ok: false, razon: `solo ${obtenido.length} días` }
    for (const fila of obtenido) {
      const vals = Object.values(fila)
      const dia = vals.find((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) as string | undefined
      const n = vals.find((v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)))
      if (!dia) return { ok: false, razon: 'una fila sin fecha' }
      const esperado = mapa.get(dia.slice(0, 10)) ?? 0
      if (Number(n) !== esperado) return { ok: false, razon: `${dia.slice(0, 10)}: ${n} y la base dice ${esperado}` }
    }
    return { ok: true, razon: `${obtenido.length} días, todos coinciden` }
  }
  if (c.tipo === 'valores') {
    const libres = obtenido.flatMap((f) => Object.values(f)).map((v) => canon(v, false))
    for (const g of verdad.flatMap((f) => Object.values(f)).map((v) => canon(v, false))) {
      const k = libres.findIndex((y) => iguales(g, y, c.tolAbs ?? 0))
      if (k < 0) return { ok: false, razon: `no encuentro el valor ${JSON.stringify(g)}` }
      libres.splice(k, 1)
    }
    return { ok: true, razon: 'los valores coinciden (sin importar cómo vengan repartidos en filas)' }
  }
  const mes = Boolean(c.mes)
  const tol = c.tolAbs ?? 0
  if (verdad.length !== obtenido.length) return { ok: false, razon: `${obtenido.length} filas y la base dice ${verdad.length}` }
  const usadas = new Set<number>()
  const modelo = obtenido.map((f) => Object.values(f).map((v) => canon(v, mes)))
  for (const g of verdad) {
    const gv = Object.values(g).map((v) => canon(v, mes))
    const j = modelo.findIndex((m, i) => {
      if (usadas.has(i)) return false
      const libres = [...m]
      return gv.every((x) => {
        const k = libres.findIndex((y) => iguales(x, y, tol))
        if (k < 0) return false
        libres.splice(k, 1)
        return true
      })
    })
    if (j < 0) return { ok: false, razon: `no encuentro la fila ${JSON.stringify(g)}` }
    usadas.add(j)
  }
  return { ok: true, razon: `${verdad.length} filas coinciden` }
}
