'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { ItemDeSalir, Operacion } from '@/app/panel/operacion'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { DecisionesDeMuestra, useDecisiones, type GuionDePublicar } from './hilo-de-muestra'

type Props = Omit<ComponentProps<typeof Operacion>, 'ruta' | 'alIr' | 'children' | 'publicador' | 'salir'> & { paginas: Record<string, ReactNode>; rutaInicial?: string; tarjetas?: Record<string, EstadoDeTarjeta>; guion?: GuionDePublicar }

function OperacionDeMuestra({ paginas, rutaInicial, datos, ...props }: Omit<Props, 'tarjetas' | 'guion'> & { rutaInicial: string }) {
  const [ruta, setRuta] = useState(rutaInicial)
  const { items, propias, publicador } = useDecisiones()
  const { negocio } = datos
  const conLoQuePaso = negocio ? { ...datos, negocio: { ...negocio, propias: [...negocio.propias, ...propias], publicar: negocio.publicar && { ...negocio.publicar, items } } } : datos
  return (
    // La ruta de verdad es `usePathname`, sin la consulta: `paginas` sí la distingue porque así se elige una conversación.
    <Operacion {...props} datos={conLoQuePaso} ruta={ruta.split('?')[0]} alIr={setRuta} publicador={publicador} salir={<ItemDeSalir alTocar={() => setRuta('/panel')} />}>
      {paginas[ruta]}
    </Operacion>
  )
}

/** La cáscara de la vitrina: las Secciones se recorren sin navegar, porque `/panel` pide sesión. */
export function MarcoDeMuestra({ rutaInicial = '/panel', tarjetas = {}, guion, ...props }: Props) {
  return (
    <DecisionesDeMuestra inicial={tarjetas} pendientes={props.datos.negocio?.publicar?.items} guion={guion}>
      <OperacionDeMuestra {...props} rutaInicial={rutaInicial} />
    </DecisionesDeMuestra>
  )
}
