// Ruta relativa y solo tipos: `src/db/esquema.ts` importa de aquí y drizzle-kit no resuelve `@/`.
import type { CasoId, ClienteId, Instante, Marca, ModoDelNegocio, NegocioId, Wamid } from '../identidad'

/** La fija el camino que origina el mensaje, nunca el Dueño ni el modelo. */
export type ClaseDeMensaje = 'respuesta' | 'resolucion_de_caso' | 'aviso_del_nucleo'

export type AlCliente = { readonly tipo: 'cliente'; readonly negocio: NegocioId; readonly cliente: ClienteId }

/** Los avisos fijos también salen por aquí, hacia un teléfono que todavía no es Cliente de nadie. */
export type Destinatario =
  | AlCliente
  | { readonly tipo: 'telefono'; readonly telefono: string; readonly negocio: NegocioId | null }

export type DatosDeIntencion = {
  readonly texto: string
  /** La arma `intencion.*` en `salida/index.ts`: la misma clave no sale dos veces. */
  readonly clave: string
} & (
  | { readonly clase: 'respuesta'; readonly destinatario: AlCliente; readonly enRespuestaA: Wamid }
  | {
      readonly clase: 'resolucion_de_caso'
      readonly destinatario: AlCliente
      /** `null` solo desde `enviarAlCliente`, que no sabe de qué Caso viene. */
      readonly caso: CasoId | null
    }
  | { readonly clase: 'aviso_del_nucleo'; readonly destinatario: Destinatario; readonly enRespuestaA: Wamid }
)

export type IntencionDeEnvio = Marca<DatosDeIntencion, 'IntencionDeEnvio'>
/** La del ensayo: misma forma, otra marca, así `despachar` no la acepta y `decidir` sí. */
export type IntencionEnsayada = Marca<DatosDeIntencion, 'IntencionEnsayada'>

export type HechosDeEnvio = {
  readonly ahora: Instante
  readonly emergenciaGlobal: boolean
  readonly numeroPermitido: boolean
  /** `null`: un aviso a un teléfono sin Negocio. */
  readonly negocio: null | { readonly modo: ModoDelNegocio; readonly emergencia: boolean }
  /** `null` si el destinatario no es un Cliente o su id no existe. */
  readonly cliente: null | { readonly negocio: NegocioId }
  readonly ultimoEntrante: Instante | null
  readonly respuestasAlMismoMensaje: number
}

/** El orden es el de evaluación: gana la primera regla que frena. */
export const ORDEN_DE_LA_COMPUERTA = [
  'emergencia',
  'negocio_en_sombra',
  'numero_no_permitido',
  'destinatario_de_otro_negocio',
  'fuera_de_ventana',
  'una_respuesta_por_mensaje',
] as const

export type MotivoDeSilencio = (typeof ORDEN_DE_LA_COMPUERTA)[number]

export type Veredicto = { readonly tipo: 'sale' } | { readonly tipo: 'no_sale'; readonly motivo: MotivoDeSilencio }

export const APLICA_A = {
  emergencia: { respuesta: true, resolucion_de_caso: true, aviso_del_nucleo: true },
  negocio_en_sombra: { respuesta: true, resolucion_de_caso: true, aviso_del_nucleo: true },
  numero_no_permitido: { respuesta: true, resolucion_de_caso: true, aviso_del_nucleo: true },
  destinatario_de_otro_negocio: { respuesta: true, resolucion_de_caso: true, aviso_del_nucleo: false },
  fuera_de_ventana: { respuesta: true, resolucion_de_caso: true, aviso_del_nucleo: true },
  una_respuesta_por_mensaje: { respuesta: true, resolucion_de_caso: false, aviso_del_nucleo: true },
} as const satisfies { readonly [M in MotivoDeSilencio]: { readonly [C in ClaseDeMensaje]: boolean } }

export const VENTANA_MS = 24 * 60 * 60 * 1000

/** Cada regla dice solo si frena: su motivo es su clave, así una regla no frena con el motivo de otra. */
export const REGLAS_DE_LA_COMPUERTA = {
  emergencia: (_i, h) => h.emergenciaGlobal || h.negocio?.emergencia === true,
  negocio_en_sombra: (_i, h) => h.negocio?.modo === 'en_sombra',
  numero_no_permitido: (_i, h) => !h.numeroPermitido,
  destinatario_de_otro_negocio: (i, h) => i.destinatario.tipo === 'cliente' && h.cliente?.negocio !== i.destinatario.negocio,
  fuera_de_ventana: (_i, h) => h.ultimoEntrante === null || Date.parse(h.ahora) - Date.parse(h.ultimoEntrante) > VENTANA_MS,
  una_respuesta_por_mensaje: (_i, h) => h.respuestasAlMismoMensaje > 0,
} as const satisfies { readonly [M in MotivoDeSilencio]: (i: DatosDeIntencion, h: HechosDeEnvio) => boolean }

export function decidir(i: IntencionDeEnvio | IntencionEnsayada, h: HechosDeEnvio): Veredicto {
  for (const motivo of ORDEN_DE_LA_COMPUERTA) {
    if (APLICA_A[motivo][i.clase] && REGLAS_DE_LA_COMPUERTA[motivo](i, h)) return { tipo: 'no_sale', motivo }
  }
  return { tipo: 'sale' }
}

export type ModoDeLaCompuerta = 'observa' | 'hace_cumplir'

/** Hacer cumplir es cambiar esta línea. Las pruebas la leen, así que siguen verdes en los dos modos. */
export const MODO_DE_LA_COMPUERTA = 'observa' as ModoDeLaCompuerta

/** Al observar, todo `no_sale` sale igual y su veredicto queda en `mensajes_salientes`. */
export function seCumple(v: Veredicto, modo: ModoDeLaCompuerta): boolean {
  return v.tipo === 'no_sale' && modo === 'hace_cumplir'
}

type Es<A extends true> = A

export type _AvisoSinNegocioCabe = Es<null extends Extract<Destinatario, { tipo: 'telefono' }>['negocio'] ? true : false>
export type _RespuestaAUnCliente = Es<Extract<DatosDeIntencion, { clase: 'respuesta' }>['destinatario'] extends AlCliente ? true : false>
export type _SombraFrenaTodo = Es<(typeof APLICA_A)['negocio_en_sombra'] extends { readonly [C in ClaseDeMensaje]: true } ? true : false>
export type _EnsayoNoSeDespacha = Es<IntencionEnsayada extends IntencionDeEnvio ? false : true>
/** Si `ClaseDeMensaje` gana un `iniciado_*`, no compila hasta que la Ley 2300 y el cupo estén en `ORDEN_DE_LA_COMPUERTA`. */
type ReglasParaIniciar =
  | 'baja'
  | 'sin_consentimiento_publicitario'
  | 'ley_horario_publicitario'
  | 'ley_frecuencia_publicitaria'
  | 'plantilla_no_aprobada'
  | 'tope_del_numero'
  | 'cuota_del_negocio'
export type _Ley2300ConElPrimerIniciado = Es<
  [Extract<ClaseDeMensaje, `iniciado_${string}`>] extends [never] ? true : [ReglasParaIniciar] extends [MotivoDeSilencio] ? true : false
>
