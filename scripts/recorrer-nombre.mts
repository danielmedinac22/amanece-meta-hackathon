/**
 * Necesita `ENVIO_SIMULADO=1 pnpm dev` corriendo.
 *
 *   PANEL_URL=http://localhost:3156 pnpm tsx scripts/recorrer-nombre.mts <carpeta> <enlace de una página pública>
 */
import { join } from 'node:path'
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'
import { clerkConLlave } from './importar-cuentas.mjs'
import { abrirNavegador } from './navegador.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const LLAVE = process.env.CLERK_SECRET_KEY
if (!LLAVE?.startsWith('sk_test_')) throw new Error('recorrer-nombre solo corre con una llave de desarrollo de Clerk.')
const [carpeta, enlace] = process.argv.slice(2)
if (!carpeta || !enlace) throw new Error('Uso: recorrer-nombre.mts <carpeta> <enlace>')
const base = process.env.PANEL_URL ?? 'http://localhost:3000'

const { db, esquema } = await import('../src/db')
const { lecturaPendiente } = await import('../src/nucleo/cambios')
const { marcar } = await import('../src/nucleo/identidad')
const clerk = clerkConLlave(LLAVE)
const marca = String(Date.now()).slice(-9)
const clave = `una-clave-larga-${marca}`
const email = `nombre-${marca}+clerk_test@example.com`
const usuario = (await clerk.pedir('/users', 'POST', { email_address: [email], password: clave, first_name: 'Nombre' })) as { id: string }
const nav = await abrirNavegador()

const escribir = (texto: string) => nav.evalua(`(() => { const t = [...document.querySelectorAll('textarea')].filter((x) => x.offsetParent !== null).at(-1); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(texto)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const enviar = () => nav.evalua(`[...document.querySelectorAll('button[aria-label="Enviar"]')].filter((b) => b.offsetParent !== null && !b.disabled).at(-1).click() ?? true`)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

try {
  const { token } = (await clerk.pedir('/testing_tokens', 'POST')) as { token: string }
  await nav.conTestingToken(token, atob(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, ''))
  await nav.ir(`${base}/entrar`)
  await nav.escribe('email', email)
  await nav.escribe('password', clave)
  await nav.clic('Entrar')
  await nav.hastaQue(`document.body.innerText.includes('Confirma que eres tú') || location.pathname.startsWith('/panel')`)
  if (await nav.ve('Confirma que eres tú', 500)) {
    await nav.escribe('codigo', '424242')
    await nav.clic('Entrar')
  }
  afirmar('entra y ve el armado', await nav.hastaQue(`Boolean(document.querySelector('textarea'))`, 90_000), await nav.ruta())
  await espera(3000)
  const [fila] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.usuarioId, usuario.id))
  afirmar('la primera entrada le armó un Negocio', Boolean(fila))
  const negocio = marcar.negocio(fila.negocioId)

  await nav.ajustar(1440, 900, false)
  await escribir(`Esta es mi página: ${enlace}`)
  await espera(200)
  await enviar()
  let nombre: string | undefined
  for (let i = 0; i < 180 && !nombre; i++) {
    await espera(1000)
    nombre = (await lecturaPendiente(negocio))?.escritura.nombre
  }
  afirmar('la tarjeta trae el nombre de la página', Boolean(nombre), nombre)
  console.log(`Nombre leído: ${nombre}`)
  afirmar('la tarjeta lo muestra en el navegador', await nav.ve(`Nombre: «${nombre}» · lo leí`, 60_000), (await nav.texto()).slice(-600))
  await espera(1500)
  await nav.captura(join(carpeta, 'nombre-por-confirmar-pc.png'), 1440, 900, false)
  await nav.captura(join(carpeta, 'nombre-por-confirmar-telefono.png'), 390, 844, false)
  await nav.ajustar(1440, 900, false)
  const [antes] = await db.select({ nombre: esquema.negocios.nombre }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio))
  afirmar('antes del botón el Negocio no lo tiene', antes.nombre !== nombre, antes)

  await nav.clic('Están bien y no falta ninguno')
  let despues = antes.nombre
  for (let i = 0; i < 60 && despues !== nombre; i++) {
    await espera(500)
    ;[{ nombre: despues }] = await db.select({ nombre: esquema.negocios.nombre }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio))
  }
  afirmar('el botón lo guarda', despues === nombre, despues)
  await espera(2500)
  await nav.captura(join(carpeta, 'nombre-sabido-pc.png'), 1440, 900, false)
  await nav.captura(join(carpeta, 'nombre-sabido-oscuro.png'), 1440, 900, true)
} catch (e) {
  afirmar('recorrer-nombre terminó sin error inesperado', false, e)
} finally {
  nav.cerrar()
  const [d] = await db.select({ negocio: esquema.duenos.negocioId }).from(esquema.duenos).where(eq(esquema.duenos.usuarioId, usuario.id))
  if (d) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, d.negocio))
  await clerk.pedir(`/users/${usuario.id}`, 'DELETE').catch((e) => afirmar('borró su usuario', false, e))
  console.log(`Usuario de prueba creado y borrado: ${email}`)
}
terminar()
