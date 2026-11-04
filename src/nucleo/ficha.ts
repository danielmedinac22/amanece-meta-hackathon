import type { OrigenDeCliente } from '@/db/esquema'
import type { MensajeEntrante, Referido } from './entrada'

/** La ficha del link `wa.me`: `(CODIGO)` al inicio del texto, en mayúsculas o minúsculas. Nada más del texto enruta. */
export const FICHA_DE_ENRUTAMIENTO = /^\(([A-Za-z0-9]{3,12})\)/

/** Solo la de este Negocio: `(sin) azúcar` tiene la misma forma y lo escribió el Cliente. */
const traeSuFicha = (texto: string, codigo: string) => FICHA_DE_ENRUTAMIENTO.exec(texto)?.[1].toUpperCase() === codigo

export const sinSuFicha = (texto: string, codigo: string) => (traeSuFicha(texto, codigo) ? texto.replace(FICHA_DE_ENRUTAMIENTO, '') : texto)

const CON_SU_FICHA: Record<Referido, OrigenDeCliente> = { anuncio: 'anuncio', ninguno: 'link', otro: 'sin_dato' }

/** Todos los Negocios comparten un número: sin su ficha, ni un anuncio se le puede atribuir a este. */
export const origenAlNacer = (m: Pick<MensajeEntrante, 'texto' | 'referido'>, codigo: string): OrigenDeCliente => (traeSuFicha(m.texto, codigo) ? CON_SU_FICHA[m.referido] : 'sin_dato')
