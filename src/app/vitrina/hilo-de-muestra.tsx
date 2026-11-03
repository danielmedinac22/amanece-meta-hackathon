'use client'

import { VistaDelHilo, type DatosDelHilo } from '@/app/panel/hilo-vista'

const nada = () => {}

/** El Hilo de la vitrina: pinta la conversación inventada y sus sugerencias y botón de enviar no llegan a ninguna ruta. */
export function HiloDeMuestra(datos: Pick<DatosDelHilo, 'messages' | 'estados' | 'estado'>) {
  return <VistaDelHilo {...datos} status="ready" error={undefined} alEnviar={nada} alCambiar={nada} />
}
