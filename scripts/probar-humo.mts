/**
 * Lo que solo se ve con el build de producción: `next build`, `next start` y pedir las rutas que cargan WebAssembly.
 * Empaquetado, `libpg-query` no carga su WASM y la ruta da 500 aunque el build pase.
 *
 *   pnpm tsx scripts/probar-humo.mts
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { afirmar, terminar } from './afirmar.mjs'

/** Un puerto libre: otro `next start` de otra rama puede tener el que sea. */
const PUERTO = await new Promise<number>((listo) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address() as { port: number }
    s.close(() => listo(port))
  })
})
const build = spawnSync('npx', ['next', 'build'], { encoding: 'utf8' })
afirmar('next build pasa', build.status === 0, (build.stdout + build.stderr).slice(-1500))

const servidor = spawn('npx', ['next', 'start', '-p', String(PUERTO)], { stdio: 'ignore', detached: true })
try {
  let respuesta: Response | null = null
  for (let i = 0; i < 60 && !respuesta; i++) {
    respuesta = await fetch(`http://localhost:${PUERTO}/api/salud/consultas`).catch(() => null)
    if (!respuesta) await new Promise((r) => setTimeout(r, 500))
  }
  const cuerpo = respuesta ? await respuesta.json().catch(() => null) : null
  afirmar('next start: /api/salud/consultas carga el validador y responde ok', respuesta?.status === 200 && cuerpo?.ok === true, { status: respuesta?.status, cuerpo })
} finally {
  if (servidor.pid) process.kill(-servidor.pid)
}
terminar()
