'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { VistaDeCasos } from '@/app/panel/casos'
import { VistaDelHilo, type DatosDelHilo } from '@/app/panel/hilo-vista'
import type { TocarTarjeta } from '@/app/panel/tocar-tarjeta'
import type { DatosDeCasos } from '@/negocio/casos'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'

const nada = () => {}

type Decisiones = { estados: Record<string, EstadoDeTarjeta>; tocar: TocarTarjeta }
const LasDecisiones = createContext<Decisiones>({ estados: {}, tocar: async () => ({ tipo: 'descartada' }) })

/** Lo que en la app de verdad guarda la base: la misma tarjeta se decide desde el Hilo o desde Casos. Un botón responde y deja el estado como lo haría la ruta si todo sale bien. */
export function DecisionesDeMuestra({ inicial, children }: { inicial: Record<string, EstadoDeTarjeta>; children: ReactNode }) {
  const [estados, setEstados] = useState(inicial)
  const tocar: TocarTarjeta = async (tarjeta, accion) => {
    const estado = accion === 'aprobar' ? 'aplicada' : accion === 'descartar' ? 'descartada' : 'revertida'
    setEstados((e) => (e[tarjeta.propuesta] ? { ...e, [tarjeta.propuesta]: { ...e[tarjeta.propuesta], estado } } : e))
    return accion === 'aprobar' ? { tipo: 'aplicado', resumen: '', envio: null, version: null } : accion === 'descartar' ? { tipo: 'descartada' } : { tipo: 'deshecho', resumen: '' }
  }
  return <LasDecisiones.Provider value={{ estados, tocar }}>{children}</LasDecisiones.Provider>
}

/** El Hilo de la vitrina: pinta la conversación inventada y sus sugerencias, botones y envíos no llegan a ninguna ruta. */
export function HiloDeMuestra({ status = 'ready', ...datos }: Pick<DatosDelHilo, 'messages' | 'estado'> & { status?: DatosDelHilo['status'] }) {
  const { estados, tocar } = useContext(LasDecisiones)
  return <VistaDelHilo {...datos} estados={estados} status={status} error={undefined} alEnviar={nada} alTocar={tocar} alCambiar={nada} />
}

/** Casos con lo que la base diría después de un clic: enviar lo pasa a Resueltos, y descartarlo lo deja esperando. */
export function CasosDeMuestra(datos: DatosDeCasos) {
  const { estados, tocar } = useContext(LasDecisiones)
  const conEstado = datos.esperan.map((c) => (c.decision ? { ...c, decision: { ...c.decision, estado: estados[c.decision.tarjeta.propuesta] ?? c.decision.estado } } : c))
  const enviados = conEstado.filter((c) => c.decision?.estado.estado === 'aplicada')
  const esperan = conEstado.filter((c) => !enviados.includes(c))
  const resueltos = enviados.map((c) => ({ id: c.id, titulo: c.titulo, resolucion: c.decision?.estado.asunto?.tipo === 'caso' ? c.decision.estado.asunto.respuesta : '', hace: 'ahora', noSalio: false }))
  return <VistaDeCasos {...datos} cuentaQueEspera={datos.cuentaQueEspera - enviados.length} esperan={esperan} resueltos={[...resueltos, ...datos.resueltos]} alTocar={tocar} alCambiar={nada} />
}

/** Como el sondeo del Hilo de verdad: un rato después de abrir, llega un mensaje con una decisión. */
export function HiloQueRecibeUnaDecision({ messages, llega, ...datos }: Pick<DatosDelHilo, 'messages' | 'estado'> & { llega: DatosDelHilo['messages'][number] }) {
  const [llegada, setLlegada] = useState(false)
  useEffect(() => {
    const espera = setTimeout(() => setLlegada(true), 2500)
    return () => clearTimeout(espera)
  }, [])
  return <HiloDeMuestra {...datos} messages={llegada ? [...messages, llega] : messages} />
}
