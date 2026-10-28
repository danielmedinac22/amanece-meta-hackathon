/**
 * Brazo SQL acotado: catálogo sin filas, una consulta, validador sobre el AST de Postgres, ejecución con rol y RLS,
 * hasta 3 intentos con el error a la vista. Compara con la verdad.
 *   tsx scripts/medir-sql/correr-sql.mts [--rep 1] [--solo a,b] [--salida archivo.json]
 */
import { ponerCorrida, quietud } from '../medir/entorno.mts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { argumento, gastoDe, negocioDe, verdadDe, TZ_LITERAL, LISTA_DE_ESTADOS, ESTADO_LITERAL, type Gasto } from './comun.mts'

const { cargarParser, validarConsulta, explicar } = await import('../../src/medir-sql/validar')
const { ejecutarAcotado } = await import('../../src/medir-sql/ejecutar')
const { generarSql } = await import('../../src/medir-sql/generador-sql')
const { PETICIONES, comparar } = await import('../../src/medir-sql/peticiones')
await cargarParser()

const REP = argumento('rep', '1')!
const SOLO = argumento('solo')?.split(',')
const SALIDA = argumento('salida', `scripts/medir-sql/resultados/sql${process.env.SIN_INSTRUCCION_DE_DECLINAR === '1' ? '-sin-instruccion' : ''}-rep${REP}.json`)!
const MAX = 3
const A = await negocioDe('SQL10K')

type Intento = { n: number; decision: string; motivo: string; sql: string; enPalabras: string; falta: string; validador: string; postgres: string; ms: number; gasto: Gasto }
const resultados: any[] = []
for (const p of PETICIONES.filter((x) => !SOLO || SOLO.includes(x.id))) {
  const verdad = p.verdad ? await verdadDe(p.verdad, A) : null
  const intentos: Intento[] = []
  let anterior: { sql: string; error: string } | undefined
  let final: { filas: Record<string, unknown>[]; total: number; msPg: number } | null = null
  let declinio: { motivo: string; falta: string } | null = null
  const t0 = performance.now()
  for (let n = 1; n <= MAX; n++) {
    const corrida = `sql:${p.id}:r${REP}:${n}`
    ponerCorrida(corrida)
    const ti = performance.now()
    let salida
    try {
      salida = (await generarSql(p.texto, p.forma, anterior)).salida
    } catch (e) {
      intentos.push({ n, decision: 'error_del_modelo', motivo: '', sql: '', enPalabras: '', falta: '', validador: '', postgres: String(e).slice(0, 300), ms: performance.now() - ti, gasto: gastoDe(corrida) })
      anterior = undefined
      continue
    }
    const it: Intento = { n, decision: salida.decision, motivo: salida.motivo, sql: salida.sql, enPalabras: salida.en_palabras, falta: salida.falta, validador: '', postgres: '', ms: 0, gasto: gastoDe(corrida) }
    if (salida.decision === 'no_se_puede') {
      declinio = { motivo: salida.motivo, falta: salida.falta }
      it.ms = performance.now() - ti
      intentos.push(it)
      break
    }
    const v = validarConsulta(salida.sql, p.forma)
    if (!v.ok) {
      it.validador = `${v.error.tipo}: ${explicar(v.error)}`
      anterior = { sql: salida.sql, error: explicar(v.error) }
    } else {
      it.validador = 'ok'
      const r = await ejecutarAcotado(A, v.sql)
      if (!r.ok) {
        it.postgres = r.mensaje
        anterior = { sql: salida.sql, error: `Postgres: ${r.mensaje}` }
      } else if (p.forma.tipo === 'numero' && r.filas.length !== 1) {
        it.postgres = `forma: devolvió ${r.filas.length} filas y "numero" pide una`
        anterior = { sql: salida.sql, error: it.postgres }
      } else {
        it.postgres = 'ok'
        final = { filas: r.filas, total: r.total, msPg: r.ms }
      }
    }
    it.ms = performance.now() - ti
    await quietud(50)
    it.gasto = gastoDe(corrida)
    intentos.push(it)
    if (final) break
  }
  const ms = performance.now() - t0
  await quietud(100)
  const gastos = intentos.map((i) => gastoDe(`sql:${p.id}:r${REP}:${i.n}`))
  const gasto = gastos.reduce((a, g) => ({ llamadas: a.llamadas + g.llamadas, entrada: a.entrada + g.entrada, salida: a.salida + g.salida, razonamiento: a.razonamiento + g.razonamiento, enCache: a.enCache + g.enCache, usdStandard: a.usdStandard + g.usdStandard, usdContributor: a.usdContributor + g.usdContributor }), { llamadas: 0, entrada: 0, salida: 0, razonamiento: 0, enCache: 0, usdStandard: 0, usdContributor: 0 })
  const primero = intentos[0]
  const validaALaPrimera = Boolean(primero && primero.decision === 'consulta' && primero.validador === 'ok' && primero.postgres === 'ok')
  const validaEnTres = Boolean(final)
  let veredicto: string
  let razon = ''
  if (p.esperado === 'declinar') {
    if (declinio) { veredicto = 'declino_bien'; razon = `motivo ${declinio.motivo}: ${declinio.falta}` }
    else if (final) { veredicto = 'mal_en_silencio'; razon = 'inventó una consulta que no puede responder' }
    else veredicto = 'invalida'
  } else if (declinio) { veredicto = 'declino_de_mas'; razon = `motivo ${declinio.motivo}: ${declinio.falta}` }
  else if (final) {
    const c = comparar(verdad!, final.filas, p.comparador, p.forma.tipo === 'serie')
    veredicto = c.ok ? 'correcta' : 'mal_en_silencio'
    razon = c.razon
  } else veredicto = 'invalida'
  const sqlFinal = (final ? intentos.at(-1)!.sql : '') || ''
  const todosLosSql = intentos.map((i) => i.sql).join('\n')
  const rec = {
    id: p.id, rep: REP, esperado: p.esperado, veredicto, razon, validaALaPrimera, validaEnTres, intentos: intentos.length, ms, gasto,
    zonaOLiteralDeTiempoEnAlgunIntento: TZ_LITERAL.test(todosLosSql), zonaOLiteralDeTiempoEnElFinal: TZ_LITERAL.test(sqlFinal),
    listaDeEstadosEnElFinal: LISTA_DE_ESTADOS.test(sqlFinal), estadoLiteralEnElFinal: ESTADO_LITERAL.test(sqlFinal), usaCuentaComoVentaEnElFinal: /cuenta_como_venta/.test(sqlFinal),
    laVerdadUsaVenta: Boolean(p.verdad?.includes('IN (\'confirmado\'')),
    sqlFinal, enPalabras: intentos.at(-1)?.enPalabras ?? '', filas: final?.filas.length ?? null, total: final?.total ?? null, muestra: final?.filas.slice(0, 3) ?? null, filasFinales: final?.filas ?? null, filasDeLaVerdad: verdad, intentosDetalle: intentos,
  }
  resultados.push(rec)
  console.log(`${p.id.padEnd(26)} ${veredicto.padEnd(16)} 1ra=${validaALaPrimera ? 'si' : 'no'} int=${intentos.length} ${(ms / 1000).toFixed(1)}s $${gasto.usdStandard.toFixed(4)} ${razon.slice(0, 90)}`)
}
mkdirSync('scripts/medir-sql/resultados', { recursive: true })
writeFileSync(SALIDA, JSON.stringify(resultados, null, 1))
console.log('guardado', SALIDA)
process.exit(0)
