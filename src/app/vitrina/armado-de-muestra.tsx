'use client'

import type { ChatStatus, UIMessage } from 'ai'
import { useState, type ReactNode } from 'react'
import { useRecogerLoEscrito } from '@/app/lo-escrito'
import { VistaDelArmado } from '@/app/panel/armado'
import type { TocarTarjeta } from '@/app/panel/tocar-tarjeta'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { DatosDelArmado } from '@/nucleo/armado'
import { lineaDePlantilla } from './datos-armado'

const nada = () => {}

type Props = {
  datos: DatosDelArmado
  messages: UIMessage[]
  tarjetas?: Record<string, EstadoDeTarjeta>
  status?: ChatStatus
  /** Lo que el servidor leería después de que el Dueño escriba o toque la tarjeta. */
  siguiente?: DatosDelArmado
  /** Lo que el Dueño ve al abrir. */
  despues?: ReactNode
}

/** La carta de la vitrina: lo que en la app de verdad vuelve a leer el servidor aquí es un dato fijo, y nada llega a una ruta. */
export function ArmadoDeMuestra({ datos, messages, tarjetas = {}, status = 'ready', siguiente, despues }: Props) {
  const [ahora, setAhora] = useState({ datos, messages, estados: tarjetas })
  const [salio, setSalio] = useState(false)
  const alEnviar = (t: string) => setAhora((a) => ({ ...a, datos: siguiente ?? a.datos, messages: [...a.messages, { id: `m-${a.messages.length}`, role: 'user', parts: [{ type: 'text', text: t }] }] }))
  useRecogerLoEscrito(true, ({ texto, plantilla }) => {
    if (plantilla) setAhora((a) => ({ ...a, messages: [...a.messages, lineaDePlantilla(plantilla)] }))
    alEnviar(texto)
  })
  if (salio) return despues
  const avanzar = () => setAhora((a) => ({ ...a, datos: siguiente ?? a.datos }))
  const alTocar: TocarTarjeta = async (tarjeta, accion) => {
    const estado = accion === 'aprobar' ? 'aplicada' : 'descartada'
    setAhora((a) => ({ ...a, estados: { ...a.estados, [tarjeta.propuesta]: { ...a.estados[tarjeta.propuesta], estado } } }))
    return accion === 'aprobar' ? { tipo: 'aplicado', resumen: '', envio: null, version: null } : { tipo: 'descartada' }
  }
  return <VistaDelArmado datos={ahora.datos} messages={ahora.messages} estados={ahora.estados} status={status} error={undefined} alEnviar={alEnviar} alTocar={alTocar} alCambiar={avanzar} alAbrir={async () => ({ abierto: true })} alSalir={despues ? () => setSalio(true) : nada} />
}
