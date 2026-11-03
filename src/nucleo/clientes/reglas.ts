/**
 * Las reglas del Dueño compiladas a puntos de código. El modelo solo ve `textoParaElPrompt`: no tiene cómo saltarse
 * un efecto.
 */
import type { EstadoDelNegocio } from '../estado'
import { condicionEnPalabras, seCumpleLaCondicion, sinCumplidorHoy, type Clave, type Cuando, type Efecto, type ElementoDe, type PedidoParaReglas, type QueNoPrometer, type SE_CUMPLE_HOY } from '../estado/elementos'
import { diceAlguna, PROMESAS } from '../salida/revisar'

export type ViolacionDeRegla = { readonly regla: Clave; readonly efecto: Efecto['tipo']; readonly detalle: string }

/**
 * Por qué una regla está activa en este turno. Lo decide el código y viaja hasta la salida.
 *  - `pedido_nuevo`: `crear_pedido` creó en este turno los `pedidos` que cumplen la condición; cada uno abre su Caso.
 *  - `pedido_abierto`: el Cliente ya tiene un pedido abierto que la cumple. Restringe la salida pero no abre Caso: si
 *    lo abriera, cada mensaje de ese Cliente avisaría al Dueño.
 */
export type Activa = { readonly regla: Clave; readonly porque: 'siempre' | 'pedido_abierto' } | PorPedidoNuevo
export type PorPedidoNuevo = { readonly regla: Clave; readonly porque: 'pedido_nuevo'; readonly pedidos: readonly [number, ...number[]] }

export type CasoPorAbrir = { readonly titulo: string; readonly pedido: number | null; readonly regla: string }

/** Qué partes de una regla cumple cada razón. `enSalida` no ramifica por `porque`. */
const CUMPLE = {
  siempre: { entrada: true, caso: true, salida: true },
  pedido_nuevo: { entrada: false, caso: true, salida: true },
  pedido_abierto: { entrada: false, caso: false, salida: true },
} as const satisfies Record<Activa['porque'], { readonly entrada: boolean; readonly caso: boolean; readonly salida: boolean }>

export type ReglasCompiladas = {
  readonly textoParaElPrompt: string
  /** Las de `siempre` y las de pedido que cumple un pedido abierto del Cliente. */
  alEntrar(abiertos: readonly PedidoParaReglas[]): readonly Activa[]
  /** La llama `envolver` cuando `crear_pedido` ya devolvió el número: un pedido negado o que no se guardó no activa nada. */
  alCrear(p: PedidoParaReglas, numero: number): readonly PorPedidoNuevo[]
  enEntrada(activas: readonly Activa[]): null | { readonly regla: Clave; readonly nombre: string; readonly avisoAlCliente: string }
  /** `casosDelModelo`: los pedidos de los Casos que abrió el modelo en el turno. Uno de ese mismo pedido reemplaza al de la regla. */
  enSalida(
    activas: readonly Activa[],
    texto: string,
    casosDelModelo: readonly (number | null)[],
  ): { readonly violaciones: readonly ViolacionDeRegla[]; readonly casosPorAbrir: readonly CasoPorAbrir[] }
  nombresDeLasReglasDelCaso(activas: readonly Activa[], pedido: number | null): readonly string[]
}

/** Sin repetir regla: si una vale por dos razones, gana la primera, así que quien llama pone primero la que más cumple. */
export function sinRepetir(activas: readonly Activa[]): readonly Activa[] {
  return activas.filter((a, i) => activas.findIndex((b) => b.regla === a.regla) === i)
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

/** Cuándo se sabe que una regla vale, con la misma derivación: encender `tema` o `fuera_de_horario` sin su fila no compila. */
type Activacion = { readonly al: 'entrar' } | { readonly al: 'pedido' }
const ACTIVACION: { readonly [K in Cuando['tipo']]: Encendido<(typeof SE_CUMPLE_HOY)['cuando'], K, Activacion> } = {
  siempre: { al: 'entrar' },
  pedido: { al: 'pedido' },
  tema: null,
  fuera_de_horario: null,
}

function compilarEfecto<K extends Efecto['tipo']>(e: Extract<Efecto, { tipo: K }>): Parte | null {
  const compilar = COMPILAR_EFECTO[e.tipo as K] as ((e: Extract<Efecto, { tipo: K }>) => Parte) | null
  return compilar ? compilar(e) : null
}

type Compilada = {
  readonly clave: Clave
  readonly nombre: string
  readonly cuando: Cuando
  readonly partes: readonly (Parte & { readonly efecto: Efecto['tipo'] })[]
}

/** Una regla que hoy nada cumple no debía estar (`escribir` no la deja entrar): se salta con un error, sin tumbar el turno. */
function compilarUna(clave: Clave, r: ElementoDe<'regla'>): Compilada | null {
  const partes = r.efectos.map((e) => compilarEfecto(e))
  if (sinCumplidorHoy(r).length || !ACTIVACION[r.cuando.tipo] || partes.includes(null)) {
    console.error('[reglas] una regla vigente sin cumplidor se salta', clave, sinCumplidorHoy(r))
    return null
  }
  return { clave, nombre: r.nombre, cuando: r.cuando, partes: r.efectos.map((e, i) => ({ ...partes[i]!, efecto: e.tipo })) }
}

const cumpleElPedido = (c: Compilada, p: PedidoParaReglas) => c.cuando.tipo === 'pedido' && seCumpleLaCondicion(c.cuando.condicion, p)

export function compilarReglas(estado: EstadoDelNegocio): ReglasCompiladas {
  const compiladas = estado.vigentes('regla').flatMap((v) => compilarUna(v.clave, v.elemento) ?? [])
  const activasDe = (activas: readonly Activa[]) =>
    sinRepetir(activas).flatMap((a) => {
      const c = compiladas.find((x) => x.clave === a.regla)
      return c ? [{ a, c, cumple: CUMPLE[a.porque] }] : []
    })
  const casosQuePiden = (activas: readonly Activa[]): readonly CasoPorAbrir[] =>
    activasDe(activas).flatMap(({ a, c, cumple }) =>
      cumple.caso ? c.partes.flatMap((p) => (p.en === 'caso' ? (a.porque === 'pedido_nuevo' ? a.pedidos : [null]).map((pedido) => ({ titulo: p.titulo, pedido, regla: c.nombre })) : [])) : [],
    )
  const alPedido = compiladas.filter((c) => ACTIVACION[c.cuando.tipo]?.al === 'pedido')
  return {
    textoParaElPrompt: compiladas
      .flatMap((c) => {
        const si = c.cuando.tipo === 'pedido' ? `Si ${condicionEnPalabras(c.cuando.condicion, estado).replace(/^cuando /, '')}: ` : ''
        return c.partes.flatMap((p) => (p.en === 'salida' ? [`- ${si}${p.paraElModelo}`] : []))
      })
      .join('\n'),
    alEntrar: (abiertos) => [
      ...compiladas.filter((c) => ACTIVACION[c.cuando.tipo]?.al === 'entrar').map((c): Activa => ({ regla: c.clave, porque: 'siempre' })),
      ...alPedido.filter((c) => abiertos.some((p) => cumpleElPedido(c, p))).map((c): Activa => ({ regla: c.clave, porque: 'pedido_abierto' })),
    ],
    alCrear: (p, numero) => alPedido.filter((c) => cumpleElPedido(c, p)).map((c): PorPedidoNuevo => ({ regla: c.clave, porque: 'pedido_nuevo', pedidos: [numero] })),
    enEntrada(activas) {
      for (const { c, cumple } of activasDe(activas)) if (cumple.entrada) for (const p of c.partes) if (p.en === 'entrada') return { regla: c.clave, nombre: c.nombre, avisoAlCliente: p.avisoAlCliente }
      return null
    },
    enSalida(activas, texto, casosDelModelo) {
      const violaciones: ViolacionDeRegla[] = []
      for (const { c, cumple } of activasDe(activas)) {
        for (const p of c.partes) {
          if (p.en === 'salida' && cumple.salida) {
            const detalle = p.detecta(texto)
            if (detalle) violaciones.push({ regla: c.clave, efecto: p.efecto, detalle })
          }
        }
      }
      return { violaciones, casosPorAbrir: casosQuePiden(activas).filter((c) => !casosDelModelo.includes(c.pedido)) }
    },
    nombresDeLasReglasDelCaso: (activas, pedido) => casosQuePiden(activas).flatMap((c) => (c.pedido === pedido ? [c.regla] : [])),
  }
}
