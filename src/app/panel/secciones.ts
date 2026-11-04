import type { Icon } from '@phosphor-icons/react'
import { CalendarBlank, ChartLine, ChatsCircle, House, Package, Tray, UsersThree } from '@phosphor-icons/react/ssr'
import type { Voz } from '@/nucleo/hoy-palabras'

/** Lo que el sidebar cuenta. Un número solo donde algo espera decisión. */
export type Cuentas = { casosAbiertos: number }

/** `trae` completa `No pude traer…` cuando la Sección no carga; `traeUna`, cuando no carga el detalle de una de sus filas. */
export type SeccionFija = { ruta: string; nombre: string; icono: Icon; trae: string; traeUna?: string; cuenta?: (c: Cuentas) => number; soloEn?: Voz }

/** Agregar una Sección al sidebar es agregar una fila aquí y su `page.tsx` bajo esa ruta. */
export const SECCIONES: readonly SeccionFija[] = [
  { ruta: '/panel', nombre: 'Inicio', icono: House, trae: 'lo de hoy' },
  { ruta: '/panel/casos', nombre: 'Casos', icono: Tray, trae: 'tus Casos', cuenta: (c) => c.casosAbiertos },
  { ruta: '/panel/agenda', nombre: 'Agenda', icono: CalendarBlank, trae: 'tu agenda', soloEn: 'agenda' },
  { ruta: '/panel/conversaciones', nombre: 'Conversaciones', icono: ChatsCircle, trae: 'tus conversaciones' },
  { ruta: '/panel/pedidos', nombre: 'Pedidos', icono: Package, trae: 'tus pedidos', traeUna: 'este pedido' },
  { ruta: '/panel/clientes', nombre: 'Clientes', icono: UsersThree, trae: 'tus Clientes', traeUna: 'este Cliente' },
  { ruta: '/panel/tablero', nombre: 'Tablero', icono: ChartLine, trae: 'tu Tablero' },
]

export const seccionesDe = (voz: Voz) => SECCIONES.filter((s) => !s.soloEn || s.soloEn === voz)

export type SeccionPropia = { clave: string; nombre: string }

export const RUTA_DE_AJUSTES = '/panel/ajustes'

export const rutaDePropia = (clave: string) => `/panel/secciones/${encodeURIComponent(clave)}`

/** El detalle de una fila sigue siendo su Sección: el sidebar la marca y el encabezado la nombra. */
export const esDeLaSeccion = (ruta: string, s: SeccionFija) => ruta === s.ruta || (s.traeUna !== undefined && ruta.startsWith(`${s.ruta}/`))

export function nombreDeLaRuta(ruta: string, propias: readonly SeccionPropia[]): string {
  if (ruta === RUTA_DE_AJUSTES) return 'Ajustes del negocio'
  return SECCIONES.find((s) => esDeLaSeccion(ruta, s))?.nombre ?? propias.find((p) => rutaDePropia(p.clave) === ruta)?.nombre ?? 'Tu negocio'
}

export function loQueTrae(ruta: string): string {
  if (ruta === RUTA_DE_AJUSTES) return 'los ajustes de tu negocio'
  const seccion = SECCIONES.find((s) => esDeLaSeccion(ruta, s))
  return (ruta === seccion?.ruta ? seccion.trae : seccion?.traeUna) ?? 'esta Sección'
}
