'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useRef, type ComponentProps, type MouseEvent } from 'react'

/** Lo que el lienzo avisa a la cáscara al ir a una Sección: lleva a `Tu negocio` en teléfono, y en la vitrina reemplaza la navegación. */
export const AlIrASeccion = createContext<(evento: MouseEvent, destino: string) => void>(() => {})

export function IrASeccion({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const alIr = useContext(AlIrASeccion)
  return <Link href={href} onClick={(e) => alIr(e, href)} {...props} />
}

/** Dentro de la fila elegida: al abrir, la lista de al lado la deja a la vista aunque esté más abajo. */
export function ALaVista() {
  const marca = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    marca.current?.closest('li, tr')?.scrollIntoView({ block: 'nearest' })
  }, [])
  return <span ref={marca} hidden />
}
