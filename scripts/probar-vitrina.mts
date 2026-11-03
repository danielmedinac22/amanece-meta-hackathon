/**
 * La vitrina existe solo en `next dev` y no deja rastro en un build. Corre los tres servidores de verdad: dev sin base
 * de datos ni sesión (la vitrina pinta sin leer nada y /panel sigue pidiendo entrar) y build + start (404 en /vitrina).
 * Primero dev porque `next dev` toma un candado por carpeta: con otro `pnpm dev` abierto falla enseguida, no tras el
 * build. Ciérralo antes de correr esto. Tarda unos minutos por el build.
 *
 *   pnpm tsx scripts/probar-vitrina.mts
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decisionQueEspera } from '../src/negocio/partes-del-hilo'
import { afirmar, terminar } from './afirmar.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const NEXT = join(RAIZ, 'node_modules/next/dist/bin/next')
const ESCENAS_ESPERADAS = ['panel-vacio', 'panel-armandose', 'panel-funcionando', 'panel-un-caso', 'panel-con-cambios', 'operacion-sidebar-plegado', 'operacion-hilo-oculto', 'operacion-conversacion-flotante', 'operacion-llega-decision', 'telefono-tu-negocio', 'telefono-cajon', 'componentes']
const RUTAS_DEL_PANEL = ['/panel', '/panel/casos', '/panel/conversaciones', '/panel/pedidos', '/panel/clientes', '/panel/tablero', '/panel/secciones/una-seccion']

const ancho = (selector: string) => `document.querySelector('${selector}').getBoundingClientRect().width`
const HILO = '[data-pano=hilo]'
const ESPACIO_DEL_HILO = '[data-slot=sidebar-inset] > [aria-hidden]'
const PESTANAS = 'nav[aria-label="Dónde estás"]'
const PUNTO = '[aria-label="Algo espera tu decisión"]'
const SIDEBAR_ABIERTO = `--cierto=${ancho('[data-slot=sidebar-gap]')} === 216`
const WHATSAPP_CON_BORDE = `--cierto=(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Escríbele')); return getComputedStyle(a).borderTopColor !== 'rgba(0, 0, 0, 0)' })()`

/** Recorridos con clics de verdad: lo que el Dueño nota al tocar la cáscara. Título, escena, ancho y pasos. */
const RECORRIDOS: [string, string, string, ...string[]][] = [
  ['PC: el sidebar mide 216 y el Hilo 348', 'panel-funcionando', '1440', SIDEBAR_ABIERTO, `--cierto=${ancho(HILO)} === 348`],
  ['PC: plegar el sidebar lo deja en íconos y lo abre otra vez', 'panel-funcionando', '1440', '--clic=Menú', `--cierto=${ancho('[data-slot=sidebar-gap]')} === 48`, '--clic=Menú', SIDEBAR_ABIERTO],
  ['PC: Ocultar deja la caja, el caret abre y pliega, y el pin la fija', 'panel-funcionando', '1440', '--ve=Hola, soy tu agente', '--clic=Ocultar', '--no-ve=Hola, soy tu agente', `--cierto=${ancho(ESPACIO_DEL_HILO)} === 0`, `--cierto=(() => { const c = document.querySelector('${HILO}').getBoundingClientRect(); const m = document.querySelector('[data-slot=sidebar-inset]').getBoundingClientRect(); return Math.abs(c.x + c.width / 2 - (m.x + m.width / 2)) < 1 && c.bottom < innerHeight })()`, '--clic=Ver la conversación', '--ve=Hola, soy tu agente', '--clic=Plegar la conversación', '--no-ve=Hola, soy tu agente', '--clic=Fijar la conversación', '--ve=Hola, soy tu agente', `--cierto=${ancho(HILO)} === 348`, `--cierto=${ancho(ESPACIO_DEL_HILO)} === 348`],
  ['PC: una decisión nueva abre sola la conversación, y plegarla se respeta', 'operacion-llega-decision', '1440', '--no-ve=Una clienta preguntó', '--espera=3000', '--ve=Una clienta preguntó', '--clic=Plegar la conversación', '--espera=500', '--no-ve=Una clienta preguntó'],
  ['PC: Ocultar con una decisión esperando deja la conversación abierta', 'panel-un-caso', '1440', '--clic=Ocultar', '--ve=Una clienta preguntó'],
  ['Sidebar: Casos muestra el número de Casos abiertos', 'panel-un-caso', '1440', `--cierto=document.querySelectorAll('[data-slot=sidebar-menu-badge]').length === 1 && document.querySelector('[data-slot=sidebar-menu-badge]').textContent.trim() === '1'`],
  ['Sidebar: sin Casos abiertos no hay número', 'panel-funcionando', '1440', `--cierto=document.querySelectorAll('[data-slot=sidebar-menu-badge]').length === 0`],
  ['Sidebar: cada Sección pinta lo suyo y dice si falta', 'panel-un-caso', '1440', '--clic=Pedidos con novedad', '--ve=Marcela Ríos', `--no-ve=14 pedidos`, '--clic=Pedidos', '--ve=Esta Sección todavía falta', `--cierto=document.querySelector('h1').textContent === 'Pedidos'`, '--clic=Casos', '--ve=Casos para ti', '--clic=Tablero', '--ve=14 pedidos', '--no-ve=Casos para ti', '--clic=Inicio', '--ve=Casos para ti', '--ve=14 pedidos'],
  ['PC: Publicar vive en el encabezado del lienzo y abre su lista', 'panel-con-cambios', '1440', '--clic=Publicar', '--ve=Lo notan tus Clientes', `--ve=Vista previa`, WHATSAPP_CON_BORDE],
  ['Teléfono: Publicar va arriba y abre su lista', 'panel-con-cambios', '390', '--clic=Publicar', '--ve=Lo notan tus Clientes', `--cierto=document.querySelector('header').textContent.includes('Publicar')`],
  ['Teléfono: el Escríbele por WhatsApp se ve con borde', 'panel-con-cambios', '390', '--clic=Tu negocio', WHATSAPP_CON_BORDE],
  ['Teléfono: pestañas, punto y cajón', 'panel-un-caso', '390', '--ve=Una clienta preguntó', '--no-ve=14 pedidos', `--cierto=!document.querySelector('${PUNTO}')`, '--clic=Tu negocio', '--ve=14 pedidos', '--no-ve=Una clienta preguntó', `--cierto=!!document.querySelector('${PUNTO}')`, '--clic=Menú', '--ve=Conversaciones', '--clic=Casos', '--no-ve=Conversaciones', '--ve=Casos para ti', '--clic=Tu agente', '--ve=Una clienta preguntó', `--cierto=!document.querySelector('${PUNTO}')`],
  ['Teléfono: tocar una Sección lleva a Tu negocio', 'panel-funcionando', '390', '--clic=Menú', '--clic=Pedidos', '--ve=Esta Sección todavía falta'],
  ['El corte: en 1023 son pestañas', 'panel-funcionando', '1023', `--cierto=document.querySelector('${PESTANAS}').checkVisibility()`, '--no-ve=Pedidos de hoy'],
  ['El corte: en 1024 son tres paños', 'panel-funcionando', '1024', `--cierto=!document.querySelector('${PESTANAS}').checkVisibility()`, '--ve=Pedidos de hoy', `--cierto=${ancho(HILO)} === 348`],
  ['Movimiento: los paños usan la curva de DESIGN.md', 'panel-funcionando', '1440', `--cierto=(() => { const c = getComputedStyle(document.querySelector('${ESPACIO_DEL_HILO}')); return c.transitionDuration === '0.28s' && c.transitionTimingFunction === 'cubic-bezier(0.25, 1, 0.5, 1)' })()`, `--cierto=getComputedStyle(document.querySelector('[data-slot=sidebar-gap]')).transitionTimingFunction === 'cubic-bezier(0.25, 1, 0.5, 1)'`, '--clic=Ocultar', `--cierto=getComputedStyle(document.querySelector('${HILO}')).animationName === 'sube'`],
  ['Movimiento: con prefers-reduced-motion el estado cambia y nada se mueve', 'panel-funcionando', '1440', '--menos-movimiento', `--cierto=getComputedStyle(document.querySelector('${ESPACIO_DEL_HILO}')).transitionProperty === 'none'`, `--cierto=getComputedStyle(document.querySelector('[data-slot=sidebar-gap]')).transitionProperty === 'none'`, '--clic=Ocultar', '--no-ve=Hola, soy tu agente', `--cierto=getComputedStyle(document.querySelector('${HILO}')).animationName === 'none'`],
]

const hijos = new Set<ChildProcess>()

function matarHijos() {
  for (const h of hijos) {
    try {
      if (h.pid) process.kill(-h.pid, 'SIGKILL')
    } catch {
      // ya había salido
    }
  }
  hijos.clear()
}

process.on('exit', matarHijos)
for (const senal of ['SIGINT', 'SIGTERM'] as const) process.on(senal, () => process.exit(1))

function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer()
    servidor.once('error', rechazar)
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as { port: number }
      servidor.close(() => resolver(port))
    })
  })
}

async function servir(modo: 'start' | 'dev', env: Record<string, string> = {}) {
  const puerto = await puertoLibre()
  const salida: string[] = []
  const hijo = spawn(process.execPath, [NEXT, modo, '-p', String(puerto), '-H', 'localhost'], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  hijos.add(hijo)
  for (const flujo of [hijo.stdout, hijo.stderr]) flujo.on('data', (d: Buffer) => salida.push(String(d)))
  const base = `http://localhost:${puerto}`
  const limite = Date.now() + 180_000
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) throw new Error(`next ${modo} salió con ${hijo.exitCode}:\n${salida.join('').slice(-2000)}`)
    if (await fetch(`${base}/entrar`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) }).then((r) => r.status < 500, () => false)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  return {
    base,
    salida: () => salida.join('').slice(-2000),
    parar: () => {
      matarHijos()
    },
  }
}

const ver = (url: string, opciones: RequestInit = {}) => fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'manual', ...opciones })

function nombres(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => [e.name, ...(e.isDirectory() ? nombres(join(carpeta, e.name)) : [])])
}

console.log('\nqué tarjeta espera al Dueño')
{
  const tarjeta = (propuesta: string, accion: string, vence = '2099-01-01T00:00:00Z') => ({ id: propuesta, role: 'assistant', parts: [{ type: 'data-tarjeta', data: { propuesta, accion, vence } }] }) as never
  const espera = { estado: 'espera_al_dueno', accion: 'enviar', aprobadaPor: null } as const
  afirmar('Sin tarjetas no hay decisión', decisionQueEspera([], {}) === null)
  afirmar('La que espera al Dueño cuenta', decisionQueEspera([tarjeta('a', 'enviar')], { a: espera }) === 'a')
  afirmar('Una ya aplicada no cuenta', decisionQueEspera([tarjeta('a', 'aplicar')], { a: { ...espera, estado: 'aplicada' } }) === null)
  afirmar('Recién llegada en el stream cuenta si no venció', decisionQueEspera([tarjeta('a', 'aplicar')], {}) === 'a')
  afirmar('Vencida sin estado no cuenta', decisionQueEspera([tarjeta('a', 'aplicar', '2020-01-01T00:00:00Z')], {}) === null)
  afirmar('Deshacer no es una decisión que espera', decisionQueEspera([tarjeta('a', 'deshacer')], {}) === null)
  afirmar('Entre varias manda la más reciente', decisionQueEspera([tarjeta('a', 'enviar'), tarjeta('b', 'enviar')], { a: espera, b: espera }) === 'b')
}

try {
  console.log('\nnext dev, sin base de datos ni sesión')
  const desarrollo = await servir('dev', { DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', DATABASE_URL_CONSULTAS: '' })
  const indice = await ver(`${desarrollo.base}/vitrina`)
  const html = await indice.text()
  afirmar('dev: /vitrina da 200', indice.status === 200, { estado: indice.status, servidor: desarrollo.salida() })
  const ids = [...html.matchAll(/href="\/vitrina\/([\w-]+)"/g)].map((m) => m[1])
  afirmar('dev: el índice enlaza las escenas esperadas', ESCENAS_ESPERADAS.every((id) => ids.includes(id)), ids)

  for (const id of new Set([...ids, ...ESCENAS_ESPERADAS])) {
    const r = await ver(`${desarrollo.base}/vitrina/${id}`)
    afirmar(`dev: /vitrina/${id} da 200`, r.status === 200, { estado: r.status, servidor: desarrollo.salida() })
  }

  const funcionando = await (await ver(`${desarrollo.base}/vitrina/panel-funcionando`)).text()
  afirmar('dev: panel-funcionando pinta el Negocio de prueba', funcionando.includes('Café Ladera') && funcionando.includes('Pedidos de hoy'))

  const noExiste = await ver(`${desarrollo.base}/vitrina/no-hay-esta`)
  afirmar('dev: una escena que no existe da 404', noExiste.status === 404, noExiste.status)

  for (const ruta of RUTAS_DEL_PANEL) {
    const panel = await ver(`${desarrollo.base}${ruta}`)
    afirmar(`dev: ${ruta} sin sesión redirige a /entrar`, [302, 307].includes(panel.status) && (panel.headers.get('location') ?? '').includes('/entrar'), { estado: panel.status, destino: panel.headers.get('location') })
  }

  // Teléfono y PC valen igual: ninguna escena se desborda a lo ancho a ninguno de los dos anchos.
  const captura = join(mkdtempSync(join(tmpdir(), 'vitrina-')), 'escena.png')
  for (const id of new Set([...ids, ...ESCENAS_ESPERADAS])) {
    for (const [ancho, alto] of [['390', '844'], ['1440', '900']]) {
      const r = spawnSync('tsx', [join(RAIZ, 'scripts/mirar-vitrina.mts'), id, captura, ancho, alto], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, VITRINA_URL: desarrollo.base } })
      afirmar(`dev: ${id} cabe en ${ancho} px`, r.status === 0, r.stderr.slice(-500))
    }
  }

  for (const [titulo, escena, anchoDeLaVentana, ...pasos] of RECORRIDOS) {
    const r = spawnSync('tsx', [join(RAIZ, 'scripts/mirar-vitrina.mts'), escena, captura, anchoDeLaVentana, '900', ...pasos], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, VITRINA_URL: desarrollo.base } })
    afirmar(titulo, r.status === 0, r.stderr.slice(-500))
  }
  desarrollo.parar()

  console.log('\nbuild')
  const build = spawnSync(process.execPath, [NEXT, 'build'], { cwd: RAIZ, encoding: 'utf8', timeout: 540_000 })
  afirmar('next build termina bien', build.status === 0, `${build.stdout}\n${build.stderr}`.slice(-2000))

  const manifiesto = JSON.parse(readFileSync(join(RAIZ, '.next/app-path-routes-manifest.json'), 'utf8')) as Record<string, string>
  const rutas = Object.entries(manifiesto).flat()
  afirmar('El build publica cada Sección del Panel', RUTAS_DEL_PANEL.map((r) => r.replace('una-seccion', '[clave]')).every((r) => rutas.includes(r)), rutas)
  afirmar('El build no publica ninguna ruta de la vitrina', !rutas.some((r) => r.includes('vitrina')), rutas)
  const nombresDelServidor = nombres(join(RAIZ, '.next/server/app'))
  afirmar('Nada bajo .next/server/app se llama vitrina', !nombresDelServidor.some((n) => n.includes('vitrina')), nombresDelServidor.filter((n) => n.includes('vitrina')))

  const conDatosDePrueba = spawnSync('grep', ['-rl', 'Marcela Ríos', join(RAIZ, '.next/server'), join(RAIZ, '.next/static')], { encoding: 'utf8' }).stdout.trim()
  afirmar('Los datos inventados no salen en el build', conDatosDePrueba === '', conDatosDePrueba)

  console.log('\nnext start')
  const produccion = await servir('start')
  for (const ruta of ['/vitrina', '/vitrina/componentes']) {
    const r = await ver(`${produccion.base}${ruta}`)
    afirmar(`start: ${ruta} da 404`, r.status === 404, r.status)
  }
  produccion.parar()

} catch (error) {
  afirmar('La prueba de la vitrina corrió completa', false, error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : error)
} finally {
  matarHijos()
}

terminar()
