import type { Icon } from '@phosphor-icons/react'
import { ChartLine, ChatsCircle, House, Package, Tray, UsersThree } from '@phosphor-icons/react/ssr'

/** Lo que el sidebar cuenta. Un número solo donde algo espera decisión. */
export type Cuentas = { casosAbiertos: number }

/** `trae` completa `No pude traer…` cuando la Sección no carga. */
export type SeccionFija = { ruta: string; nombre: string; icono: Icon; trae: string; cuenta?: (c: Cuentas) => number }

/** Agregar una Sección al sidebar es agregar una fila aquí y su `page.tsx` bajo esa ruta. */
export const SECCIONES: readonly SeccionFija[] = [
  { ruta: '/panel', nombre: 'Inicio', icono: House, trae: 'lo de hoy' },
  { ruta: '/panel/casos', nombre: 'Casos', icono: Tray, trae: 'tus Casos', cuenta: (c) => c.casosAbiertos },
  { ruta: '/panel/conversaciones', nombre: 'Conversaciones', icono: ChatsCircle, trae: 'tus conversaciones' },
  { ruta: '/panel/pedidos', nombre: 'Pedidos', icono: Package, trae: 'tus pedidos' },
  { ruta: '/panel/clientes', nombre: 'Clientes', icono: UsersThree, trae: 'tus Clientes' },
  { ruta: '/panel/tablero', nombre: 'Tablero', icono: ChartLine, trae: 'tu Tablero' },
]

export type SeccionPropia = { clave: string; nombre: string }

export const RUTA_DE_AJUSTES = '/panel/ajustes'

export const rutaDePropia = (clave: string) => `/panel/secciones/${encodeURIComponent(clave)}`

export function nombreDeLaRuta(ruta: string, propias: readonly SeccionPropia[]): string {
  if (ruta === RUTA_DE_AJUSTES) return 'Ajustes del negocio'
  return SECCIONES.find((s) => s.ruta === ruta)?.nombre ?? propias.find((p) => rutaDePropia(p.clave) === ruta)?.nombre ?? 'Tu negocio'
}

export function loQueTrae(ruta: string): string {
  if (ruta === RUTA_DE_AJUSTES) return 'los ajustes de tu negocio'
  return SECCIONES.find((s) => s.ruta === ruta)?.trae ?? 'esta Sección'
}
