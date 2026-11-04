/**
 * Adjuntar de verdad: sesión real de Clerk de desarrollo, Chrome, las rutas y Muse Spark. Una foto y un PDF desde PC y teléfono,
 * en el armado y con el Negocio abierto, y un archivo ajeno pedido con otra sesión. Guarda capturas y borra lo que crea. Necesita
 * `ENVIO_SIMULADO=1 pnpm dev` corriendo y solo acepta una llave `sk_test_`.
 *
 *   PANEL_URL=http://localhost:3155 pnpm tsx scripts/recorrer-archivos.mts /ruta/a/carpeta
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afirmar, terminar } from './afirmar.mjs'
import { clerkConLlave } from './importar-cuentas.mjs'
import { abrirNavegador } from './navegador.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const LLAVE = process.env.CLERK_SECRET_KEY
if (!LLAVE?.startsWith('sk_test_')) throw new Error('recorrer-archivos solo corre con una llave de desarrollo de Clerk.')
const carpeta = process.argv[2]
if (!carpeta) throw new Error('Uso: recorrer-archivos.mts <carpeta de capturas>')
const base = process.env.PANEL_URL ?? 'http://localhost:3000'

const { db, esquema } = await import('../src/db')
const { abrirConElBoton } = await import('../src/negocio/abrir')
const { guardarEnElAlta } = await import('../src/nucleo/cambios')
const { marcar } = await import('../src/nucleo/identidad')
const a = esquema.archivosDueno
const clerk = clerkConLlave(LLAVE)
const marca = String(Date.now()).slice(-9)
const clave = `una-clave-larga-${marca}`
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const FOTO = readFileSync(new URL('./archivos-de-prueba/lista.png', import.meta.url))

async function pdf() {
  const doc = await PDFDocument.create()
  const fuente = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([600, 400]).drawText('Lista Ladera Norte\nCuchara Roble, $23.400\nTaza Arrayan, $31.800', { x: 40, y: 340, size: 18, font: fuente, lineHeight: 26 })
  return Buffer.from(await doc.save())
}

const usuarios: { id: string; email: string }[] = []
async function crearUsuario(quien: string) {
  const email = `archivos-${quien}-${marca}+clerk_test@example.com`
  const u = (await clerk.pedir('/users', 'POST', { email_address: [email], password: clave, first_name: quien })) as { id: string }
  usuarios.push({ id: u.id, email })
  return { id: u.id, email }
}
const jwtDe = async (usuario: string) => {
  const s = (await clerk.pedir('/sessions', 'POST', { user_id: usuario })) as { id: string }
  return ((await clerk.pedir(`/sessions/${s.id}/tokens`, 'POST', {})) as { jwt: string }).jwt
}
const ver = (ruta: string, jwt?: string, opciones: RequestInit = {}) => fetch(`${base}${ruta}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000), ...opciones, headers: { ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), ...opciones.headers } })

const dueno = await crearUsuario('duena')
const ajeno = await crearUsuario('ajeno')
const nav = await abrirNavegador()

const escoger = (nombre: string, tipo: string, bytes: Buffer) =>
  nav.evalua(`(() => { const b = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), (c) => c.charCodeAt(0)); const d = new DataTransfer(); d.items.add(new File([b], ${JSON.stringify(nombre)}, { type: ${JSON.stringify(tipo)} })); const i = [...document.querySelectorAll('[data-adjuntar]')].at(-1); i.files = d.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
const escribir = (texto: string) => nav.evalua(`(() => { const t = [...document.querySelectorAll('textarea')].filter((x) => x.offsetParent !== null).at(-1); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(texto)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const enviar = () => nav.evalua(`[...document.querySelectorAll('button[aria-label="Enviar"]')].filter((b) => b.offsetParent !== null && !b.disabled).at(-1).click() ?? true`)
const listo = (nombre: string) => nav.hastaQue(`[...document.querySelectorAll('[aria-label="Archivos para enviar"] li')].some((l) => l.innerText.includes(${JSON.stringify(nombre)}) && !l.innerText.includes('Subiendo'))`, 60_000)

async function darVuelta(duenoId: string, cuantos: number) {
  for (let i = 0; i < 240; i++) {
    const n = await db.$count(esquema.mensajesDueno, eq(esquema.mensajesDueno.duenoId, duenoId))
    if (n >= cuantos) {
      const [ultimo] = await db.select({ rol: esquema.mensajesDueno.rol }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, duenoId)).orderBy(esquema.mensajesDueno.creado).offset(cuantos - 1).limit(1)
      if (ultimo?.rol === 'agente') return
    }
    await espera(500)
  }
  throw new Error('El agente no respondió')
}
const filasDelHilo = (duenoId: string) => db.$count(esquema.mensajesDueno, eq(esquema.mensajesDueno.duenoId, duenoId))

try {
  const { token } = (await clerk.pedir('/testing_tokens', 'POST')) as { token: string }
  await nav.conTestingToken(token, atob(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, ''))
  await nav.ir(`${base}/entrar`)
  await nav.escribe('email', dueno.email)
  await nav.escribe('password', clave)
  await nav.clic('Entrar')
  await nav.hastaQue(`document.body.innerText.includes('Confirma que eres tú') || location.pathname.startsWith('/panel')`)
  if (await nav.ve('Confirma que eres tú', 500)) {
    await nav.escribe('codigo', '424242')
    await nav.clic('Entrar')
  }
  afirmar('Entra y ve el armado con adjuntar', await nav.hastaQue(`Boolean(document.querySelector('[aria-label="Adjuntar"]'))`, 90_000), await nav.ruta())
  await espera(3000)
  const [fila] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.usuarioId, dueno.id))
  afirmar('La primera entrada le armó un Negocio de prueba', Boolean(fila))
  const ctx = { negocio: marcar.negocio(fila.negocioId), dueno: marcar.dueno(fila.id), medio: 'web' } as const

  await nav.ajustar(1440, 900, false)
  await escoger('lista precios 99000.png', 'image/png', FOTO)
  await nav.captura(join(carpeta, 'real-subiendo-pc-claro.png'), 1440, 900, false)
  afirmar('PC: la foto sube', await listo('lista precios 99000.png'), (await nav.texto()).slice(-400))
  await nav.captura(join(carpeta, 'real-lista-para-enviar-pc-claro.png'), 1440, 900, false)
  let antes = await filasDelHilo(fila.id)
  await escribir('Esta es mi lista de precios')
  await espera(200)
  await enviar()
  await darVuelta(fila.id, antes + 2)
  afirmar('PC: lo leído de la foto llega en su tarjeta', await nav.ve('Tueste Zarzamora', 60_000), (await nav.texto()).slice(-500))
  await espera(1200)
  await nav.captura(join(carpeta, 'real-armado-foto-pc-claro.png'), 1440, 900, false)
  const [subida] = await db.select({ id: a.id, tipo: a.tipo, nombre: a.nombre, lecturas: a.lecturas, enviado: a.enviado }).from(a).where(eq(a.duenoId, fila.id))
  afirmar('PC: quedó guardada, enviada y leída una vez', subida?.tipo === 'image/png' && subida.lecturas === 1 && !!subida.enviado, subida)
  afirmar('PC: el globo enlaza al archivo', await nav.evalua<boolean>(`[...document.querySelectorAll('a')].some((x) => x.getAttribute('href') === '/api/dueno/archivos/${subida.id}')`))
  await nav.clic('Están bien y no falta ninguno')
  afirmar('PC: con el botón queda confirmada', await nav.ve('Confirmada', 60_000), (await nav.texto()).slice(-500))
  const [cuenta] = await db.select({ n: esquema.elementos.clave }).from(esquema.elementos).where(eq(esquema.elementos.negocioId, fila.negocioId)).limit(1)
  afirmar('PC: lo leído ya está en el Negocio', Boolean(cuenta))

  await nav.ajustar(390, 844, true)
  await espera(800)
  await escoger('menu.pdf', 'application/pdf', await pdf())
  afirmar('Teléfono: el PDF sube', await listo('menu.pdf'), (await nav.texto()).slice(-400))
  await nav.captura(join(carpeta, 'real-armado-adjuntando-tel-oscuro.png'), 390, 844, true)
  antes = await filasDelHilo(fila.id)
  await enviar()
  await darVuelta(fila.id, antes + 2)
  afirmar('Teléfono: lo leído del PDF llega sin escribir nada', await nav.ve('Cuchara Roble', 60_000), (await nav.texto()).slice(-500))
  await espera(1200)
  await nav.captura(join(carpeta, 'real-armado-pdf-tel-oscuro.png'), 390, 844, true)
  afirmar('Teléfono: cabe a lo ancho', await nav.evalua<boolean>('document.documentElement.scrollWidth <= window.innerWidth'))

  const jwtDelDueno = await jwtDe(dueno.id)
  const jwtAjeno = await jwtDe(ajeno.id)
  afirmar('Sin sesión, el archivo pide entrar', (await ver(`/api/dueno/archivos/${subida.id}`)).status === 401)
  const delDueno = await ver(`/api/dueno/archivos/${subida.id}`, jwtDelDueno)
  afirmar('Con su sesión, el archivo sale con su tipo y sin dejar adivinar otro', delDueno.status === 200 && delDueno.headers.get('content-type') === 'image/png' && delDueno.headers.get('x-content-type-options') === 'nosniff', delDueno.status)
  afirmar('Salen los mismos bytes', Buffer.compare(Buffer.from(await delDueno.arrayBuffer()), FOTO) === 0)
  // El ajeno ya tiene sesión pero todavía no Negocio: el primer GET del Hilo se lo arma.
  await ver('/api/dueno/chat', jwtAjeno)
  const deOtro = await ver(`/api/dueno/archivos/${subida.id}`, jwtAjeno)
  const noExiste = await ver(`/api/dueno/archivos/00000000-0000-4000-8000-000000000000`, jwtAjeno)
  afirmar('Un archivo de otro Negocio responde igual que uno que no existe', deOtro.status === 404 && noExiste.status === 404 && (await deOtro.text()) === (await noExiste.text()), deOtro.status)
  const [delAjeno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.usuarioId, ajeno.id))
  const antesAjeno = await filasDelHilo(delAjeno.id)
  const conAjeno = await ver('/api/dueno/chat', jwtAjeno, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'lee esto' }, { type: 'data-archivo', data: { id: subida.id } }] }] }) })
  afirmar('Mandar en un mensaje el archivo de otro Negocio se rechaza y no guarda nada', conAjeno.status === 400 && (await filasDelHilo(delAjeno.id)) === antesAjeno, conAjeno.status)
  const texto = new FormData()
  texto.set('archivo', new File(['<script>alert(1)</script>'], 'precios.pdf', { type: 'application/pdf' }))
  const subidaFalsa = await ver('/api/dueno/archivos', jwtDelDueno, { method: 'POST', body: texto })
  afirmar('Un texto con nombre de PDF no sube', subidaFalsa.status === 422, subidaFalsa.status)

  // Una foto de teléfono: pesa más de 1 MB y pasa por el lienzo antes de subir.
  await guardarEnElAlta(ctx, { nombre: 'Café Archivos', rubro: 'café', quiere: [{ tipo: 'poner', elemento: { tipo: 'dato', campo: 'ciudad', valor: 'Manizales' }, reemplaza: null }] })
  const abierto = await abrirConElBoton(ctx)
  afirmar('El Negocio de prueba abre', abierto.abierto, abierto)
  await nav.ir(`${base}/panel`)
  await nav.ajustar(1440, 900, false)
  afirmar('Con el Negocio abierto se ve el Hilo con adjuntar', await nav.hastaQue(`Boolean([...document.querySelectorAll('[data-pano=hilo] [aria-label="Adjuntar"]')].find((b) => b.offsetParent !== null))`, 60_000), await nav.ruta())
  await nav.evalua(`(async () => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d'); const d = x.createImageData(4000, 3000); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255 } x.putImageData(d, 0, 0); x.fillStyle = 'white'; x.fillRect(200, 200, 3600, 2600); x.fillStyle = 'black'; x.font = '180px Helvetica'; x.fillText('Botella Guadua, $54.200', 400, 800); const b = await new Promise((r) => c.toBlob(r, 'image/png')); window.__peso = b.size; const t = new DataTransfer(); t.items.add(new File([b], 'foto-de-telefono.png', { type: 'image/png' })); const i = [...document.querySelectorAll('[data-adjuntar]')].at(-1); i.files = t.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  afirmar('Una foto grande sube', await listo('foto-de-telefono.png'), (await nav.texto()).slice(-400))
  antes = await filasDelHilo(fila.id)
  await escribir('¿Qué producto sale en esta foto y cuánto vale?')
  await espera(200)
  await enviar()
  await darVuelta(fila.id, antes + 2)
  await espera(1500)
  const pesoOriginal = await nav.evalua<number>('window.__peso')
  const [grande] = await db.select({ tamano: a.tamano, tipo: a.tipo }).from(a).where(eq(a.nombre, 'foto-de-telefono.png'))
  console.log(`Foto de 4000x3000: ${pesoOriginal} bytes en el navegador, ${grande.tamano} guardados como ${grande.tipo}`)
  afirmar('La foto grande se redujo en el navegador', grande.tipo === 'image/jpeg' && grande.tamano < 4_000_000 && grande.tamano < pesoOriginal, grande)
  const hilo = await nav.evalua<string>(`document.querySelector('[data-pano=hilo]').innerText`)
  console.log('Con el Negocio abierto respondió:', hilo.slice(-300))
  afirmar('Abierto: el agente contesta con lo que trae la foto', /Guadua/i.test(hilo) && /54\.?200/.test(hilo), hilo.slice(-400))
  afirmar('Abierto: preguntar no deja una tarjeta nueva', !hilo.includes('Compara cada precio con tu foto') || (hilo.match(/Compara cada precio/g) ?? []).length <= 2)
  await nav.captura(join(carpeta, 'real-hilo-foto-pc-claro.png'), 1440, 900, false)
  await nav.captura(join(carpeta, 'real-hilo-foto-pc-oscuro.png'), 1440, 900, true)
  await nav.captura(join(carpeta, 'real-hilo-foto-tel-claro.png'), 390, 844, false)
} catch (e) {
  afirmar('recorrer-archivos terminó sin lanzar', false, e)
} finally {
  nav.cerrar()
  for (const u of usuarios) {
    const [d] = await db.select({ negocio: esquema.duenos.negocioId }).from(esquema.duenos).where(eq(esquema.duenos.usuarioId, u.id))
    if (d) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, d.negocio))
    await clerk.pedir(`/users/${u.id}`, 'DELETE').catch((e) => afirmar('borró su usuario', false, e))
    console.log(`Usuario de prueba creado y borrado: ${u.email}`)
  }
}
terminar()
