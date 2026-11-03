import type { ComponentProps, ReactNode } from 'react'
import { InicioHoy } from '@/app/panel/inicio-hoy'
import { ListaDePedidos, TablaDeClientes } from '@/app/panel/listas'
import { rutaDeConversacion, VistaDeConversaciones } from '@/app/panel/conversaciones'
import { VistaDelTablero } from '@/app/panel/tablero'
import { SinNegocio, VistaDelNegocio, VistaDeUnaSeccion } from '@/app/panel/vista'
import { rutaDePropia } from '@/app/panel/secciones'
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { Componentes } from './componentes'
import { CasosDeMuestra, HiloDeMuestra, HiloQueRecibeUnaDecision, type GuionDePublicar } from './hilo-de-muestra'
import { MarcoDeMuestra } from './marco-de-muestra'
import { GUION_FALLA, GUION_LLEGA_UNA_SECCION, GUION_OTRO_DUENO, GUION_UN_INDICADOR, GUION_UNA_REGLA, HILO_UN_INDICADOR, HILO_UNA_REGLA, NEGOCIO_MUCHOS_CAMBIOS, NEGOCIO_SECCION_SIN_PUBLICAR, NEGOCIO_UN_INDICADOR, TARJETAS_UN_INDICADOR, TARJETAS_UNA_REGLA } from './datos'
import { HILO_ARMANDOSE, HILO_CON_UN_CASO, HILO_CONSTANCIAS, HILO_TRABAJANDO, HILO_VARIAS_DECISIONES, NEGOCIO_AGENDA, NEGOCIO_ARMANDOSE, NEGOCIO_CASOS_SIN_BOTON, NEGOCIO_CON_CAMBIOS, NEGOCIO_CON_UN_CASO, NEGOCIO_CON_MUCHAS_FILAS, NEGOCIO_FUNCIONANDO, NEGOCIO_RECIEN_ABIERTO, NEGOCIO_SIN_VENTAS, TARJETAS_CON_UN_CASO, TARJETAS_CONSTANCIAS, TARJETAS_VARIAS_DECISIONES, type NegocioDeMuestra } from './datos'

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
      publicar: datos.hoy ? { ...datos.pendiente, link: datos.hoy.link, nuevos: datos.nuevos ?? [] } : null,
    },
  }
}

function paginasDe(datos: NegocioDeMuestra | null): Record<string, ReactNode> {
  const sin = <SinNegocio />
  return {
    '/panel': datos?.hoy ? <InicioHoy {...datos.hoy} /> : datos ? <VistaDelNegocio datos={datos} /> : sin,
    '/panel/casos': datos ? <CasosDeMuestra {...datos.seccionDeCasos} /> : sin,
    '/panel/tablero': datos ? <VistaDelTablero indicadores={datos.indicadores} tablero={datos.tablero} /> : sin,
    '/panel/conversaciones': datos ? <VistaDeConversaciones {...datos.conversaciones} /> : sin,
    ...Object.fromEntries(Object.values(datos?.detalles ?? {}).map((d) => [rutaDeConversacion(d.cliente), <VistaDeConversaciones key={d.cliente} {...datos!.conversaciones} detalle={d} enDetalle />])),
    '/panel/pedidos': datos ? <ListaDePedidos {...datos.pedidos} /> : sin,
    '/panel/clientes': datos ? <TablaDeClientes {...datos.clientes} /> : sin,
    ...Object.fromEntries((datos?.secciones ?? []).map((p) => [rutaDePropia(p.clave), <VistaDeUnaSeccion key={p.clave} p={p} />])),
  }
}

function panel(datos: NegocioDeMuestra | null, estado: 'armando' | 'listo' | null, mensajes: UIMessage[] = [], tarjetas: Record<string, EstadoDeTarjeta> = {}, disposicion: Disposicion = {}) {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={paginasDe(datos)} tarjetas={tarjetas} hilo={<HiloDeMuestra messages={mensajes} estado={estado} />} {...disposicion} />
}

/** En teléfono también abre el lienzo, donde vive la lista. */
const enLaSeccion = (datos: NegocioDeMuestra, rutaInicial: string) => panel(datos, 'listo', [], {}, { rutaInicial, inicial: { pestana: 'negocio' } })

/** Publicar de punta a punta: la tarjeta, el botón y el lienzo cambian juntos, como con la base de verdad. */
function publicando(datos: NegocioDeMuestra, mensajes: UIMessage[], tarjetas: Record<string, EstadoDeTarjeta>, guion: GuionDePublicar, rutaInicial = '/panel') {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={paginasDe(datos)} tarjetas={tarjetas} guion={guion} rutaInicial={rutaInicial} hilo={<HiloDeMuestra messages={mensajes} estado="listo" />} />
}

function llegaUnaSeccion() {
  const { seccion } = GUION_LLEGA_UNA_SECCION
  // Sin Secciones todavía: la primera trae su grupo con ella, y también tiene que entrar con animación.
  const sinSecciones = { ...NEGOCIO_FUNCIONANDO, secciones: [] }
  return <MarcoDeMuestra datos={operacionDe(sinSecciones)} paginas={{ ...paginasDe(sinSecciones), [rutaDePropia(seccion.clave)]: <VistaDeUnaSeccion p={seccion} /> }} guion={GUION_LLEGA_UNA_SECCION.guion} hilo={<HiloDeMuestra messages={[]} estado="listo" />} />
}

function llegaUnaDecision() {
  const antes = HILO_CON_UN_CASO.slice(0, -1)
  return <MarcoDeMuestra datos={operacionDe(NEGOCIO_CON_UN_CASO)} paginas={paginasDe(NEGOCIO_CON_UN_CASO)} inicial={{ lugar: 'caja' }} tarjetas={TARJETAS_CON_UN_CASO} hilo={<HiloQueRecibeUnaDecision messages={antes} llega={HILO_CON_UN_CASO.at(-1)!} estado="listo" />} />
}

/** Agregar una pantalla a la vitrina es agregar una fila aquí. */
export const ESCENAS: readonly Escena[] = [
  { id: 'panel-vacio', titulo: 'Panel sin Negocio todavía', pinta: () => panel(null, null) },
  { id: 'panel-armandose', titulo: 'Panel de un Negocio armándose', pinta: () => panel(NEGOCIO_ARMANDOSE, 'armando', HILO_ARMANDOSE) },
  { id: 'panel-funcionando', titulo: 'Panel de un Negocio funcionando', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo') },
  { id: 'panel-un-caso', titulo: 'Panel con un Caso esperando al Dueño', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO) },
  { id: 'panel-con-cambios', titulo: 'Panel con cambios sin publicar', pinta: () => panel(NEGOCIO_CON_CAMBIOS, 'listo') },
  { id: 'publicar-indicador', titulo: 'Publicar: un Indicador en la vista previa, hasta Publicado', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_UN_INDICADOR) },
  { id: 'publicar-indicador-tablero', titulo: 'Publicar: el Indicador en su lugar, el Tablero', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_UN_INDICADOR, '/panel/tablero') },
  { id: 'publicar-indicador-pedidos', titulo: 'Publicar: el Indicador encima de Pedidos', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_UN_INDICADOR, '/panel/pedidos') },
  { id: 'publicar-regla', titulo: 'Publicar: una regla por aplicar, hasta Publicada', pinta: () => publicando(NEGOCIO_FUNCIONANDO, HILO_UNA_REGLA, TARJETAS_UNA_REGLA, GUION_UNA_REGLA) },
  { id: 'publicar-seccion', titulo: 'Publicar: llega una Sección y entra al sidebar', pinta: llegaUnaSeccion },
  { id: 'publicar-seccion-sin-publicar', titulo: 'Publicar: una Sección propia todavía sin publicar', pinta: () => publicando(NEGOCIO_SECCION_SIN_PUBLICAR, [], {}, {}, rutaDePropia('pedidos-con-novedad')) },
  { id: 'publicar-otro-dueno', titulo: 'Publicar: otro Dueño aplicó algo más', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_OTRO_DUENO) },
  { id: 'publicar-falla', titulo: 'Publicar: no se pudo, y se vuelve a tocar', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_FALLA) },
  { id: 'publicar-muchos', titulo: 'Publicar: muchos cambios y líneas largas', pinta: () => publicando(NEGOCIO_MUCHOS_CAMBIOS, [], {}, {}) },
  { id: 'panel-recien-abierto', titulo: 'Inicio: recién abierto, nadie ha escrito', pinta: () => panel(NEGOCIO_RECIEN_ABIERTO, 'listo') },
  { id: 'hoy-sin-ventas', titulo: 'Inicio: una semana sin ventas y nada que mirar', pinta: () => panel(NEGOCIO_SIN_VENTAS, 'listo') },
  { id: 'hoy-agenda', titulo: 'Inicio: un Negocio de citas', pinta: () => panel(NEGOCIO_AGENDA, 'listo') },
  { id: 'pedidos-lista', titulo: 'Pedidos: agrupados por lo que falta hacer', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/pedidos') },
  { id: 'pedidos-vacios', titulo: 'Pedidos: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/pedidos') },
  { id: 'pedidos-muchos', titulo: 'Pedidos: más filas que el límite y nombres largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/pedidos') },
  { id: 'clientes-tabla', titulo: 'Clientes: la tabla', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/clientes') },
  { id: 'clientes-vacios', titulo: 'Clientes: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/clientes') },
  { id: 'clientes-muchos', titulo: 'Clientes: más filas que el límite y nombres largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/clientes') },
  { id: 'casos-espera', titulo: 'Casos: uno espera tu decisión, el mismo del Hilo', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { rutaInicial: '/panel/casos', inicial: { pestana: 'negocio' } }) },
  { id: 'casos-sin-boton', titulo: 'Casos: sin respuesta, descartada, vencida, y una que no salió', pinta: () => enLaSeccion(NEGOCIO_CASOS_SIN_BOTON, '/panel/casos') },
  { id: 'casos-vacios', titulo: 'Casos: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/casos') },
  { id: 'casos-muchos', titulo: 'Casos: más filas que el límite y textos largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/casos') },
  { id: 'conversaciones-lista', titulo: 'Conversaciones: lista y detalle', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/conversaciones') },
  { id: 'conversacion-con-caso', titulo: 'Conversaciones: una elegida, con un Caso que espera', pinta: () => enLaSeccion(NEGOCIO_CON_UN_CASO, rutaDeConversacion('camila')) },
  { id: 'conversaciones-vacias', titulo: 'Conversaciones: todavía ninguna', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/conversaciones') },
  { id: 'conversaciones-muchas', titulo: 'Conversaciones: más filas que el límite y textos largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, rutaDeConversacion('larga')) },
  { id: 'tablero', titulo: 'Tablero: cifras, Indicadores propios, gráfica, reparto y tabla', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/tablero') },
  { id: 'tablero-vacio', titulo: 'Tablero: todavía sin pedidos ni conversaciones', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/tablero') },
  { id: 'tablero-agenda', titulo: 'Tablero: un Negocio de citas', pinta: () => enLaSeccion(NEGOCIO_AGENDA, '/panel/tablero') },
  { id: 'tablero-armandose', titulo: 'Tablero: un Negocio armándose', pinta: () => enLaSeccion(NEGOCIO_ARMANDOSE, '/panel/tablero') },
  { id: 'tablero-muchos', titulo: 'Tablero: cifras grandes, nombres largos, 30 días y un ranking', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/tablero') },
  { id: 'seccion-propia', titulo: 'Sección propia: la que pidió el Dueño', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePropia('pedidos-con-novedad')) },
  { id: 'seccion-larga', titulo: 'Sección propia: ocho columnas, valores largos y recortada', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, rutaDePropia('seccion-larga')) },
  { id: 'seccion-sin-filas', titulo: 'Sección propia: sin filas por ahora', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePropia('devoluciones-de-hoy')) },
  { id: 'seccion-fallo', titulo: 'Sección propia: no se pudo calcular', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePropia('devoluciones')) },
  { id: 'operacion-sidebar-plegado', titulo: 'PC: el sidebar plegado a íconos', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { sidebarAbierto: false }) },
  { id: 'operacion-hilo-oculto', titulo: 'PC: el Hilo oculto, con la caja flotante', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo', HILO_ARMANDOSE, {}, { inicial: { lugar: 'caja' } }) },
  { id: 'operacion-conversacion-flotante', titulo: 'PC: la conversación abierta encima del lienzo', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { lugar: 'conversacion' } }) },
  { id: 'operacion-llega-decision', titulo: 'PC: llega una decisión y la conversación se abre sola', pinta: llegaUnaDecision },
  { id: 'telefono-tu-negocio', titulo: 'Teléfono: Tu negocio, con el punto en Tu agente', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { pestana: 'negocio' } }) },
  { id: 'telefono-cajon', titulo: 'Teléfono: el sidebar como cajón', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { cajonAbierto: true, inicial: { pestana: 'negocio' } }) },
  { id: 'hilo-constancias', titulo: 'Hilo: cada desenlace de una tarjeta resuelta', pinta: () => panel(NEGOCIO_FUNCIONANDO, 'listo', HILO_CONSTANCIAS, TARJETAS_CONSTANCIAS) },
  { id: 'hilo-varias-decisiones', titulo: 'Hilo: tres decisiones a la vez', pinta: () => panel(NEGOCIO_CON_UN_CASO, 'listo', HILO_VARIAS_DECISIONES, TARJETAS_VARIAS_DECISIONES) },
  { id: 'hilo-trabajando', titulo: 'Hilo: el agente trabajando', pinta: () => <MarcoDeMuestra datos={operacionDe(NEGOCIO_FUNCIONANDO)} paginas={paginasDe(NEGOCIO_FUNCIONANDO)} hilo={<HiloDeMuestra messages={HILO_TRABAJANDO} estado="listo" status="streaming" />} /> },
  { id: 'componentes', titulo: 'Todos los componentes y colores', pinta: () => <Componentes /> },
]
