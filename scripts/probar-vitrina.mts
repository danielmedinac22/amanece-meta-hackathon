/**
 * La vitrina existe solo en `next dev` y no deja rastro en un build. Corre los tres servidores de verdad:
 * build + start (404 en /vitrina) y dev sin base de datos ni sesión (la vitrina pinta sin leer nada y /panel sigue
 * pidiendo entrar). Tarda unos minutos por el build.
 *
 *   pnpm tsx scripts/probar-vitrina.mts
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afirmar, terminar } from './afirmar.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const NEXT = join(RAIZ, 'node_modules/next/dist/bin/next')
const SIN_BASE = 'postgres://nadie:x@127.0.0.1:1/nada'
const ESCENAS_ESPERADAS = ['panel-vacio', 'panel-armandose', 'panel-funcionando', 'panel-un-caso', 'componentes']

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
  const hijo = spawn(process.execPath, [NEXT, modo, '-p', String(puerto), '-H', '127.0.0.1'], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  hijos.add(hijo)
  for (const flujo of [hijo.stdout, hijo.stderr]) flujo.on('data', (d: Buffer) => salida.push(String(d)))
  const base = `http://127.0.0.1:${puerto}`
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

try {
  console.log('\nbuild')
  const build = spawnSync(process.execPath, [NEXT, 'build'], { cwd: RAIZ, encoding: 'utf8', timeout: 540_000 })
  afirmar('next build termina bien', build.status === 0, `${build.stdout}\n${build.stderr}`.slice(-2000))

  const manifiesto = JSON.parse(readFileSync(join(RAIZ, '.next/app-path-routes-manifest.json'), 'utf8')) as Record<string, string>
  const rutas = Object.entries(manifiesto).flat()
  afirmar('El build publica /panel', rutas.includes('/panel'), rutas)
  afirmar('El build no publica ninguna ruta de la vitrina', !rutas.some((r) => r.includes('vitrina')), rutas)
  const nombresDelServidor = nombres(join(RAIZ, '.next/server/app'))
  afirmar('Nada bajo .next/server/app se llama vitrina', !nombresDelServidor.some((n) => n.includes('vitrina')), nombresDelServidor.filter((n) => n.includes('vitrina')))

  console.log('\nnext start')
  const produccion = await servir('start')
  for (const ruta of ['/vitrina', '/vitrina/componentes']) {
    const r = await ver(`${produccion.base}${ruta}`)
    afirmar(`start: ${ruta} da 404`, r.status === 404, r.status)
  }
  produccion.parar()

  console.log('\nnext dev, sin base de datos ni sesión')
  const desarrollo = await servir('dev', { DATABASE_URL: SIN_BASE, DATABASE_URL_UNPOOLED: SIN_BASE, DATABASE_URL_CONSULTAS: SIN_BASE })
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

  const panel = await ver(`${desarrollo.base}/panel`)
  afirmar('dev: /panel sin sesión redirige a /entrar', [302, 307].includes(panel.status) && (panel.headers.get('location') ?? '').includes('/entrar'), { estado: panel.status, destino: panel.headers.get('location') })
  desarrollo.parar()
} catch (error) {
  afirmar('La prueba de la vitrina corrió completa', false, error)
} finally {
  matarHijos()
}

terminar()
