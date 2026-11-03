/**
 * Recorre el Panel de verdad, con una sesión de Clerk de desarrollo y el Negocio sembrado LADERA de la base de pruebas: cada
 * Sección en PC y teléfono, y un turno del Hilo con el modelo real. Guarda las capturas y sale con 1 si algo se desborda o
 * pinta un error. Lo que crea lo borra al final. Necesita `ENVIO_SIMULADO=1 pnpm dev` corriendo y solo acepta una llave `sk_test_`.
 *
 *   PANEL_URL=http://localhost:3154 pnpm tsx scripts/recorrer-panel.mts /ruta/a/carpeta
 */
import { join } from 'node:path'
import { config } from 'dotenv'
import { and, eq, gt, gte } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'
import { clerkConLlave } from './importar-cuentas.mjs'
import { abrirNavegador } from './navegador.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const LLAVE = process.env.CLERK_SECRET_KEY
if (!LLAVE?.startsWith('sk_test_')) throw new Error('recorrer-panel solo corre con una llave de desarrollo de Clerk.')
const carpeta = process.argv[2]
if (!carpeta) throw new Error('Uso: recorrer-panel.mts <carpeta de capturas>')
const base = process.env.PANEL_URL ?? 'http://localhost:3000'

const { db, esquema } = await import('../src/db')
const clerk = clerkConLlave(LLAVE)
const marca = String(Date.now()).slice(-9)
const email = `recorrido-${marca}+clerk_test@example.com`
const clave = `una-clave-larga-${marca}`
const inicio = new Date()

const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
if (!ladera) throw new Error('LADERA no está sembrado en esta base.')
const usuario = (await clerk.pedir('/users', 'POST', { email_address: [email], password: clave, first_name: 'Recorrido' })) as { id: string }
const [dueno] = await db.insert(esquema.duenos).values({ negocioId: ladera.id, usuarioId: usuario.id, nombre: 'Recorrido', email }).returning()

const nav = await abrirNavegador()
const { token } = (await clerk.pedir('/testing_tokens', 'POST')) as { token: string }
await nav.conTestingToken(token, atob(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, ''))

try {
  await nav.ir(`${base}/entrar`)
  await nav.escribe('email', email)
  await nav.escribe('password', clave)
  await nav.clic('Entrar')
  await nav.hastaQue(`document.body.innerText.includes('Confirma que eres tú') || location.pathname.startsWith('/panel')`)
  if (await nav.ve('Confirma que eres tú', 500)) {
    await nav.escribe('codigo', '424242')
    await nav.clic('Entrar')
  }
  afirmar('Entra al Negocio sembrado', await nav.ve(ladera.nombre, 90_000), await nav.ruta())

  const rutas: [string, string][] = [['inicio', '/panel'], ['casos', '/panel/casos'], ['conversaciones', '/panel/conversaciones'], ['pedidos', '/panel/pedidos'], ['clientes', '/panel/clientes'], ['tablero', '/panel/tablero'], ['ajustes', '/panel/ajustes']]
  for (const [nombre, ruta] of rutas) {
    await nav.ir(`${base}${ruta}`)
    afirmar(`${ruta} pinta el Negocio`, await nav.ve(ladera.nombre, 60_000), await nav.ruta())
    afirmar(`${ruta} se queda en su ruta`, (await nav.ruta()).startsWith(ruta), await nav.ruta())
    afirmar(`${ruta} no pinta un error`, !(await nav.texto()).includes('No pude traer'), (await nav.texto()).slice(0, 300))
    await new Promise((r) => setTimeout(r, 1200))
    await nav.captura(join(carpeta, `panel-${nombre}-pc-claro.png`), 1440, 900, false)
    await nav.ajustar(390, 844, true)
    afirmar(`${ruta} abre en teléfono en Tu agente`, await nav.ve('Tu negocio', 5000))
    await nav.clic('Tu negocio')
    await new Promise((r) => setTimeout(r, 900))
    await nav.captura(join(carpeta, `panel-${nombre}-tel-oscuro.png`), 390, 844, true)
    afirmar(`${ruta} cabe a lo ancho del teléfono`, await nav.evalua<boolean>('document.documentElement.scrollWidth <= window.innerWidth'), await nav.evalua('document.documentElement.scrollWidth'))
    await nav.ajustar(1440, 900, false)
  }

  await nav.ir(`${base}/panel`)
  await nav.ve(ladera.nombre, 60_000)
  const pregunta = `¿Cuántos pedidos llevo esta semana? ${marca}`
  await nav.hastaQue(`Boolean(document.querySelector('textarea'))`)
  const pregunte = `(() => { const t = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(pregunta)}); t.dispatchEvent(new Event('input', { bubbles: true })); t.form?.requestSubmit(); return true })()`
  await nav.evalua(pregunte)
  afirmar('El Hilo pinta lo que escribió el Dueño', await nav.ve(pregunta, 30_000))
  let respondio = false
  for (let i = 0; i < 120 && !respondio; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const filas = await db.select({ rol: esquema.mensajesDueno.rol }).from(esquema.mensajesDueno).where(and(eq(esquema.mensajesDueno.duenoId, dueno.id), gte(esquema.mensajesDueno.creado, inicio)))
    respondio = filas.some((m) => m.rol === 'agente')
  }
  afirmar('El agente respondió con el modelo real y quedó en la base', respondio)
  await new Promise((r) => setTimeout(r, 1500))
  await nav.captura(join(carpeta, 'panel-hilo-pc-claro.png'), 1440, 900, false)

  const escribir = (texto: string) =>
    nav.evalua(`(() => { const t = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(texto)}); t.dispatchEvent(new Event('input', { bubbles: true })); t.form?.requestSubmit(); return true })()`)
  await escribir('Muéstrame mis productos con su precio en una Sección que se llame Precios')
  // Una Sección se aplica sola, como vista previa: lo que espera un botón es Publicar.
  afirmar('La Sección sale en el sidebar sin que nadie toque un botón', await nav.ve('Tus secciones', 180_000), (await nav.texto()).slice(0, 400))
  afirmar('La tarjeta ofrece Deshacer', await nav.ve('Deshacer', 60_000))
  await nav.captura(join(carpeta, 'panel-tarjeta-pc-claro.png'), 1440, 900, false)
  const [fila] = await db.select().from(esquema.elementos).where(and(eq(esquema.elementos.negocioId, ladera.id), eq(esquema.elementos.tipo, 'seccion'), gt(esquema.elementos.version, ladera.version)))
  afirmar('La Sección quedó en la base', Boolean(fila), fila)
  if (fila) {
    await nav.ir(`${base}/panel/secciones/${encodeURIComponent(fila.clave)}`)
    afirmar('La ruta de la Sección pinta su tabla', await nav.hastaQue(`document.querySelector('table') !== null`, 60_000) && !(await nav.texto()).includes('No pude traer'), (await nav.texto()).slice(0, 400))
    await new Promise((r) => setTimeout(r, 1000))
    await nav.captura(join(carpeta, 'panel-seccion-pc-claro.png'), 1440, 900, false)
    await nav.captura(join(carpeta, 'panel-seccion-tel-oscuro.png'), 390, 844, true)
    await nav.ajustar(1440, 900, false)
    const tocarPublicar = `[...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null && e.innerText.trim().startsWith('Publicar')).at(-1)?.click() ?? true`
    await nav.evalua(tocarPublicar)
    await new Promise((r) => setTimeout(r, 800))
    await nav.captura(join(carpeta, 'panel-publicar-abierto-pc-claro.png'), 1440, 900, false)
    await nav.evalua(tocarPublicar)
    afirmar('Publicar termina en Publicado', await nav.ve('Publicado', 60_000), (await nav.texto()).slice(0, 300))
    await new Promise((r) => setTimeout(r, 1000))
    await nav.captura(join(carpeta, 'panel-publicado-pc-claro.png'), 1440, 900, false)
  }

  await nav.clic(`Tu cuenta: Recorrido`)
  await new Promise((r) => setTimeout(r, 400))
  await nav.captura(join(carpeta, 'panel-menu-del-dueno-pc-claro.png'), 1440, 900, false)
  await nav.captura(join(carpeta, 'panel-menu-del-dueno-pc-oscuro.png'), 1440, 900, true)
} catch (e) {
  afirmar('recorrer-panel terminó sin lanzar', false, e)
} finally {
  nav.cerrar()
  await db.delete(esquema.elementos).where(and(eq(esquema.elementos.negocioId, ladera.id), gt(esquema.elementos.version, ladera.version)))
  await db.update(esquema.negocios).set({ version: ladera.version }).where(eq(esquema.negocios.id, ladera.id))
  await db.delete(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, ladera.id), gte(esquema.propuestas.creado, inicio)))
  await db.delete(esquema.cambios).where(and(eq(esquema.cambios.negocioId, ladera.id), gte(esquema.cambios.creado, inicio)))
  await db.delete(esquema.duenos).where(eq(esquema.duenos.id, dueno.id))
  await clerk.pedir(`/users/${usuario.id}`, 'DELETE')
}
terminar()
