import type { ComponentProps, ReactNode } from 'react'
import type { Operacion } from '@/app/panel/operacion'
import { FaltaEstaSeccion, SinNegocio, VistaDeCasos, VistaDelNegocio, VistaDelTablero, VistaDeUnaSeccion, type DatosDelNegocio } from '@/app/panel/vista'
import { rutaDePropia } from '@/app/panel/secciones'
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { Componentes } from './componentes'
import { HiloDeMuestra, HiloQueRecibeUnaDecision } from './hilo-de-muestra'
import { MarcoDeMuestra } from './marco-de-muestra'
import { HILO_ARMANDOSE, HILO_CON_UN_CASO, NEGOCIO_ARMANDOSE, NEGOCIO_CON_CAMBIOS, NEGOCIO_CON_UN_CASO, NEGOCIO_FUNCIONANDO, TARJETAS_CON_UN_CASO } from './datos'

type Escena = { id: string; titulo: string; pinta: () => ReactNode }
type Disposicion = Pick<ComponentProps<typeof Operacion>, 'sidebarAbierto' | 'cajonAbierto' | 'inicial'>

function operacionDe(datos: DatosDelNegocio | null) {
  if (!datos) return { dueno: 'Lucía', negocio: null }
  return {
    dueno: 'Lucía',
    negocio: {
      nombre: datos.nombre,
      ciudad: 'Manizales',
      casosAbiertos: datos.casos.length,
      propias: datos.secciones.map((s) => ({ clave: s.clave, nombre: s.nombre })),
      publicar: datos.link ? datos.pendiente : null,
    },
  }
}

function paginasDe(datos: DatosDelNegocio | null): Record<string, ReactNode> {
  const sin = <SinNegocio />
  return {
    '/panel': datos ? <VistaDelNegocio datos={datos} /> : sin,
    '/panel/casos': datos ? <VistaDeCasos casos={datos.casos} /> : sin,
    '/panel/tablero': datos ? <VistaDelTablero indicadores={datos.indicadores} /> : sin,
    '/panel/conversaciones': <FaltaEstaSeccion que="tus conversaciones" />,
    '/panel/pedidos': <FaltaEstaSeccion que="tus pedidos" />,
    '/panel/clientes': <FaltaEstaSeccion que="tus clientes" />,
    ...Object.fromEntries((datos?.secciones ?? []).map((p) => [rutaDePropia(p.clave), <VistaDeUnaSeccion key={p.clave} p={p} />])),
  }
}

function panel(datos: DatosDelNegocio | null, estado: 'armando' | 'listo' | null, mensajes: UIMessage[] = [], tarjetas: Record<string, EstadoDeTarjeta> = {}, disposicion: Disposicion = {}) {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={paginasDe(datos)} hilo={<HiloDeMuestra messages={mensajes} estados={tarjetas} estado={estado} />} {...disposicion} />
}

function llegaUnaDecision() {
  const antes = HILO_CON_UN_CASO.slice(0, -1)
  return <MarcoDeMuestra datos={operacionDe(NEGOCIO_CON_UN_CASO)} paginas={paginasDe(NEGOCIO_CON_UN_CASO)} inicial={{ lugar: 'caja' }} hilo={<HiloQueRecibeUnaDecision messages={antes} llega={HILO_CON_UN_CASO.at(-1)!} estados={TARJETAS_CON_UN_CASO} estado="listo" />} />
}

/** Agregar una pantalla a la vitrina es agregar una fila aquí. */
export const ESCENAS: readonly Escena[] = [
  { id: 'panel-vacio', titulo: 'Panel sin Negocio todavía', pinta: () => panel(null, null) },
  { id: 'panel-armandose', titulo: 'Panel de un Negocio armándose', pinta: () => panel(NEGOCIO_ARMANDOSE, 'armando', HILO_ARMANDOSE) },
  { id: 'panel-funcionando', titulo: 'Panel de un Negocio funcionando', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo') },
  { id: 'panel-un-caso', titulo: 'Panel con un Caso esperando al Dueño', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO) },
  { id: 'panel-con-cambios', titulo: 'Panel con cambios sin publicar', pinta: () => panel(NEGOCIO_CON_CAMBIOS, 'listo') },
  { id: 'operacion-sidebar-plegado', titulo: 'PC: el sidebar plegado a íconos', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { sidebarAbierto: false }) },
  { id: 'operacion-hilo-oculto', titulo: 'PC: el Hilo oculto, con la caja flotante', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo', HILO_ARMANDOSE, {}, { inicial: { lugar: 'caja' } }) },
  { id: 'operacion-conversacion-flotante', titulo: 'PC: la conversación abierta encima del lienzo', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { lugar: 'conversacion' } }) },
  { id: 'operacion-llega-decision', titulo: 'PC: llega una decisión y la conversación se abre sola', pinta: llegaUnaDecision },
  { id: 'telefono-tu-negocio', titulo: 'Teléfono: Tu negocio, con el punto en Tu agente', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { pestana: 'negocio' } }) },
  { id: 'telefono-cajon', titulo: 'Teléfono: el sidebar como cajón', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { cajonAbierto: true, inicial: { pestana: 'negocio' } }) },
  { id: 'componentes', titulo: 'Todos los componentes y colores', pinta: () => <Componentes /> },
]
