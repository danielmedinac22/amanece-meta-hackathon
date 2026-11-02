/**
 * El lote HTTP de una consulta: una transacción de solo lectura, con su propia conexión de `amanece_consultas`, y el
 * Negocio y su firma fijados con `LOCAL`. Único `neon(…)` de `src/` fuera de `db/index.ts` (eslint).
 */
import { neon } from '@neondatabase/serverless'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import type { EstadoDelNegocio } from '../estado'
import { claveDeProducto } from '../estado/elementos'
import { COLUMNAS, prologo } from './catalogo'
import type { ConsultaValidada, ErrorDeConsulta, Filas, NombreDeFuente } from './tipos'

export const FILAS_POR_CONSULTA = 500
export const TOPE_DE_UNA_CONSULTA = '2s'

export type ResultadoDeEjecutar =
  | {
      readonly tipo: 'filas'
      readonly filas: Filas
      /** Cuántas había antes del `LIMIT`: `count(*) OVER ()` corre antes de recortar. */
      readonly total: number
      /** Filas de cada fuente que la consulta usa, en este Negocio. Con esto se sabe `resultado_vacio_con_datos`. */
      readonly filasPorFuente: Readonly<Partial<Record<NombreDeFuente, number>>>
      readonly ms: number
    }
  | { readonly tipo: 'error'; readonly error: Extract<ErrorDeConsulta, { tipo: 'postgres' | 'dato_inexistente' }>; readonly ms: number }
  /** Falta `DATABASE_URL_CONSULTAS`. Es de configuración, no de lo que pidió el Dueño: no es una Capacidad faltante ni un intento del redactor. */
  | { readonly tipo: 'sin_configurar'; readonly ms: 0 }

/** Una sentencia del lote, como dato: `probar-aislamiento` lo lee y lo muta. */
export type Sentencia = { readonly texto: string; readonly parametros: readonly unknown[] }

/** Los tres parámetros del prólogo: el Negocio, su zona y sus productos vigentes (del estado o del borrador). */
export function parametrosDelPrologo(estado: EstadoDelNegocio): readonly [string, string, string] {
  const productos = estado.vigentes('producto').map((v) => ({ id: claveDeProducto.aId(v.clave), nombre: v.elemento.nombre, precio: v.elemento.precio, activo: v.elemento.activo }))
  return [estado.identidad.id, estado.identidad.zonaHoraria, JSON.stringify(productos)]
}

const firmas = new Map<string, Promise<string>>()

/** La firma del Negocio, por la conexión del dueño, una vez por proceso: la llave nunca sale de la base. Una que falla no queda guardada. */
export function firmaDe(negocio: string): Promise<string> {
  const ya = firmas.get(negocio)
  if (ya) return ya
  const firma = db.execute(sql`SELECT public.firmar_consulta(${negocio}::uuid) AS firma`).then((r) => (r.rows[0] as { firma: string }).firma)
  firmas.set(negocio, firma)
  firma.catch(() => firmas.delete(negocio))
  return firma
}

export const hayConexionDeConsultas = () => Boolean(process.env.DATABASE_URL_CONSULTAS)

/**
 * Puro. El lote entero, en orden. `RESET ALL` y `RESET ROLE` primero, porque una petición HTTP a Neon hereda lo que
 * otra fijó sin `LOCAL` (80 de 120 lotes en #28; 0 con el `RESET`). Después el `search_path` vacío (el prólogo
 * califica `public.`), el Negocio y su firma con `is_local = true`, el tope, la consulta envuelta y el conteo de las
 * fuentes que usa.
 */
export function armarLote(estado: EstadoDelNegocio, consulta: ConsultaValidada, firma: string): readonly Sentencia[] {
  const parametros = parametrosDelPrologo(estado)
  const orden = consulta.orden.length ? `ORDER BY ${consulta.orden.map((o) => `q."${o.columna}"${o.descendente ? ' DESC' : ''}`).join(', ')}` : ''
  const conteos = consulta.fuentes.map((f) => `'${f}', (SELECT count(*) FROM ${f})`).join(', ')
  return [
    { texto: 'RESET ALL', parametros: [] },
    { texto: 'RESET ROLE', parametros: [] },
    { texto: "SET LOCAL search_path = ''", parametros: [] },
    { texto: "SELECT set_config('app.negocio_id', $1, true), set_config('app.firma', $2, true)", parametros: [estado.identidad.id, firma] },
    { texto: `SET LOCAL statement_timeout = '${TOPE_DE_UNA_CONSULTA}'`, parametros: [] },
    { texto: `WITH ${prologo()}\nSELECT to_jsonb(q) AS fila, count(*) OVER () AS total FROM (\n${consulta.sql}\n) AS q ${orden} LIMIT ${FILAS_POR_CONSULTA}`, parametros },
    { texto: `WITH ${prologo()}\nSELECT jsonb_build_object(${conteos}) AS por_fuente`, parametros },
  ]
}

/** Las sentencias que van antes de la consulta: lo que comparten `ejecutar` y la sonda de `probar-aislamiento`. */
export const PREAMBULO = 5

const CLASES: Partial<Record<string, string>> = {
  '57014': 'tardó más de 2 segundos',
  '22012': 'divide por cero',
  '22P02': 'un valor no tiene el tipo que la consulta espera',
  '22007': 'una fecha no es válida',
  '22008': 'una fecha está fuera de rango',
  '22003': 'un número está fuera de rango',
  '21000': 'una subconsulta devolvió más de una fila',
  '42883': 'una función o un operador no existe para esos tipos',
  '42804': 'los tipos no coinciden',
  '42P01': 'una fuente no existe',
  '42803': 'una columna tiene que ir en GROUP BY o dentro de un agregado',
  '42702': 'una columna es ambigua: califícala con su fuente',
  '42601': 'hay un error de sintaxis',
  '42501': 'no tiene permiso',
  '25006': 'solo se lee',
}

/**
 * Lo que vuelve de un error de Postgres. El mensaje crudo puede citar el valor de una fila (un 22P02 con el nombre
 * de un Cliente): al redactor y a la tarjeta llegan el SQLSTATE, su clase en palabras y solo los nombres entre
 * comillas que ya estaban en su propio SQL. Un 42703 es un `dato_inexistente` con los campos de las fuentes que usa.
 */
export function sanear(e: unknown, consulta: ConsultaValidada): Extract<ErrorDeConsulta, { tipo: 'postgres' | 'dato_inexistente' }> {
  const codigo = typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'desconocido'
  const crudo = e instanceof Error ? e.message : ''
  const sql = consulta.sql.toLowerCase()
  const nombres = [...crudo.matchAll(/"([^"]{1,63})"/g)].map((m) => m[1]).filter((n) => new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sql))
  if (codigo === '42703') return { tipo: 'dato_inexistente', fuente: consulta.fuentes.join(', ') || 'ninguna', campo: nombres.at(-1)?.split('.').at(-1) ?? null, hay: consulta.fuentes.flatMap((f) => COLUMNAS[f]) }
  const clase = CLASES[codigo] ?? (codigo.startsWith('22') ? 'un dato no sirvió para la operación' : codigo.startsWith('42') ? 'la consulta no es válida' : 'Postgres la rechazó')
  return { tipo: 'postgres', codigo, mensaje: `${clase} (SQLSTATE ${codigo})${nombres.length ? `; nombres: ${[...new Set(nombres)].join(', ')}` : ''}` }
}

/** Una petición HTTP, una transacción de solo lectura. Un error de Postgres vuelve saneado, sin filas. */
export async function ejecutar(estado: EstadoDelNegocio, consulta: ConsultaValidada): Promise<ResultadoDeEjecutar> {
  const url = process.env.DATABASE_URL_CONSULTAS
  if (!url) {
    console.error('[consultas] falta DATABASE_URL_CONSULTAS: no corre ninguna consulta')
    return { tipo: 'sin_configurar', ms: 0 }
  }
  const q = neon(url)
  const inicio = performance.now()
  try {
    const lote = armarLote(estado, consulta, await firmaDe(estado.identidad.id))
    const r = (await q.transaction((t) => lote.map((s) => t.query(s.texto, [...s.parametros])), { readOnly: true })) as unknown as Record<string, unknown>[][]
    const filas = r[PREAMBULO] as { fila: Record<string, string | number | boolean | null>; total: string | number }[]
    const [conteo] = r[PREAMBULO + 1] as { por_fuente: Record<string, string | number> }[]
    const filasPorFuente = Object.fromEntries(Object.entries(conteo?.por_fuente ?? {}).map(([f, n]) => [f, Number(n)]))
    return { tipo: 'filas', filas: filas.map((f) => f.fila), total: Number(filas[0]?.total ?? 0), filasPorFuente, ms: performance.now() - inicio }
  } catch (e) {
    return { tipo: 'error', error: sanear(e, consulta), ms: performance.now() - inicio }
  }
}
