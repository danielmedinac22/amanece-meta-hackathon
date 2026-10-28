/**
 * Atadura al Negocio con el driver HTTP de Neon: rol sin BYPASSRLS + política RLS + variable de transacción.
 * Incluye la mutación de control (política en `true` => la prueba de aislamiento tiene que FALLAR).
 */
import '../medir/entorno.mts'
import { neon } from '@neondatabase/serverless'
import { writeFileSync } from 'node:fs'

const q = neon(process.env.DATABASE_URL!)
const A = (await q.query(`select id from negocios where codigo='SQL10K'`))[0].id as string
const B = (await q.query(`select id from negocios where codigo='SQL10KB'`))[0].id as string
const salida: any = { A, B, pruebas: [] }
const anota = (nombre: string, ok: boolean, detalle: unknown) => {
  salida.pruebas.push({ nombre, ok, detalle })
  console.log(`${ok ? 'PASA ' : 'FALLA'} ${nombre} :: ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`)
}

async function comoRol(negocio: string | null, texto: string, params: unknown[] = [], opciones: { rol?: string; timeout?: string } = {}) {
  const pasos = [q.query(`SET LOCAL ROLE ${opciones.rol ?? 'amanece_consultas'}`)]
  if (negocio) pasos.push(q.query(`SELECT set_config('app.negocio_id', $1, true)`, [negocio]))
  pasos.push(q.query(`SET LOCAL statement_timeout = '${opciones.timeout ?? '2s'}'`))
  pasos.push(q.query(texto, params))
  const t0 = performance.now()
  try {
    const r = await q.transaction(pasos, { readOnly: true })
    return { ok: true as const, filas: r[r.length - 1] as Record<string, any>[], ms: performance.now() - t0 }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e), ms: performance.now() - t0 }
  }
}

console.log('== 1. La transacción por HTTP aplica rol, variable y tope juntos')
{
  const r = await comoRol(A, `select current_user as usuario, current_setting('app.negocio_id') as negocio, current_setting('statement_timeout') as tope, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls`)
  anota('rol + variable + tope en una transacción HTTP', r.ok && r.filas[0].usuario === 'amanece_consultas' && r.filas[0].negocio === A && r.filas[0].tope === '2s' && r.filas[0].bypassrls === false, r.ok ? r.filas[0] : r.error)
}
console.log('== 2. Sin transacción, el rol NO se queda (cada llamada HTTP es otra transacción)')
{
  await q.query(`SET LOCAL ROLE amanece_consultas`).catch((e) => console.log('   SET LOCAL suelto:', String(e.message).slice(0, 100)))
  const r = await q.query(`select current_user as usuario, current_setting('app.negocio_id', true) as negocio`)
  anota('llamadas HTTP sueltas pierden SET LOCAL', r[0].usuario === 'neondb_owner', r[0])
}
console.log('== 3. Aislamiento: A no ve filas de B')
const total = async (negocio: string | null, filtro: string) => comoRol(negocio, `select count(*)::int as n, count(distinct negocio_id)::int as negocios from public.pedidos ${filtro}`)
async function aislamiento(etiqueta: string) {
  const a = await total(A, '')
  const b = await total(B, '')
  const aVeB = await total(A, `where negocio_id = '${B}'`)
  const clientesAvB = await comoRol(A, `select count(*)::int as n from public.clientes where negocio_id = '${B}'`)
  const casosAvB = await comoRol(A, `select count(*)::int as n from public.casos where negocio_id = '${B}'`)
  const cteMalLigada = await comoRol(A, `select count(*)::int as n from public.pedidos where negocio_id = $1`, [B])
  const detalle = { A_ve: a.ok && a.filas[0], B_ve: b.ok && b.filas[0], A_pide_filas_de_B: aVeB.ok && aVeB.filas[0].n, A_pide_clientes_de_B: clientesAvB.ok && clientesAvB.filas[0].n, A_pide_casos_de_B: casosAvB.ok && casosAvB.filas[0].n, filtro_de_la_CTE_apuntando_a_B: cteMalLigada.ok && cteMalLigada.filas[0].n }
  const ok = a.ok && b.ok && a.filas[0].n === 10000 && a.filas[0].negocios === 1 && b.filas[0].n === 800 && b.filas[0].negocios === 1 && aVeB.ok && aVeB.filas[0].n === 0 && clientesAvB.ok && clientesAvB.filas[0].n === 0 && casosAvB.ok && casosAvB.filas[0].n === 0 && cteMalLigada.ok && cteMalLigada.filas[0].n === 0
  anota(etiqueta, ok, detalle)
  return ok
}
const base = await aislamiento('aislamiento con la política real (negocio_id = current_setting)')

console.log('== 4. Mutación de control: la política en `true` tiene que romper el aislamiento')
await q.query(`ALTER POLICY consultas_negocio ON pedidos USING (true)`)
await q.query(`ALTER POLICY consultas_negocio ON clientes USING (true)`)
await q.query(`ALTER POLICY consultas_negocio ON casos USING (true)`)
const conMutacion = await aislamiento('aislamiento con la política mutada a true (se espera FALLA)')
await q.query(`ALTER POLICY consultas_negocio ON pedidos USING (negocio_id = current_setting('app.negocio_id')::uuid)`)
await q.query(`ALTER POLICY consultas_negocio ON clientes USING (negocio_id = current_setting('app.negocio_id')::uuid)`)
await q.query(`ALTER POLICY consultas_negocio ON casos USING (negocio_id = current_setting('app.negocio_id')::uuid)`)
const restaurada = await aislamiento('aislamiento con la política restaurada')
anota('la mutación de control hace fallar la prueba (y la restauración la arregla)', base && !conMutacion && restaurada, { base, conMutacion, restaurada })

console.log('== 5. Sin variable de Negocio: falla cerrado')
{
  const r = await comoRol(null, `select count(*)::int as n from public.pedidos`)
  anota('sin app.negocio_id la consulta falla (no devuelve todo)', !r.ok, r.ok ? r.filas : r.error)
}
console.log('== 6. Si el validador se saltara: lo que frena la base sola')
const ataques: [string, string][] = [
  ['leer otra tabla sin permiso (negocios)', `select * from public.negocios`],
  ['leer pg_authid', `select * from pg_authid`],
  ['leer la columna no concedida (texto de mensajes)', `select texto from public.mensajes_cliente limit 1`],
  ['leer la columna no concedida (dirección)', `select direccion from public.pedidos limit 1`],
  ['escribir', `update public.pedidos set total = 0`],
  ['borrar', `delete from public.pedidos`],
  ['pg_sleep(5) con tope de 2 s', `select pg_sleep(5)`],
  ['cambiarse de rol', `set role neondb_owner`],
  ['consulta pesada (producto cartesiano)', `select count(*) from public.pedidos a, public.pedidos b, public.pedidos c`],
]
for (const [nombre, texto] of ataques) {
  const r = await comoRol(A, texto)
  anota(`ataque: ${nombre}`, !r.ok, r.ok ? `NO se frenó: ${JSON.stringify(r.filas).slice(0, 80)}` : `${r.error.slice(0, 90)} (${r.ms.toFixed(0)} ms)`)
}
{
  const r = await comoRol(A, `select count(*)::int as n, count(distinct p.negocio_id)::int as negocios from public.pedidos p, (select set_config('app.negocio_id', '${B}', true)) s`)
  anota('ataque: set_config dentro del SELECT para cambiar de Negocio', !r.ok || r.filas[0].negocios === 1 && r.filas[0].n === 10000, r.ok ? r.filas[0] : r.error)
  const r2 = await q.transaction([q.query(`SET LOCAL ROLE amanece_consultas`), q.query(`SELECT set_config('app.negocio_id', $1, true)`, [A]), q.query(`SELECT set_config('app.negocio_id', $1, true)`, [B]), q.query(`select count(*)::int as n, count(distinct negocio_id)::int as negocios from public.pedidos`)])
  anota('referencia: set_config como sentencia aparte SÍ cambia de Negocio (por eso el validador prohíbe set_config)', (r2[3] as any)[0].n === 800, (r2[3] as any)[0])
}
console.log('== 7. Costo de atar al Negocio')
{
  const med = async (f: () => Promise<unknown>) => { const t: number[] = []; for (let i = 0; i < 7; i++) { const t0 = performance.now(); await f(); t.push(performance.now() - t0) } return t.sort((a, b) => a - b)[3] }
  const sinAtar = await med(() => q.query(`select count(*)::int from public.pedidos where negocio_id = $1`, [A]))
  const atada = await med(() => comoRol(A, `select count(*)::int from public.pedidos where negocio_id = $1`, [A]))
  anota('mediana de 7 llamadas: una consulta suelta vs la transacción de 4 sentencias', true, { sueltaMs: Math.round(sinAtar), transaccionMs: Math.round(atada) })
}
writeFileSync('scripts/medir-sql/resultados/rls.json', JSON.stringify(salida, null, 1))
process.exit(0)
