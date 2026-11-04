/**
 * Recorre el Panel de verdad, con una sesión de Clerk de desarrollo y el Negocio sembrado LADERA de la base de pruebas: cada
 * Sección en PC y teléfono, un turno del Hilo con el modelo real, tomar y devolver una conversación, el detalle de un pedido,
 * adjuntar y Corregir. Guarda las capturas y sale con 1 si algo se desborda o pinta un error. Lo que crea lo borra al final. Necesita `ENVIO_SIMULADO=1 pnpm dev` corriendo y solo acepta una llave `sk_test_`.
 *
 *   PANEL_URL=http://localhost:3154 pnpm tsx scripts/recorrer-panel.mts /ruta/a/carpeta
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { and, desc, eq, gt, gte, max } from 'drizzle-orm'
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
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { marcar } = await import('../src/nucleo/identidad')
const clerk = clerkConLlave(LLAVE)
const marca = String(Date.now()).slice(-9)
const email = `recorrido-${marca}+clerk_test@example.com`
const clave = `una-clave-larga-${marca}`
const inicio = new Date()

const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
if (!ladera) throw new Error('LADERA no está sembrado en esta base.')
const usuario = (await clerk.pedir('/users', 'POST', { email_address: [email], password: clave, first_name: 'Recorrido' })) as { id: string }
const [dueno] = await db.insert(esquema.duenos).values({ negocioId: ladera.id, usuarioId: usuario.id, nombre: 'Recorrido', email }).returning()
const turnosAntes = await db.$count(esquema.turnos, eq(esquema.turnos.negocioId, ladera.id))

const nav = await abrirNavegador()
const otroNav = await abrirNavegador()
const telefono = `573${marca}`
const FOTO = readFileSync(new URL('./archivos-de-prueba/lista.png', import.meta.url))
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const emailDelArmado = `recorrido-armado-${marca}+clerk_test@example.com`
const delArmado = (await clerk.pedir('/users', 'POST', { email_address: [emailDelArmado], password: clave, first_name: 'Armado' })) as { id: string }

type Navegador = typeof nav
async function entrar(n: Navegador, correo: string, token: string) {
  await n.conTestingToken(token, atob(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, ''))
  await n.ir(`${base}/entrar`)
  await n.escribe('email', correo)
  await n.escribe('password', clave)
  await n.clic('Entrar')
  await n.hastaQue(`document.body.innerText.includes('Confirma que eres tú') || location.pathname.startsWith('/panel')`)
  if (await n.ve('Confirma que eres tú', 500)) {
    await n.escribe('codigo', '424242')
    await n.clic('Entrar')
  }
}
const escribirEnElHilo = (n: Navegador, texto: string) =>
  n.evalua(`(() => { const t = [...document.querySelectorAll('textarea')].filter((x) => x.offsetParent !== null).at(-1); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(texto)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const enviarEnElHilo = (n: Navegador) => n.hastaQue(`(() => { const b = [...document.querySelectorAll('button[aria-label="Enviar"]')].filter((x) => x.offsetParent !== null && !x.disabled).at(-1); if (!b) return false; b.click(); return true })()`, 30_000)
async function adjuntarLaLista(n: Navegador) {
  await n.hastaQue(`document.querySelectorAll('[data-adjuntar]').length > 0`, 60_000)
  await n.evalua(`(() => { const b = Uint8Array.from(atob(${JSON.stringify(FOTO.toString('base64'))}), (c) => c.charCodeAt(0)); const d = new DataTransfer(); d.items.add(new File([b], 'lista.png', { type: 'image/png' })); const i = [...document.querySelectorAll('[data-adjuntar]')].at(-1); i.files = d.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  return n.hastaQue(`[...document.querySelectorAll('[aria-label="Archivos para enviar"] li')].some((l) => l.innerText.includes('lista.png') && !l.innerText.includes('Subiendo'))`, 60_000)
}
const tarjetaLeida = async (negocio: string) => {
  const [p] = await db.select({ escritura: esquema.propuestas.escritura }).from(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, negocio), eq(esquema.propuestas.origen, 'lectura'), eq(esquema.propuestas.estado, 'espera_al_dueno'), gte(esquema.propuestas.creado, inicio)))
  return p ? JSON.stringify(p.escritura) : null
}
async function hasta(condicion: () => Promise<boolean>, limiteMs = 180_000) {
  for (const fin = Date.now() + limiteMs; Date.now() < fin; await espera(1000)) if (await condicion()) return true
  return false
}

try {
  const { token } = (await clerk.pedir('/testing_tokens', 'POST')) as { token: string }
  await entrar(nav, email, token)
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

  console.log('Tomar la conversación')
  let wamid = 0
  const escribeElCliente = (texto: string) => atenderMensaje({ wamid: marcar.wamid(`wamid.RECORRIDO.${marca}.${++wamid}`), telefono, nombre: 'Camila Recorrido', texto, enviadoEn: marcar.instante(new Date()), boton: null, referido: 'ninguno' }, marcar.negocio(ladera.id))
  await escribeElCliente('Hola, ¿qué cafés tienen?')
  const [cliente] = await db.select().from(esquema.clientes).where(and(eq(esquema.clientes.negocioId, ladera.id), eq(esquema.clientes.telefono, telefono)))
  const delCliente = (rol: 'agente' | 'dueno') => db.select().from(esquema.mensajesCliente).where(and(eq(esquema.mensajesCliente.clienteId, cliente.id), eq(esquema.mensajesCliente.rol, rol)))
  const filaDelCliente = async () => (await db.select().from(esquema.clientes).where(eq(esquema.clientes.id, cliente.id)))[0]
  afirmar('Libre, el agente le responde al Cliente', (await delCliente('agente')).length === 1)

  await nav.ajustar(1440, 900, false)
  await nav.ir(`${base}/panel/conversaciones?cliente=${cliente.id}`)
  afirmar('La conversación ofrece tomarla', await nav.ve('Tomar la conversación', 60_000), (await nav.texto()).slice(-400))
  await nav.clic('Tomar la conversación')
  afirmar('Tomada, ofrece devolverla', await nav.ve('Devolver al agente', 30_000), (await nav.texto()).slice(-400))
  const tomada = await filaDelCliente()
  afirmar('La toma queda a nombre del Dueño de la sesión', tomada.tomadaPor === dueno.id && tomada.vecesTomada === 1, tomada.tomadaPor)
  await nav.captura(join(carpeta, 'toma-tomada-pc-claro.png'), 1440, 900, false)

  const escrito = `Hola Camila, soy el dueño ${marca}`
  const redactorDeLaToma = `document.querySelector('textarea[aria-label="Escríbele al Cliente"]')`
  afirmar('Tomada, se le puede escribir', await nav.hastaQue(`Boolean(${redactorDeLaToma})`, 30_000))
  await nav.evalua(`(() => { const t = ${redactorDeLaToma}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(escrito)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await espera(200)
  await nav.evalua(`${redactorDeLaToma}.form.requestSubmit() ?? true`)
  afirmar('Lo que escribió el Dueño se ve en la conversación', await nav.ve(escrito, 30_000), (await nav.texto()).slice(-400))
  afirmar('Lo que escribió el Dueño queda guardado con su rol', await hasta(async () => (await delCliente('dueno')).some((m) => m.texto === escrito), 30_000))

  const agenteAntes = (await delCliente('agente')).length
  await escribeElCliente('¿Me confirmas el precio?')
  afirmar('Tomada, el agente no le contesta', (await delCliente('agente')).length === agenteAntes)
  afirmar('Tomada, lo que escribió queda debido', (await filaDelCliente()).sinContestar !== null)
  const avisos = await db.select({ mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(and(eq(esquema.mensajesDueno.duenoId, dueno.id), gte(esquema.mensajesDueno.creado, inicio)))
  afirmar('Quien la tiene recibe el aviso en su Hilo', avisos.some((m) => JSON.stringify(m.mensaje).includes('data-toma')))

  await nav.ir(`${base}/panel/conversaciones?cliente=${cliente.id}`)
  await nav.clic('Devolver al agente', 60_000)
  afirmar('Devuelta, se puede volver a tomar', await nav.ve('Tomar la conversación', 30_000), (await nav.texto()).slice(-400))
  afirmar('Devuelta, ya no la tiene nadie', (await filaDelCliente()).tomadaPor === null)
  afirmar('Devuelta, el agente contesta lo que quedó debido', await hasta(async () => (await delCliente('agente')).length === agenteAntes + 1), (await delCliente('agente')).length)
  await escribeElCliente('Gracias, ¿y el de tueste medio?')
  afirmar('Devuelta, el agente vuelve a responder lo nuevo', (await delCliente('agente')).length === agenteAntes + 2, (await delCliente('agente')).length)
  const salidas = await db.select({ estado: esquema.mensajesSalientes.estado }).from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.clienteId, cliente.id))
  afirmar('Nada le salió de verdad al Cliente: todo fue simulado', salidas.length > 0 && salidas.every((f) => f.estado === 'simulado' || f.estado === 'no_salio') && salidas.some((f) => f.estado === 'simulado'), salidas)

  console.log('El detalle de un pedido')
  const [{ ultimo }] = await db.select({ ultimo: max(esquema.pedidos.numero) }).from(esquema.pedidos).where(eq(esquema.pedidos.negocioId, ladera.id))
  const numero = (ultimo ?? 0) + 1
  const [pedido] = await db.insert(esquema.pedidos).values({ negocioId: ladera.id, clienteId: cliente.id, numero, items: [{ productoId: 'recorrido', nombre: 'Tueste de recorrido', cantidad: 2, precio: 38000 }], total: 76000, ciudad: 'Pereira', direccion: 'Carrera 8 # 21-40' }).returning()
  await nav.ir(`${base}/panel/pedidos`)
  afirmar('La lista trae el pedido', await nav.hastaQue(`(() => { const f = [...document.querySelectorAll('a, button')].find((e) => e.offsetParent !== null && e.innerText.includes('#${numero}')); if (!f) return false; f.click(); return true })()`, 60_000))
  afirmar('La fila abre el detalle del pedido', await nav.hastaQue(`location.pathname === '/panel/pedidos/${pedido.id}'`, 60_000), await nav.ruta())
  afirmar('El detalle trae lo pedido, la entrega, el Cliente y la conversación', (await nav.ve('Lo que pidió', 60_000)) && (await nav.ve('Tueste de recorrido')) && (await nav.ve('Carrera 8 # 21-40')) && (await nav.ve('Camila Recorrido')) && (await nav.ve(escrito)), (await nav.texto()).slice(-500))
  await nav.captura(join(carpeta, 'pedido-detalle-pc-claro.png'), 1440, 900, false)
  await nav.ir(`${base}/panel/clientes/${cliente.id}`)
  afirmar('El detalle del Cliente trae sus pedidos', await nav.ve('Sus pedidos', 60_000), (await nav.texto()).slice(-400))
  await nav.ir(`${base}/panel/pedidos/00000000-0000-4000-8000-000000000000`)
  afirmar('Un pedido que no es del Negocio lo dice', await nav.ve('Este pedido no está en tu negocio.', 60_000), (await nav.texto()).slice(-300))

  console.log('Adjuntar con el Negocio abierto')
  await nav.ir(`${base}/panel`)
  afirmar('Abierto: la lista sube', await adjuntarLaLista(nav), (await nav.texto()).slice(-300))
  await escribirEnElHilo(nav, 'Carga a mi catálogo lo que trae este archivo')
  await espera(200)
  await enviarEnElHilo(nav)
  const hayCorregir = `[...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && b.innerText.trim() === 'Corregir')`
  // El modelo a veces lee sin `cargar` y pregunta primero: el Dueño le contesta y la tarjeta tiene que llegar igual.
  const terminoElTurno = await hasta(async () => (await db.select({ rol: esquema.mensajesDueno.rol }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, dueno.id)).orderBy(desc(esquema.mensajesDueno.creado)).limit(1))[0]?.rol === 'agente')
  afirmar('Abierto: el agente termina su turno con el archivo', terminoElTurno)
  await espera(2000)
  if (!(await nav.evalua<boolean>(hayCorregir))) {
    console.log('Abierto: el agente pidió confirmar antes de cargar')
    await escribirEnElHilo(nav, 'Sí, cárgalo a mi catálogo')
    await espera(200)
    await enviarEnElHilo(nav)
  }
  const llego = await nav.hastaQue(hayCorregir, 180_000)
  const hiloAbierto = await nav.evalua<string>(`document.querySelector('[data-pano=hilo]').innerText`)
  const pasos = await db.select({ mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(and(eq(esquema.mensajesDueno.duenoId, dueno.id), gte(esquema.mensajesDueno.creado, inicio)))
  afirmar('Abierto: lo leído llega a una tarjeta con Corregir', llego, { hilo: hiloAbierto.slice(-700), herramientas: JSON.stringify(pasos.at(-1)?.mensaje).slice(0, 900) })
  afirmar('Abierto: la tarjeta no pide descartarla para corregir', llego && hiloAbierto.includes('dile a tu agente cómo es') && !hiloAbierto.includes('descártala'), hiloAbierto.slice(-400))
  await nav.captura(join(carpeta, 'abierto-tarjeta-leida-pc-claro.png'), 1440, 900, false)
  if (llego) await nav.clic('Descartar')
  await espera(1500)

  console.log('Adjuntar y Corregir en el armado, con otra sesión')
  await entrar(otroNav, emailDelArmado, token)
  afirmar('Otra cuenta entra al armado', await otroNav.hastaQue(`document.querySelectorAll('[data-adjuntar]').length > 0`, 90_000), await otroNav.ruta())
  await espera(3000)
  const [delOtro] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.usuarioId, delArmado.id))
  afirmar('La primera entrada le armó su propio Negocio', Boolean(delOtro) && delOtro.negocioId !== ladera.id)
  afirmar('Armado: la lista sube', await adjuntarLaLista(otroNav), (await otroNav.texto()).slice(-300))
  await escribirEnElHilo(otroNav, 'Esta es mi lista de precios')
  await espera(200)
  await enviarEnElHilo(otroNav)
  afirmar('Armado: lo leído llega a su tarjeta', await otroNav.ve('Tueste Zarzamora', 180_000) && await otroNav.ve('Molinillo Yarumo', 5000), (await otroNav.texto()).slice(-500))
  await espera(1500)
  await otroNav.clic('Corregir', 60_000)
  afirmar('Corregir empieza el mensaje en el redactor', await otroNav.hastaQue(`[...document.querySelectorAll('textarea')].some((t) => t.offsetParent !== null && t.value.startsWith('Corrige lo que leíste'))`, 10_000))
  await otroNav.captura(join(carpeta, 'armado-corregir-pc-claro.png'), 1440, 900, false)
  await escribirEnElHilo(otroNav, 'Corrige lo que leíste: quita el Filtro Guacamaya, ese ya no lo vendo')
  await espera(200)
  await enviarEnElHilo(otroNav)
  const quedo = await hasta(async () => {
    const t = await tarjetaLeida(delOtro.negocioId)
    return t !== null && !t.includes('Guacamaya') && t.includes('Zarzamora')
  })
  afirmar('Corregir saca de la tarjeta lo que el Dueño dijo y deja lo demás', quedo, await tarjetaLeida(delOtro.negocioId))
  afirmar('Corregir deja su rastro en el Hilo', await otroNav.ve('Corrigió lo que leyó', 60_000), (await otroNav.texto()).slice(-400))
  await otroNav.captura(join(carpeta, 'armado-corregido-pc-claro.png'), 1440, 900, false)

  console.log('La puerta en las rutas de la toma')
  const { id: sesionDelOtro } = (await clerk.pedir('/sessions', 'POST', { user_id: delArmado.id })) as { id: string }
  const { jwt } = (await clerk.pedir(`/sessions/${sesionDelOtro}/tokens`, 'POST', {})) as { jwt: string }
  const tomar = `${base}/api/conversaciones/${cliente.id}/tomar`
  afirmar('Sin sesión, tomar responde 401', (await fetch(tomar, { method: 'POST' })).status === 401)
  const ajeno = await fetch(tomar, { method: 'POST', headers: { authorization: `Bearer ${jwt}` } })
  afirmar('Con la sesión de otro Negocio, el Cliente no existe', ajeno.status === 200 && ((await ajeno.json()) as { tipo: string }).tipo === 'no_existe', ajeno.status)
  afirmar('La sesión ajena no tomó nada', (await filaDelCliente()).tomadaPor === null)
} catch (e) {
  afirmar('recorrer-panel terminó sin lanzar', false, e)
} finally {
  nav.cerrar()
  otroNav.cerrar()
  for (const [id, correo] of [[usuario.id, email], [delArmado.id, emailDelArmado]]) {
    const [d] = id === usuario.id ? [] : await db.select({ negocio: esquema.duenos.negocioId }).from(esquema.duenos).where(eq(esquema.duenos.usuarioId, id))
    if (d) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, d.negocio))
    await clerk.pedir(`/users/${id}`, 'DELETE').catch((e) => afirmar('recorrer-panel borró su usuario', false, e))
    const sigue = await clerk.pedir(`/users/${id}`).then(() => true, () => false)
    afirmar(`Usuario de prueba creado y borrado: ${correo}`, !sigue)
  }
  await db.delete(esquema.clientes).where(and(eq(esquema.clientes.negocioId, ladera.id), eq(esquema.clientes.telefono, telefono)))
  await db.delete(esquema.casos).where(and(eq(esquema.casos.negocioId, ladera.id), gte(esquema.casos.creado, inicio)))
  await db.delete(esquema.mensajesDueno).where(and(eq(esquema.mensajesDueno.negocioId, ladera.id), gte(esquema.mensajesDueno.creado, inicio)))
  await db.delete(esquema.turnos).where(and(eq(esquema.turnos.negocioId, ladera.id), gte(esquema.turnos.creado, inicio)))
  await db.delete(esquema.capacidadesFaltantes).where(and(eq(esquema.capacidadesFaltantes.negocioId, ladera.id), gte(esquema.capacidadesFaltantes.creado, inicio)))
  await db.delete(esquema.elementos).where(and(eq(esquema.elementos.negocioId, ladera.id), gt(esquema.elementos.version, ladera.version)))
  await db.update(esquema.negocios).set({ version: ladera.version }).where(eq(esquema.negocios.id, ladera.id))
  await db.delete(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, ladera.id), gte(esquema.propuestas.creado, inicio)))
  await db.delete(esquema.cambios).where(and(eq(esquema.cambios.negocioId, ladera.id), gte(esquema.cambios.creado, inicio)))
  await db.delete(esquema.duenos).where(eq(esquema.duenos.id, dueno.id))
  afirmar('LADERA queda con sus turnos de antes', (await db.$count(esquema.turnos, eq(esquema.turnos.negocioId, ladera.id))) === turnosAntes)
}
terminar()
