/**
 * Ejecuta una consulta ya validada en una transacción de Neon por HTTP: rol sin BYPASSRLS, el Negocio como
 * variable de la transacción y un tope de 2 s. Throwaway.
 */
import { neon } from '@neondatabase/serverless'
import { prologo } from './catalogo'

export type Fila = Record<string, unknown>
export type ResultadoDeEjecutar = { ok: true; filas: Fila[]; total: number; ms: number } | { ok: false; mensaje: string; ms: number }

const TOPE_DE_FILAS = 500

export function envolver(sql: string): string {
  return `${prologo()}\nSELECT to_jsonb(q) AS r, count(*) OVER () AS total FROM (\n${sql}\n) q LIMIT ${TOPE_DE_FILAS}`
}

export async function ejecutarAcotado(negocioId: string, sql: string, opciones: { url?: string; rol?: string } = {}): Promise<ResultadoDeEjecutar> {
  const url = opciones.url ?? process.env.DATABASE_URL!
  const rol = opciones.rol ?? 'amanece_consultas'
  const q = neon(url)
  const t0 = performance.now()
  try {
    const res = await q.transaction(
      [
        q.query(`SET LOCAL ROLE ${rol}`),
        q.query(`SELECT set_config('app.negocio_id', $1, true)`, [negocioId]),
        q.query(`SET LOCAL statement_timeout = '2s'`),
        q.query(envolver(sql), [negocioId]),
      ],
      { readOnly: true },
    )
    const filas = res[3] as { r: Fila; total: string | number }[]
    return { ok: true, filas: filas.map((f) => f.r), total: filas.length ? Number(filas[0].total) : 0, ms: performance.now() - t0 }
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : String(e), ms: performance.now() - t0 }
  }
}
