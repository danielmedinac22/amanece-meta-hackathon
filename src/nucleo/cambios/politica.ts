import type { Alcance } from '../estado/elementos'
import { conPropuesta, sinNombrePropio, valorDelDato, type EstadoDelNegocio, type Escritura } from '../estado'
import type { ModoDelNegocio } from '../identidad'
import type { OrigenDelPedido } from './fila'

export type { Alcance }

export type Politica = 'se_aplica' | 'espera_al_dueno'

/**
 * La tabla de `tipos.ts`, en orden:
 *   origen lectura      → espera_al_dueno (un precio leído cuenta solo si el Dueño lo confirma, también mientras se arma)
 *   con actos           → espera_al_dueno (responderle a un Cliente pide el botón)
 *   armando o en_sombra → se_aplica (no hay Clientes reales)
 *   origen panel        → se_aplica (el clic del Dueño es la aprobación)
 *   alcance panel       → se_aplica (Sección e Indicador: solo los ve el Dueño)
 *   alcance clientes    → espera_al_dueno (regla, conocimiento)
 */
export function politicaDeAprobacion(modo: ModoDelNegocio, alcance: Alcance, origen: OrigenDelPedido, conActos: boolean): Politica {
  if (origen === 'lectura' || conActos) return 'espera_al_dueno'
  if (modo === 'armando' || modo === 'en_sombra') return 'se_aplica'
  if (origen === 'panel') return 'se_aplica'
  return alcance === 'panel' ? 'se_aplica' : 'espera_al_dueno'
}

export type Falta = {
  readonly que: 'nombre' | 'producto_con_precio' | 'ciudad' | 'envios' | 'envios_sin_detalle' | 'pagos' | 'horario'
  readonly enPalabras: string
  /** Aprobar la tarjeta de lectura pendiente la resuelve: el Agente pide el botón en vez de preguntar lo que ya leyó. */
  readonly enLaTarjeta: boolean
}

const BLOQUEA = {
  nombre: { enPalabras: 'el nombre del Negocio', falta: (e: EstadoDelNegocio) => sinNombrePropio(e.identidad) },
  producto_con_precio: { enPalabras: 'al menos un producto con su precio', falta: (e: EstadoDelNegocio) => !e.vigentes('producto').some((v) => v.elemento.activo && v.elemento.precio > 0) },
} as const satisfies Partial<Record<Falta['que'], { readonly enPalabras: string; falta(e: EstadoDelNegocio): boolean }>>

const PLAZO = /\d+\s*(a\s*\d+\s*)?(d[ií]as|horas)|mismo d[ií]a|d[ií]as h[aá]biles/i
const COSTO = /incluid|gratis|sin costo|\$\s?\d|cuesta|costo|valor|tarifa/i

/** «Enviamos a todo el país» no dice cuánto cuesta ni cuánto demora: el Agente de clientes abriría un Caso. */
const enviosSinDetalle = (e: EstadoDelNegocio) => {
  const envios = valorDelDato(e, 'envios')
  return envios !== '' && (!PLAZO.test(envios) || !COSTO.test(envios))
}

const AVISA = {
  ciudad: { enPalabras: 'la ciudad', falta: (e: EstadoDelNegocio) => !valorDelDato(e, 'ciudad') },
  envios: { enPalabras: 'los envíos', falta: (e: EstadoDelNegocio) => !valorDelDato(e, 'envios') },
  envios_sin_detalle: { enPalabras: 'cuánto cuestan y cuánto demoran los envíos', falta: enviosSinDetalle },
  pagos: { enPalabras: 'las formas de pago', falta: (e: EstadoDelNegocio) => !valorDelDato(e, 'pagos') },
  horario: { enPalabras: 'el horario', falta: (e: EstadoDelNegocio) => !valorDelDato(e, 'horario') },
} as const satisfies Partial<Record<Falta['que'], { readonly enPalabras: string; falta(e: EstadoDelNegocio): boolean }>>

type _CadaFaltaEnUnaTabla = Es<[Falta['que']] extends [keyof typeof BLOQUEA | keyof typeof AVISA] ? true : false>
type Es<A extends true> = A
export type ComprobacionesDePolitica = [_CadaFaltaEnUnaTabla]

/**
 * Pura. Lo que falta para abrir el Negocio. Bloquean el nombre propio y un producto activo con precio; lo demás solo
 * avisa. La voz y la zona no cuentan. Un nombre o un producto que espera en la tarjeta de lectura no es vigente, así que
 * sigue bloqueando, con `enLaTarjeta`.
 */
export function queFaltaParaAbrir(estado: EstadoDelNegocio, pendiente: Escritura | null): { readonly bloquea: readonly Falta[]; readonly avisa: readonly Falta[] } {
  const conTarjeta = pendiente ? conPropuesta(estado, pendiente) : null
  const faltas = <T extends Record<string, { readonly enPalabras: string; falta(e: EstadoDelNegocio): boolean }>>(tabla: T) =>
    (Object.keys(tabla) as (keyof T & Falta['que'])[]).flatMap((que): Falta[] =>
      tabla[que].falta(estado) ? [{ que, enPalabras: tabla[que].enPalabras, enLaTarjeta: conTarjeta !== null && !tabla[que].falta(conTarjeta) }] : [],
    )
  return { bloquea: faltas(BLOQUEA), avisa: faltas(AVISA) }
}
