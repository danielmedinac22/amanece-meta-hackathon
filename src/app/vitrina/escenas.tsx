import { VistaDeAgenda } from '@/app/panel/agenda'
import { Button } from '@/components/ui/button'
import { CuentaPorPasar } from '@/app/panel/espera'
import type { ComponentProps, ReactNode } from 'react'
import { InicioHoy } from '@/app/panel/inicio-hoy'
import { ListaDePedidos, TablaDeClientes } from '@/app/panel/listas'
import { VistaDeConversaciones, type ControlDeToma } from '@/app/panel/conversaciones'
import { VistaDelTablero } from '@/app/panel/tablero'
import { VistaDeUnaSeccion } from '@/app/panel/vista'
import { rutaDePropia } from '@/app/panel/secciones'
import type { UIMessage } from 'ai'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { VistaDeAjustes } from '@/app/panel/ajustes'
import { ClienteQueNoEsta, PedidoQueNoEsta } from '@/app/panel/detalle'
import { rutaDeCliente, rutaDeConversacion, rutaDePedido } from '@/nucleo/listas-palabras'
import SeccionQueNoEsta from '@/app/panel/not-found'
import { EsqueletoDeAjustes, EsqueletoDeCasos, EsqueletoDeClientes, EsqueletoDeConversaciones, EsqueletoDeInicio, EsqueletoDeAgenda, EsqueletoDePedidos, EsqueletoDelTablero, EsqueletoDeUnaSeccion, EsqueletoDeUnCliente, EsqueletoDeUnPedido } from '@/app/panel/esqueletos'
import { loQueTrae, RUTA_DE_AJUSTES } from '@/app/panel/secciones'
import { Alba } from '@/app/alba'
import { AlbaHastaElArmado } from './alba-de-muestra'
import { ArmadoDeMuestra } from './armado-de-muestra'
import { ARMADO_COBRO, ARMADO_COBRO_CON_MAS_FALTANTES, ARMADO_CONFIRMAR, ARMADO_CONOCIENDO, ARMADO_COBRO_CORREGIDO, ARMADO_CORREGIDA, HILO_CORREGIDA, HILO_NO_CORRIGIO, TARJETAS_CORREGIDA, ARMADO_FUERA_DE_ORDEN, ARMADO_LEYENDO, ARMADO_LISTO, ARMADO_TEXTOS_LARGOS, ARMADO_VACIO, HILO_COBRO, HILO_DESDE_PLANTILLA, HILO_CONFIRMAR, HILO_CONOCIENDO, HILO_FUERA_DE_ORDEN, HILO_LEYENDO, HILO_LISTO, TARJETAS_CONFIRMAR } from './datos-armado'
import { Componentes } from './componentes'
import { ADJUNTOS_EN_EL_REDACTOR, GUION_TARJETAS_QUE_VENCIERON, HILO_CAPACIDAD_FALTANTE, HILO_CON_ARCHIVOS, HILO_TARJETAS_QUE_VENCIERON, TARJETAS_QUE_VENCIERON } from './datos-de-estados'
import { ConfirmarDeMuestra, EntradaDeMuestra, ErrorDeMuestra, QueFallaDeVerdad } from './estados-de-muestra'
import { HILO_AVISO_DE_LA_TOMA, NEGOCIO_CLIENTE_ESPERA, NEGOCIO_CON_LA_TOMA_TUYA, NEGOCIO_DE_OTRO_DUENO, NEGOCIO_NO_SALIO, NEGOCIO_POR_VENCER, NEGOCIO_SE_ACABO_EL_TIEMPO, NEGOCIO_SIN_SABER_SI_SALIO, NEGOCIO_SIN_VENTANA, NEGOCIO_TOMADA_CON_EL_AGENTE_TERMINANDO, NEGOCIO_TUYA_SIN_VENTANA, NEGOCIO_WHATSAPP_NO_LO_TOMA } from './datos-de-la-toma'
import { GUION_WHATSAPP_NO_LA_TOMA, HILO_CASO_CON_REGLA, HILO_CASO_VIEJO, HILO_DESENLACES_DEL_ENVIO, NEGOCIO_CASOS_CON_ENVIO, TARJETAS_CASO_CON_REGLA, TARJETAS_CASO_VIEJO, TARJETAS_DESENLACES_DEL_ENVIO } from './datos-del-caso'
import { CasosDeMuestra, HiloDeMuestra, HiloQueRecibeUnaDecision, type GuionDePublicar } from './hilo-de-muestra'
import { MarcoDeMuestra } from './marco-de-muestra'
import { TomaDeMuestra } from './toma-de-muestra'
import { GUION_FALLA, GUION_LLEGA_UNA_SECCION, GUION_OTRO_DUENO, GUION_UN_INDICADOR, GUION_UNA_REGLA, HILO_UN_INDICADOR, HILO_UNA_REGLA, NEGOCIO_MUCHOS_CAMBIOS, NEGOCIO_SECCION_SIN_PUBLICAR, NEGOCIO_UN_INDICADOR, TARJETAS_UN_INDICADOR, TARJETAS_UNA_REGLA } from './datos'
import { HILO_ARMANDOSE, HILO_CON_UN_CASO, HILO_CONSTANCIAS, HILO_TRABAJANDO, HILO_VARIAS_DECISIONES, NEGOCIO_AGENDA, NEGOCIO_AGENDA_SIN_CITAS, NEGOCIO_CASOS_SIN_BOTON, NEGOCIO_CON_CAMBIOS, NEGOCIO_CON_UN_CASO, NEGOCIO_CON_MUCHAS_FILAS, NEGOCIO_FUNCIONANDO, NEGOCIO_LO_ULTIMO, NEGOCIO_RECIEN_ABIERTO, NEGOCIO_SIN_ORIGENES, NEGOCIO_SIN_VENTAS, TARJETAS_CON_UN_CASO, TARJETAS_CONSTANCIAS, TARJETAS_VARIAS_DECISIONES, type NegocioDeMuestra } from './datos'

type Escena = { id: string; titulo: string; pinta: () => ReactNode }
type Disposicion = Pick<ComponentProps<typeof MarcoDeMuestra>, 'sidebarAbierto' | 'cajonAbierto' | 'inicial' | 'rutaInicial'>

function operacionDe(datos: NegocioDeMuestra) {
  return {
    dueno: 'Lucía',
    negocio: {
      nombre: datos.nombre,
      ciudad: 'Manizales',
      voz: datos.hoy.hoy.voz,
      casosAbiertos: datos.casos.length,
      propias: datos.secciones.map((s) => ({ clave: s.clave, nombre: s.nombre })),
      publicar: { ...datos.pendiente, link: datos.hoy.link, nuevos: datos.nuevos ?? [] },
    },
  }
}

const AGENTE_ATIENDE = { tipo: 'agente', vez: 0, ventana: true, espera: false } as const

function paginasDe(datos: NegocioDeMuestra): Record<string, ReactNode> {
  const atencionDe = (cliente: string | undefined) => (cliente && datos.atenciones?.[cliente]) || AGENTE_ATIENDE
  const Toma: ControlDeToma = (p) => <TomaDeMuestra {...p} alEscribir={datos.alEscribir} />
  return {
    '/panel': <InicioHoy {...datos.hoy} />,
    '/panel/casos': <CasosDeMuestra {...datos.seccionDeCasos} />,
    '/panel/tablero': <VistaDelTablero indicadores={datos.indicadores} tablero={datos.tablero} />,
    '/panel/conversaciones': <VistaDeConversaciones {...datos.conversaciones} atencion={atencionDe(datos.conversaciones.detalle?.cliente)} Toma={Toma} />,
    ...Object.fromEntries(Object.values(datos.detalles ?? {}).map((d) => [rutaDeConversacion(d.cliente), <VistaDeConversaciones key={d.cliente} {...datos.conversaciones} detalle={d} enDetalle atencion={atencionDe(d.cliente)} Toma={Toma} />])),
    '/panel/pedidos': <ListaDePedidos {...datos.pedidos} />,
    '/panel/agenda': <VistaDeAgenda {...(datos.agenda ?? { grupos: [] })} />,
    '/panel/clientes': <TablaDeClientes {...datos.clientes} />,
    [RUTA_DE_AJUSTES]: <VistaDeAjustes nombre={datos.nombre} ciudad="Manizales" link={datos.hoy.link} />,
    ...Object.fromEntries(datos.secciones.map((p) => [rutaDePropia(p.clave), <VistaDeUnaSeccion key={p.clave} p={p} />])),
  }
}

const filasDe = ({ pedidos, clientes, detalles }: NegocioDeMuestra) => ({ pedidos, clientes, detalles })

function panel(datos: NegocioDeMuestra, mensajes: UIMessage[] = [], tarjetas: Record<string, EstadoDeTarjeta> = {}, disposicion: Disposicion = {}) {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={paginasDe(datos)} filas={filasDe(datos)} tarjetas={tarjetas} hilo={<HiloDeMuestra messages={mensajes} />} {...disposicion} />
}

/** En teléfono también abre el lienzo, donde vive la lista. */
const enLaSeccion = (datos: NegocioDeMuestra, rutaInicial: string) => panel(datos, [], {}, { rutaInicial, inicial: { pestana: 'negocio' } })

/** Publicar de punta a punta: la tarjeta, el botón y el lienzo cambian juntos, como con la base de verdad. */
function publicando(datos: NegocioDeMuestra, mensajes: UIMessage[], tarjetas: Record<string, EstadoDeTarjeta>, guion: GuionDePublicar, rutaInicial = '/panel') {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={paginasDe(datos)} filas={filasDe(datos)} tarjetas={tarjetas} guion={guion} rutaInicial={rutaInicial} hilo={<HiloDeMuestra messages={mensajes} />} />
}

function llegaUnaSeccion() {
  const { seccion } = GUION_LLEGA_UNA_SECCION
  // Sin Secciones todavía: la primera trae su grupo con ella, y también tiene que entrar con animación.
  const sinSecciones = { ...NEGOCIO_FUNCIONANDO, secciones: [] }
  return <MarcoDeMuestra datos={operacionDe(sinSecciones)} paginas={{ ...paginasDe(sinSecciones), [rutaDePropia(seccion.clave)]: <VistaDeUnaSeccion p={seccion} /> }} guion={GUION_LLEGA_UNA_SECCION.guion} hilo={<HiloDeMuestra messages={[]} />} />
}

function llegaUnaDecision() {
  const antes = HILO_CON_UN_CASO.slice(0, -1)
  return <MarcoDeMuestra datos={operacionDe(NEGOCIO_CON_UN_CASO)} paginas={paginasDe(NEGOCIO_CON_UN_CASO)} inicial={{ lugar: 'caja' }} tarjetas={TARJETAS_CON_UN_CASO} hilo={<HiloQueRecibeUnaDecision messages={antes} llega={HILO_CON_UN_CASO.at(-1)!} />} />
}

const LA_SECCION_PROPIA = rutaDePropia('pedidos-con-novedad')
const NOMBRE_DE_MUCHAS_FILAS = NEGOCIO_CON_MUCHAS_FILAS.clientes.filas[0].nombre

/** Una Sección con su estado en el lugar de la página: la cáscara no se mueve mientras carga ni si falla. */
function conLaPagina(ruta: string, pagina: ReactNode, datos = NEGOCIO_FUNCIONANDO) {
  return <MarcoDeMuestra datos={operacionDe(datos)} paginas={{ ...paginasDe(datos), [ruta]: pagina }} filas={filasDe(datos)} rutaInicial={ruta} inicial={{ pestana: 'negocio' }} hilo={<HiloDeMuestra messages={[]} />} />
}

const ESTADOS_POR_SECCION: readonly { id: string; ruta: string; esqueleto: ReactNode }[] = [
  { id: 'inicio', ruta: '/panel', esqueleto: <EsqueletoDeInicio /> },
  { id: 'casos', ruta: '/panel/casos', esqueleto: <EsqueletoDeCasos /> },
  { id: 'conversaciones', ruta: '/panel/conversaciones', esqueleto: <EsqueletoDeConversaciones /> },
  { id: 'pedidos', ruta: '/panel/pedidos', esqueleto: <EsqueletoDePedidos /> },
  { id: 'agenda', ruta: '/panel/agenda', esqueleto: <EsqueletoDeAgenda /> },
  { id: 'clientes', ruta: '/panel/clientes', esqueleto: <EsqueletoDeClientes /> },
  { id: 'pedido', ruta: rutaDePedido('p-41'), esqueleto: <EsqueletoDeUnPedido /> },
  { id: 'cliente', ruta: rutaDeCliente('Daniela Quintero'), esqueleto: <EsqueletoDeUnCliente /> },
  { id: 'tablero', ruta: '/panel/tablero', esqueleto: <EsqueletoDelTablero /> },
  { id: 'seccion', ruta: LA_SECCION_PROPIA, esqueleto: <EsqueletoDeUnaSeccion /> },
  { id: 'ajustes', ruta: RUTA_DE_AJUSTES, esqueleto: <EsqueletoDeAjustes /> },
]

const ESCENAS_DE_ESTADOS: readonly Escena[] = [
  { id: 'entrar', titulo: 'Entrar: si no coincide, lo dice y se vuelve a tocar', pinta: () => <EntradaDeMuestra modoInicial="entrar" responde={['datos_no_coinciden', 'sin_conexion', 'muchos_intentos', null]} /> },
  { id: 'entrar-registro', titulo: 'Entrar: primera vez, con el correo que ya tiene cuenta', pinta: () => <EntradaDeMuestra modoInicial="registro" responde={['ya_tiene_cuenta', null]} /> },
  { id: 'entrar-codigo', titulo: 'Entrar: el código del registro, con uno equivocado', pinta: () => <EntradaDeMuestra modoInicial="registro" responde={[{ en: 'codigo', por: 'registro', email: 'lucia@cafeladera.co' }, 'codigo_incorrecto', null]} /> },
  { id: 'entrar-dispositivo', titulo: 'Entrar: desde un dispositivo nuevo', pinta: () => <EntradaDeMuestra modoInicial="entrar" responde={[{ en: 'codigo', por: 'dispositivo', email: 'lucia@cafeladera.co' }, null]} /> },
  { id: 'entrar-olvido', titulo: 'Entrar: olvidó la contraseña', pinta: () => <EntradaDeMuestra modoInicial="entrar" responde={[{ en: 'codigo', por: 'recuperar', email: 'lucia@cafeladera.co' }, { en: 'contrasena_nueva' }, null]} /> },
  { id: 'cuenta-por-pasar', titulo: 'Una cuenta que todavía no llega a su Negocio', pinta: () => <CuentaPorPasar salir={<Button variant="ghost">Cerrar sesión</Button>} /> },
  { id: 'cuenta-por-confirmar', titulo: 'Un correo sin verificar: lo confirma con un código, y uno equivocado lo dice', pinta: () => <ConfirmarDeMuestra /> },
  { id: 'ajustes', titulo: 'Ajustes del negocio: funcionando', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, RUTA_DE_AJUSTES) },
  { id: 'ajustes-armandose', titulo: 'Ajustes del negocio: armándose, sin link', pinta: () => conLaPagina(RUTA_DE_AJUSTES, <VistaDeAjustes nombre="Café Ladera" ciudad="Manizales" link={null} />) },
  { id: 'ajustes-sin-ciudad', titulo: 'Ajustes del negocio: el agente no sabe la ciudad', pinta: () => conLaPagina(RUTA_DE_AJUSTES, <VistaDeAjustes nombre="Café Ladera" ciudad="" link={NEGOCIO_FUNCIONANDO.hoy.link} />) },
  { id: 'ajustes-largo', titulo: 'Ajustes del negocio: nombre y ciudad muy largos', pinta: () => conLaPagina(RUTA_DE_AJUSTES, <VistaDeAjustes nombre="Distribuidora de Cafés Especiales y Tostadores del Eje Cafetero Hermanos Giraldo" ciudad="San José de las Palomas de Santa Rosa de Cabal, Risaralda, Colombia" link={NEGOCIO_FUNCIONANDO.hoy.link} />) },
  ...ESTADOS_POR_SECCION.map(({ id, ruta, esqueleto }) => ({ id: `cargando-${id}`, titulo: `Cargando: ${id}`, pinta: () => conLaPagina(ruta, esqueleto) })),
  ...ESTADOS_POR_SECCION.map(({ id, ruta }) => ({ id: `error-${id}`, titulo: `Error: ${id}`, pinta: () => conLaPagina(ruta, <ErrorDeMuestra titulo={`No pude traer ${loQueTrae(ruta)}.`} />) })),
  { id: 'seccion-sin-advertencia', titulo: 'Sección propia: sin aviso de recorte', pinta: () => conLaPagina(LA_SECCION_PROPIA, <VistaDeUnaSeccion p={{ ...NEGOCIO_FUNCIONANDO.secciones.find((p) => rutaDePropia(p.clave) === LA_SECCION_PROPIA)!, advertencias: [] }} />) },
  { id: 'error-de-verdad', titulo: 'Error: el archivo que usa Next, con su Volver a intentar', pinta: () => <QueFallaDeVerdad /> },
  { id: 'seccion-no-esta', titulo: 'Una Sección que ya no está en el Negocio', pinta: () => conLaPagina('/panel/secciones/ya-no-esta', <SeccionQueNoEsta />) },
  { id: 'hilo-capacidad-faltante', titulo: 'Hilo: lo que el agente no sabe hacer queda anotado', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_CAPACIDAD_FALTANTE) },
  { id: 'hilo-con-archivos', titulo: 'Hilo: una lista, una foto sin texto y un PDF recortado', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_CON_ARCHIVOS) },
  { id: 'hilo-adjuntando', titulo: 'Hilo: subiendo, listo y con error en el redactor', pinta: () => <MarcoDeMuestra datos={operacionDe(NEGOCIO_FUNCIONANDO)} paginas={paginasDe(NEGOCIO_FUNCIONANDO)} hilo={<HiloDeMuestra messages={HILO_ARMANDOSE.slice(0, 1)} adjuntos={ADJUNTOS_EN_EL_REDACTOR} />} /> },
  { id: 'hilo-tarjeta-vencio', titulo: 'Hilo: tocar tarjetas que vencieron sin refrescar', pinta: () => <MarcoDeMuestra datos={operacionDe(NEGOCIO_FUNCIONANDO)} paginas={paginasDe(NEGOCIO_FUNCIONANDO)} tarjetas={TARJETAS_QUE_VENCIERON} guion={GUION_TARJETAS_QUE_VENCIERON} hilo={<HiloDeMuestra messages={HILO_TARJETAS_QUE_VENCIERON} />} /> },
  { id: 'hilo-error', titulo: 'Hilo: se cortó la respuesta', pinta: () => <MarcoDeMuestra datos={operacionDe(NEGOCIO_FUNCIONANDO)} paginas={paginasDe(NEGOCIO_FUNCIONANDO)} hilo={<HiloDeMuestra messages={HILO_ARMANDOSE.slice(0, 1)} seCorto />} /> },
]

/** Agregar una pantalla a la vitrina es agregar una fila aquí. */
export const ESCENAS: readonly Escena[] = [
  { id: 'alba', titulo: 'Alba: lo primero que ve el Dueño, con la caja de verdad', pinta: () => <Alba /> },
  { id: 'alba-al-armado', titulo: 'Alba: de la caja al armado, ya con cuenta', pinta: () => <AlbaHastaElArmado /> },
  { id: 'armado-desde-plantilla', titulo: 'Armado: parte de una plantilla', pinta: () => <ArmadoDeMuestra datos={ARMADO_CONOCIENDO} messages={HILO_DESDE_PLANTILLA} /> },
  { id: 'hilo-desde-plantilla', titulo: 'Hilo: ya abierto, lo que la plantilla ofrece pedir', pinta: () => <div className="mx-auto h-dvh max-w-md p-4"><HiloDeMuestra messages={HILO_DESDE_PLANTILLA} /></div> },
  { id: 'panel-vacio', titulo: 'Armado: un Dueño recién entrado', pinta: () => <ArmadoDeMuestra datos={ARMADO_VACIO} messages={[]} /> },
  { id: 'panel-armandose', titulo: 'Armado: conversando, sin enlace', pinta: () => <ArmadoDeMuestra datos={ARMADO_CONOCIENDO} messages={HILO_CONOCIENDO} /> },
  { id: 'armado-leyendo', titulo: 'Armado: leyendo su página', pinta: () => <ArmadoDeMuestra datos={ARMADO_LEYENDO} messages={HILO_LEYENDO} status="streaming" /> },
  { id: 'armado-confirmar', titulo: 'Armado: ¿están bien estos productos?', pinta: () => <ArmadoDeMuestra datos={ARMADO_CONFIRMAR} messages={HILO_CONFIRMAR} tarjetas={TARJETAS_CONFIRMAR} siguiente={ARMADO_COBRO} /> },
  { id: 'armado-corregida', titulo: 'Armado: lo leído, ya corregido en palabras', pinta: () => <ArmadoDeMuestra datos={ARMADO_CORREGIDA} messages={HILO_CORREGIDA} tarjetas={TARJETAS_CORREGIDA} siguiente={ARMADO_COBRO_CORREGIDO} /> },
  { id: 'armado-no-corrigio', titulo: 'Armado: lo que dijo el Dueño no coincidió con la tarjeta', pinta: () => <ArmadoDeMuestra datos={ARMADO_CONFIRMAR} messages={HILO_NO_CORRIGIO} tarjetas={TARJETAS_CONFIRMAR} /> },
  { id: 'hilo-lectura-espera', titulo: 'Hilo: lo leído espera con el Negocio ya abierto', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_CONFIRMAR, TARJETAS_CONFIRMAR) },
  { id: 'armado-cobro', titulo: 'Armado: cómo te pagan', pinta: () => <ArmadoDeMuestra datos={ARMADO_COBRO} messages={HILO_COBRO} siguiente={ARMADO_LISTO} /> },
  { id: 'armado-cobro-con-mas-faltantes', titulo: 'Armado: cómo te pagan, y faltan otras cosas', pinta: () => <ArmadoDeMuestra datos={ARMADO_COBRO_CON_MAS_FALTANTES} messages={HILO_COBRO} /> },
  { id: 'armado-listo', titulo: 'Armado: listo para abrir', pinta: () => <ArmadoDeMuestra datos={ARMADO_LISTO} messages={HILO_LISTO} despues={panel(NEGOCIO_RECIEN_ABIERTO)} /> },
  { id: 'armado-fuera-de-orden', titulo: 'Armado: dijo primero cómo cobra, antes que el nombre', pinta: () => <ArmadoDeMuestra datos={ARMADO_FUERA_DE_ORDEN} messages={HILO_FUERA_DE_ORDEN} /> },
  { id: 'armado-textos-largos', titulo: 'Armado: nombre, envíos y producto largos', pinta: () => <ArmadoDeMuestra datos={ARMADO_TEXTOS_LARGOS} messages={HILO_LISTO} /> },
  { id: 'panel-funcionando', titulo: 'Panel de un Negocio funcionando', pinta: () => panel(NEGOCIO_FUNCIONANDO) },
  { id: 'panel-un-caso', titulo: 'Panel con un Caso esperando al Dueño', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO) },
  { id: 'panel-con-cambios', titulo: 'Panel con cambios sin publicar', pinta: () => panel(NEGOCIO_CON_CAMBIOS) },
  { id: 'publicar-indicador', titulo: 'Publicar: un Indicador en la vista previa, hasta Publicado', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_UN_INDICADOR) },
  { id: 'publicar-indicador-tablero', titulo: 'Publicar: el Indicador en su lugar, el Tablero', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_UN_INDICADOR, '/panel/tablero') },
  { id: 'publicar-indicador-pedidos', titulo: 'Publicar: el Indicador encima de Pedidos', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_UN_INDICADOR, '/panel/pedidos') },
  { id: 'publicar-regla', titulo: 'Publicar: una regla por aplicar, hasta Publicada', pinta: () => publicando(NEGOCIO_FUNCIONANDO, HILO_UNA_REGLA, TARJETAS_UNA_REGLA, GUION_UNA_REGLA) },
  { id: 'publicar-seccion', titulo: 'Publicar: llega una Sección y entra al sidebar', pinta: llegaUnaSeccion },
  { id: 'publicar-seccion-sin-publicar', titulo: 'Publicar: una Sección propia todavía sin publicar', pinta: () => publicando(NEGOCIO_SECCION_SIN_PUBLICAR, [], {}, {}, rutaDePropia('pedidos-con-novedad')) },
  { id: 'publicar-otro-dueno', titulo: 'Publicar: otro Dueño aplicó algo más', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_OTRO_DUENO) },
  { id: 'publicar-falla', titulo: 'Publicar: no se pudo, y se vuelve a tocar', pinta: () => publicando(NEGOCIO_UN_INDICADOR, HILO_UN_INDICADOR, TARJETAS_UN_INDICADOR, GUION_FALLA) },
  { id: 'publicar-muchos', titulo: 'Publicar: muchos cambios y líneas largas', pinta: () => publicando(NEGOCIO_MUCHOS_CAMBIOS, [], {}, {}) },
  { id: 'panel-recien-abierto', titulo: 'Inicio: recién abierto, nadie ha escrito', pinta: () => panel(NEGOCIO_RECIEN_ABIERTO) },
  { id: 'hoy-sin-ventas', titulo: 'Inicio: una semana sin ventas y nada que mirar', pinta: () => panel(NEGOCIO_SIN_VENTAS) },
  { id: 'hoy-agenda', titulo: 'Inicio: un Negocio de citas', pinta: () => panel(NEGOCIO_AGENDA) },
  { id: 'hoy-agenda-sin-citas', titulo: 'Inicio: un Negocio de citas, sin ninguna', pinta: () => panel(NEGOCIO_AGENDA_SIN_CITAS) },
  { id: 'agenda-lista', titulo: 'Agenda: hoy, próximas y lo que ya pasó', pinta: () => enLaSeccion(NEGOCIO_AGENDA, '/panel/agenda') },
  { id: 'agenda-vacia', titulo: 'Agenda: todavía ninguna', pinta: () => enLaSeccion(NEGOCIO_AGENDA_SIN_CITAS, '/panel/agenda') },
  { id: 'tablero-agenda-sin-citas', titulo: 'Tablero: un Negocio de citas, sin ninguna', pinta: () => enLaSeccion(NEGOCIO_AGENDA_SIN_CITAS, '/panel/tablero') },
  { id: 'hoy-lo-ultimo', titulo: 'Inicio: lo último, con un mensaje largo, un link y un pedido confirmado', pinta: () => panel(NEGOCIO_LO_ULTIMO) },
  { id: 'pedidos-lista', titulo: 'Pedidos: agrupados por lo que falta hacer', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/pedidos') },
  { id: 'pedidos-vacios', titulo: 'Pedidos: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/pedidos') },
  { id: 'pedidos-muchos', titulo: 'Pedidos: más filas que el límite y nombres largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/pedidos') },
  { id: 'clientes-tabla', titulo: 'Clientes: la tabla', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/clientes') },
  { id: 'clientes-vacios', titulo: 'Clientes: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/clientes') },
  { id: 'clientes-muchos', titulo: 'Clientes: más filas que el límite y nombres largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/clientes') },
  { id: 'pedido-abierto', titulo: 'Un pedido: lo que pidió, el Cliente y su conversación', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePedido('p-41')) },
  { id: 'pedido-sin-conversacion', titulo: 'Un pedido: su Cliente no ha escrito', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePedido('p-37')) },
  { id: 'pedido-cancelado', titulo: 'Un pedido cancelado: su grupo se abre en la lista', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePedido('p-31')) },
  { id: 'pedido-largo', titulo: 'Un pedido: nombres y dirección largos, y uno al final de la lista', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, rutaDePedido('p-9950')) },
  { id: 'pedido-no-esta', titulo: 'Un pedido que no es de este Negocio', pinta: () => conLaPagina(rutaDePedido('de-otro'), <PedidoQueNoEsta />) },
  { id: 'cliente-abierto', titulo: 'Un Cliente: sus pedidos y su conversación', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDeCliente('Daniela Quintero')) },
  { id: 'cliente-con-caso', titulo: 'Un Cliente: con un Caso que espera', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDeCliente('Camila Rojas')) },
  { id: 'cliente-sin-nada', titulo: 'Un Cliente sin nombre, sin pedidos ni mensajes', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDeCliente('+573000000000')) },
  { id: 'cliente-largo', titulo: 'Un Cliente: más pedidos que el límite y textos largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, rutaDeCliente(NOMBRE_DE_MUCHAS_FILAS)) },
  { id: 'cliente-no-esta', titulo: 'Un Cliente que no es de este Negocio', pinta: () => conLaPagina(rutaDeCliente('de-otro'), <ClienteQueNoEsta />) },
  { id: 'casos-espera', titulo: 'Casos: uno espera tu decisión, el mismo del Hilo', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { rutaInicial: '/panel/casos', inicial: { pestana: 'negocio' } }) },
  { id: 'casos-sin-boton', titulo: 'Casos: sin respuesta, descartada, vencida, y una que no salió', pinta: () => enLaSeccion(NEGOCIO_CASOS_SIN_BOTON, '/panel/casos') },
  { id: 'casos-vacios', titulo: 'Casos: todavía ninguno', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/casos') },
  { id: 'casos-muchos', titulo: 'Casos: más filas que el límite y textos largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/casos') },
  { id: 'conversaciones-lista', titulo: 'Conversaciones: lista y detalle', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/conversaciones') },
  { id: 'conversacion-con-caso', titulo: 'Conversaciones: una elegida, con un Caso que espera', pinta: () => enLaSeccion(NEGOCIO_CON_UN_CASO, rutaDeConversacion('camila')) },
  { id: 'conversaciones-vacias', titulo: 'Conversaciones: todavía ninguna', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/conversaciones') },
  { id: 'conversacion-tomada', titulo: 'Conversaciones: la tienes tú, con lo que le escribiste y cuánto queda', pinta: () => enLaSeccion(NEGOCIO_CON_LA_TOMA_TUYA, '/panel/conversaciones') },
  { id: 'conversacion-agente-terminando', titulo: 'Conversaciones: la tomaste y tu agente alcanzó a responder', pinta: () => enLaSeccion(NEGOCIO_TOMADA_CON_EL_AGENTE_TERMINANDO, '/panel/conversaciones') },
  { id: 'conversacion-de-otro', titulo: 'Conversaciones: la tiene otro Dueño', pinta: () => enLaSeccion(NEGOCIO_DE_OTRO_DUENO, '/panel/conversaciones') },
  { id: 'conversacion-tuya-sin-ventana', titulo: 'Conversaciones: la tienes tú y WhatsApp ya no deja escribirle', pinta: () => enLaSeccion(NEGOCIO_TUYA_SIN_VENTANA, '/panel/conversaciones') },
  { id: 'conversacion-sin-ventana', titulo: 'Conversaciones: tu agente atiende y WhatsApp ya no deja escribirle', pinta: () => enLaSeccion(NEGOCIO_SIN_VENTANA, '/panel/conversaciones') },
  { id: 'conversacion-cliente-espera', titulo: 'Conversaciones: volvió a tu agente y un Cliente espera respuesta', pinta: () => enLaSeccion(NEGOCIO_CLIENTE_ESPERA, '/panel/conversaciones') },
  { id: 'conversacion-por-vencer', titulo: 'Conversaciones: el tiempo llega a cero y vuelve a tu agente', pinta: () => enLaSeccion(NEGOCIO_POR_VENCER, '/panel/conversaciones') },
  { id: 'conversacion-se-acabo-el-tiempo', titulo: 'Conversaciones: escribes justo cuando se acabó el tiempo', pinta: () => enLaSeccion(NEGOCIO_SE_ACABO_EL_TIEMPO, '/panel/conversaciones') },
  { id: 'conversacion-no-salio', titulo: 'Conversaciones: la compuerta no deja salir tu mensaje', pinta: () => enLaSeccion(NEGOCIO_NO_SALIO, '/panel/conversaciones') },
  { id: 'conversacion-whatsapp-no-lo-toma', titulo: 'Conversaciones: WhatsApp no toma tu mensaje', pinta: () => enLaSeccion(NEGOCIO_WHATSAPP_NO_LO_TOMA, '/panel/conversaciones') },
  { id: 'conversacion-sin-saber', titulo: 'Conversaciones: todavía no se sabe si tu mensaje salió', pinta: () => enLaSeccion(NEGOCIO_SIN_SABER_SI_SALIO, '/panel/conversaciones') },
  { id: 'hilo-aviso-de-la-toma', titulo: 'El Hilo avisa que un Cliente escribió en la conversación que tienes', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_AVISO_DE_LA_TOMA) },
  { id: 'conversaciones-muchas', titulo: 'Conversaciones: más filas que el límite y textos largos', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, rutaDeConversacion('larga')) },
  { id: 'tablero', titulo: 'Tablero: cifras, Indicadores propios, gráfica, reparto y tabla', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, '/panel/tablero') },
  { id: 'tablero-vacio', titulo: 'Tablero: todavía sin pedidos ni conversaciones', pinta: () => enLaSeccion(NEGOCIO_RECIEN_ABIERTO, '/panel/tablero') },
  { id: 'tablero-sin-origenes', titulo: 'Tablero: Clientes de antes de guardar de dónde llegan', pinta: () => enLaSeccion(NEGOCIO_SIN_ORIGENES, '/panel/tablero') },
  { id: 'tablero-agenda', titulo: 'Tablero: un Negocio de citas', pinta: () => enLaSeccion(NEGOCIO_AGENDA, '/panel/tablero') },
  { id: 'tablero-armandose', titulo: 'Tablero: un Negocio armándose ve la carta', pinta: () => <ArmadoDeMuestra datos={ARMADO_CONOCIENDO} messages={HILO_CONOCIENDO} /> },
  { id: 'tablero-muchos', titulo: 'Tablero: cifras grandes, nombres largos, 30 días y un ranking', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, '/panel/tablero') },
  { id: 'seccion-propia', titulo: 'Sección propia: la que pidió el Dueño', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePropia('pedidos-con-novedad')) },
  { id: 'seccion-larga', titulo: 'Sección propia: ocho columnas, valores largos y recortada', pinta: () => enLaSeccion(NEGOCIO_CON_MUCHAS_FILAS, rutaDePropia('seccion-larga')) },
  { id: 'seccion-sin-filas', titulo: 'Sección propia: sin filas por ahora', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePropia('devoluciones-de-hoy')) },
  { id: 'seccion-fallo', titulo: 'Sección propia: no se pudo calcular', pinta: () => enLaSeccion(NEGOCIO_FUNCIONANDO, rutaDePropia('devoluciones')) },
  { id: 'operacion-sidebar-plegado', titulo: 'PC: el sidebar plegado a íconos', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { sidebarAbierto: false }) },
  { id: 'operacion-hilo-oculto', titulo: 'PC: el Hilo oculto, con la caja flotante', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_ARMANDOSE, {}, { inicial: { lugar: 'caja' } }) },
  { id: 'operacion-conversacion-flotante', titulo: 'PC: la conversación abierta encima del lienzo', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { lugar: 'conversacion' } }) },
  { id: 'operacion-llega-decision', titulo: 'PC: llega una decisión y la conversación se abre sola', pinta: llegaUnaDecision },
  { id: 'telefono-tu-negocio', titulo: 'Teléfono: Tu negocio, con el punto en Tu agente', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { inicial: { pestana: 'negocio' } }) },
  { id: 'telefono-cajon', titulo: 'Teléfono: el sidebar como cajón', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_CON_UN_CASO, TARJETAS_CON_UN_CASO, { cajonAbierto: true, inicial: { pestana: 'negocio' } }) },
  { id: 'hilo-constancias', titulo: 'Hilo: cada desenlace de una tarjeta resuelta', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_CONSTANCIAS, TARJETAS_CONSTANCIAS) },
  { id: 'caso-con-regla', titulo: 'Caso: dice su regla y lo que le toca al Dueño', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_CASO_CON_REGLA, TARJETAS_CASO_CON_REGLA) },
  { id: 'caso-viejo', titulo: 'Caso: uno de antes, sin regla ni lo que le toca al Dueño', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_CASO_VIEJO, TARJETAS_CASO_VIEJO) },
  { id: 'caso-desenlaces', titulo: 'Caso: cada desenlace del envío, como se ve al recargar', pinta: () => panel(NEGOCIO_FUNCIONANDO, HILO_DESENLACES_DEL_ENVIO, TARJETAS_DESENLACES_DEL_ENVIO) },
  { id: 'caso-no-la-toma', titulo: 'Caso: tocar Enviar y que WhatsApp no la tome', pinta: () => publicando(NEGOCIO_FUNCIONANDO, HILO_CASO_CON_REGLA, TARJETAS_CASO_CON_REGLA, GUION_WHATSAPP_NO_LA_TOMA) },
  { id: 'casos-envio', titulo: 'Casos: lo que pasó con cada respuesta, y un Caso sin tarjeta con su regla', pinta: () => enLaSeccion(NEGOCIO_CASOS_CON_ENVIO, '/panel/casos') },
  { id: 'hilo-varias-decisiones', titulo: 'Hilo: tres decisiones a la vez', pinta: () => panel(NEGOCIO_CON_UN_CASO, HILO_VARIAS_DECISIONES, TARJETAS_VARIAS_DECISIONES) },
  { id: 'hilo-trabajando', titulo: 'Hilo: el agente trabajando', pinta: () => <MarcoDeMuestra datos={operacionDe(NEGOCIO_FUNCIONANDO)} paginas={paginasDe(NEGOCIO_FUNCIONANDO)} hilo={<HiloDeMuestra messages={HILO_TRABAJANDO} status="streaming" />} /> },
  ...ESCENAS_DE_ESTADOS,
  { id: 'componentes', titulo: 'Todos los componentes y colores', pinta: () => <Componentes /> },
]
