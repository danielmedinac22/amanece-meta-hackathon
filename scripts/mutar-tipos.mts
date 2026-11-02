/**
 * Las invariantes del tramo que viven en los tipos: aplica una por una cada mutación sobre el código real y afirma
 * que `tsc --noEmit` falla con cada una y pasa sin ninguna. Restaura cada archivo, también si algo lanza. Fuera de
 * `pnpm probar`: tarda lo que tardan ocho `tsc`.
 *
 *   pnpm tsx scripts/mutar-tipos.mts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { afirmar, terminar } from './afirmar.mjs'

type Mutacion = { readonly nombre: string; readonly archivo: string; readonly antes: string; readonly despues: string }

const ELEMENTOS = 'src/nucleo/estado/elementos.ts'
const MUTACIONES: readonly Mutacion[] = [
  {
    nombre: 'guia de vuelta en Efecto',
    archivo: ELEMENTOS,
    antes: "  | { readonly tipo: 'no_decir'; readonly frases: readonly [string, ...string[]] }\n",
    despues: "  | { readonly tipo: 'no_decir'; readonly frases: readonly [string, ...string[]] }\n  | { readonly tipo: 'guia'; readonly texto: string }\n",
  },
  {
    nombre: 'fila como tipo de Elemento',
    archivo: ELEMENTOS,
    antes: "  | { readonly tipo: 'pregunta'; readonly pregunta: string; readonly respuesta: string }\n",
    despues: "  | { readonly tipo: 'pregunta'; readonly pregunta: string; readonly respuesta: string }\n  | { readonly tipo: 'fila'; readonly valores: string }\n",
  },
  {
    nombre: 'pedido evaluado por activar en CUANDO',
    archivo: ELEMENTOS,
    antes: "  pedido: { evalua: 'codigo', seSabeEn: 'herramienta' },",
    despues: "  pedido: { evalua: 'activar', seSabeEn: 'herramienta' },",
  },
  {
    nombre: 'escribir sin Transaccion',
    archivo: 'src/nucleo/estado/escribir.ts',
    antes: 'export async function escribir(tx: Transaccion,',
    despues: "export async function escribir(tx: typeof import('@/db').db,",
  },
  {
    nombre: 'dato con conversaciones en VISTA_PREVIA',
    archivo: ELEMENTOS,
    antes: "  dato: 'describir',\n  pregunta: 'describir',",
    despues: "  dato: 'conversaciones',\n  pregunta: 'describir',",
  },
  {
    nombre: 'pasar_al_dueno como acción del puerto',
    archivo: 'src/nucleo/clientes/acciones.ts',
    antes: '  consultar_pedido(numero: number | null): Promise<readonly PedidoConsultado[]>\n',
    despues: '  consultar_pedido(numero: number | null): Promise<readonly PedidoConsultado[]>\n  pasar_al_dueno(motivo: string): Promise<{ readonly caso: CasoId | null }>\n',
  },
  {
    nombre: 'encender fuera_de_horario en SE_CUMPLE_HOY sin tocar la comprobación',
    archivo: ELEMENTOS,
    antes: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'no', pedido: 'no' },",
    despues: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'si', pedido: 'no' },",
  },
  {
    nombre: 'encender tema en SE_CUMPLE_HOY sin tocar la comprobación',
    archivo: ELEMENTOS,
    antes: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'no', pedido: 'no' },",
    despues: "  cuando: { siempre: 'si', tema: 'si', fuera_de_horario: 'no', pedido: 'no' },",
  },
]

function tsc(): { readonly pasa: boolean; readonly errores: string } {
  const r = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8' })
  return { pasa: r.status === 0, errores: (r.stdout + r.stderr).split('\n').filter((l) => l.includes('error TS')).slice(0, 3).join('\n') }
}

const limpio = tsc()
afirmar('sin mutaciones, tsc pasa', limpio.pasa, limpio.errores)
for (const m of MUTACIONES) {
  const original = readFileSync(m.archivo, 'utf8')
  if (original.split(m.antes).length !== 2) {
    afirmar(`${m.nombre}: el texto a mutar está una sola vez en ${m.archivo}`, false, m.antes)
    continue
  }
  try {
    writeFileSync(m.archivo, original.replace(m.antes, m.despues))
    const r = tsc()
    afirmar(`${m.nombre}: tsc falla`, !r.pasa, r.errores)
    if (!r.pasa) console.log(`      ${r.errores.split('\n')[0]}`)
  } finally {
    writeFileSync(m.archivo, original)
  }
}
afirmar('restaurado todo, tsc vuelve a pasar', tsc().pasa)
terminar()
