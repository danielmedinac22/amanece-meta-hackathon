/**
 * Captura una escena de la vitrina en Chrome sin ventana, en el modo y el ancho que se pidan, y sale con 1 si la
 * página se desborda a lo ancho o falla un paso. Necesita `pnpm dev` corriendo. `--menos-movimiento` pide
 * `prefers-reduced-motion`. Pasos, en el orden en que se escriben: `--clic=texto` toca un botón por su texto o su aria-label, `--escribe=texto` escribe en la primera caja de texto, `--espera=ms`, `--ve=texto` y `--no-ve=texto` afirman lo
 * visible, `--evalua=js` imprime una expresión y `--cierto=js` falla si no da `true`.
 *
 *   pnpm tsx scripts/mirar-vitrina.mts panel-un-caso /tmp/caso.png 390 844 --oscuro --clic="Tu negocio"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.VITRINA_URL ?? 'http://localhost:3000'
const banderas = process.argv.slice(2).filter((a) => a.startsWith('--'))
const [escena, salida, ancho = '1440', alto = '900'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!escena || !salida) throw new Error('Uso: mirar-vitrina.mts <escena> <salida.png> [ancho] [alto] [--oscuro]')
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CHROME_RESPONDE_MS = 30_000
const LLEGA_MS = 10_000

/** Lo que se afirma llega tras una animación o tras `router.refresh`, que en `next dev` tarda lo que tarde el servidor: se espera la condición, no un tiempo fijo. */
async function hastaQue<T>(valor: () => Promise<T>): Promise<T> {
  const limite = Date.now() + LLEGA_MS
  let ultimo = await valor()
  while (!ultimo && Date.now() < limite) {
    await espera(50)
    ultimo = await valor()
  }
  return ultimo
}

// Puerto 0: lo elige el sistema. Con un número al azar, dos Chrome a la vez podían sacar el mismo: el segundo se queda en `::1`, y este script terminaba manejando la pestaña del otro por `127.0.0.1`.
const perfil = mkdtempSync(join(tmpdir(), 'vitrina-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run'], { stdio: 'ignore' })

function puertoDeEsteChrome() {
  try {
    return readFileSync(join(perfil, 'DevToolsActivePort'), 'utf8').split('\n')[0] || null
  } catch {
    return null
  }
}

try {
  let pestana: { type: string; webSocketDebuggerUrl: string } | undefined
  for (let i = 0; i < 40 && !pestana; i++) {
    await espera(250)
    const puerto = puertoDeEsteChrome()
    if (!puerto) continue
    const lista = (await fetch(`http://127.0.0.1:${puerto}/json`).then((r) => r.json(), () => [])) as { type: string; webSocketDebuggerUrl: string }[]
    pestana = lista.find((t) => t.type === 'page')
  }
  if (!pestana) throw new Error('Chrome no abrió')
  const ws = new WebSocket(pestana.webSocketDebuggerUrl)
  await new Promise((abierta, fallo) => {
    ws.onopen = abierta
    ws.onerror = fallo
  })
  let id = 0
  const pendientes = new Map<number, (resultado: Record<string, never>) => void>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data))
    pendientes.get(m.id)?.(m.result ?? m.error)
  }
  // Sin esto, si Chrome se va la promesa nunca termina, y el Chrome hijo mantiene vivo el proceso para siempre.
  const seCerro = new Promise<never>((_, fallo) => {
    ws.onclose = () => fallo(new Error('Chrome cerró la conexión'))
  })
  seCerro.catch(() => {})
  const cdp = (method: string, params: object = {}) =>
    Promise.race([
      seCerro,
      new Promise<Record<string, never>>((r, fallo) => {
        const n = ++id
        pendientes.set(n, r)
        setTimeout(() => fallo(new Error(`Chrome no respondió a ${method}`)), CHROME_RESPONDE_MS).unref()
        ws.send(JSON.stringify({ id: n, method, params }))
      }),
    ])

  await cdp('Emulation.setDeviceMetricsOverride', { width: +ancho, height: +alto, deviceScaleFactor: 1, mobile: false })
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: banderas.includes('--oscuro') ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: banderas.includes('--menos-movimiento') ? 'reduce' : 'no-preference' }] })
  // Sin ventana la pestaña nunca tiene foco y `:focus` no aplica: lo que se muestra al enfocar no se podría afirmar.
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp('Page.enable')
  await cdp('Page.navigate', { url: `${BASE}/vitrina/${escena}` })
  // Next bloquea su JavaScript de desarrollo fuera de `localhost`: la página se pinta pero ningún botón responde.
  const evaluar = async <T,>(expression: string) => ((await cdp('Runtime.evaluate', { expression, returnByValue: true })) as unknown as { result?: { value: T } }).result?.value as T
  let viva = false
  for (let i = 0; i < 80 && !viva; i++) {
    await espera(250)
    viva = await evaluar<boolean>(`Object.keys(document.documentElement).some((k) => k.startsWith('__react'))`)
  }
  if (!viva) throw new Error(`React no arrancó en ${BASE}. Abre la vitrina por localhost.`)
  await espera(400)

  // Los pasos corren en el orden en que se escriben, así que una prueba puede tocar y afirmar lo que ve el Dueño.
  for (const bandera of banderas) {
    const [, paso, valor] = bandera.match(/^--(\w[\w-]*)=([\s\S]*)$/) ?? []
    if (paso === 'clic') {
      // Un clic de verdad: Base UI abre sus menús con los eventos del puntero, y `element.click()` no los dispara. Un clic fuera de la pantalla se pierde, por eso lleva a la vista lo que va a tocar.
      // `__reactProps`: React ya hidrató ese botón. `viva` solo dice que empezó por la raíz, y a un botón sin hidratar el clic se le pierde.
      const punto = await hastaQue(() => evaluar<{ x: number; y: number } | null>(`(() => { const e = [...document.querySelectorAll('button,summary,a,[role=tab]')].find((x) => x.checkVisibility() && Object.keys(x).some((k) => k.startsWith('__reactProps')) && (x.textContent.trim().startsWith(${JSON.stringify(valor)}) || x.getAttribute('aria-label')?.startsWith(${JSON.stringify(valor)}))); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`))
      if (!punto) throw new Error(`No encontré: ${valor}`)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, ...punto, button: 'left', clickCount: 1 })
      await espera(600)
    } else if (paso === 'escribe') {
      await evaluar(`document.querySelector('textarea').focus()`)
      await cdp('Input.insertText', { text: valor })
      await espera(100)
    } else if (paso === 'espera') {
      await espera(+valor)
    } else if (paso === 've' || paso === 'no-ve') {
      const lo = await hastaQue(() => evaluar<boolean>(`document.body.innerText.includes(${JSON.stringify(valor)}) === ${paso === 've'}`))
      if (!lo) throw new Error(`${paso === 've' ? 'No se ve' : 'Se ve'}: ${valor}`)
    } else if (paso === 'evalua') {
      console.log(JSON.stringify(await evaluar<unknown>(valor)))
    } else if (paso === 'cierto') {
      if ((await hastaQue(() => evaluar<unknown>(`(${valor}) === true`))) !== true) throw new Error(`No es cierto: ${valor}`)
    }
  }
  // Un paño recorta lo que se le sale, así que el documento no se entera.
  const desbordes = await evaluar<string[]>(`[document.documentElement, ...document.querySelectorAll('body *')].filter((e) => e === document.documentElement ? e.scrollWidth > innerWidth : e.scrollWidth - e.clientWidth > 1 && ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX) && getComputedStyle(e).textOverflow !== 'ellipsis' && e.clientWidth > 40 && !e.hasAttribute('data-carrusel')).map((e) => e.tagName + ' ' + String(e.className).slice(0, 60) + ': ' + (e.scrollWidth - (e === document.documentElement ? innerWidth : e.clientWidth)) + ' px')`)
  if (desbordes.length) {
    console.error(`Se desborda a lo ancho:\n${desbordes.join('\n')}`)
    process.exitCode = 1
  }
  // El botón de Next en desarrollo tapa al Dueño en el sidebar, y producción no lo tiene.
  await evaluar(`document.querySelector('nextjs-portal')?.remove()`)
  const { data } = (await cdp('Page.captureScreenshot', { format: 'png' })) as unknown as { data: string }
  writeFileSync(salida, Buffer.from(data, 'base64'))
  console.log('Guardada', salida)
  ws.close()
} finally {
  chrome.kill()
}
