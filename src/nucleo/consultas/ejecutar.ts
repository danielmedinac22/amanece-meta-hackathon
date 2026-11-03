/**
 * El lote HTTP de una consulta: una transacción de solo lectura, con su propia conexión de `amanece_consultas`, y el
 * Negocio y su firma fijados con `LOCAL`. Único `neon(…)` de `src/` fuera de `db/index.ts` (eslint).
 */
import { neon } from '@neondatabase/serverless'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import type { EstadoDelNegocio } from '../estado'
import { claveDeProducto } from '../estado/elementos'
import { COLUMNAS, FUENTES, prologo } from './catalogo'
import type { ConsultaValidada, ErrorDeConsulta, Filas, NombreDeFuente, TipoDeSalida } from './tipos'

export const FILAS_POR_CONSULTA = 500
export const TOPE_DE_UNA_CONSULTA = '2s'
/** `statement_timeout` no cubre la red: una petición colgada retendría el Panel entero. Alcanza para la consulta y el conteo. */
const TOPE_DE_LA_PETICION_MS = 5000

export type ResultadoDeEjecutar =
  | {
      readonly tipo: 'filas'
      readonly filas: Filas
      /** Cuántas había antes del `LIMIT`: `count(*) OVER ()` corre antes de recortar. */
      readonly total: number
      /** Filas de cada fuente que usa y lee una tabla, en este Negocio. Con esto se sabe `resultado_vacio_con_datos`: `hoy` siempre tiene una. */
      readonly filasPorFuente: Readonly<Partial<Record<NombreDeFuente, number>>>
      readonly ms: number
    }
  | { readonly tipo: 'error'; readonly error: Extract<ErrorDeConsulta, { tipo: 'postgres' | 'dato_inexistente' }>; readonly ms: number }
  /** `DATABASE_URL_CONSULTAS` falta o no parsea. Es de configuración, no de lo que pidió el Dueño: no es una Capacidad faltante ni un intento del redactor. */
  | { readonly tipo: 'sin_configurar'; readonly ms: 0 }
  /** La base no atendió: red, contraseña, `0004` sin aplicar o la firma. Tampoco es culpa de lo que pidió el Dueño. `codigo` es el SQLSTATE o `SIN_CODIGO`, nunca un mensaje. */
  | { readonly tipo: 'no_disponible'; readonly codigo: string; readonly ms: number }

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
  const pedida = db.execute(sql`SELECT public.firmar_consulta(${negocio}::uuid) AS firma`).then((r) => {
    const firma = (r.rows[0] as { firma: string | null } | undefined)?.firma
    if (!firma) throw new Error('firmar_consulta no devolvió una firma')
    return firma
  })
  const tope = new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('la firma tardó demasiado')), TOPE_DE_LA_PETICION_MS).unref())
  const firma = Promise.race([pedida, tope])
  firmas.set(negocio, firma)
  firma.catch(() => firmas.delete(negocio))
  return firma
}

/**
 * El cliente del lote, o null si la variable falta o no tiene la forma que pide el driver. `neon` no lanza al
 * construirse: lanzaría al correr, con la URL y su contraseña en el mensaje. Nunca cae a la conexión del dueño.
 */
function conexionDeConsultas() {
  const url = process.env.DATABASE_URL_CONSULTAS
  try {
    if (!url) throw new Error('falta')
    const { protocol, username, password, hostname, pathname } = new URL(url)
    if (!/^postgres(ql)?:$/.test(protocol) || !username || !password || !hostname || pathname.length < 2) throw new Error('no parsea')
    return neon(url)
  } catch {
    console.error('[consultas] DATABASE_URL_CONSULTAS falta o no es una URL de Postgres: no corre ninguna consulta')
    return null
  }
}

export const hayConexionDeConsultas = () => conexionDeConsultas() !== null

/**
 * Puro. El lote entero, en orden. `RESET ALL` y `RESET ROLE` primero, porque una petición HTTP a Neon hereda lo que
 * otra fijó sin `LOCAL` (80 de 120 lotes en #28; 0 con el `RESET`). Después el `search_path` vacío (el prólogo
 * califica `public.`), el Negocio, su firma y su zona con `is_local = true`, el tope, la consulta envuelta y el conteo
 * de las fuentes que usa.
 */
export function armarLote(estado: EstadoDelNegocio, consulta: ConsultaValidada, firma: string): readonly Sentencia[] {
  const parametros = parametrosDelPrologo(estado)
  const orden = consulta.orden.length ? `ORDER BY ${consulta.orden.map((o) => `q."${o.columna.replaceAll('"', '""')}"${o.descendente ? ' DESC' : ''}`).join(', ')}` : ''
  const conteos = consulta.fuentes
    .filter((f) => Object.keys(FUENTES[f].lee).length > 0)
    .map((f) => `'${f}', (SELECT count(*) FROM ${f})`)
    .join(', ')
  return [
    { texto: 'RESET ALL', parametros: [] },
    { texto: 'RESET ROLE', parametros: [] },
    { texto: "SET LOCAL search_path = ''", parametros: [] },
    { texto: "SELECT set_config('app.negocio_id', $1, true), set_config('app.firma', $2, true), set_config('TimeZone', $3, true)", parametros: [estado.identidad.id, firma, estado.identidad.zonaHoraria] },
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
  '25006': 'solo se lee',
}

/** Un `valor` vacío es un número que todavía no hay; uno que no se puede leer como número (un uuid, un nombre) es otra cosa. */
export const numero = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const noEsNumero = (v: unknown) => v !== null && v !== undefined && numero(v) === null

/**
 * Puro. Lo que depende de los datos y el validador no ve. Un `numero` es una fila: con más, `filas[0]` sería una cifra
 * arbitraria. En `numero` y `serie`, `valor` es un número: si no, el Panel diría "sin datos" sobre una consulta que sí trajo filas.
 */
export function formaDelResultado(salida: TipoDeSalida, r: { readonly total: number; readonly filas: Filas }): Extract<ErrorDeConsulta, { tipo: 'forma' }> | null {
  if (salida === 'filas') return null
  if (salida === 'numero' && r.total > 1) return { tipo: 'forma', esperada: 'numero', hay: [`${r.total} filas`] }
  return r.filas.some((f) => noEsNumero(f.valor)) ? { tipo: 'forma', esperada: salida, hay: ['un valor que no es un número'] } : null
}

export const SIN_CODIGO = 'sin_codigo'

/**
 * El SQLSTATE de un error, también el que drizzle envuelve en `cause`. Un error de red no lo trae, ni una contraseña
 * mala por HTTP (medido: `code` vacío), y su mensaje puede traer la URL: lo único que se loguea es esto.
 */
export function codigoDe(e: unknown): string {
  const codigo = typeof e === 'object' && e !== null ? ((e as { code?: unknown }).code ?? (e as { cause?: { code?: unknown } }).cause?.code) : null
  return typeof codigo === 'string' && /^[0-9A-Z]{5}$/.test(codigo) ? codigo : SIN_CODIGO
}

const CLASES_SIN_SERVICIO = /^(08|28|3D|53|57P)/
const DEL_PUENTE = /public\.(consultas_negocio|firmar_consulta|hmac|llave_de_consultas)/

/**
 * Puro. La base no atendió, y no hay nada que el redactor pueda corregir en su SQL: sin SQLSTATE, sin conexión o
 * sin autenticar, o falta el puente de `0004`. Un 42501 siempre es esto: lo validado solo llega a columnas con GRANT,
 * así que solo puede ser la firma o una migración a medias.
 */
export function esNoDisponible(e: unknown): boolean {
  const codigo = codigoDe(e)
  if (codigo === SIN_CODIGO || codigo === '42501' || CLASES_SIN_SERVICIO.test(codigo)) return true
  return (codigo === '42883' || codigo === '42P01') && DEL_PUENTE.test(e instanceof Error ? e.message : '')
}

/**
 * Lo que vuelve de un error de Postgres. El mensaje crudo puede citar el valor de una fila (un 22P02 con el nombre
 * de un Cliente): al redactor y a la tarjeta llegan el SQLSTATE, su clase en palabras y solo los nombres entre
 * comillas que ya estaban en su propio SQL. Un 42703 es un `dato_inexistente` con los campos de las fuentes que usa.
 */
export function sanear(e: unknown, consulta: ConsultaValidada): Extract<ErrorDeConsulta, { tipo: 'postgres' | 'dato_inexistente' }> {
  const codigo = codigoDe(e)
  const crudo = e instanceof Error ? e.message : ''
  const sql = consulta.sql.toLowerCase()
  const nombres = [...crudo.matchAll(/"([^"]{1,63})"/g)].map((m) => m[1]).filter((n) => new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sql))
  if (codigo === '42703') return { tipo: 'dato_inexistente', fuente: consulta.fuentes.join(', ') || 'ninguna', campo: nombres.at(-1)?.split('.').at(-1) ?? null, hay: consulta.fuentes.flatMap((f) => COLUMNAS[f]) }
  const clase = CLASES[codigo] ?? (codigo.startsWith('22') ? 'un dato no sirvió para la operación' : codigo.startsWith('42') ? 'la consulta no es válida' : 'Postgres la rechazó')
  return { tipo: 'postgres', codigo, mensaje: `${clase} (SQLSTATE ${codigo})${nombres.length ? `; nombres: ${[...new Set(nombres)].join(', ')}` : ''}` }
}

/** Una petición HTTP con su tope, una transacción de solo lectura. Un error de Postgres vuelve saneado, sin filas. */
export async function ejecutar(estado: EstadoDelNegocio, consulta: ConsultaValidada): Promise<ResultadoDeEjecutar> {
  const q = conexionDeConsultas()
  if (!q) return { tipo: 'sin_configurar', ms: 0 }
  const negocio = estado.identidad.id
  const inicio = performance.now()
  const ms = () => performance.now() - inicio
  let firma: string
  try {
    firma = await firmaDe(negocio)
  } catch (e) {
    return { tipo: 'no_disponible', codigo: codigoDe(e), ms: ms() }
  }
  try {
    const lote = armarLote(estado, consulta, firma)
    const r = (await q.transaction((t) => lote.map((s) => t.query(s.texto, [...s.parametros])), { readOnly: true, fetchOptions: { signal: AbortSignal.timeout(TOPE_DE_LA_PETICION_MS) } })) as unknown as Record<string, unknown>[][]
    const filas = r[PREAMBULO] as { fila: Record<string, string | number | boolean | null>; total: string | number }[]
    const [conteo] = r[PREAMBULO + 1] as { por_fuente: Record<string, string | number> }[]
    const filasPorFuente = Object.fromEntries(Object.entries(conteo?.por_fuente ?? {}).map(([f, n]) => [f, Number(n)]))
    return { tipo: 'filas', filas: filas.map((f) => f.fila), total: Number(filas[0]?.total ?? 0), filasPorFuente, ms: ms() }
  } catch (e) {
    if (codigoDe(e) === '42501') firmas.delete(negocio)
    return esNoDisponible(e) ? { tipo: 'no_disponible', codigo: codigoDe(e), ms: ms() } : { tipo: 'error', error: sanear(e, consulta), ms: ms() }
  }
}
