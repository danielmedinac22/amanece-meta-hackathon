'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { Operacion } from '@/app/panel/operacion'

type Props = Omit<ComponentProps<typeof Operacion>, 'ruta' | 'alIr' | 'children'> & { paginas: Record<string, ReactNode>; rutaInicial?: string }

/** La cáscara de la vitrina: las Secciones se recorren sin navegar, porque `/panel` pide sesión. */
export function MarcoDeMuestra({ paginas, rutaInicial = '/panel', ...props }: Props) {
  const [ruta, setRuta] = useState(rutaInicial)
  return (
    <Operacion {...props} ruta={ruta} alIr={setRuta}>
      {paginas[ruta]}
    </Operacion>
  )
}
