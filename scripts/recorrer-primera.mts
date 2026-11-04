/**
 * La primera experiencia de un Dueño, de punta a punta: una cuenta de Clerk de desarrollo, un navegador de verdad, una web
 * pública leída de verdad y Muse Spark real. Pega el enlace, aprueba, contesta, abre y mira Inicio. Es lo que dejó trabado al
 * primer Dueño de producción el 4 de noviembre, y lo que la vitrina no puede probar. Lo que crea lo borra al final. Necesita
 * `ENVIO_SIMULADO=1 pnpm dev` corriendo contra una base de pruebas.
 *
 *   PANEL_URL=http://localhost:3155 pnpm tsx scripts/recorrer-primera.mts /ruta/a/carpeta [enlace]
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
if (!LLAVE?.startsWith('sk_test_')) throw new Error('recorrer-primera solo corre con una llave de desarrollo de Clerk.')
const carpeta = process.argv[2]
if (!carpeta) throw new Error('Uso: recorrer-primera.mts <carpeta de capturas> [enlace]')
const enlace = process.argv[3] ?? 'https://amanece.co'
const base = process.env.PANEL_URL ?? 'http://localhost:3000'

const { db, esquema } = await import('../src/db')
const clerk = clerkConLlave(LLAVE)
const marca = String(Date.now()).slice(-9)
const email = `primera-${marca}+clerk_test@example.com`
const clave = `una-clave-larga-${marca}`
const NOMBRE = 'Café Trigo'
const usuario = (await clerk.pedir('/users', 'POST', { email_address: [email], password: clave, first_name: 'Primera' })) as { id: string }
const nav = await abrirNavegador()

const titular = () => nav.evalua<string>(`document.querySelector('h1')?.textContent ?? ''`)
const loUltimo = () => nav.evalua<string>(`document.querySelector('main')?.lastElementChild?.textContent ?? ''`)
const foto = (nombre: string) => nav.captura(join(carpeta, `primera-${nombre}.png`), 1440, 900, false)
const decir = async (texto: string) => {
  await nav.hastaQue(`[...document.querySelectorAll('textarea')].some((x) => x.offsetParent !== null)`)
  await nav.evalua(`(() => { const t = [...document.querySelectorAll('textarea')].filter((x) => x.offsetParent !== null).at(-1); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(texto)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  afirmar(`Envía: ${texto}`, await nav.hastaQue(`(() => { const b = [...document.querySelectorAll('button[aria-label="Enviar"]')].filter((x) => x.offsetParent !== null && !x.disabled).at(-1); if (!b) return false; b.click(); return true })()`, 10_000))
}
const terminoElTurno = () => nav.hastaQue(`!document.querySelector('[aria-label="Tu agente está escribiendo"]') && [...document.querySelectorAll('button[aria-label="Enviar"]')].length > 0 && !document.body.innerText.includes('Leyendo ')`, 120_000)

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
  afirmar('Cuenta nueva: llega a la carta del armado', await nav.ve('Lo que ya sé', 90_000), await nav.ruta())
  afirmar('Cuenta nueva: empieza preguntando por su negocio', (await titular()) === 'Cuéntame de tu negocio.', await titular())
  // El primer sondeo le crea el Negocio y el Panel se vuelve a leer: lo escrito antes de eso se pierde.
  afirmar('Cuenta nueva: el agente saluda', await nav.ve('Soy tu Agente', 30_000), (await nav.texto()).slice(0, 300))
  await new Promise((r) => setTimeout(r, 3000))

  await decir(enlace)
  const hayTarjeta = await nav.ve('Están bien y no falta ninguno', 180_000)
  await foto('1-tarjeta')
  afirmar(`Lee ${enlace} y deja la tarjeta`, hayTarjeta, (await nav.texto()).slice(0, 600))
  await terminoElTurno()
  const antes = await nav.texto()
  console.log(`  Titular con la tarjeta: ${await titular()}`)

  await nav.clic('Están bien y no falta ninguno')
  afirmar('Aprobar: la tarjeta queda confirmada', await nav.ve('Confirmada', 20_000), (await nav.texto()).slice(0, 600))
  await nav.hastaQue(`document.querySelector('main')?.lastElementChild?.textContent?.includes('¿') || document.body.innerText.includes('Abrir ')`, 20_000)
  await foto('2-aprobado')
  const despues = await titular()
  const ultimo = await loUltimo()
  console.log(`  Titular al aprobar: ${despues}\n  Lo último de la carta: ${ultimo.slice(0, 160)}`)
  afirmar('Aprobar: el titular ya no pide que cuente', despues !== 'Cuéntame de tu negocio.', despues)
  afirmar('Aprobar: lo último de la carta dice qué hacer', ultimo.includes('¿') || ultimo.includes('Abrir '), ultimo.slice(0, 300))
  afirmar('Aprobar: alguna fila se marcó', await nav.evalua<boolean>(`document.querySelectorAll('aside [aria-label="Lo sé"]').length > 0`), antes.slice(0, 300))

  for (let i = 0; i < 4 && (await titular()).includes('¿'); i++) {
    const t = await titular()
    await decir(t.includes('llama') ? NOMBRE : 'La bolsa de 500 g vale 38000')
    await nav.hastaQue(`document.querySelector('h1')?.textContent !== ${JSON.stringify(t)}`, 120_000)
    await terminoElTurno()
    console.log(`  Contestó «${t}» y ahora dice: ${await titular()}`)
  }
  await foto('3-contesto')
  const pideCobro = await nav.ve('¿Cómo te pagan tus clientes?', 8000)
  if (pideCobro) await nav.clic('Te lo digo después')
  afirmar('Contesta lo mínimo y puede abrir', await nav.ve('Abrir ', 30_000), (await nav.texto()).slice(0, 600))
  await foto('4-puede-abrir')

  const abrir = await nav.evalua<string>(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith('Abrir '))?.innerText.trim() ?? ''`)
  afirmar('Abrir se activa cuando el agente termina', await nav.hastaQue(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === ${JSON.stringify(abrir)} && !b.disabled)`, 120_000))
  await nav.clic(abrir)
  afirmar('Abrir lleva a la app con su sidebar', await nav.ve('Todavía no te ha escrito nadie.', 60_000), (await nav.texto()).slice(0, 400))
  afirmar('Inicio pide lo que no bloqueó abrir', await nav.ve('Para que tu agente atienda mejor', 5000))
  await foto('5-abierto')
  await nav.clic('Decirle: Cómo cobras')
  afirmar('Decírselo empieza el mensaje', await nav.hastaQue(`[...document.querySelectorAll('textarea')].some((t) => t.value === 'Agrega cómo me pagan mis clientes: ')`, 5000))
  await decir('Agrega cómo me pagan mis clientes: contra entrega')
  afirmar('El agente trae la tarjeta para aplicarlo', await nav.ve('Aplicar', 120_000), (await nav.texto()).slice(0, 600))
  await foto('6-aplicar')
} catch (e) {
  afirmar('recorrer-primera terminó sin lanzar', false, e)
} finally {
  nav.cerrar()
  const [d] = await db.select({ negocio: esquema.duenos.negocioId }).from(esquema.duenos).where(eq(esquema.duenos.usuarioId, usuario.id))
  if (d) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, d.negocio))
  await clerk.pedir(`/users/${usuario.id}`, 'DELETE').catch((e) => afirmar('recorrer-primera borró su usuario', false, e))
}
terminar()
