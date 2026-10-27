/**
 * Corre los `probar-*` uno tras otro y sale con 1 si alguno falló. En serie a propósito: `probar-clientes` y
 * `probar-dueno` escriben en el mismo Negocio sembrado.
 *
 *   pnpm probar
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pruebas: [archivo: string, ...argumentos: string[]][] = [
  ['probar-aislado'],
  ['probar-modelo'],
  ['probar-clientes', '--pedido'],
  ['probar-dueno'],
]

const fallaron: string[] = []
for (const [archivo, ...argumentos] of pruebas) {
  console.log(`\n${'#'.repeat(78)}\n# ${[archivo, ...argumentos].join(' ')}\n${'#'.repeat(78)}`)
  const r = spawnSync('tsx', [fileURLToPath(new URL(`./${archivo}.mts`, import.meta.url)), ...argumentos], { stdio: 'inherit' })
  if (r.error) console.error(r.error)
  if (r.status !== 0) fallaron.push(archivo)
}

console.log(`\n${fallaron.length ? `Fallaron ${fallaron.length} de ${pruebas.length}: ${fallaron.join(', ')}` : `Pasaron las ${pruebas.length} pruebas.`}`)
process.exit(fallaron.length ? 1 : 0)
