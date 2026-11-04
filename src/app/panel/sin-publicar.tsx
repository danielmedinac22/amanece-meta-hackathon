'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { SeccionPintada } from '@/nucleo/panel'

/** Lo que está en la vista previa y no ha llegado al link. Lo pone la cáscara, que ya lo tiene para el botón. */
export const SinPublicar = createContext<{ claves: ReadonlySet<string>; indicadores: readonly SeccionPintada[] }>({ claves: new Set(), indicadores: [] })

/** El recuadro de lo que pinta el lienzo: punteado mientras no se publica. */
export function BordeDeCambio({ clave, className, quieto, nuevo, children }: { clave: string; className?: string; quieto?: string; nuevo?: string; children: ReactNode }) {
  const sinPublicar = useContext(SinPublicar).claves.has(clave)
  return <div className={cn('transition-colors duration-300 motion-reduce:transition-none', className, sinPublicar ? cn('border border-dashed border-ojo', nuevo) : quieto)}>{children}</div>
}
