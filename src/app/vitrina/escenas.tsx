import type { ReactNode } from 'react'
import { Hilo } from '@/app/panel/hilo'
import { MarcoDelPanel, SinNegocio, VistaDelNegocio, type DatosDelNegocio } from '@/app/panel/vista'
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { Componentes } from './componentes'
import { HILO_ARMANDOSE, HILO_CON_UN_CASO, NEGOCIO_ARMANDOSE, NEGOCIO_CON_CAMBIOS, NEGOCIO_CON_UN_CASO, NEGOCIO_FUNCIONANDO, TARJETAS_CON_UN_CASO } from './datos'

type Escena = { id: string; titulo: string; pinta: () => ReactNode }

function panel(datos: DatosDelNegocio | null, estado: 'armando' | 'listo' | null, mensajes: UIMessage[] = [], tarjetas: Record<string, EstadoDeTarjeta> = {}) {
  return (
    <MarcoDelPanel nombreDelNegocio={datos?.nombre ?? null} equipo={false} hilo={<Hilo inicial={mensajes} tarjetas={tarjetas} estado={estado} />}>
      {datos ? <VistaDelNegocio datos={datos} /> : <SinNegocio />}
    </MarcoDelPanel>
  )
}

/** Agregar una pantalla a la vitrina es agregar una fila aquí. */
export const ESCENAS: readonly Escena[] = [
  { id: 'panel-vacio', titulo: 'Panel sin Negocio todavía', pinta: () => panel(null, null) },
  { id: 'panel-armandose', titulo: 'Panel de un Negocio armándose', pinta: () => panel(NEGOCIO_ARMANDOSE, 'armando', HILO_ARMANDOSE) },
  { id: 'panel-funcionando', titulo: 'Panel de un Negocio funcionando', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo') },
  { id: 'panel-un-caso', titulo: 'Panel con un Caso esperando al Dueño', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO) },
  { id: 'panel-con-cambios', titulo: 'Panel con cambios sin publicar', pinta: () => panel(NEGOCIO_CON_CAMBIOS, 'listo') },
  { id: 'componentes', titulo: 'Todos los componentes y colores', pinta: () => <Componentes /> },
]
