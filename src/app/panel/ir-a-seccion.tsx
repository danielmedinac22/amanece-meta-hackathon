'use client'

import Link from 'next/link'
import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react'

/** Lo que el lienzo avisa a la cáscara al ir a una Sección: lleva a `Tu negocio` en teléfono, y en la vitrina reemplaza la navegación. */
export const AlIrASeccion = createContext<(evento: MouseEvent, destino: string) => void>(() => {})

export function IrASeccion({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const alIr = useContext(AlIrASeccion)
  return <Link href={href} onClick={(e) => alIr(e, href)} {...props} />
}
