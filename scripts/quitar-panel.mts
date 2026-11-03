/**
 * Va antes de cualquier vuelta a un despliegue anterior: ese código no conoce los tipos `seccion` e `indicador`, su
 * `leerAplicado` lanza con una sola fila viva de esas y el Negocio queda sin atender. Deja la lápida (`contenido` null,
 * versión siguiente, por `escribir`) en cada clave `seccion:` e `indicador:`. En seco por defecto. Una transacción por
 * Negocio, y uno que falla no corta la corrida. Correrlo otra vez escribe 0.
 *
 *   pnpm tsx scripts/quitar-panel.mts [--de-verdad] [--negocio=<id>]
 */
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import { asc, eq, like, or } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { ultimasDe } = await import('../src/nucleo/estado')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')

type Clave = import('../src/nucleo/estado/elementos').Clave
type NegocioId = import('../src/nucleo/identidad').NegocioId

export function quitarPanel(negocio: NegocioId, opciones: { readonly deVerdad: boolean }): Promise<readonly Clave[]> {
  return conTransaccion<readonly Clave[]>(async (tx, deshacer) => {
    const t = esquema.elementos
    const vivas = (await ultimasDe(tx, negocio, or(like(t.clave, 'seccion:%'), like(t.clave, 'indicador:%')))).filter((u) => u.contenido !== null)
    const claves = vivas.map((u) => el.comoClave(u.clave))
    if (!opciones.deVerdad || !claves.length) return deshacer(claves)
    const r = await escribir(tx, negocio, { tipo: 'tablas_viejas' }, { elementos: vivas.map((u) => ({ clave: el.comoClave(u.clave), base: el.comoVersion(u.version), despues: null })), filas: [] }, null)
    if (r.tipo === 'conflicto') throw new Error(`conflicto en ${r.claves.map((c) => c.clave).join(', ')}; vuelve a correrlo`)
    if (r.tipo === 'invalida') throw new Error(`no cabe: ${r.problemas.map((p) => p.tipo).join(', ')}`)
    return claves
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const deVerdad = process.argv.includes('--de-verdad')
  const solo = process.argv.find((a) => a.startsWith('--negocio='))?.slice('--negocio='.length)
  const t = esquema.negocios
  const negocios = await db.select({ id: t.id, codigo: t.codigo }).from(t).where(solo ? eq(t.id, solo) : undefined).orderBy(asc(t.codigo))
  console.log(`${deVerdad ? '' : '[en seco] '}${negocios.length} Negocios`)
  const fallaron: string[] = []
  let total = 0
  for (const n of negocios) {
    try {
      const claves = await quitarPanel(marcar.negocio(n.id), { deVerdad })
      total += claves.length
      if (claves.length) console.log(`${n.codigo}: ${claves.length} ${deVerdad ? 'quitadas' : 'por quitar'}`)
      for (const c of claves) console.log(`  - ${c}`)
    } catch (e) {
      console.error(`${n.codigo}: falló`, e)
      fallaron.push(n.codigo)
    }
  }
  console.log(`Resumen: ${total} claves ${deVerdad ? 'quitadas' : 'por quitar'}${fallaron.length ? `; fallaron ${fallaron.join(', ')}` : ''}.`)
  process.exit(fallaron.length ? 1 : 0)
}
