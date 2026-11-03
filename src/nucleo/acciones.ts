/**
 * La tabla de lo que cada actor puede hacer. Hoy una sola fila. La forma es un subconjunto textual de la del diseño de
 * permisos (#28), para que ese tramo agregue filas sin reescribir esta. Darle la acción a otro actor cambia quién compila.
 */
import type { ContextoDelDueno, Marca } from './identidad'

type Clase = 'libre' | 'con_aprobacion_del_dueno' | 'nunca'
/** `boton`: una pulsación autenticada del Dueño. */
export type TipoDeActor = 'agente' | 'vigilancia' | 'boton' | 'panel'
type Sentido = 'frena' | 'suelta' | 'neutra'
type LlegaA = 'nadie' | 'un_dueno' | 'un_cliente' | 'los_clientes' | 'segun_alcance'
type Implementacion = 'lectura' | 'propia' | 'dentro_de_una_propuesta' | 'aprobar_de_8' | 'descartar_de_8'
type Grupo = 'consultas' | 'cambios' | 'actos' | 'casos' | 'propuestas' | 'agente_de_clientes' | 'hilo_y_avisos' | 'niveles'
type Medios = { readonly web: 'si' | 'no'; readonly whatsapp: 'si' | 'no' | 'solo_con_el_negocio_abierto' }

export type DefinicionDeAccion = {
  readonly grupo: Grupo
  readonly que: string
  readonly actores: { readonly [T in TipoDeActor]: Clase }
  readonly medios: Medios | null
  readonly sentido: Sentido
  readonly llegaA: LlegaA
  readonly gasta: readonly ('modelo' | 'whatsapp')[]
  readonly topes: readonly never[]
  readonly mueve: { readonly quien: 'nadie' }
  readonly herramienta: string | null
  readonly implementacion: Implementacion
  readonly porQue: string
}

export const ACCIONES = {
  publicar: {
    grupo: 'propuestas',
    que: 'mandar a tu link lo que ya aplicaste en tu vista previa',
    actores: { agente: 'nunca', vigilancia: 'nunca', boton: 'libre', panel: 'nunca' },
    medios: null,
    sentido: 'suelta',
    llegaA: 'los_clientes',
    gasta: [],
    topes: [],
    mueve: { quien: 'nadie' },
    herramienta: null,
    implementacion: 'propia',
    porQue: 'Les cambia a todos los Clientes cómo se les atiende: es la pulsación del Dueño, atada por huella a lo que vio. El modelo no la tiene.',
  },
} as const satisfies Record<string, DefinicionDeAccion>

export type Actor<T extends TipoDeActor> = Marca<ContextoDelDueno, `Actor:${T}`>

/** Solo lo llaman las rutas de `src/app/api/**` (eslint). */
export const actorDelBoton = (ctx: ContextoDelDueno) => ctx as Actor<'boton'>

export type QuienPuede<A extends keyof typeof ACCIONES> = { [T in TipoDeActor]: (typeof ACCIONES)[A]['actores'][T] extends 'nunca' ? never : Actor<T> }[TipoDeActor]

type Es<A extends true> = A
export type _ElAgenteNoPublica = Es<(typeof ACCIONES)['publicar']['actores']['agente'] extends 'nunca' ? true : false>
