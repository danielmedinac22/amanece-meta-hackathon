/**
 * Las invariantes del tramo que viven en los tipos: aplica una por una cada mutación sobre el código real y afirma
 * que `tsc --noEmit` falla con cada una y pasa sin ninguna. Restaura cada archivo, también si algo lanza. Fuera de
 * `pnpm probar`: tarda lo que tardan todas las mutaciones en `tsc`.
 *
 *   pnpm tsx scripts/mutar-tipos.mts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { afirmar, terminar } from './afirmar.mjs'

type Cambio = { readonly antes: string; readonly despues: string }
/** `tambien`: un segundo cambio en el mismo archivo, para mutar una tabla con su comprobación al día. */
type Mutacion = Cambio & { readonly nombre: string; readonly archivo: string; readonly tambien?: Cambio }

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
    antes: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'no', pedido: 'si' },",
    despues: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'si', pedido: 'si' },",
  },
  {
    nombre: 'encender tema en SE_CUMPLE_HOY sin tocar la comprobación',
    archivo: ELEMENTOS,
    antes: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'no', pedido: 'si' },",
    despues: "  cuando: { siempre: 'si', tema: 'si', fuera_de_horario: 'no', pedido: 'si' },",
  },
  {
    nombre: 'encender fuera_de_horario con su comprobación al día y sin su fila en ACTIVACION',
    archivo: ELEMENTOS,
    antes: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'no', pedido: 'si' },\n",
    despues: "  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'si', pedido: 'si' },\n",
    tambien: { antes: "type DelPlanB = 'tema' | 'fuera_de_horario' | 'pedir_dato' | 'no_vender'", despues: "type DelPlanB = 'tema' | 'pedir_dato' | 'no_vender'" },
  },
  {
    nombre: 'una Falta nueva sin su fila en BLOQUEA ni AVISA',
    archivo: 'src/nucleo/cambios/politica.ts',
    antes: "'envios_sin_detalle' | 'pagos' | 'horario'\n",
    despues: "'envios_sin_detalle' | 'pagos' | 'horario' | 'voz'\n",
  },
  {
    nombre: 'texto en lo que se guarda de un ensayo',
    archivo: 'src/nucleo/cambios/ensayar.ts',
    antes: "  readonly corregido: 'no' | 'si' | 'respaldo'\n}",
    despues: "  readonly corregido: 'no' | 'si' | 'respaldo'\n  readonly texto: string\n}",
  },
  {
    nombre: 'la consulta de una Sección en lo que escribe el Agente del dueño',
    archivo: ELEMENTOS,
    antes: "type SoloDelRedactor = 'consulta'",
    despues: 'type SoloDelRedactor = never',
  },
  {
    nombre: 'seccion con describir en VISTA_PREVIA',
    archivo: ELEMENTOS,
    antes: "  seccion: 'panel',\n  indicador: 'panel',",
    despues: "  seccion: 'describir',\n  indicador: 'panel',",
  },
  {
    nombre: 'filas de una consulta en lo que se guarda de la vista previa del Panel',
    archivo: 'src/nucleo/cambios/ensayar.ts',
    antes: '  readonly fallo: PorQueNoSePudo | null\n}',
    despues: '  readonly fallo: PorQueNoSePudo | null\n  readonly filas: readonly Record<string, string>[]\n}',
  },
  {
    nombre: 'un motivo de Capacidad faltante sin su lugar en el CHECK',
    archivo: 'src/nucleo/capacidades.ts',
    antes: "  | { readonly tipo: 'regla_vieja' }\n",
    despues: "  | { readonly tipo: 'regla_vieja' }\n  | { readonly tipo: 'cobrar2' }\n",
  },
  {
    nombre: '/medicion sin preguntar si quien mira es del equipo',
    archivo: 'src/app/medicion/page.tsx',
    antes: '  const equipo = await esDelEquipo()\n  if (!equipo) notFound()\n',
    despues: '  const equipo = { email: process.env.EQUIPO_DE_AMANECE ?? \'\' }\n',
  },
  {
    nombre: 'un estado de pedido sin decir si está abierto',
    archivo: 'src/nucleo/clientes/turno.ts',
    antes: 'enviado: true, novedad: true, entregado: false,',
    despues: 'enviado: true, entregado: false,',
  },
  {
    nombre: 'atender con lo aplicado',
    archivo: 'src/nucleo/clientes/atender.ts',
    antes: 'estado = await leerPublicado(negocio)',
    despues: 'estado = await leerAplicado(negocio)',
    tambien: { antes: 'import { leerPublicado, NegocioInexistente,', despues: 'import { leerAplicado, NegocioInexistente,' },
  },
  {
    nombre: 'entornoReal con lo aplicado',
    archivo: 'src/nucleo/clientes/turno.ts',
    antes: 'export function entornoReal(estado: EstadoPublicado,',
    despues: 'export function entornoReal(estado: EstadoAplicado,',
    tambien: { antes: "import type { EstadoDelNegocio, EstadoPublicado } from '../estado'", despues: "import type { EstadoAplicado, EstadoDelNegocio, EstadoPublicado } from '../estado'" },
  },
  {
    nombre: 'el bit con default en el esquema',
    archivo: 'src/db/esquema.ts',
    antes: "sinPublicar: boolean('sin_publicar').notNull(),",
    despues: "sinPublicar: boolean('sin_publicar').notNull().default(false),",
  },
  {
    nombre: 'publicar libre para el agente',
    archivo: 'src/nucleo/acciones.ts',
    antes: "actores: { agente: 'nunca', vigilancia: 'nunca', boton: 'libre', panel: 'nunca' },",
    despues: "actores: { agente: 'libre', vigilancia: 'nunca', boton: 'libre', panel: 'nunca' },",
  },
  {
    nombre: 'proponer acepta el origen panel, que aplica sin botón',
    archivo: 'src/nucleo/cambios/index.ts',
    antes: 'export async function proponer(ctx: ContextoDelDueno, pedido: PedidoDelDueno,',
    despues: 'export async function proponer(ctx: ContextoDelDueno, pedido: PedidoConSuClic,',
  },
  {
    nombre: 'el contexto de un Caso con lo aplicado',
    archivo: 'src/agentes/avisos.ts',
    antes: '  estado: EstadoPublicado,\n',
    despues: '  estado: EstadoAplicado,\n',
    tambien: { antes: 'type EstadoPublicado }', despues: 'type EstadoAplicado }' },
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
  const cambios = [m, ...(m.tambien ? [m.tambien] : [])]
  const faltan = cambios.filter((c) => original.split(c.antes).length !== 2)
  if (faltan.length) {
    afirmar(`${m.nombre}: el texto a mutar está una sola vez en ${m.archivo}`, false, faltan.map((c) => c.antes))
    continue
  }
  try {
    writeFileSync(m.archivo, cambios.reduce((texto, c) => texto.replace(c.antes, c.despues), original))
    const r = tsc()
    afirmar(`${m.nombre}: tsc falla`, !r.pasa, r.errores)
    if (!r.pasa) console.log(`      ${r.errores.split('\n')[0]}`)
  } finally {
    writeFileSync(m.archivo, original)
  }
}
afirmar('restaurado todo, tsc vuelve a pasar', tsc().pasa)
terminar()
