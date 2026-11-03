/**
 * Un Chrome sin ventana para recorrer pantallas de verdad, con cookies que duran toda la corrida. `mirar-vitrina` abre
 * un Chrome por escena y aquí la sesión tiene que sobrevivir de una página a otra.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function abrirNavegador() {
  const perfil = mkdtempSync(join(tmpdir(), 'sesion-'))
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run'], { stdio: 'ignore' })
  let puerto = ''
  for (let i = 0; i < 120 && !puerto; i++) {
    await espera(250)
    try {
      puerto = readFileSync(join(perfil, 'DevToolsActivePort'), 'utf8').split('\n')[0]
    } catch {}
  }
  if (!puerto) throw new Error('Chrome no abrió')
  const pestanas = (await (await fetch(`http://127.0.0.1:${puerto}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
  const pestana = pestanas.find((p) => p.type === 'page')
  if (!pestana) throw new Error('Chrome no tiene pestaña')
  const ws = new WebSocket(pestana.webSocketDebuggerUrl)
  await new Promise((listo, mal) => {
    ws.onopen = listo
    ws.onerror = mal
  })
  let tokenDePrueba = ''
  let siguiente = 0
  const pendientes = new Map<number, (v: { result?: unknown; error?: unknown }) => void>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: unknown }
    if (m.id !== undefined) pendientes.get(m.id)?.(m)
  }
  const cdp = (method: string, params: object = {}) =>
    new Promise<Record<string, unknown>>((listo, mal) => {
      const id = ++siguiente
      pendientes.set(id, (m) => (m.error ? mal(new Error(JSON.stringify(m.error))) : listo(m.result as Record<string, unknown>)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  await cdp('Page.enable')
  await cdp('Runtime.enable')
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as { method?: string; params?: { requestId: string; request: { url: string } } }
    if (m.method !== 'Fetch.requestPaused' || !m.params) return
    const url = new URL(m.params.request.url)
    url.searchParams.set('__clerk_testing_token', tokenDePrueba)
    void cdp('Fetch.continueRequest', { requestId: m.params.requestId, url: url.href })
  })

  const evalua = async <T,>(js: string): Promise<T> => {
    const r = (await cdp('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: unknown }
    if (r.exceptionDetails) throw new Error(`En la página: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`)
    return r.result.value
  }
  /** Lo que se espera llega tras una navegación o un `router.refresh`. Si no llega, da `false` y quien pregunta afirma. */
  const hastaQue = async (js: string, limiteMs = 45_000) => {
    const limite = Date.now() + limiteMs
    while (Date.now() < limite) {
      if (await evalua<boolean>(js).catch(() => false)) return true
      await espera(150)
    }
    return false
  }
  const dice = (texto: string) => `document.body?.innerText.includes(${JSON.stringify(texto)})`

  const ajustar = async (ancho: number, alto: number, oscuro: boolean) => {
    await cdp('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 500 })
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: oscuro ? 'dark' : 'light' }] })
    await espera(500)
  }

  return {
    /** El camino que documenta Clerk para pruebas: cada pedido a su API lleva un Testing Token, que solo sirve en esa instancia. */
    conTestingToken: async (token: string, dominio: string) => {
      tokenDePrueba = token
      await cdp('Fetch.enable', { patterns: [{ urlPattern: `https://${dominio}/v1/*` }] })
    },
    evalua,
    hastaQue,
    ve: (texto: string, limiteMs?: number) => hastaQue(dice(texto), limiteMs),
    texto: () => evalua<string>('document.body?.innerText ?? ""'),
    ruta: () => evalua<string>('location.pathname + location.search'),
    ir: async (url: string) => {
      await cdp('Page.navigate', { url })
      await espera(300)
      await hastaQue('document.readyState === "complete"')
    },
    atras: async () => {
      await evalua('history.back()')
      await espera(800)
      await hastaQue('document.readyState === "complete"')
    },
    /** Los formularios leen `FormData`, así que basta con poner el valor. */
    escribe: (nombre: string, valor: string) => evalua(`(() => { const c = document.querySelector('[name=${nombre}]'); c.value = ${JSON.stringify(valor)}; c.dispatchEvent(new Event('input', { bubbles: true })); return true })()`),
    /** Toca el botón o enlace de ese texto, también los del menú, que abren con el puntero. */
    clic: async (texto: string, limiteMs = 30_000) => {
      const buscar = `[...document.querySelectorAll('button, a, [role=menuitem]')].filter((e) => e.offsetParent !== null && (e.innerText?.trim() === ${JSON.stringify(texto)} || e.getAttribute('aria-label') === ${JSON.stringify(texto)})).at(-1)`
      if (!(await hastaQue(`Boolean(${buscar})`, limiteMs))) throw new Error(`No encontré para tocar: ${texto}`)
      await evalua(`(() => { const e = ${buscar}; for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) e.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })); return true })()`)
    },
    ajustar,
    captura: async (ruta: string, ancho: number, alto: number, oscuro: boolean) => {
      await ajustar(ancho, alto, oscuro)
      const { data } = (await cdp('Page.captureScreenshot', { format: 'png' })) as { data: string }
      writeFileSync(ruta, Buffer.from(data, 'base64'))
    },
    cerrar: () => {
      ws.close()
      chrome.kill()
    },
  }
}
