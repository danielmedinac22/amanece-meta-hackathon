import type { MotivoDeSilencio } from './salida/compuerta'

export type EnvioDeRespuesta =
  | { readonly tipo: 'salio' }
  | { readonly tipo: 'no_salio'; readonly motivo: MotivoDeSilencio }
  | { readonly tipo: 'no_la_tomo' }
  | { readonly tipo: 'sin_saber' }

export const SIN_SABER = { tipo: 'sin_saber' } as const satisfies EnvioDeRespuesta

export const MOTIVO_EN_PALABRAS = {
  no_le_toca: 'la conversación ya no está en tus manos.',
  emergencia: 'los envíos están detenidos por una emergencia.',
  negocio_en_sombra: 'el Negocio está en sombra y no le habla a nadie.',
  numero_no_permitido: 'el número de Amanece no está listo para enviar.',
  destinatario_de_otro_negocio: 'ese Cliente no es de este Negocio.',
  fuera_de_ventana: 'pasaron más de 24 horas desde su último mensaje y WhatsApp no deja escribirle hasta que vuelva a escribir.',
  una_respuesta_por_mensaje: 'ya se le había respondido ese mensaje.',
} as const satisfies Record<MotivoDeSilencio, string>

/** `sin_saber` nunca le gana a lo que ya se sabe: el sondeo y el clic pueden llegar en cualquier orden. */
export function loQueSeSabe(...envios: readonly (EnvioDeRespuesta | null)[]): EnvioDeRespuesta | null {
  return envios.find((e) => e && e.tipo !== 'sin_saber') ?? envios.find(Boolean) ?? null
}

export const comoPropuesta = (respuesta: string) => `Responderle: "${respuesta}"`

type NoSalio = Exclude<EnvioDeRespuesta, { tipo: 'salio' }>

export function porQueNoSalio(e: NoSalio): string {
  switch (e.tipo) {
    case 'no_salio':
      return `no salió: ${MOTIVO_EN_PALABRAS[e.motivo]}`
    case 'no_la_tomo':
      return 'WhatsApp no la tomó. Escríbele tú directamente.'
    case 'sin_saber':
      return 'todavía no sé si le llegó. Si no cambia en un momento, escríbele tú.'
  }
}

export function noSalioEnPalabras(e: NoSalio): string {
  const texto = porQueNoSalio(e)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const comoSigueLaFrase = (nombre: string) => (/^\p{Lu}\p{Lu}/u.test(nombre) ? nombre : nombre.charAt(0).toLowerCase() + nombre.slice(1)).replace(/[.\s]+$/, '')

export function porTuRegla(reglas: readonly string[]): string | null {
  const nombres = reglas.map((r) => comoSigueLaFrase(r.trim())).filter(Boolean)
  if (!nombres.length) return null
  const lista = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' }).format(nombres)
  return `${nombres.length === 1 ? 'Por tu regla' : 'Por tus reglas'}: ${lista}.`
}

/** Lo que lee el Agente del dueño: las palabras y no el código, para que no tenga que adivinar qué significa. */
export const envioParaElModelo = (e: EnvioDeRespuesta) => (e.tipo === 'salio' ? 'WhatsApp la tomó' : porQueNoSalio(e))
