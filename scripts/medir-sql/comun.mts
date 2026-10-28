import { eventos } from '../medir/entorno.mts'
import { neon } from '@neondatabase/serverless'

export const sqlOwner = neon(process.env.DATABASE_URL!)
export async function negocioDe(codigo: string) {
  const r = await sqlOwner.query(`select id from negocios where codigo = $1`, [codigo])
  return r[0].id as string
}
export async function verdadDe(sql: string, negocioId: string): Promise<Record<string, unknown>[]> {
  return (await sqlOwner.query(`select to_jsonb(x) as r from (${sql}) x`, [negocioId])).map((f) => f.r)
}

export const argumento = (nombre: string, porDefecto?: string) => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : porDefecto
}

export type Gasto = { llamadas: number; entrada: number; salida: number; razonamiento: number; enCache: number; usdStandard: number; usdContributor: number }
export const STANDARD = { entrada: 1.25, salida: 4.25 }
export const CONTRIBUTOR = { entrada: 0.1, salida: 0.2 }
export function gastoDe(corrida: string): Gasto {
  const ev = eventos.filter((e) => e.corrida === corrida && e.kind === 'modelo' && e.uso)
  const entrada = ev.reduce((s, e) => s + (e.uso?.entrada ?? 0), 0)
  const salida = ev.reduce((s, e) => s + (e.uso?.salida ?? 0), 0)
  return {
    llamadas: ev.length,
    entrada,
    salida,
    razonamiento: ev.reduce((s, e) => s + (e.uso?.razonamiento ?? 0), 0),
    enCache: ev.reduce((s, e) => s + (e.uso?.enCache ?? 0), 0),
    usdStandard: (entrada * STANDARD.entrada + salida * STANDARD.salida) / 1e6,
    usdContributor: (entrada * CONTRIBUTOR.entrada + salida * CONTRIBUTOR.salida) / 1e6,
  }
}
export const sumaGasto = (xs: Gasto[]): Gasto => xs.reduce((a, g) => ({ llamadas: a.llamadas + g.llamadas, entrada: a.entrada + g.entrada, salida: a.salida + g.salida, razonamiento: a.razonamiento + g.razonamiento, enCache: a.enCache + g.enCache, usdStandard: a.usdStandard + g.usdStandard, usdContributor: a.usdContributor + g.usdContributor }), { llamadas: 0, entrada: 0, salida: 0, razonamiento: 0, enCache: 0, usdStandard: 0, usdContributor: 0 })

export const TZ_LITERAL = /america\/|bogot[aá]|at\s+time\s+zone|timezone\s*\(|utc|interval\s+'\s*-?5\s*hours?'|\b[-+]\s*5\s*\*\s*3600|\b(now|current_date|current_timestamp|localtimestamp)\b/i
export const LISTA_DE_ESTADOS = /estado\s+(not\s+)?in\s*\(\s*'[^']+'\s*,/i
export const ESTADO_LITERAL = /estado\s*(=|<>|!=|in\b)\s*(\(\s*)?'/i
