'use client'

import { useEffect, useState } from 'react'
import { VistaDelHilo, type DatosDelHilo } from '@/app/panel/hilo-vista'

const nada = () => {}

/** El Hilo de la vitrina: pinta la conversación inventada y sus sugerencias y botón de enviar no llegan a ninguna ruta. */
export function HiloDeMuestra(datos: Pick<DatosDelHilo, 'messages' | 'estados' | 'estado'>) {
  return <VistaDelHilo {...datos} status="ready" error={undefined} alEnviar={nada} alCambiar={nada} />
}

/** Como el sondeo del Hilo de verdad: un rato después de abrir, llega un mensaje con una decisión. */
export function HiloQueRecibeUnaDecision({ messages, llega, ...datos }: Pick<DatosDelHilo, 'messages' | 'estados' | 'estado'> & { llega: DatosDelHilo['messages'][number] }) {
  const [llegada, setLlegada] = useState(false)
  useEffect(() => {
    const espera = setTimeout(() => setLlegada(true), 2500)
    return () => clearTimeout(espera)
  }, [])
  return <HiloDeMuestra {...datos} messages={llegada ? [...messages, llega] : messages} />
}
