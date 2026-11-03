'use client'

import type { UIMessage } from 'ai'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { VistaDeCasos } from '@/app/panel/casos'
import { VistaDelHilo, type DatosDelHilo } from '@/app/panel/hilo-vista'
import type { SeccionPropia } from '@/app/panel/secciones'
import type { Publicador, RespuestaDePublicar } from '@/app/panel/tocar-publicar'
import type { RespuestaDeTarjeta, TocarTarjeta } from '@/app/panel/tocar-tarjeta'
import type { DatosDeCasos } from '@/negocio/casos'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { ItemDeLoPendiente } from '@/nucleo/cambios'

const nada = () => {}
const QUIEN_PUBLICA = 'Lucía'
const CUANTO_TARDA_PUBLICAR = 900

/** Cómo se porta Publicar en una escena. */
export type GuionDePublicar = {
  /** Lo que cada tarjeta deja sin publicar al aprobarla y quita al deshacerla. */
  cambios?: Record<string, ItemDeLoPendiente>
  /** Lo que responde Publicar, en orden, antes de salir bien. */
  respuestas?: readonly RespuestaDePublicar[]
  /** Lo que llega solo un rato después de abrir, como con el sondeo: la Sección entra al sidebar. */
  llega?: { mensaje: UIMessage; seccion: SeccionPropia; item: ItemDeLoPendiente; estado: Record<string, EstadoDeTarjeta> }
  /** Lo que responde la ruta al aprobar esa tarjeta, en vez de salir bien, y cómo queda guardada. */
  alAprobar?: Record<string, { respuesta: RespuestaDeTarjeta; queda?: EstadoDeTarjeta['estado'] }>
}

const aviso = (id: string, text: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] })

type Decisiones = { estados: Record<string, EstadoDeTarjeta>; tocar: TocarTarjeta; items: readonly ItemDeLoPendiente[]; propias: readonly SeccionPropia[]; avisos: readonly UIMessage[]; publicador: Publicador }
const LasDecisiones = createContext<Decisiones>({ estados: {}, tocar: async () => ({ tipo: 'descartada' }), items: [], propias: [], avisos: [], publicador: async () => ({ tipo: 'ya_estaba' }) })

export const useDecisiones = () => useContext(LasDecisiones)

/** Lo que en la app de verdad guarda la base: la misma tarjeta se decide desde el Hilo o desde Casos. Un botón responde y deja el estado como lo haría la ruta si todo sale bien. */
export function DecisionesDeMuestra({ inicial, pendientes = [], guion = {}, children }: { inicial: Record<string, EstadoDeTarjeta>; pendientes?: readonly ItemDeLoPendiente[]; guion?: GuionDePublicar; children: ReactNode }) {
  const [estados, setEstados] = useState(inicial)
  const [items, setItems] = useState(pendientes)
  const [propias, setPropias] = useState<readonly SeccionPropia[]>([])
  const [avisos, setAvisos] = useState<readonly UIMessage[]>([])
  const [respuestas, setRespuestas] = useState(guion.respuestas ?? [])
  const avisar = (texto: string) => setAvisos((a) => [...a, aviso(`aviso-${a.length}`, texto)])

  const { llega } = guion
  useEffect(() => {
    if (!llega) return
    const espera = setTimeout(() => {
      setItems((i) => [...i, llega.item])
      setPropias([llega.seccion])
      setEstados((e) => ({ ...e, ...llega.estado }))
      setAvisos((a) => [...a, llega.mensaje])
    }, 2500)
    return () => clearTimeout(espera)
  }, [llega])

  const publicador: Publicador = async () => {
    await new Promise((r) => setTimeout(r, CUANTO_TARDA_PUBLICAR))
    const [respuesta, ...siguen] = respuestas
    if (respuesta) {
      setRespuestas(siguen)
      if (respuesta.tipo === 'cambio') setItems(respuesta.pendiente.items)
      return respuesta
    }
    const lineas = [...items].sort((a, b) => Number(a.loNotan === 'equipo') - Number(b.loNotan === 'equipo')).map((i) => i.linea)
    setItems([])
    setEstados((e) => Object.fromEntries(Object.entries(e).map(([id, t]) => [id, t.estado === 'aplicada' && t.asunto?.tipo === 'elemento' ? { ...t, publicada: true } : t])))
    avisar(`${QUIEN_PUBLICA} publicó: ${lineas.join('; ')}`)
    return { tipo: 'publicado', resumen: '' }
  }

  const tocar: TocarTarjeta = async (tarjeta, accion) => {
    const guionada = accion === 'aprobar' ? guion.alAprobar?.[tarjeta.propuesta] : undefined
    if (guionada) {
      const { respuesta, queda } = guionada
      if (queda) setEstados((e) => ({ ...e, [tarjeta.propuesta]: { ...e[tarjeta.propuesta], estado: queda } }))
      return respuesta
    }
    const estado = accion === 'aprobar' ? 'aplicada' : accion === 'descartar' ? 'descartada' : 'revertida'
    setEstados((e) => (e[tarjeta.propuesta] ? { ...e, [tarjeta.propuesta]: { ...e[tarjeta.propuesta], estado } } : e))
    const cambio = guion.cambios?.[tarjeta.propuesta]
    if (cambio && accion === 'aprobar') {
      setItems((i) => [...i, cambio])
      avisar(`${QUIEN_PUBLICA} aplicó: ${cambio.linea}. Queda en la vista previa hasta que alguien toque Publicar`)
    }
    if (cambio && accion === 'deshacer') {
      setItems((i) => i.filter((x) => x.clave !== cambio.clave))
      avisar(`${QUIEN_PUBLICA} revirtió: ${cambio.linea}. Solo sale de la vista previa`)
    }
    return accion === 'aprobar' ? { tipo: 'aplicado', resumen: '', envio: null, version: null } : accion === 'descartar' ? { tipo: 'descartada' } : { tipo: 'deshecho', resumen: '' }
  }
  return <LasDecisiones.Provider value={{ estados, tocar, items, propias, avisos, publicador }}>{children}</LasDecisiones.Provider>
}

/** El Hilo de la vitrina: pinta la conversación inventada y sus sugerencias, botones y envíos no llegan a ninguna ruta. */
export function HiloDeMuestra({ status = 'ready', seCorto, messages, ...datos }: Pick<DatosDelHilo, 'messages' | 'estado'> & { status?: DatosDelHilo['status']; seCorto?: boolean }) {
  const { estados, tocar, avisos } = useContext(LasDecisiones)
  return <VistaDelHilo {...datos} messages={[...messages, ...avisos]} estados={estados} status={status} error={seCorto ? new Error('Se cortó') : undefined} alEnviar={nada} alTocar={tocar} alCambiar={nada} />
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
