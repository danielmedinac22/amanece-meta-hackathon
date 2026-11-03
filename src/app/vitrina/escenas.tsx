import type { ComponentProps, ReactNode } from 'react'
import { InicioHoy } from '@/app/panel/inicio-hoy'
import { ListaDePedidos, TablaDeClientes } from '@/app/panel/listas'
import { FaltaEstaSeccion, SinNegocio, VistaDeCasos, VistaDelNegocio, VistaDelTablero, VistaDeUnaSeccion } from '@/app/panel/vista'
import { rutaDePropia } from '@/app/panel/secciones'
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { Componentes } from './componentes'
import { HiloDeMuestra, HiloQueRecibeUnaDecision } from './hilo-de-muestra'
import { MarcoDeMuestra } from './marco-de-muestra'
import { HILO_ARMANDOSE, HILO_CON_UN_CASO, HILO_CONSTANCIAS, HILO_TRABAJANDO, HILO_VARIAS_DECISIONES, NEGOCIO_AGENDA, NEGOCIO_ARMANDOSE, NEGOCIO_CON_CAMBIOS, NEGOCIO_CON_UN_CASO, NEGOCIO_CON_MUCHAS_FILAS, NEGOCIO_FUNCIONANDO, NEGOCIO_RECIEN_ABIERTO, NEGOCIO_SIN_VENTAS, TARJETAS_CON_UN_CASO, TARJETAS_CONSTANCIAS, TARJETAS_VARIAS_DECISIONES, type NegocioDeMuestra } from './datos'

type Escena = { id: string; titulo: string; pinta: () => ReactNode }
type Disposicion = Pick<ComponentProps<typeof MarcoDeMuestra>, 'sidebarAbierto' | 'cajonAbierto' | 'inicial' | 'rutaInicial'>

function operacionDe(datos: NegocioDeMuestra | null) {
  if (!datos) return { dueno: 'Lucía', negocio: null }
  return {
    dueno: 'Lucía',
    negocio: {
      nombre: datos.nombre,
      ciudad: 'Manizales',
      casosAbiertos: datos.casos.length,
      propias: datos.secciones.map((s) => ({ clave: s.clave, nombre: s.nombre })),
      publicar: datos.hoy ? datos.pendiente : null,
    },
  }
}

function paginasDe(datos: NegocioDeMuestra | null): Record<string, ReactNode> {
  const sin = <SinNegocio />
  return {
    '/panel': datos?.hoy ? <InicioHoy {...datos.hoy} /> : datos ? <VistaDelNegocio datos={datos} /> : sin,
    '/panel/casos': datos ? <VistaDeCasos casos={datos.casos} /> : sin,
    '/panel/tablero': datos ? <VistaDelTablero indicadores={datos.indicadores} /> : sin,
    '/panel/conversaciones': <FaltaEstaSeccion que="tus conversaciones" />,
    '/panel/pedidos': datos ? <ListaDePedidos {...datos.pedidos} /> : sin,
    '/panel/clientes': datos ? <TablaDeClientes {...datos.clientes} /> : sin,
    ...Object.fromEntries((datos?.secciones ?? []).map((p) => [rutaDePropia(p.clave), <VistaDeUnaSeccion key={p.clave} p={p} />])),
  }
}

function panel(datos: NegocioDeMuestra | null, estado: 'armando' | 'listo' | null, mensajes: UIMessage[] = [], tarjetas: Record<string, EstadoDeTarjeta> = {}, disposicion: Disposicion = {}) {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={paginasDe(datos)} hilo={<HiloDeMuestra messages={mensajes} estados={tarjetas} estado={estado} />} {...disposicion} />
}

/** En teléfono también abre el lienzo, donde vive la lista. */
const enLaSeccion = (datos: NegocioDeMuestra, rutaInicial: string) => panel(datos, 'listo', [], {}, { rutaInicial, inicial: { pestana: 'negocio' } })

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
  { id: 'panel-recien-abierto', titulo: 'Inicio: recién abierto, nadie ha escrito', pinta: () => panel(NEGOCIO_RECIEN_ABIERTO, 'listo') },
  { id: 'hoy-sin-ventas', titulo: 'Inicio: una semana sin ventas y nada que mirar', pinta: () => panel(NEGOCIO_SIN_VENTAS, 'listo') },
  { id: 'hoy-agenda', titulo: 'Inicio: un Negocio de citas', pinta: () => panel(NEGOCIO_AGENDA, 'listo') },
  { id: 'pedidos-lista', titulo: 'Pedidos: agrupados por lo que falta hacer', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/pedidos') },
  { id: 'pedidos-vacios', titulo: 'Pedidos: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/pedidos') },
  { id: 'pedidos-muchos', titulo: 'Pedidos: más filas que el límite y nombres largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/pedidos') },
  { id: 'clientes-tabla', titulo: 'Clientes: la tabla', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/clientes') },
  { id: 'clientes-vacios', titulo: 'Clientes: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/clientes') },
  { id: 'clientes-muchos', titulo: 'Clientes: más filas que el límite y nombres largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/clientes') },
  { id: 'operacion-sidebar-plegado', titulo: 'PC: el sidebar plegado a íconos', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { sidebarAbierto: false }) },
  { id: 'operacion-hilo-oculto', titulo: 'PC: el Hilo oculto, con la caja flotante', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo', HILO_ARMANDOSE, {}, { inicial: { lugar: 'caja' } }) },
  { id: 'operacion-conversacion-flotante', titulo: 'PC: la conversación abierta encima del lienzo', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { lugar: 'conversacion' } }) },
  { id: 'operacion-llega-decision', titulo: 'PC: llega una decisión y la conversación se abre sola', pinta: llegaUnaDecision },
  { id: 'telefono-tu-negocio', titulo: 'Teléfono: Tu negocio, con el punto en Tu agente', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { pestana: 'negocio' } }) },
  { id: 'telefono-cajon', titulo: 'Teléfono: el sidebar como cajón', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { cajonAbierto: true, inicial: { pestana: 'negocio' } }) },
  { id: 'hilo-constancias', titulo: 'Hilo: cada desenlace de una tarjeta resuelta', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo', HILO_CONSTANCIAS, TARJETAS_CONSTANCIAS) },
  { id: 'hilo-varias-decisiones', titulo: 'Hilo: tres decisiones a la vez', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_VARIAS_DECISIONES, TARJETAS_VARIAS_DECISIONES) },
  { id: 'hilo-trabajando', titulo: 'Hilo: el agente trabajando', pinta: () => <MarcoDeMuestra datos={operacionDe(NEGOCIO_FUNCIONANDO)} paginas={paginasDe(NEGOCIO_FUNCIONANDO)} hilo={<HiloDeMuestra messages={HILO_TRABAJANDO} estados={{}} estado="listo" status="streaming" />} /> },
  { id: 'componentes', titulo: 'Todos los componentes y colores', pinta: () => <Componentes /> },
]
