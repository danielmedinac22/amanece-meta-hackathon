'use client'

import { useEffect, useState } from 'react'
import { VistaDelHilo, type DatosDelHilo } from '@/app/panel/hilo-vista'
import type { TocarTarjeta } from '@/app/panel/tocar-tarjeta'

const nada = () => {}

/** El Hilo de la vitrina: pinta la conversación inventada y sus sugerencias, botones y envíos no llegan a ninguna ruta. Un botón responde y deja el estado como lo haría la ruta si todo sale bien. */
export function HiloDeMuestra({ status = 'ready', estados: inicial, ...datos }: Pick<DatosDelHilo, 'messages' | 'estados' | 'estado'> & { status?: DatosDelHilo['status'] }) {
  const [estados, setEstados] = useState(inicial)
  const tocar: TocarTarjeta = async (tarjeta, accion) => {
    const estado = accion === 'aprobar' ? 'aplicada' : accion === 'descartar' ? 'descartada' : 'revertida'
    setEstados((e) => (e[tarjeta.propuesta] ? { ...e, [tarjeta.propuesta]: { ...e[tarjeta.propuesta], estado } } : e))
    return accion === 'aprobar' ? { tipo: 'aplicado', resumen: '', envio: null, version: null } : accion === 'descartar' ? { tipo: 'descartada' } : { tipo: 'deshecho', resumen: '' }
  }
  return <VistaDelHilo {...datos} estados={estados} status={status} error={undefined} alEnviar={nada} alTocar={tocar} alCambiar={nada} />
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
