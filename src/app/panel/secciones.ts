import type { Icon } from '@phosphor-icons/react'
import { ChartLine, ChatsCircle, House, Package, Tray, UsersThree } from '@phosphor-icons/react/ssr'

/** Lo que el sidebar cuenta. Un número solo donde algo espera decisión. */
export type Cuentas = { casosAbiertos: number }

export type SeccionFija = { ruta: string; nombre: string; icono: Icon; cuenta?: (c: Cuentas) => number }

/** Agregar una Sección al sidebar es agregar una fila aquí y su `page.tsx` bajo esa ruta. */
export const SECCIONES: readonly SeccionFija[] = [
  { ruta: '/panel', nombre: 'Inicio', icono: House },
  { ruta: '/panel/casos', nombre: 'Casos', icono: Tray, cuenta: (c) => c.casosAbiertos },
  { ruta: '/panel/conversaciones', nombre: 'Conversaciones', icono: ChatsCircle },
  { ruta: '/panel/pedidos', nombre: 'Pedidos', icono: Package },
  { ruta: '/panel/clientes', nombre: 'Clientes', icono: UsersThree },
  { ruta: '/panel/tablero', nombre: 'Tablero', icono: ChartLine },
]

export type SeccionPropia = { clave: string; nombre: string }

export const rutaDePropia = (clave: string) => `/panel/secciones/${encodeURIComponent(clave)}`

export function nombreDeLaRuta(ruta: string, propias: readonly SeccionPropia[]): string {
  return SECCIONES.find((s) => s.ruta === ruta)?.nombre ?? propias.find((p) => rutaDePropia(p.clave) === ruta)?.nombre ?? 'Tu negocio'
}
