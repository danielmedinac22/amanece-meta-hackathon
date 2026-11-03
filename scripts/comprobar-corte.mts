/**
 * Solo lectura. Después de la 0005 y antes de publicar el código: por cada Negocio, lo publicado tiene que ser
 * exactamente lo aplicado, porque ningún Cliente debe notar el corte. Sale con 1 si algún Negocio difiere o no se lee.
 *
 *   pnpm tsx scripts/comprobar-corte.mts
 */
import { config } from 'dotenv'
import { asc } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })

const { db, esquema } = await import('../src/db')
const { leerAplicado, leerPublicado } = await import('../src/nucleo/estado')
const { marcar } = await import('../src/nucleo/identidad')
const { canonico } = await import('../src/lib/canonico')

const contenido = (e: { todos(): readonly { clave: string; elemento: unknown }[] }) => canonico([...e.todos()].map((v) => [v.clave, v.elemento]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))

const t = esquema.negocios
const negocios = await db.select({ id: t.id, codigo: t.codigo }).from(t).orderBy(asc(t.codigo))
const fallaron: string[] = []
let elementos = 0
for (const n of negocios) {
  try {
    const N = marcar.negocio(n.id)
    const [aplicado, publicado] = [await leerAplicado(N), await leerPublicado(N)]
    elementos += aplicado.todos().length
    if (contenido(aplicado) !== contenido(publicado)) {
      fallaron.push(n.codigo)
      console.error(`${n.codigo}: lo publicado difiere de lo aplicado (${publicado.todos().length} contra ${aplicado.todos().length})`)
    }
  } catch (e) {
    fallaron.push(n.codigo)
    console.error(`${n.codigo}: no se pudo leer`, e)
  }
}
console.log(`${negocios.length} Negocios, ${elementos} Elementos vigentes. ${fallaron.length ? `Difieren o fallan: ${fallaron.join(', ')}` : 'En todos, lo publicado es lo aplicado.'}`)
process.exit(fallaron.length ? 1 : 0)
