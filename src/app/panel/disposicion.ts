import { createContext, type ReactNode } from 'react'

/**
 * Dónde está el Hilo en PC: al lado (`fijo`), solo la caja flotante (`caja`) o la caja con la conversación encima
 * del lienzo (`conversacion`). En teléfono manda `pestana` y `lugar` no se aplica.
 */
export type Lugar = 'fijo' | 'caja' | 'conversacion'
export type Pestana = 'agente' | 'negocio'

export type Disposicion = {
  lugar: Lugar
  pestana: Pestana
  /** La tarjeta más reciente que espera al Dueño. */
  decision: string | null
  /** Ya hubo un gesto: desde aquí, lo que cambia de lugar entra con movimiento. */
  movido: boolean
}

export const DISPOSICION_INICIAL: Disposicion = { lugar: 'fijo', pestana: 'agente', decision: null, movido: false }

export type CambioDeDisposicion =
  | { tipo: 'ocultar' }
  | { tipo: 'fijar' }
  | { tipo: 'alternar_conversacion' }
  | { tipo: 'pestana'; pestana: Pestana }
  | { tipo: 'decision'; id: string | null }

export function disponer(d: Disposicion, cambio: CambioDeDisposicion): Disposicion {
  switch (cambio.tipo) {
    case 'ocultar':
      return { ...d, lugar: d.decision ? 'conversacion' : 'caja', movido: true }
    case 'fijar':
      return { ...d, lugar: 'fijo', movido: true }
    case 'alternar_conversacion':
      return { ...d, lugar: d.lugar === 'caja' ? 'conversacion' : 'caja', movido: true }
    case 'pestana':
      return d.pestana === cambio.pestana ? d : { ...d, pestana: cambio.pestana, movido: true }
    case 'decision':
      // Solo una decisión nueva abre la caja: si el Dueño plegó esta, se respeta hasta que llegue otra.
      if (d.decision === cambio.id) return d
      return cambio.id && d.lugar === 'caja' ? { ...d, decision: cambio.id, lugar: 'conversacion', movido: true } : { ...d, decision: cambio.id }
  }
}

/** Lo que el Hilo necesita de la cáscara. El Hilo vive en un solo lugar del árbol: moverlo perdería su `useChat`. */
export const HiloEnLaOperacion = createContext<{ vista: string; controles: ReactNode; avisarDecision: (id: string | null) => void; borrador: Borrador | null }>({
  vista: '',
  controles: null,
  avisarDecision: () => {},
  borrador: null,
})

/** Un objeto nuevo por cada pedido: tocar lo mismo dos veces vuelve a dejar el texto en el redactor. */
export type Borrador = { texto: string }

/** Lo que el lienzo le deja al Hilo: empieza un mensaje y el Dueño lo termina. */
export const EscribirleAlAgente = createContext<(texto: string) => void>(() => {})
