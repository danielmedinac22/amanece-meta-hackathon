/**
 * Captura una escena de la vitrina en Chrome sin ventana, en el modo y el ancho que se pidan, y sale con 1 si la
 * página se desborda a lo ancho. `--clic=texto` toca un botón antes de capturar. Necesita `pnpm dev` corriendo.
 *
 *   pnpm tsx scripts/mirar-vitrina.mts panel-un-caso /tmp/caso.png 390 844 --oscuro
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.VITRINA_URL ?? 'http://localhost:3000'
const banderas = process.argv.slice(2).filter((a) => a.startsWith('--'))
const [escena, salida, ancho = '1440', alto = '900'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!escena || !salida) throw new Error('Uso: mirar-vitrina.mts <escena> <salida.png> [ancho] [alto] [--oscuro]')
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

const puerto = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${puerto}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vitrina-'))}`, '--no-first-run'], { stdio: 'ignore' })

try {
  let pestana: { type: string; webSocketDebuggerUrl: string } | undefined
  for (let i = 0; i < 40 && !pestana; i++) {
    await espera(250)
    const lista = (await fetch(`http://127.0.0.1:${puerto}/json`).then((r) => r.json(), () => [])) as { type: string; webSocketDebuggerUrl: string }[]
    pestana = lista.find((t) => t.type === 'page')
  }
  if (!pestana) throw new Error('Chrome no abrió')
  const ws = new WebSocket(pestana.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pendientes = new Map<number, (resultado: Record<string, never>) => void>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data))
    pendientes.get(m.id)?.(m.result ?? m.error)
  }
  const cdp = (method: string, params: object = {}) =>
    new Promise<Record<string, never>>((r) => {
      const n = ++id
      pendientes.set(n, r)
      ws.send(JSON.stringify({ id: n, method, params }))
    })

  await cdp('Emulation.setDeviceMetricsOverride', { width: +ancho, height: +alto, deviceScaleFactor: 1, mobile: false })
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: banderas.includes('--oscuro') ? 'dark' : 'light' }] })
  await cdp('Page.enable')
  await cdp('Page.navigate', { url: `${BASE}/vitrina/${escena}` })
  await espera(2500)

  // Next bloquea su JavaScript de desarrollo fuera de `localhost`: la página se pinta pero ningún botón responde.
  const viva = (await cdp('Runtime.evaluate', { expression: `Object.keys(document.documentElement).some((k) => k.startsWith('__react'))`, returnByValue: true })) as unknown as { result: { value: boolean } }
  if (!viva.result.value) throw new Error(`React no arrancó en ${BASE}. Abre la vitrina por localhost.`)

  const medida = (await cdp('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth - window.innerWidth', returnByValue: true })) as unknown as { result: { value: number } }
  if (medida.result.value > 0) {
    console.error(`Se desborda ${medida.result.value} px a lo ancho`)
    process.exitCode = 1
  }
  for (const clic of banderas.filter((b) => b.startsWith('--clic=')).map((b) => b.slice(7))) {
    // Un clic de verdad: Base UI abre sus menús con los eventos del puntero, y `element.click()` no los dispara.
    const buscar = `(() => { const e = [...document.querySelectorAll('button,summary,a,[role=tab]')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(clic)})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
    const hallado = (await cdp('Runtime.evaluate', { expression: buscar, returnByValue: true })) as unknown as { result: { value: { x: number; y: number } | null } }
    const punto = hallado.result.value
    if (!punto) throw new Error(`No encontré: ${clic}`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, ...punto, button: 'left', clickCount: 1 })
    await espera(600)
  }
  const { data } = (await cdp('Page.captureScreenshot', { format: 'png' })) as unknown as { data: string }
  writeFileSync(salida, Buffer.from(data, 'base64'))
  console.log('Guardada', salida)
  ws.close()
} finally {
  chrome.kill()
}
