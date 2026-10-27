/** Una Sección con "todos los pedidos" en el Negocio sintético: ¿llega a reintentar o a fallar? */
import { eventos, ponerCorrida, quietud } from './entorno.mts'
import { writeFileSync } from 'node:fs'
const { db, esquema } = await import('../../src/db')
const { eq } = await import('drizzle-orm')
const cambios = await import('../../src/negocio/cambios')
const { generarPieza } = await import('../../src/agentes/generador')
const [neg] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'SINTETICO'))
const [dueno] = await db.insert(esquema.duenos).values({ negocioId: neg.id, usuarioId: `medir-lista-${Date.now()}`, nombre: 'Dueño sintético' }).returning()
const out: unknown[] = []
const PEDIDOS = ['Quiero una lista de todos mis pedidos con el cliente, la ciudad y el total.', 'Quiero ver todos los pedidos entregados este mes, uno por fila, con cliente, ciudad, total y fecha.']
for (const [i, pedido] of PEDIDOS.entries()) {
  ponerCorrida(`lista-${i}`)
  const intentos: { error?: string; codigo: string }[] = []
  const t = performance.now()
  const c = await cambios.proponerPieza(neg.id, dueno.id, pedido, 'seccion', `Lista ${i}`, async (entrada) => {
    intentos.push({ error: entrada.intentoFallido?.error, codigo: '' })
    return generarPieza(entrada)
  })
  await quietud()
  const vp = c.vistaPrevia as { totalFilas?: number; error?: string; intentos?: number; ms?: number }
  const reg = { pedido, estado: c.estado, intentosDelGenerador: intentos.length, errorQueRecibioElGenerador: intentos.map((x) => x.error?.slice(0, 220) ?? null), totalFilas: vp.totalFilas ?? null, error: vp.error ?? null, msQuickJS: vp.ms ?? null, ms: Math.round(performance.now() - t), llamadas: eventos.filter((e) => e.corrida === `lista-${i}` && e.kind === 'modelo').length, costoGuardado: c.costoUsd }
  out.push(reg)
  console.log(JSON.stringify(reg))
}
writeFileSync('scripts/medir/resultados/sintetico-lista.json', JSON.stringify(out, null, 1))
process.exit(0)
