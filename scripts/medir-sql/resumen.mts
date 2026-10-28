/** Lee los JSON de resultados y escribe las tablas en Markdown. */
import { readFileSync, existsSync } from 'node:fs'
import { PETICIONES, comparar } from '../../src/medir-sql/peticiones'

/** Recalcula el veredicto de cada corrida con el comparador final, a partir de las filas guardadas. */
function revisar(x: any) {
  const p = PETICIONES.find((q) => q.id === x.id)!
  if (p.esperado === 'respuesta' && x.filasFinales && x.filasDeLaVerdad) {
    const c = comparar(x.filasDeLaVerdad, x.filasFinales, p.comparador, p.forma.tipo === 'serie')
    x.veredicto = c.ok ? 'correcta' : 'mal_en_silencio'
    x.razon = c.razon
  }
  return x
}
const leer = (arm: 'sql' | 'js' | 'js-sospecha') => [1, 2, 3].flatMap((r) => (existsSync(`scripts/medir-sql/resultados/${arm}-rep${r}.json`) ? (JSON.parse(readFileSync(`scripts/medir-sql/resultados/${arm}-rep${r}.json`, 'utf8')) as any[]).map(revisar) : []))
const sql = leer('sql'), js = leer('js'), jsS = leer('js-sospecha')
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN }
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)} % (${n}/${d})` : 'n/a')
const usd = (x: number) => x.toFixed(4)

function fila(rs: any[]) {
  if (!rs.length) return '| | | | | |'
  const ok = rs.filter((r) => r.veredicto === 'correcta' || r.veredicto === 'declino_bien').length
  const sil = rs.filter((r) => r.veredicto === 'mal_en_silencio').length
  const inv = rs.filter((r) => r.veredicto === 'invalida').length
  const de = rs.filter((r) => r.veredicto === 'declino_de_mas').length
  const primera = rs.filter((r) => r.validaALaPrimera).length
  return `${ok}/${rs.length} | ${rs[0].esperado === 'declinar' ? '(declina)' : `${primera}/${rs.length}`} | ${sil}${inv ? ` + ${inv} inv` : ''}${de ? ` + ${de} de más` : ''} | ${usd(mediana(rs.map((r) => r.gasto.usdStandard)))} | ${mediana(rs.map((r) => r.ms / 1000)).toFixed(1)}`
}
console.log('### Por pedido (todas las repeticiones)\n')
console.log('| Pedido | Qué se espera | SQL: bien | SQL: 1ª válida | SQL: mal en silencio | SQL USD | SQL s | JS: bien | JS: 1ª válida | JS: mal en silencio | JS USD | JS s |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const p of PETICIONES) {
  const a = sql.filter((r) => r.id === p.id), b = js.filter((r) => r.id === p.id)
  console.log(`| ${p.id} | ${p.esperado} | ${fila(a)} | ${fila(b)} |`)
}

console.log('\n### Tokens por pedido (mediana de las repeticiones: entrada / salida, de la salida cuánto es razonamiento)\n')
console.log('| Pedido | SQL tokens | SQL intentos (máx) | JS tokens | JS llamadas (máx) |\n|---|---|---|---|---|')
for (const p of PETICIONES) {
  const a = sql.filter((r) => r.id === p.id), b = js.filter((r) => r.id === p.id)
  const t = (rs: any[]) => (rs.length ? `${Math.round(mediana(rs.map((r) => r.gasto.entrada)))} / ${Math.round(mediana(rs.map((r) => r.gasto.salida)))} (${Math.round(mediana(rs.map((r) => r.gasto.razonamiento)))})` : '')
  console.log(`| ${p.id} | ${t(a)} | ${Math.max(...a.map((r) => r.intentos))} | ${t(b)} | ${Math.max(...b.map((r) => r.gasto.llamadas))} |`)
}

function totales(nombre: string, rs: any[]) {
  const resp = rs.filter((r) => r.esperado === 'respuesta'), dec = rs.filter((r) => r.esperado === 'declinar')
  const row = (cond: (r: any) => boolean, base = resp) => pct(base.filter(cond).length, base.length)
  return {
    nombre,
    n: rs.length,
    primera: row((r) => r.validaALaPrimera),
    entres: row((r) => r.validaEnTres),
    correcta: row((r) => r.veredicto === 'correcta'),
    silencio: `${rs.filter((r) => r.veredicto === 'mal_en_silencio').length} (${resp.filter((r) => r.veredicto === 'mal_en_silencio').length} en respondibles, ${dec.filter((r) => r.veredicto === 'mal_en_silencio').length} en declinables)`,
    invalida: rs.filter((r) => r.veredicto === 'invalida').length,
    declinoDeMas: rs.filter((r) => r.veredicto === 'declino_de_mas').length,
    declinoBien: pct(dec.filter((r) => r.veredicto === 'declino_bien').length, dec.length),
    usdMed: usd(mediana(rs.map((r) => r.gasto.usdStandard))),
    sMed: mediana(rs.map((r) => r.ms / 1000)).toFixed(1),
    sP90: [...rs.map((r) => r.ms / 1000)].sort((a, b) => a - b)[Math.floor(rs.length * 0.9)]?.toFixed(1),
    tokIn: Math.round(mediana(rs.map((r) => r.gasto.entrada))),
    tokOut: Math.round(mediana(rs.map((r) => r.gasto.salida))),
    llamadas: mediana(rs.map((r) => r.gasto.llamadas)),
    usdStdTotal: rs.reduce((s, r) => s + r.gasto.usdStandard, 0),
    usdConTotal: rs.reduce((s, r) => s + r.gasto.usdContributor, 0),
  }
}
const tot = [totales('SQL acotado (c1)', sql), totales('JS en QuickJS con entrada declarada (c2)', js), ...(jsS.length ? [totales('c2 + reintento si el resultado sale vacío', jsS)] : [])]
console.log('\n### Totales\n')
console.log('| | ' + tot.map((t) => t.nombre).join(' | ') + ' |')
console.log('|---|' + tot.map(() => '---|').join(''))
const lineas: [string, (t: any) => string][] = [
  ['Corridas (pedidos x repeticiones)', (t) => String(t.n)],
  ['Válida a la primera (de las respondibles)', (t) => t.primera],
  ['Válida en 3 intentos', (t) => t.entres],
  ['Correcta contra la verdad', (t) => t.correcta],
  ['Mal en silencio (válida y equivocada)', (t) => t.silencio],
  ['Nunca válida en 3 intentos', (t) => String(t.invalida)],
  ['Declinó de más (respondible)', (t) => String(t.declinoDeMas)],
  ['Declinó bien (de las que había que declinar)', (t) => t.declinoBien],
  ['USD Standard por pedido, mediana', (t) => t.usdMed],
  ['Segundos por pedido, mediana / p90', (t) => `${t.sMed} / ${t.sP90}`],
  ['Tokens por pedido, mediana (entrada / salida)', (t) => `${t.tokIn} / ${t.tokOut}`],
  ['Llamadas al modelo por pedido, mediana', (t) => String(t.llamadas)],
  ['Gasto total USD Standard / Contributor', (t) => `${t.usdStdTotal.toFixed(3)} / ${t.usdConTotal.toFixed(4)}`],
]
for (const [n, f] of lineas) console.log(`| ${n} | ${tot.map(f).join(' | ')} |`)

console.log('\n### Solo la repetición 1\n')
const r1 = [totales('SQL', sql.filter((r) => r.rep === '1')), totales('JS', js.filter((r) => r.rep === '1'))]
console.log('| | SQL | JS |\n|---|---|---|')
for (const [n, f] of lineas.slice(1, 8)) console.log(`| ${n} | ${r1.map(f).join(' | ')} |`)

console.log('\n### Lo que no salió bien\n')
for (const [nombre, rs] of [['SQL', sql], ['JS', js]] as const) {
  console.log(`**${nombre}**\n`)
  const malos = rs.filter((r) => r.veredicto !== 'correcta' && r.veredicto !== 'declino_bien')
  if (!malos.length) console.log('Ninguno.\n')
  for (const r of malos) console.log(`- ${r.id} (rep ${r.rep}): ${r.veredicto}. ${r.razon}`)
  console.log('')
}

console.log('### Zona horaria y lista de estados (SQL)\n')
const venta = sql.filter((r) => r.laVerdadUsaVenta)
console.log(`- Intentos con now(), current_date, AT TIME ZONE, una zona o un desfase escrito (aunque el validador lo rechazó): ${sql.filter((r) => r.zonaOLiteralDeTiempoEnAlgunIntento).length} de ${sql.length} corridas.`)
console.log(`- SQL final aceptado con alguno de esos literales: ${sql.filter((r) => r.zonaOLiteralDeTiempoEnElFinal).length} de ${sql.length}.`)
console.log(`- Pedidos cuya verdad es "venta" (${venta.length} corridas): usaron cuenta_como_venta ${venta.filter((r) => r.usaCuentaComoVentaEnElFinal).length}, escribieron una lista de estados ${venta.filter((r) => r.listaDeEstadosEnElFinal).length}, escribieron algún estado literal ${venta.filter((r) => r.estadoLiteralEnElFinal).length}.`)
console.log(`- Corridas que no son de venta y usaron una lista de estados: ${sql.filter((r) => !r.laVerdadUsaVenta && r.listaDeEstadosEnElFinal).length}.`)

console.log('\n### Intentos del SQL: qué rechazó el validador o Postgres\n')
const intentos = sql.flatMap((r) => r.intentosDetalle.map((i: any) => ({ ...i, id: r.id, rep: r.rep })))
const causas = new Map<string, number>()
for (const i of intentos) {
  const c = i.decision === 'no_se_puede' ? 'no_se_puede' : i.validador !== 'ok' ? `validador: ${String(i.validador).split(':')[0]} / ${String(i.validador).slice(String(i.validador).indexOf(':') + 2, String(i.validador).indexOf(':') + 70)}` : i.postgres === 'ok' ? 'ok' : `postgres: ${String(i.postgres).slice(0, 80)}`
  causas.set(c, (causas.get(c) ?? 0) + 1)
}
console.log('| Resultado del intento | Intentos |\n|---|---|')
for (const [c, n] of [...causas.entries()].sort((a, b) => b[1] - a[1])) console.log(`| ${c} | ${n} |`)

console.log('\n### JS: lo que declaró y lo que leyó\n')
const decl = js.filter((r) => r.ventanaDeclarada !== null)
console.log(`- Declaraciones corregidas por el núcleo (más de una): ${js.filter((r) => r.declaraciones > 1).length} corridas.`)
console.log(`- Ventana declarada, mediana: ${mediana(decl.map((r) => r.ventanaDeclarada))} días. Carga de datos, mediana: ${mediana(decl.map((r) => r.msCarga)).toFixed(0)} ms. QuickJS, mediana: ${mediana(decl.map((r) => r.msQuickjs ?? 0)).toFixed(0)} ms.`)
console.log(`- Código final con un desfase de zona escrito a mano (lo pide el prompt actual): ${js.filter((r) => r.desfaseDeZonaEnElCodigo).length} de ${js.filter((r) => r.codigoFinal).length}.`)
