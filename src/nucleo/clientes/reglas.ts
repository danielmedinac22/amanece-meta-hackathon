/**
 * Las reglas del Dueño compiladas a puntos de código. El modelo solo ve `textoParaElPrompt`: no tiene cómo saltarse
 * un efecto.
 */
import type { EstadoDelNegocio } from '../estado'
import { reglaEnPalabras, type Clave, type Efecto, type ElementoDe, type QueNoPrometer } from '../estado/elementos'
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
  ): { readonly violaciones: readonly ViolacionDeRegla[]; readonly casosPorAbrir: readonly { readonly regla: Clave; readonly titulo: string }[] }
}

/** Una regla que `escribir` no debía dejar entrar: no se adivina cómo cumplirla. */
export class SinCumplidor extends Error {}

const NO_PROMETER_PARA_EL_MODELO = {
  plazo: 'No prometas fechas ni plazos de entrega.',
  descuento: 'No ofrezcas descuentos ni promociones.',
  disponibilidad: 'No asegures que hay disponibilidad ni existencias.',
} as const satisfies Record<QueNoPrometer, string>

type Compilada = {
  readonly clave: Clave
  readonly nombre: string
  readonly entrada: string | null
  readonly casos: readonly string[]
  readonly salida: readonly ((texto: string) => string | null)[]
  readonly efectosDeSalida: readonly Efecto['tipo'][]
}

function compilarUna(clave: Clave, r: ElementoDe<'regla'>): Compilada {
  switch (r.cuando.tipo) {
    case 'siempre':
      break
    case 'tema':
    case 'fuera_de_horario':
    case 'pedido':
      throw new SinCumplidor(`${clave}: hoy nada evalúa cuando ${r.cuando.tipo}`)
  }
  let entrada: string | null = null
  const casos: string[] = []
  const salida: ((texto: string) => string | null)[] = []
  const efectosDeSalida: Efecto['tipo'][] = []
  for (const e of r.efectos) {
    switch (e.tipo) {
      case 'pasar_al_dueno':
        entrada ??= e.avisoAlCliente
        break
      case 'abrir_caso':
        casos.push(e.titulo)
        break
      case 'no_prometer':
        salida.push((t) => (PROMESAS[e.que].detecta(t) ? NO_PROMETER_PARA_EL_MODELO[e.que] : null))
        efectosDeSalida.push(e.tipo)
        break
      case 'no_decir':
        salida.push((t) => {
          const dicha = diceAlguna(t, e.frases)
          return dicha ? `No digas «${dicha}».` : null
        })
        efectosDeSalida.push(e.tipo)
        break
      case 'pedir_dato':
      case 'no_vender':
        throw new SinCumplidor(`${clave}: hoy nada cumple ${e.tipo}`)
    }
  }
  return { clave, nombre: r.nombre, entrada, casos, salida, efectosDeSalida }
}

export function compilarReglas(estado: EstadoDelNegocio): ReglasCompiladas {
  const reglas = estado.vigentes('regla')
  const compiladas = reglas.map((v) => compilarUna(v.clave, v.elemento))
  const activasDe = (activas: readonly Clave[]) => compiladas.filter((c) => activas.includes(c.clave))
  return {
    textoParaElPrompt: reglas.map((v) => `- ${reglaEnPalabras(v.elemento)}.`).join('\n'),
    alEntrar: () => compiladas.map((c) => c.clave),
    enEntrada(activas) {
      const c = activasDe(activas).find((x) => x.entrada !== null)
      return c && c.entrada !== null ? { regla: c.clave, nombre: c.nombre, avisoAlCliente: c.entrada } : null
    },
    enSalida(activas, texto, casoAbierto) {
      const violaciones: ViolacionDeRegla[] = []
      const casosPorAbrir: { regla: Clave; titulo: string }[] = []
      for (const c of activasDe(activas)) {
        c.salida.forEach((detecta, i) => {
          const detalle = detecta(texto)
          if (detalle) violaciones.push({ regla: c.clave, efecto: c.efectosDeSalida[i], detalle })
        })
        if (!casoAbierto) for (const titulo of c.casos) casosPorAbrir.push({ regla: c.clave, titulo })
      }
      return { violaciones, casosPorAbrir }
    },
  }
}
