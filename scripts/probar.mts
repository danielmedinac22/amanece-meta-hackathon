/**
 * Corre los `probar-*` uno tras otro y sale con 1 si alguno falló. En serie a propósito: `probar-clientes` y
 * `probar-dueno` escriben en el mismo Negocio sembrado.
 *
 *   pnpm probar
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pruebas: [archivo: string, ...argumentos: string[]][] = [
  ['probar-diseno'],
  ['probar-humo'],
  ['probar-modelo'],
  ['probar-revisar'],
  ['probar-consultas'],
  ['probar-leer-enlace'],
  ['probar-elementos'],
  ['probar-migracion'],
  ['probar-reglas'],
  ['probar-lectura'],
  ['probar-salida'],
  ['probar-entrada'],
  ['probar-clientes', '--pedido'],
  ['probar-aislamiento'],
  ['probar-aprobar'],
  ['probar-publicar'],
  ['probar-dueno'],
  ['probar-primera'],
  ['probar-armado'],
  ['probar-plantillas'],
  ['probar-vista-previa'],
  ['probar-panel'],
  ['probar-hoy'],
  ['probar-listas'],
  ['probar-tablero'],
  ['probar-estados'],
  ['probar-casos'],
  ['probar-sesion'],
  ['probar-vitrina'],
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
