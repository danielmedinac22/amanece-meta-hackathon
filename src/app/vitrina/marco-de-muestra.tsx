'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { Operacion } from '@/app/panel/operacion'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { DecisionesDeMuestra } from './hilo-de-muestra'

type Props = Omit<ComponentProps<typeof Operacion>, 'ruta' | 'alIr' | 'children'> & { paginas: Record<string, ReactNode>; rutaInicial?: string; tarjetas?: Record<string, EstadoDeTarjeta> }

/** La cáscara de la vitrina: las Secciones se recorren sin navegar, porque `/panel` pide sesión. */
export function MarcoDeMuestra({ paginas, rutaInicial = '/panel', tarjetas = {}, ...props }: Props) {
  const [ruta, setRuta] = useState(rutaInicial)
  return (
    <DecisionesDeMuestra inicial={tarjetas}>
      {/* La ruta de verdad es `usePathname`, sin la consulta: `paginas` sí la distingue porque así se elige una conversación. */}
      <Operacion {...props} ruta={ruta.split('?')[0]} alIr={setRuta}>
        {paginas[ruta]}
      </Operacion>
    </DecisionesDeMuestra>
  )
}
