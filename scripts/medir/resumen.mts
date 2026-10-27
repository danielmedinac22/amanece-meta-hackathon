/**
 * Convierte resultados/corridas.json en las tablas del informe (Markdown). No toca la base ni el modelo.
 *
 *   tsx scripts/medir/resumen.mts [resultados/corridas.json]
 */
import { readFileSync } from 'node:fs'

const ENTRADA = process.argv[2] ?? 'scripts/medir/resultados/corridas.json'
const datos = JSON.parse(readFileSync(ENTRADA, 'utf8'))
const corridas = (datos.corridas as any[]).filter((c) => c.tipo !== 'hilo-largo')

const mediana = (xs: number[]) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b)
  if (!s.length) return NaN
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const s = (ms: number | null | undefined) => (ms == null || Number.isNaN(ms) ? '-' : (ms / 1000).toFixed(1))
const d = (n: number | null | undefined, k = 5) => (n == null || Number.isNaN(n) ? '-' : n.toFixed(k))
const k = (n: number) => (n / 1000).toFixed(1)

// Precios por millón de tokens: entrada, salida, entrada en caché. La tabla del código no tiene la tercera.
const CONTRIBUTOR = { e: 0.1, s: 0.2, c: 0.002 }
const STANDARD = { e: 1.25, s: 4.25, c: 0.15 }
function conCache(c: any, p: { e: number; s: number; c: number }) {
  let total = 0
  for (const t of [c.turno1, c.turno2]) {
    if (!t) continue
    for (const paso of t.pasos) {
      const cache = paso.enCache ?? 0
      total += ((paso.entrada - cache) * p.e + cache * p.c + paso.salida * p.s) / 1e6
    }
  }
  return total
}

const tipos = ['regla', 'indicador', 'seccion']
for (const tipo of tipos) {
  const cs = corridas.filter((c) => c.tipo === tipo)
  if (!cs.length) continue
  console.log(`\n### ${tipo}\n`)
  console.log('| # | estado | herramienta | llamadas | tokens ent/sal (razon.) | USD código | USD Standard | USD con caché (Contrib.) | t1 s | t2 s | hasta aplicado s | entender | generar | simular | resto herr. | responder | DB (consultas/s) | primera vez | reintentos | motivo |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const c of cs) {
    const f = c.turno1.fases
    const resto = f.ventanaDeHerramienta - f.generar - f.simular
    const reint = c.cambios.map((x: any) => (x.intentos ? x.intentos - 1 : 0)).reduce((a: number, b: number) => a + b, 0)
    console.log(
      `| ${c.corrida} | ${c.estadoFinal} | ${c.herramientasTurno1.join('+') || '-'} | ${c.llamadasAlModelo} | ${k(c.tokens.entrada)}k/${k(c.tokens.salida)}k (${k(c.tokens.razonamiento)}k) | ${d(c.usd)} | ${d(c.usdStandard, 4)} | ${d(conCache(c, CONTRIBUTOR), 5)} | ${s(c.msTurno1)} | ${s(c.msTurno2)} | ${s(c.msHastaAplicadoMaquina)} | ${s(f.entender)} | ${s(f.generar)} | ${s(f.simular)} | ${s(resto)} | ${s(f.responder)} | ${c.turno1.consultasADb + (c.turno2?.consultasADb ?? 0)}/${s(c.turno1.msEnDb + (c.turno2?.msEnDb ?? 0))} | ${c.aplicadoALaPrimera ? 'sí' : 'no'} | ${reint} | ${c.errores.join('; ').slice(0, 90) || ''} |`,
    )
  }
  const ok = cs.filter((c) => c.estadoFinal === 'aplicado')
  const col = (f: (c: any) => number) => mediana(cs.map(f))
  console.log(`\nMediana (${cs.length} corridas, ${ok.length} aplicadas): ${col((c) => c.llamadasAlModelo)} llamadas; ${k(col((c) => c.tokens.entrada))}k tokens de entrada y ${k(col((c) => c.tokens.salida))}k de salida (${k(col((c) => c.tokens.razonamiento))}k de razonamiento); USD código ${d(col((c) => c.usd))}; USD Standard ${d(col((c) => c.usdStandard), 4)}; USD con caché Contributor ${d(mediana(cs.map((c) => conCache(c, CONTRIBUTOR))))}; con caché Standard ${d(mediana(cs.map((c) => conCache(c, STANDARD))), 4)}; hasta aplicado (máquina) ${s(mediana(ok.map((c) => c.msHastaAplicadoMaquina)))} s; turno 1 ${s(col((c) => c.msTurno1))} s; turno 2 ${s(mediana(cs.map((c) => c.msTurno2)))} s`)
  console.log(`Lo que guarda el sistema en \`cambios.costoUsd\` (mediana): ${d(mediana(cs.map((c) => c.guardadoEnCambios.costoUsd)), 6)} frente a lo medido ${d(col((c) => c.usd), 6)} (${((mediana(cs.map((c) => c.guardadoEnCambios.costoUsd)) / col((c) => c.usd)) * 100).toFixed(0)} %).`)
  console.log(`Lo que guarda en \`turnos\` (mediana): ${d(mediana(cs.map((c) => c.guardadoEnTurnos.costoUsd)), 6)}.`)
  console.log(`Fases (mediana, s): entender ${s(col((c) => c.turno1.fases.entender))}, generar ${s(col((c) => c.turno1.fases.generar))}, simular ${s(col((c) => c.turno1.fases.simular))}, ventana de herramienta ${s(col((c) => c.turno1.fases.ventanaDeHerramienta))}, responder 1 ${s(col((c) => c.turno1.fases.responder))}, confirmar (turno 2 entender) ${s(mediana(cs.map((c) => c.turno2?.fases.entender)))}, aplicar (ventana turno 2) ${s(mediana(cs.map((c) => c.turno2?.fases.ventanaDeHerramienta)))}, responder 2 ${s(mediana(cs.map((c) => c.turno2?.fases.responder)))}; QuickJS en la vista previa ${mediana(cs.flatMap((c) => c.cambios.map((x: any) => x.msQuickJS))).toFixed(0)} ms.`)
}
console.log('\n(USD código = tabla PRECIOS de src/lib/modelo.ts con MODEL_ID; "USD Standard" = los mismos tokens a 1.25/4.25; "con caché" cobra los tokens en caché a su tarifa.)')
