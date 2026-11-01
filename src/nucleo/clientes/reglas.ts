/**
 * Las reglas del Dueño compiladas a puntos de código. El modelo solo ve `textoParaElPrompt`: no tiene cómo saltarse
 * un efecto.
 */
import type { EstadoDelNegocio } from '../estado'
import { sinCumplidorHoy, type Clave, type Cuando, type Efecto, type ElementoDe, type QueNoPrometer, type SE_CUMPLE_HOY } from '../estado/elementos'
import { diceAlguna, PROMESAS } from '../salida/revisar'

export type ViolacionDeRegla = { readonly regla: Clave; readonly efecto: Efecto['tipo']; readonly detalle: string }

export type ReglasCompiladas = {
  readonly textoParaElPrompt: string
  /** Las que valen antes de leer el mensaje: hoy, las de `siempre`. */
  alEntrar(): readonly Clave[]
  enEntrada(activas: readonly Clave[]): null | { readonly regla: Clave; readonly nombre: string; readonly avisoAlCliente: string }
  enSalida(
    activas: readonly Clave[],
    texto: string,
    casoAbierto: boolean,
  ): { readonly violaciones: readonly ViolacionDeRegla[]; readonly casosPorAbrir: readonly string[] }
}

const NO_PROMETER_PARA_EL_MODELO = {
  plazo: 'No prometas fechas ni plazos de entrega.',
  descuento: 'No ofrezcas descuentos ni promociones.',
  disponibilidad: 'No asegures que hay disponibilidad ni existencias.',
} as const satisfies Record<QueNoPrometer, string>

/** Lo que un efecto aporta al turno. `salida` trae el texto para el modelo y el detector que lo hace cumplir. */
type Parte =
  | { readonly en: 'entrada'; readonly avisoAlCliente: string }
  | { readonly en: 'caso'; readonly titulo: string }
  | { readonly en: 'salida'; readonly paraElModelo: string; detecta(texto: string): string | null }

type Encendido<T extends Record<string, 'si' | 'no'>, K extends keyof T, V> = T[K] extends 'si' ? V : null

/**
 * El único lugar que sabe cumplir cada efecto. Su tipo sale de `SE_CUMPLE_HOY`: encender un efecto allí sin su
 * compilador aquí no compila, y lo apagado es `null`.
 */
const COMPILAR_EFECTO: { readonly [K in Efecto['tipo']]: Encendido<(typeof SE_CUMPLE_HOY)['efecto'], K, (e: Extract<Efecto, { tipo: K }>) => Parte> } = {
  pasar_al_dueno: (e) => ({ en: 'entrada', avisoAlCliente: e.avisoAlCliente }),
  abrir_caso: (e) => ({ en: 'caso', titulo: e.titulo }),
  no_prometer: (e) => ({ en: 'salida', paraElModelo: NO_PROMETER_PARA_EL_MODELO[e.que], detecta: (t) => (PROMESAS[e.que].detecta(t) ? NO_PROMETER_PARA_EL_MODELO[e.que] : null) }),
  no_decir: (e) => ({
    en: 'salida',
    paraElModelo: `No digas ${e.frases.map((f) => `«${f}»`).join(', ')}.`,
    detecta: (t) => {
      const dicha = diceAlguna(t, e.frases)
      return dicha ? `No digas «${dicha}».` : null
    },
  }),
  pedir_dato: null,
  no_vender: null,
}

/** Cuándo se sabe que una regla vale, con la misma derivación: hoy solo `siempre`, que vale al entrar. */
const VALE_AL_ENTRAR: { readonly [K in Cuando['tipo']]: Encendido<(typeof SE_CUMPLE_HOY)['cuando'], K, true> } = { siempre: true, tema: null, fuera_de_horario: null, pedido: null }

function compilarEfecto<K extends Efecto['tipo']>(e: Extract<Efecto, { tipo: K }>): Parte | null {
  const compilar = COMPILAR_EFECTO[e.tipo as K] as ((e: Extract<Efecto, { tipo: K }>) => Parte) | null
  return compilar ? compilar(e) : null
}

type Compilada = {
  readonly clave: Clave
  readonly nombre: string
  readonly partes: readonly (Parte & { readonly efecto: Efecto['tipo'] })[]
}

/** Una regla que hoy nada cumple no debía estar (`escribir` no la deja entrar): se salta con un error, sin tumbar el turno. */
function compilarUna(clave: Clave, r: ElementoDe<'regla'>): Compilada | null {
  const partes = r.efectos.map((e) => compilarEfecto(e))
  if (sinCumplidorHoy(r).length || !VALE_AL_ENTRAR[r.cuando.tipo] || partes.includes(null)) {
    console.error('[reglas] una regla vigente sin cumplidor se salta', clave, sinCumplidorHoy(r))
    return null
  }
  return { clave, nombre: r.nombre, partes: r.efectos.map((e, i) => ({ ...partes[i]!, efecto: e.tipo })) }
}

export function compilarReglas(estado: EstadoDelNegocio): ReglasCompiladas {
  const compiladas = estado.vigentes('regla').flatMap((v) => compilarUna(v.clave, v.elemento) ?? [])
  const activasDe = (activas: readonly Clave[]) => compiladas.filter((c) => activas.includes(c.clave))
  return {
    textoParaElPrompt: compiladas
      .flatMap((c) => c.partes)
      .flatMap((p) => (p.en === 'salida' ? [`- ${p.paraElModelo}`] : []))
      .join('\n'),
    alEntrar: () => compiladas.map((c) => c.clave),
    enEntrada(activas) {
      for (const c of activasDe(activas)) for (const p of c.partes) if (p.en === 'entrada') return { regla: c.clave, nombre: c.nombre, avisoAlCliente: p.avisoAlCliente }
      return null
    },
    enSalida(activas, texto, casoAbierto) {
      const violaciones: ViolacionDeRegla[] = []
      const casosPorAbrir: string[] = []
      for (const c of activasDe(activas)) {
        for (const p of c.partes) {
          if (p.en === 'salida') {
            const detalle = p.detecta(texto)
            if (detalle) violaciones.push({ regla: c.clave, efecto: p.efecto, detalle })
          }
          if (p.en === 'caso' && !casoAbierto) casosPorAbrir.push(p.titulo)
        }
      }
      return { violaciones, casosPorAbrir }
    },
  }
}
