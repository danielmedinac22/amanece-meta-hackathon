import { pesos } from './estado/elementos'

/** De qué habla la frase de Inicio. Una voz nueva es una fila de `SEMANA` y otra de `MIENTRAS_NADIE_ESCRIBE`. */
export type Voz = 'tienda' | 'agenda'

export type Cifras = {
  semana: { ventas: number; pedidos: number; clientes: number }
  /** La semana pasada hasta este mismo momento: un martes no se compara contra una semana completa. */
  anterior: { ventas: number; pedidos: number }
  conversaciones: { total: number; resueltas: number }
}

export type Parte = string | { cifra: string }

const RUBROS_DE_AGENDA = /\b(?:agenda|citas?|spa|unas|medic[oa]s?)\b|\b(?:peluquer|barber|estetic|manicur|odontolog|dentist|consultorio|clinica|psicolog|fisioterap|veterinari|nutricion|masaj|tatuaj)/

/** `negocios.rubro` es texto libre. Lo que no se reconoce como agenda habla de ventas, porque `pedidos` es lo único que el Negocio registra con plata. */
export function vozDelRubro(rubro: string): Voz {
  const limpio = rubro
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  return RUBROS_DE_AGENDA.test(limpio) ? 'agenda' : 'tienda'
}

const cuantos = (n: number, cosa: string) => `${n} ${cosa}${n === 1 ? '' : 's'}`
const escribieron = (n: number) => (n === 1 ? 'escribió ' : 'escribieron ')

/** Con menos pedidos que esto la semana pasada, un porcentaje dice más del azar que del Negocio. */
export const MINIMO_PARA_COMPARAR = 3

/** `null` si no hay con qué comparar. */
export function cambioContraLaAnterior({ semana, anterior }: Pick<Cifras, 'semana' | 'anterior'>): string | null {
  if (anterior.pedidos < MINIMO_PARA_COMPARAR || anterior.ventas <= 0) return null
  const cambio = Math.round(((semana.ventas - anterior.ventas) / anterior.ventas) * 100)
  if (cambio === 0) return 'igual que la anterior'
  return `${Math.abs(cambio)}\u00a0% ${cambio > 0 ? 'más' : 'menos'} que la anterior`
}

function contraLaAnterior(cifras: Cifras): string {
  const cambio = cambioContraLaAnterior(cifras)
  return cambio ? `, ${cambio}.` : '.'
}

const SEMANA: Record<Voz, (c: Cifras) => Parte[]> = {
  tienda: (c) => (c.semana.pedidos ? ['Esta semana vendiste ', { cifra: pesos(c.semana.ventas) }, ' en ', { cifra: cuantos(c.semana.pedidos, 'pedido') }, contraLaAnterior(c)] : ['Esta semana todavía no tienes ventas.']),
  // Nada guarda una cita todavía: una agenda habla de quién le escribió. Cuando exista el dato, la frase cambia aquí.
  agenda: ({ semana: { clientes } }) => (clientes ? ['Esta semana te ', escribieron(clientes), { cifra: cuantos(clientes, 'cliente') }, '.'] : ['Esta semana todavía no te ha escrito nadie.']),
}

function hoy({ total, resueltas }: Cifras['conversaciones']): Parte[] {
  if (!total) return []
  if (!resueltas) return [' Hoy te ', escribieron(total), { cifra: cuantos(total, 'cliente') }, '.']
  if (total === 1) return [' Hoy tu agente resolvió ', { cifra: 'la única conversación' }, '.']
  return [' Hoy tu agente resolvió ', { cifra: `${resueltas} de ${total}` }, ' conversaciones.']
}

export const fraseDeHoy = (voz: Voz, cifras: Cifras): Parte[] => [...SEMANA[voz](cifras), ...hoy(cifras.conversaciones)]

export const MIENTRAS_NADIE_ESCRIBE: Record<Voz, string> = {
  tienda: 'Pon este link en tu Instagram o mándalo a tus clientes. Cuando te escriban, aquí vas a ver cada pedido.',
  agenda: 'Pon este link en tu Instagram o mándalo a tus clientes. Cuando te escriban, aquí vas a ver cada conversación.',
}

const LARGO_DE_LO_ESCRITO = 80

/** En una línea y sin partir una palabra ni un emoji. Una sola palabra más larga que el tope sí se corta, como un link. */
export function recorteDeLoEscrito(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  const grafemas = Array.from(new Intl.Segmenter('es').segment(limpio), (g) => g.segment)
  if (grafemas.length <= LARGO_DE_LO_ESCRITO) return limpio
  const corte = grafemas.slice(0, LARGO_DE_LO_ESCRITO).join('')
  return `${(grafemas[LARGO_DE_LO_ESCRITO] === ' ' ? corte : corte.replace(/\s\S*$/, '')).trimEnd()}…`
}

/** Lo dice tal cual lo escribió el Cliente. `preguntó` del prototipo no sale: un mensaje no siempre es una pregunta y saberlo pediría al modelo. */
export function loQueEscribio(quien: string, texto: string): string {
  const escrito = recorteDeLoEscrito(texto)
  return escrito ? `${quien} te escribió: «${escrito}»` : `${quien} te escribió`
}

const diaEn = (fecha: Date, zona: string) => Date.parse(fecha.toLocaleDateString('en-CA', { timeZone: zona })) / 86_400_000

export function haceCuanto(fecha: Date, ahora: Date, zona: string): string {
  const dias = diaEn(ahora, zona) - diaEn(fecha, zona)
  if (dias === 1) return 'ayer'
  if (dias > 1) return dias < 7 ? `hace ${dias} días` : fecha.toLocaleDateString('es-CO', { timeZone: zona, day: 'numeric', month: 'short' })
  const minutos = Math.floor((ahora.getTime() - fecha.getTime()) / 60_000)
  if (minutos < 1) return 'ahora'
  return minutos < 60 ? `hace ${minutos} min` : `hace ${Math.floor(minutos / 60)} h`
}
