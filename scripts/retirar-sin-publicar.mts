/**
 * Va antes de cualquier vuelta a un despliegue anterior, y antes de `quitar-panel.mts`: ese código lee la última fila e
 * ignora el bit, así que lo aplicado sin publicar les llegaría a los Clientes de una. Deja cada clave pendiente igual a
 * lo publicado, con una fila de origen `tablas_viejas`. El Dueño pierde esos pendientes de su vista previa, aunque
 * siguen en la historia. Las filas con el bit arriba se quedan así: el código viejo solo lee la última de cada clave, y
 * esa ya vale lo que los Clientes tienen. En seco por defecto. Una transacción por Negocio, y uno que falla no corta la
 * corrida. Correrlo otra vez escribe 0.
 *
 * El orden importa: un Indicador publicado y quitado sin publicar no es una clave viva para `quitar-panel`, y esta
 * corrida lo revive; si `quitar-panel` fue primero, el código viejo se encuentra una fila que no conoce.
 *
 *   pnpm tsx scripts/retirar-sin-publicar.mts [--de-verdad] [--negocio=<id>]
 */
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import { asc, eq } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { escrituraParaRetirar, leerAplicado, leerPublicado, loPendiente } = await import('../src/nucleo/estado')
const { escribir } = await import('../src/nucleo/estado/escribir')
const { marcar } = await import('../src/nucleo/identidad')

type NegocioId = import('../src/nucleo/identidad').NegocioId
type ItemPendiente = import('../src/nucleo/estado').ItemPendiente

export function retirarSinPublicar(negocio: NegocioId, opciones: { readonly deVerdad: boolean }): Promise<readonly ItemPendiente[]> {
  return conTransaccion<readonly ItemPendiente[]>(async (tx, deshacer) => {
    await tx.select({ id: esquema.negocios.id }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('no key update')
    const [aplicado, publicado] = [await leerAplicado(negocio, tx), await leerPublicado(negocio, tx)]
    const items = loPendiente(aplicado, publicado)
    if (!opciones.deVerdad) return deshacer(items)
    const r = await escribir(tx, negocio, { tipo: 'tablas_viejas' }, escrituraParaRetirar(aplicado, publicado), null)
    if (r.tipo === 'conflicto') throw new Error(`conflicto en ${r.claves.map((c) => c.clave).join(', ')}; vuelve a correrlo`)
    if (r.tipo === 'invalida') throw new Error(`no cabe: ${r.problemas.map((p) => p.tipo).join(', ')}`)
    return items
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
      const items = await retirarSinPublicar(marcar.negocio(n.id), { deVerdad })
      total += items.length
      if (items.length) console.log(`${n.codigo}: ${items.length} ${deVerdad ? 'retiradas' : 'por retirar'}`)
      for (const i of items) console.log(`  - ${i.clave}`)
    } catch (e) {
      console.error(`${n.codigo}: falló`, e)
      fallaron.push(n.codigo)
    }
  }
  console.log(`Resumen: ${total} claves ${deVerdad ? 'retiradas' : 'por retirar'}${fallaron.length ? `; fallaron ${fallaron.join(', ')}` : ''}.`)
  process.exit(fallaron.length ? 1 : 0)
}
