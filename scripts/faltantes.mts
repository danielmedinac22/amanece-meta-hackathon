/**
 * Lo que los Dueños pidieron y Amanece no tiene, con sus palabras. Es para el equipo, con las credenciales de la
 * base: `/medicion` muestra solo los grupos. Solo lee.
 *
 *   pnpm tsx scripts/faltantes.mts [--clave no_se_puede:pedidos] [--dias 30]
 */
import { config } from 'dotenv'
import { and, desc, eq, gte } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })
const { db, esquema } = await import('../src/db')

const valor = (nombre: string) => {
  const i = process.argv.indexOf(nombre)
  return i > 0 ? process.argv[i + 1] : undefined
}
const clave = valor('--clave')
const desde = new Date(Date.now() - Number(valor('--dias') ?? 30) * 86_400_000)
const t = esquema.capacidadesFaltantes

const filas = await db
  .select({ clave: t.claveDeAgrupacion, tipo: t.tipo, pedido: t.pedido, detalle: t.detalle, motivo: t.motivo, creado: t.creado, negocio: esquema.negocios.codigo })
  .from(t)
  .innerJoin(esquema.negocios, eq(esquema.negocios.id, t.negocioId))
  .where(and(gte(t.creado, desde), clave ? eq(t.claveDeAgrupacion, clave) : undefined))
  .orderBy(desc(t.creado))

const grupos = Map.groupBy(filas, (f) => f.clave)
console.log(`${filas.length} Capacidades faltantes desde ${desde.toISOString().slice(0, 10)}, en ${grupos.size} grupos\n`)
for (const [g, deEste] of [...grupos].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${g}: ${deEste.length} veces, ${new Set(deEste.map((f) => f.negocio)).size} Negocios`)
  for (const f of deEste.slice(0, 10)) console.log(`  ${f.creado.toISOString().slice(0, 16)} ${f.negocio}: «${f.pedido}»${f.tipo === 'anterior' ? ` (${f.motivo})` : ''}`)
}
