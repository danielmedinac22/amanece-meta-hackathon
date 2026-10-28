/**
 * Construye y arranca el repo con `next build && next start` (Node, local) y mide el costo de libpg-query en un
 * route handler: tamaño de lo que se despliega, arranque en frío (5 procesos nuevos) y validación en caliente.
 *   PG_EXTERNAL=1 node scripts/medir-sql/next-medir.mjs <etiqueta>
 */
import { execSync, spawn } from 'node:child_process'
import { readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const etiqueta = process.argv[2] ?? 'x'
const PUERTO = 3099
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
const SQL_SIMPLE = 'select count(*) as valor from pedidos where cuenta_como_venta'
const SQL_COMPLEJO = `WITH v AS (SELECT cliente_id, dia_local FROM pedidos WHERE cuenta_como_venta), p AS (SELECT cliente_id, min(dia_local) AS d0 FROM v GROUP BY 1), r AS (SELECT p.cliente_id, date_trunc('month', p.d0)::date AS mes, bool_or(v.dia_local > p.d0 AND v.dia_local <= p.d0 + 30) AS r30, bool_or(v.dia_local > p.d0 AND v.dia_local <= p.d0 + 60) AS r60, bool_or(v.dia_local > p.d0 AND v.dia_local <= p.d0 + 90) AS r90 FROM p JOIN v USING (cliente_id) GROUP BY 1, 2) SELECT mes, count(*) AS clientes, round(100.0 * count(*) FILTER (WHERE r30) / count(*), 1) AS ret30, round(100.0 * count(*) FILTER (WHERE r60) / count(*), 1) AS ret60, round(100.0 * count(*) FILTER (WHERE r90) / count(*), 1) AS ret90 FROM r GROUP BY mes ORDER BY mes`

execSync('rm -rf .next')
const t0 = performance.now()
const salidaBuild = execSync('pnpm next build 2>&1', { env, encoding: 'utf8', maxBuffer: 1e8 })
const msBuild = performance.now() - t0
const erroresDeBuild = salidaBuild.split('\n').filter((l) => /Aborted|ENOENT|Error/.test(l)).slice(0, 3)

const peso = (ruta) => {
  const nft = JSON.parse(readFileSync(ruta, 'utf8'))
  const base = dirname(resolve(ruta))
  let total = 0, libpg = 0
  const archivos = []
  for (const f of nft.files) {
    const p = resolve(base, f)
    if (!existsSync(p)) continue
    const st = statSync(p)
    if (!st.isFile()) continue
    total += st.size
    if (p.includes('/libpg-query/')) { libpg += st.size; archivos.push(`${f.split('/').slice(-2).join('/')} ${st.size}`) }
  }
  return { archivosTrazados: nft.files.length, bytesTrazados: total, bytesLibpgQuery: libpg, archivosLibpgQuery: archivos }
}
const rutaV = '.next/server/app/api/medir-sql/validar/route.js'
const rutaP = '.next/server/app/api/medir-sql/ping/route.js'
const pesos = { validar: peso(rutaV + '.nft.json'), ping: peso(rutaP + '.nft.json'), bytesRouteJsValidar: statSync(rutaV).size, bytesRouteJsPing: statSync(rutaP).size }
const wasm = statSync('node_modules/libpg-query/wasm/libpg-query.wasm').size

async function post(sql, forma) {
  const t = performance.now()
  const r = await fetch(`http://127.0.0.1:${PUERTO}/api/medir-sql/validar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, forma }) })
  const texto = await r.text()
  const ms = performance.now() - t
  let j = null
  try { j = JSON.parse(texto) } catch {}
  return { status: r.status, ms, j }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const arranques = []
for (let i = 0; i < 5; i++) {
  const hijo = spawn('pnpm', ['next', 'start', '-p', String(PUERTO)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const ts = performance.now()
  let listoMs = null, texto = ''
  hijo.stdout.on('data', (d) => { texto += d; if (listoMs === null && /Ready in/.test(texto)) listoMs = performance.now() - ts })
  hijo.stderr.on('data', (d) => { texto += d })
  let primerPing = null
  while (primerPing === null) {
    try {
      const t = performance.now()
      const r = await fetch(`http://127.0.0.1:${PUERTO}/api/medir-sql/ping`)
      if (r.ok) primerPing = { desdeElArranqueMs: performance.now() - ts, soloLaLlamadaMs: performance.now() - t }
    } catch { await dormir(20) }
  }
  const primeraValidacion = await post(SQL_SIMPLE, { tipo: 'filas' })
  const calientes = []
  for (let k = 0; k < 5; k++) calientes.push((await post(SQL_COMPLEJO, { tipo: 'filas' })).ms)
  const segunda = await post(SQL_SIMPLE, { tipo: 'filas' })
  arranques.push({ listoMs, primerPing, primeraValidacionMs: primeraValidacion.ms, primeraStatus: primeraValidacion.status, primeraOk: primeraValidacion.j?.resultado?.ok ?? null, cargaDelParserMs: primeraValidacion.j?.msCargaDelParser ?? null, validarMs: primeraValidacion.j?.msValidar ?? null, validarComplejoCalienteMsMediana: mediana(calientes), msValidarComplejoServidor: (await post(SQL_COMPLEJO, { tipo: 'filas' })).j?.msValidar ?? null, rssMb: segunda.j?.memoriaRssMb ?? null, errorDeProceso: texto.split('\n').filter((l) => /⨯|Aborted|ENOENT/.test(l)).slice(0, 2) })
  hijo.kill('SIGTERM')
  execSync(`pkill -f "next-server" || true`)
  await dormir(800)
}
const resumen = {
  etiqueta, externo: process.env.PG_EXTERNAL === '1', msBuild: Math.round(msBuild), erroresDeBuild, bytesWasm: wasm, pesos,
  arranque: {
    listoMsMediana: Math.round(mediana(arranques.map((a) => a.listoMs ?? 0))),
    primerPingDesdeElArranqueMsMediana: Math.round(mediana(arranques.map((a) => a.primerPing.desdeElArranqueMs))),
    primeraValidacionMsMediana: Math.round(mediana(arranques.map((a) => a.primeraValidacionMs))),
    primeraValidacionMsMax: Math.round(Math.max(...arranques.map((a) => a.primeraValidacionMs))),
    validarSimpleServidorMsMediana: +mediana(arranques.map((a) => a.validarMs ?? 0)).toFixed(2),
    validarComplejoServidorMsMediana: +mediana(arranques.map((a) => a.msValidarComplejoServidor ?? 0)).toFixed(2),
    validarComplejoCalienteRoundTripMsMediana: +mediana(arranques.map((a) => a.validarComplejoCalienteMsMediana)).toFixed(1),
    rssMbMediana: mediana(arranques.map((a) => a.rssMb ?? 0)),
    todasOk: arranques.every((a) => a.primeraOk === true),
  },
  arranques,
}
writeFileSync(`scripts/medir-sql/resultados/next-${etiqueta}.json`, JSON.stringify(resumen, null, 1))
console.log(JSON.stringify({ ...resumen, arranques: undefined }, null, 1))
