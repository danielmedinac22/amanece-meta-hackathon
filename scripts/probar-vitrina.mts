/**
 * La vitrina existe solo en `next dev` y no deja rastro en un build. Corre los tres servidores de verdad: dev sin base
 * de datos ni sesión (la vitrina pinta sin leer nada y /panel sigue pidiendo entrar) y build + start (404 en /vitrina).
 * Primero dev porque `next dev` toma un candado por carpeta: con otro `pnpm dev` abierto falla enseguida, no tras el
 * build. Ciérralo antes de correr esto. Tarda unos minutos por el build.
 *
 *   pnpm tsx scripts/probar-vitrina.mts
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tocarTarjeta } from '../src/app/panel/tocar-tarjeta'
import { decisionesEnEspera, decisionQueEspera } from '../src/negocio/partes-del-hilo'
import { afirmar, terminar } from './afirmar.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const NEXT = join(RAIZ, 'node_modules/next/dist/bin/next')
const ESCENAS_ESPERADAS = ['panel-vacio', 'panel-armandose', 'panel-funcionando', 'panel-un-caso', 'panel-con-cambios', 'panel-recien-abierto', 'hoy-sin-ventas', 'hoy-agenda', 'pedidos-lista', 'pedidos-vacios', 'pedidos-muchos', 'clientes-tabla', 'clientes-vacios', 'clientes-muchos', 'operacion-sidebar-plegado', 'operacion-hilo-oculto', 'operacion-conversacion-flotante', 'operacion-llega-decision', 'telefono-tu-negocio', 'telefono-cajon', 'hilo-constancias', 'hilo-varias-decisiones', 'hilo-trabajando', 'componentes']
const RUTAS_DEL_PANEL = ['/panel', '/panel/casos', '/panel/conversaciones', '/panel/pedidos', '/panel/clientes', '/panel/tablero', '/panel/secciones/una-seccion']

const ancho = (selector: string) => `document.querySelector('${selector}').getBoundingClientRect().width`
const HILO = '[data-pano=hilo]'
const ESPACIO_DEL_HILO = '[data-slot=sidebar-inset] > [aria-hidden]'
const PESTANAS = 'nav[aria-label="Dónde estás"]'
const PUNTO = '[aria-label="Algo espera tu decisión"]'
const SIDEBAR_ABIERTO = `--cierto=${ancho('[data-slot=sidebar-gap]')} === 216`

/** Recorridos con clics de verdad: lo que el Dueño nota al tocar la cáscara. Título, escena, ancho y pasos. */
const RECORRIDOS: [string, string, string, ...string[]][] = [
  ['PC: el sidebar mide 216 y el Hilo 348', 'panel-funcionando', '1440', SIDEBAR_ABIERTO, `--cierto=${ancho(HILO)} === 348`],
  ['PC: plegar el sidebar lo deja en íconos y lo abre otra vez', 'panel-funcionando', '1440', '--clic=Menú', `--cierto=${ancho('[data-slot=sidebar-gap]')} === 48`, '--clic=Menú', SIDEBAR_ABIERTO],
  ['PC: Ocultar deja la caja, el caret abre y pliega, y el pin la fija', 'panel-funcionando', '1440', '--ve=Hola, soy tu agente', '--clic=Ocultar', '--no-ve=Hola, soy tu agente', `--cierto=${ancho(ESPACIO_DEL_HILO)} === 0`, `--cierto=(() => { const c = document.querySelector('${HILO}').getBoundingClientRect(); const m = document.querySelector('[data-slot=sidebar-inset]').getBoundingClientRect(); return Math.abs(c.x + c.width / 2 - (m.x + m.width / 2)) < 1 && c.bottom < innerHeight })()`, '--clic=Ver la conversación', '--ve=Hola, soy tu agente', '--clic=Plegar la conversación', '--no-ve=Hola, soy tu agente', '--clic=Fijar la conversación', '--ve=Hola, soy tu agente', `--cierto=${ancho(HILO)} === 348`, `--cierto=${ancho(ESPACIO_DEL_HILO)} === 348`],
  ['PC: una decisión nueva abre sola la conversación, y plegarla se respeta', 'operacion-llega-decision', '1440', '--no-ve=Una clienta preguntó', '--espera=3000', '--ve=Una clienta preguntó', '--clic=Plegar la conversación', '--espera=500', '--no-ve=Una clienta preguntó'],
  ['PC: Ocultar con una decisión esperando deja la conversación abierta', 'panel-un-caso', '1440', '--clic=Ocultar', '--ve=Una clienta preguntó'],
  ['Sidebar: Casos muestra el número de Casos abiertos', 'panel-un-caso', '1440', `--cierto=document.querySelectorAll('[data-slot=sidebar-menu-badge]').length === 1 && document.querySelector('[data-slot=sidebar-menu-badge]').textContent.trim() === '1'`],
  ['Sidebar: sin Casos abiertos no hay número', 'panel-funcionando', '1440', `--cierto=document.querySelectorAll('[data-slot=sidebar-menu-badge]').length === 0`],
  ['Sidebar: cada Sección pinta lo suyo y dice si falta', 'panel-un-caso', '1440', '--clic=Pedidos con novedad', '--ve=Marcela Ríos', `--no-ve=Necesita tu ojo`, '--clic=Pedidos', '--ve=Por confirmar', `--cierto=document.querySelector('h1').textContent === 'Pedidos'`, '--clic=Conversaciones', '--ve=Esta Sección todavía falta', '--clic=Casos', '--ve=Casos para ti', '--clic=Tablero', '--ve=14 pedidos', '--no-ve=Casos para ti', '--clic=Inicio', '--ve=Necesita tu ojo', '--no-ve=14 pedidos'],
  ['PC: Publicar vive en el encabezado del lienzo y abre su lista', 'panel-con-cambios', '1440', '--clic=Publicar', '--ve=Lo notan tus Clientes', `--ve=Vista previa`],
  ['Teléfono: Publicar va arriba y abre su lista', 'panel-con-cambios', '390', '--clic=Publicar', '--ve=Lo notan tus Clientes', `--cierto=document.querySelector('header').textContent.includes('Publicar')`],
  ['Inicio: la frase lleva sus cifras en negrita', 'panel-funcionando', '1440', '--ve=Esta semana vendiste', `--cierto=[...document.querySelectorAll('p b')].map((b) => b.textContent).join('|') === '$1.284.000|23 pedidos|13 de 14'`],
  ['Inicio: Decidir lleva a Casos sin navegar fuera', 'panel-un-caso', '1440', '--ve=Necesita tu ojo', '--clic=Decidir', '--ve=Casos para ti', '--no-ve=Necesita tu ojo'],
  ['Inicio en teléfono: Ver el pedido se queda en Tu negocio', 'panel-un-caso', '390', '--clic=Tu negocio', '--ve=Necesita tu ojo', '--clic=Ver el pedido', '--ve=Por confirmar'],
  ['Inicio: recién abierto muestra el link y ninguna cifra', 'panel-recien-abierto', '1440', '--ve=Todavía no te ha escrito nadie.', '--no-ve=Necesita tu ojo', '--no-ve=Esta semana', `--evalua=(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.copiado = t; return Promise.resolve() } } }); return 'listo' })()`, '--clic=Copiar', '--ve=Copiado', `--cierto=window.copiado.startsWith('https://wa.me/')`],
  ['Inicio: con cero ventas no dice $0 y el ojo vacío dice qué sigue', 'hoy-sin-ventas', '1440', '--ve=Esta semana todavía no tienes ventas.', '--ve=la única conversación', '--ve=Nada por ahora', '--no-ve=$0'],
  ['Inicio: una agenda no habla de ventas', 'hoy-agenda', '1440', '--ve=te escribieron', '--ve=3 de 4', '--no-ve=vendiste', '--no-ve=pedidos,'],
  ['Teléfono: pestañas, punto y cajón', 'panel-un-caso', '390', '--ve=Una clienta preguntó', '--no-ve=Necesita tu ojo', `--cierto=!document.querySelector('${PUNTO}')`, '--clic=Tu negocio', '--ve=Necesita tu ojo', '--no-ve=Una clienta preguntó', `--cierto=!!document.querySelector('${PUNTO}')`, '--clic=Menú', '--ve=Conversaciones', '--clic=Casos', '--no-ve=Conversaciones', '--ve=Casos para ti', '--clic=Tu agente', '--ve=Una clienta preguntó', `--cierto=!document.querySelector('${PUNTO}')`],
  ['Teléfono: tocar una Sección lleva a Tu negocio', 'panel-funcionando', '390', '--clic=Menú', '--clic=Pedidos', '--ve=Por confirmar'],
  ['El corte: en 1023 son pestañas', 'panel-funcionando', '1023', `--cierto=document.querySelector('${PESTANAS}').checkVisibility()`, '--no-ve=Necesita tu ojo'],
  ['El corte: en 1024 son tres paños', 'panel-funcionando', '1024', `--cierto=!document.querySelector('${PESTANAS}').checkVisibility()`, '--ve=Necesita tu ojo', `--cierto=${ancho(HILO)} === 348`],
  ['Movimiento: los paños usan la curva de DESIGN.md', 'panel-funcionando', '1440', `--cierto=(() => { const c = getComputedStyle(document.querySelector('${ESPACIO_DEL_HILO}')); return c.transitionDuration === '0.28s' && c.transitionTimingFunction === 'cubic-bezier(0.25, 1, 0.5, 1)' })()`, `--cierto=getComputedStyle(document.querySelector('[data-slot=sidebar-gap]')).transitionTimingFunction === 'cubic-bezier(0.25, 1, 0.5, 1)'`, '--clic=Ocultar', `--cierto=getComputedStyle(document.querySelector('${HILO}')).animationName === 'sube'`],
  ['Movimiento: con prefers-reduced-motion el estado cambia y nada se mueve', 'panel-funcionando', '1440', '--menos-movimiento', `--cierto=getComputedStyle(document.querySelector('${ESPACIO_DEL_HILO}')).transitionProperty === 'none'`, `--cierto=getComputedStyle(document.querySelector('[data-slot=sidebar-gap]')).transitionProperty === 'none'`, '--clic=Ocultar', '--no-ve=Hola, soy tu agente', `--cierto=getComputedStyle(document.querySelector('${HILO}')).animationName === 'none'`],
]

const LIENZO = `document.querySelector('[data-pano=lienzo] [class*=overflow-y-auto]')`
const ENCABEZADOS = `[...document.querySelectorAll('[data-pano=lienzo] h3, [data-pano=lienzo] summary')]`
const TONO_DE = (i: number, token: string) => `(() => { const b = ${ENCABEZADOS}[${i}].querySelector('[data-slot=badge]'); const p = document.createElement('i'); p.style.color = 'var(${token})'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return getComputedStyle(b).color === c })()`
const PEGA_ARRIBA = `(() => { const l = ${LIENZO}; l.scrollTop = 700; const h = document.querySelector('[data-pano=lienzo] h3'); return l.scrollTop === 700 && Math.abs(h.getBoundingClientRect().top - l.getBoundingClientRect().top) < 1 })()`
const SIN_DESPLAZAR = `(() => { const c = document.querySelector('[data-slot=table-container]'); return c.scrollWidth <= c.clientWidth })()`
const NOMBRE_RECORTADO = `(() => { const t = document.querySelector('[data-slot=table-cell]'); return t.scrollWidth > t.clientWidth && getComputedStyle(t).textOverflow === 'ellipsis' })()`

const RECORRIDOS_DE_LISTAS: typeof RECORRIDOS = [
  ['Pedidos: los grupos van en el orden del diseño, con su cuenta y cancelado al final', 'pedidos-lista', '1440', `--cierto=${ENCABEZADOS}.map((h) => h.textContent.trim().replace(/\\s+/g, ' ')).join('|') === 'Con novedad 1|Por confirmar 1|Confirmado 2|Enviado 3|Entregado 5|Cancelado 1'`],
  ['Pedidos: el resumen lleva las cifras de arriba', 'pedidos-lista', '1440', '--ve=$1.284.000', '--ve=14 conversaciones hoy', '--ve=13 resueltas sin ti'],
  ['Pedidos: las etiquetas llevan su tono', 'pedidos-lista', '1440', `--cierto=${TONO_DE(0, '--ojo')}`, `--cierto=${TONO_DE(1, '--foreground')}`, `--cierto=${TONO_DE(2, '--bien')}`, `--cierto=${TONO_DE(3, '--muted-foreground')}`, `--cierto=${TONO_DE(4, '--muted-foreground')}`, `--cierto=${TONO_DE(5, '--muted-foreground')}`],
  ['Pedidos en oscuro: las etiquetas llevan su tono', 'pedidos-lista', '1440', '--oscuro', `--cierto=${TONO_DE(0, '--ojo')}`, `--cierto=${TONO_DE(2, '--bien')}`],
  ['Pedidos: lo cancelado se ve plegado y se abre', 'pedidos-lista', '1440', '--no-ve=Felipe Mora', '--clic=Cancelado', '--ve=Felipe Mora'],
  ['Pedidos en PC: número, ciudad y tiempo a la vista', 'pedidos-lista', '1440', '--ve=#41', '--ve=Pereira', '--ve=hace 12 min', `--cierto=getComputedStyle([...document.querySelectorAll('[data-pano=lienzo] li span')].find((s) => s.textContent === '$76.000')).fontVariantNumeric === 'tabular-nums'`],
  ['Pedidos en teléfono: se esconden número, ciudad y tiempo', 'pedidos-lista', '390', '--ve=Daniela Quintero', '--ve=$76.000', '--no-ve=#41', '--no-ve=Pereira', '--no-ve=hace 12 min'],
  ['Pedidos en PC angosto: el lienzo manda, no la ventana', 'pedidos-lista', '1024', '--ve=$76.000', '--no-ve=#41', '--no-ve=Pereira'],
  ['Pedidos en PC: el encabezado pega arriba del lienzo', 'pedidos-muchos', '1440', `--cierto=${PEGA_ARRIBA}`],
  ['Pedidos en teléfono: el encabezado pega arriba del lienzo', 'pedidos-muchos', '390', `--cierto=${PEGA_ARRIBA}`],
  ['Pedidos: con más filas que el límite dice cuántas ves', 'pedidos-muchos', '320', '--ve=Ves los 50 más recientes de 312.', '--ve=Ves los 50 más recientes de 12.480.'],
  ['Pedidos: filas largas caben en PC angosto', 'pedidos-muchos', '1024'],
  ['Pedidos: sin pedidos dice qué sigue y ninguna cifra', 'pedidos-vacios', '1440', '--ve=Todavía no tienes pedidos', '--no-ve=esta semana'],
  ['Clientes en PC: todas las columnas', 'clientes-tabla', '1440', '--ve=Pereira', '--ve=hace 12 min', '--ve=$146.000', `--cierto=${SIN_DESPLAZAR}`],
  ['Clientes en teléfono: nombre y cifras sin desplazar, sin ciudad ni último', 'clientes-tabla', '390', '--ve=Daniela Quintero', '--ve=$146.000', '--no-ve=Pereira', '--no-ve=hace 12 min', `--cierto=${SIN_DESPLAZAR}`],
  ['Clientes: las cifras de la tabla no bailan', 'clientes-tabla', '1440', `--cierto=[...document.querySelectorAll('td.text-right')].filter((c) => /^[$\\d]/.test(c.textContent)).every((c) => getComputedStyle(c).fontVariantNumeric === 'tabular-nums')`],
  ['Clientes: un nombre largo se recorta en 320 sin desplazar', 'clientes-muchos', '320', `--cierto=${SIN_DESPLAZAR}`, `--cierto=${NOMBRE_RECORTADO}`, '--ve=Ves los 100 más recientes de 1.204.'],
  ['Clientes: un nombre largo se recorta en PC angosto', 'clientes-muchos', '1024', `--cierto=${SIN_DESPLAZAR}`, `--cierto=${NOMBRE_RECORTADO}`],
  ['Clientes: un nombre largo no empuja la tabla en PC', 'clientes-muchos', '1440', `--cierto=${SIN_DESPLAZAR}`, `--cierto=${NOMBRE_RECORTADO}`],
  ['Clientes: sin Clientes dice qué sigue', 'clientes-vacios', '1440', '--ve=Todavía no te ha escrito nadie'],
]

const CARD_CASO = 'document.getElementById("tarjeta-p-caso")'
const RECORRIDOS_DEL_HILO: typeof RECORRIDOS = [
  ['Hilo: el Dueño va en globo secondary y el agente sin globo', 'panel-un-caso', '1440', `--cierto=(() => { const dueno = [...document.querySelectorAll('[data-conversacion] div')].filter((d) => d.textContent === 'Cuando un pedido sea para fuera de mi ciudad, no prometas fecha').at(-1); const agente = [...document.querySelectorAll('[data-conversacion] p')].find((p) => p.textContent.startsWith('Una clienta')); const probe = document.createElement('i'); probe.style.background = 'var(--secondary)'; document.body.append(probe); const secundario = getComputedStyle(probe).backgroundColor; probe.remove(); return getComputedStyle(dueno).backgroundColor === secundario && getComputedStyle(agente).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(agente).fontSize === '14.5px' })()`],
  ['Hilo: hasta dos sugerencias y sin adjuntar', 'panel-un-caso', '1440', `--cierto=[...document.querySelectorAll('[data-pano=hilo] button')].filter((b) => /^(Quiero ver|Muéstrame|Cuando un pedido)/.test(b.textContent)).length === 2`, `--cierto=!document.querySelector('[aria-label="Adjuntar"]')`],
  ['Redactor: vacío no se enciende; con texto se enciende con --sol y su tinta', 'panel-funcionando', '1440', `--cierto=document.querySelector('form button[aria-label="Enviar"]').disabled && getComputedStyle(document.querySelector('form button[aria-label="Enviar"]')).backgroundImage === 'none'`, `--evalua=(() => { const t = document.querySelector('form textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Hola'); t.dispatchEvent(new Event('input', { bubbles: true })); return 'escrito' })()`, '--espera=500', `--cierto=(() => { const b = getComputedStyle(document.querySelector('form button[aria-label="Enviar"]')); const probe = document.createElement('i'); probe.style.color = 'var(--sol-foreground)'; document.body.append(probe); const tinta = getComputedStyle(probe).color; probe.remove(); return b.backgroundImage.includes('linear-gradient') && b.color === tinta })()`],
  ['Rastro: un check o tres puntos', 'hilo-trabajando', '1440', '--ve=Revisó tu negocio', '--ve=Preparó lo que pediste', `--cierto=document.querySelectorAll('[data-conversacion] .puntos').length === 1`],
  ['Tarjeta de un Caso: etiqueta, lo que escribió, la respuesta, a quién le llega', 'panel-un-caso', '1440', '--ve=Quiere saber cuánto cuesta un envío · pedido #31', '--ve=Marcela Ríos escribió', '--ve=¿Cuánto cuesta enviar a Cali?', '--ve=Le voy a responder', '--ve=Sale por WhatsApp a Marcela Ríos'],
  ['Enviar confirma en su sitio y pliega en una constancia que se vuelve a abrir', 'panel-un-caso', '1440', `--evalua=(() => { const r = ${CARD_CASO}.getBoundingClientRect(); window.__x = r.x; return 'medido' })()`, '--clic=Enviar', '--espera=500', '--ve=Enviada a Marcela Ríos', '--no-ve=Le voy a responder', `--cierto=${CARD_CASO}.getBoundingClientRect().x === window.__x`, '--no-ve=Sale por WhatsApp', `--cierto=(() => { const b = [...${CARD_CASO}.querySelectorAll('button')]; return b.length === 1 && b[0].getAttribute('aria-label') === 'Ver el detalle' })()`, `--evalua=${CARD_CASO}.querySelector('button').click()`, '--espera=500', '--ve=Le voy a responder', '--ve=Enviada a Marcela Ríos'],
  ['Descartar queda en la tarjeta', 'panel-un-caso', '1440', '--clic=Descartar', '--espera=500', '--ve=Descartada', '--no-ve=Le voy a responder'],
  ['Teléfono: Enviar también confirma en su sitio', 'panel-un-caso', '390', '--clic=Enviar', '--espera=500', '--ve=Enviada a Marcela Ríos'],
  ['Movimiento: con prefers-reduced-motion la tarjeta se pliega sin animar', 'panel-un-caso', '1440', '--menos-movimiento', '--clic=Enviar', '--espera=60', '--no-ve=Le voy a responder', '--ve=Enviada a Marcela Ríos'],
  ['Constancias: cada desenlace', 'hilo-constancias', '1440', '--ve=Enviada a Camila Rojas', '--ve=La bolsa llegó rota · pedido #31', '--ve=Aplicada por Julián', '--ve=Aplicada por Julián, y revertida después', '--ve=Nuevo Indicador', '--ve=Descartada', '--ve=Nueva Sección', '--ve=Venció sin aplicarse. Pídela de nuevo si todavía la quieres.'],
  ['Una tarjeta vencida no deja tocar, tenga estado o no', 'hilo-constancias', '1440', `--cierto=![...document.querySelectorAll('[data-conversacion] button')].some((b) => /^(Enviar|Aplicar|Descartar)/.test(b.textContent))`, `--cierto=document.getElementById('tarjeta-c-sin-estado').textContent.includes('Venció sin aplicarse')`],
  ['Varias decisiones: la más urgente arriba, con 1 de 3', 'hilo-varias-decisiones', '1440', '--ve=1 de 3', '--ve=2 de 3', '--ve=3 de 3', `--cierto=document.querySelector('[data-conversacion] > button').textContent.includes('Quiere saber cuánto cuesta')`, `--cierto=document.getElementById('tarjeta-v-caso').textContent.includes('1 de 3')`, '--clic=Descartar', '--espera=400', '--ve=1 de 2', '--no-ve=3 de 3'],
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
  const espera = { estado: 'espera_al_dueno', accion: 'enviar', aprobadaPor: null, asunto: null } as const
  afirmar('Sin tarjetas no hay decisión', decisionQueEspera([], {}) === null)
  afirmar('La que espera al Dueño cuenta', decisionQueEspera([tarjeta('a', 'enviar')], { a: espera }) === 'a')
  afirmar('Una ya aplicada no cuenta', decisionQueEspera([tarjeta('a', 'aplicar')], { a: { ...espera, estado: 'aplicada' } }) === null)
  afirmar('Recién llegada en el stream cuenta si no venció', decisionQueEspera([tarjeta('a', 'aplicar')], {}) === 'a')
  afirmar('Vencida sin estado no cuenta', decisionQueEspera([tarjeta('a', 'aplicar', '2020-01-01T00:00:00Z')], {}) === null)
  afirmar('Deshacer no es una decisión que espera', decisionQueEspera([tarjeta('a', 'deshacer')], {}) === null)
  afirmar('Entre varias manda la más reciente', decisionQueEspera([tarjeta('a', 'enviar'), tarjeta('b', 'enviar')], { a: espera, b: espera }) === 'b')
  const orden = decisionesEnEspera([tarjeta('r', 'aplicar', '2030-01-01T00:00:00Z'), tarjeta('c2', 'enviar', '2030-01-03T00:00:00Z'), tarjeta('c1', 'enviar', '2030-01-02T00:00:00Z'), tarjeta('d', 'deshacer')], {}).map((t) => t.propuesta)
  afirmar('La más urgente primero: lo que espera un Cliente y después lo que vence antes', orden.join() === 'c1,c2,r', orden)
}

console.log('\nuna tarjeta sigue pasando por sus rutas')
{
  const llamadas: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  const tarjeta = { propuesta: 'p1', huella: 'h1' } as never
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    return new Response(JSON.stringify({ tipo: 'descartada' }))
  }) as typeof fetch
  for (const accion of ['aprobar', 'descartar', 'deshacer'] as const) {
    const r = await tocarTarjeta(tarjeta, accion)
    const ultima = llamadas.at(-1)!
    afirmar(`${accion}: POST a su ruta con la huella`, ultima.url === `/api/propuestas/p1/${accion}` && ultima.init.method === 'POST' && ultima.init.body === JSON.stringify({ huella: 'h1' }) && r.tipo === 'descartada', ultima)
    afirmar(`${accion}: la ruta existe`, existsSync(join(RAIZ, `src/app/api/propuestas/[id]/${accion}/route.ts`)))
  }
  globalThis.fetch = (async () => {
    throw new Error('sin red')
  }) as typeof fetch
  afirmar('Sin red el error vuelve a la tarjeta', (await tocarTarjeta(tarjeta, 'aprobar')).tipo === 'error')
  globalThis.fetch = original
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
  afirmar('dev: panel-funcionando pinta el Negocio de prueba', funcionando.includes('Café Ladera') && funcionando.includes('Necesita tu ojo'))

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

  for (const [titulo, escena, anchoDeLaVentana, ...pasos] of [...RECORRIDOS, ...RECORRIDOS_DE_LISTAS, ...RECORRIDOS_DEL_HILO]) {
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
