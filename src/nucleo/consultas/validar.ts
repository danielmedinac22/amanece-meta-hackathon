/**
 * El validador del SQL acotado, sobre el AST real de Postgres (`libpg-query` 18.1.5). Único importador de
 * `libpg-query` (eslint). En Next necesita `serverExternalPackages`: empaquetado, el WASM no carga.
 */
import { loadModule, parseSync } from 'libpg-query'

let cargado: Promise<void> | null = null
const cargar = () => (cargado ??= loadModule())

/** Hasta el validador completo: parsea y exige un solo SELECT. */
export async function validarConsulta(sql: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  await cargar()
  try {
    const { stmts = [] } = parseSync(sql)
    return stmts.length === 1 && stmts[0].stmt && 'SelectStmt' in stmts[0].stmt ? { ok: true } : { ok: false, error: 'un solo SELECT' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
