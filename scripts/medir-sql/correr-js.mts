/**
 * Brazo de respaldo (c2): el generador declara la entrada, el núcleo la valida y la carga, el generador escribe
 * JavaScript y QuickJS lo corre sobre las filas cargadas. Hasta 3 intentos con el error a la vista en cada paso.
 *   tsx scripts/medir-sql/correr-js.mts [--rep 1] [--solo a,b] [--salida archivo.json]
 */
import { ponerCorrida, quietud } from '../medir/entorno.mts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { argumento, gastoDe, negocioDe, verdadDe, TZ_LITERAL, type Gasto } from './comun.mts'

const { declararEntrada, validarEntrada, cargarEntrada, generarCodigo, aFilas, tipoDePieza } = await import('../../src/medir-sql/js')
const { correrAislado } = await import('../../src/lib/aislado')
const { PETICIONES, comparar } = await import('../../src/medir-sql/peticiones')

const REP = argumento('rep', '1')!
const SOLO = argumento('solo')?.split(',')
const SOSPECHA = argumento('sospecha', '0') === '1'
const SALIDA = argumento('salida', `scripts/medir-sql/resultados/${SOSPECHA ? 'js-sospecha' : 'js'}-rep${REP}.json`)!
const MAX = 3
const A = await negocioDe('SQL10K')
const URL = process.env.DATABASE_URL!

const resultados: any[] = []
for (const p of PETICIONES.filter((x) => !SOLO || SOLO.includes(x.id))) {
  const verdad = p.verdad ? await verdadDe(p.verdad, A) : null
  const t0 = performance.now()
  const pasos: any[] = []
  const corridas: string[] = []
  let declinio: { motivo: string; falta: string } | null = null
  let entradaOk: { e: any; entrada: any; msCarga: number } | null = null
  let fallo: { entrada: unknown; error: string } | undefined
  let declaraciones = 0
  for (let n = 1; n <= MAX && !entradaOk && !declinio; n++) {
    const corrida = `js:${p.id}:r${REP}:d${n}`
    corridas.push(corrida)
    ponerCorrida(corrida)
    const ti = performance.now()
    declaraciones = n
    const { salida } = await declararEntrada(p.texto, p.forma, fallo)
    const paso: any = { fase: 'declarar', n, decision: salida.decision, ventana: salida.ventana_dias, tablas: salida.tablas.map((t) => `${t.tabla}(${t.campos.join(',')})`), definicion: salida.definicion, motivo: salida.motivo, falta: salida.falta, resultado: '' }
    if (salida.decision === 'no_se_puede') {
      declinio = { motivo: salida.motivo, falta: salida.falta }
      paso.resultado = 'no_se_puede'
    } else {
      const err = validarEntrada(salida)
      if (err) {
        paso.resultado = err
        fallo = { entrada: { ventana_dias: salida.ventana_dias, tablas: salida.tablas }, error: err }
      } else {
        const c = await cargarEntrada(URL, A, salida)
        if (!c.ok) {
          paso.resultado = c.error
          fallo = { entrada: { ventana_dias: salida.ventana_dias, tablas: salida.tablas }, error: c.error }
        } else {
          paso.resultado = `ok (${Object.entries(c.entrada.resumen.filasLeidas).map(([t, k]) => `${t}:${k}`).join(' ')}) carga ${c.ms.toFixed(0)}ms`
          entradaOk = { e: salida, entrada: c.entrada, msCarga: c.ms }
        }
      }
    }
    paso.ms = performance.now() - ti
    pasos.push(paso)
  }
  let final: { filas: Record<string, unknown>[]; codigo: string; msQuickjs: number } | null = null
  let intentoCodigo: { codigo: string; error: string } | undefined
  let intentosDeCodigo = 0
  let primeroValido = false
  if (entradaOk) {
    for (let n = 1; n <= MAX && !final; n++) {
      const corrida = `js:${p.id}:r${REP}:c${n}`
      corridas.push(corrida)
      ponerCorrida(corrida)
      const ti = performance.now()
      intentosDeCodigo = n
      const g = await generarCodigo(p.texto, p.forma, entradaOk.e, entradaOk.entrada, intentoCodigo)
      const funcion = tipoDePieza(p.forma) === 'indicador' ? 'calcular' : 'consultar'
      const r = await correrAislado(g.codigo, funcion, entradaOk.entrada)
      const paso: any = { fase: 'codigo', n, codigo: g.codigo, quickjsMs: r.ms, resultado: '' }
      if (!r.ok) {
        paso.resultado = `QuickJS: ${r.error}`
        intentoCodigo = { codigo: g.codigo, error: r.error }
      } else {
        const f = aFilas(r.valor, p.forma)
        if (!f.ok) {
          paso.resultado = `forma: ${f.error}`
          intentoCodigo = { codigo: g.codigo, error: f.error }
        } else if (SOSPECHA && n < MAX && (f.filas.length === 0 || (p.forma.tipo === 'numero' && (f.filas[0].valor === 0 || f.filas[0].valor === null)))) {
          const filasCargadas = Object.values(entradaOk.entrada.resumen.filasLeidas as Record<string, number>).reduce((a, b) => a + b, 0)
          const msg = `El resultado salió vacío o en cero aunque se cargaron ${filasCargadas} filas. Revisa que solo uses los campos que declaraste (datos.tablas.<tabla> trae únicamente esos campos) y que los filtros no descarten todo.`
          paso.resultado = `sospecha: ${msg}`
          intentoCodigo = { codigo: g.codigo, error: msg }
        } else {
          paso.resultado = 'ok'
          final = { filas: f.filas, codigo: g.codigo, msQuickjs: r.ms }
          if (n === 1 && declaraciones === 1) primeroValido = true
        }
      }
      paso.ms = performance.now() - ti
      pasos.push(paso)
    }
  }
  const ms = performance.now() - t0
  await quietud(150)
  const gastos: Gasto[] = corridas.map(gastoDe)
  const gasto = gastos.reduce((a, g) => ({ llamadas: a.llamadas + g.llamadas, entrada: a.entrada + g.entrada, salida: a.salida + g.salida, razonamiento: a.razonamiento + g.razonamiento, enCache: a.enCache + g.enCache, usdStandard: a.usdStandard + g.usdStandard, usdContributor: a.usdContributor + g.usdContributor }), { llamadas: 0, entrada: 0, salida: 0, razonamiento: 0, enCache: 0, usdStandard: 0, usdContributor: 0 })
  let veredicto: string
  let razon = ''
  if (p.esperado === 'declinar') {
    if (declinio) { veredicto = 'declino_bien'; razon = `motivo ${declinio.motivo}: ${declinio.falta}` }
    else if (final) { veredicto = 'mal_en_silencio'; razon = 'devolvió un resultado para algo que los datos no tienen' }
    else veredicto = 'invalida'
  } else if (declinio) { veredicto = 'declino_de_mas'; razon = `motivo ${declinio.motivo}: ${declinio.falta}` }
  else if (final) {
    const c = comparar(verdad!, final.filas, p.comparador, p.forma.tipo === 'serie')
    veredicto = c.ok ? 'correcta' : 'mal_en_silencio'
    razon = c.razon
  } else veredicto = 'invalida'
  const rec = {
    id: p.id, rep: REP, esperado: p.esperado, veredicto, razon, validaALaPrimera: primeroValido, validaEnTres: Boolean(final), declaraciones, intentosDeCodigo, ms, gasto,
    ventanaDeclarada: entradaOk?.e.ventana_dias ?? null, filasLeidas: entradaOk?.entrada.resumen.filasLeidas ?? null, msCarga: entradaOk?.msCarga ?? null, msQuickjs: final?.msQuickjs ?? null,
    desfaseDeZonaEnElCodigo: final ? TZ_LITERAL.test(final.codigo) : null, codigoFinal: final?.codigo ?? '', filas: final?.filas.length ?? null, muestra: final?.filas.slice(0, 3) ?? null, filasFinales: final?.filas ?? null, filasDeLaVerdad: verdad, pasos,
  }
  resultados.push(rec)
  console.log(`${p.id.padEnd(26)} ${veredicto.padEnd(16)} 1ra=${primeroValido ? 'si' : 'no'} d=${declaraciones} c=${intentosDeCodigo} ${(ms / 1000).toFixed(1)}s $${gasto.usdStandard.toFixed(4)} ${razon.slice(0, 90)}`)
}
mkdirSync('scripts/medir-sql/resultados', { recursive: true })
writeFileSync(SALIDA, JSON.stringify(resultados, null, 1))
console.log('guardado', SALIDA)
process.exit(0)
