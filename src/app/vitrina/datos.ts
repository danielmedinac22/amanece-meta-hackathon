/** Datos inventados para pintar la vitrina. Solo `src/app/vitrina/` los importa: ninguna pantalla real los toca. */
import type { UIMessage } from 'ai'
import type { DatosDeHoy } from '@/app/panel/inicio-hoy'
import type { GuionDePublicar } from './hilo-de-muestra'
import type { CasoResuelto, DatosDeCasos } from '@/negocio/casos'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { ItemDeLoPendiente, LoPendiente, TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Supuesto } from '@/nucleo/consultas/tipos'
import type { Clave } from '@/nucleo/estado/elementos'
import type { Huella, Instante, PropuestaId } from '@/nucleo/identidad'
import type { DatosDeClientes, DatosDeConversaciones, DatosDePedidos, DetalleDeConversacion, FilaDeCliente, FilaDePedido } from '@/nucleo/listas'
import type { SeccionPintada } from '@/nucleo/panel'
import type { DatosDelTablero } from '@/nucleo/tablero'

const clave = (c: string) => c as Clave
const LINK = 'https://wa.me/000000000000?text=(LADERA)%20Hola%20Caf%C3%A9%20Ladera'
const NADA_PENDIENTE: LoPendiente = { items: [], huella: 'vitrina-sin-cambios' as Huella }

/** Lo que la cáscara de la vitrina necesita además de las páginas. */
export type NegocioDeMuestra = { nombre: string; indicadores: SeccionPintada[]; secciones: SeccionPintada[]; casos: { id: string; titulo: string; propuesta: string | null }[]; pendiente: LoPendiente; nuevos?: readonly SeccionPintada[]; hoy: DatosDeHoy; tablero: DatosDelTablero; pedidos: DatosDePedidos; clientes: DatosDeClientes; seccionDeCasos: DatosDeCasos; conversaciones: DatosDeConversaciones; detalles: Record<string, DetalleDeConversacion> }

const pedidosDeHoy: SeccionPintada = {
  clave: clave('pedidos-de-hoy'),
  tipo: 'indicador',
  nombre: 'Pedidos de hoy',
  enPalabras: 'Cuenta los pedidos creados hoy.',
  total: 1,
  mostradas: 1,
  resultado: { tipo: 'numero', valor: 14, unidad: { tipo: 'cantidad', nombre: 'pedidos' } },
  advertencias: [],
}

const ventasPorDia: SeccionPintada = {
  clave: clave('ventas-por-dia'),
  tipo: 'indicador',
  nombre: 'Ventas por día',
  enPalabras: 'Suma lo vendido cada día de la última semana.',
  total: 5,
  mostradas: 5,
  resultado: {
    tipo: 'serie',
    porTiempo: true,
    unidad: { tipo: 'dinero' },
    puntos: [
      { etiqueta: '2026-10-29', valor: 482000 },
      { etiqueta: '2026-10-30', valor: 910000 },
      { etiqueta: '2026-10-31', valor: 1284000 },
      { etiqueta: '2026-11-01', valor: 655000 },
      { etiqueta: '2026-11-02', valor: 1120000 },
    ],
  },
  advertencias: [],
}

const pedidosConNovedad: SeccionPintada = {
  clave: clave('pedidos-con-novedad'),
  tipo: 'seccion',
  nombre: 'Pedidos con novedad',
  enPalabras: 'Pedidos que la transportadora no pudo entregar.',
  total: 3,
  mostradas: 3,
  resultado: {
    tipo: 'filas',
    columnas: [
      { columna: 'cliente', titulo: 'Cliente' },
      { columna: 'ciudad', titulo: 'Ciudad' },
      { columna: 'total', titulo: 'Total' },
      { columna: 'novedad', titulo: 'Novedad' },
    ],
    filas: [
      { cliente: 'Marcela Ríos', ciudad: 'Manizales', total: 96000, novedad: 'Dirección incompleta' },
      { cliente: 'Julián Prada', ciudad: 'Bogotá', total: 184500, novedad: 'No contestó' },
      { cliente: 'Laura Gómez', ciudad: 'Pereira', total: 72000, novedad: 'Rechazó el paquete' },
    ],
  },
  advertencias: [{ tipo: 'supuesto', clave: clave('pedidos-con-novedad'), supuesto: 'Cuento como novedad todo pedido enviado que no está entregado' as Supuesto }],
}

const fallo: SeccionPintada = {
  clave: clave('devoluciones'),
  tipo: 'seccion',
  nombre: 'Devoluciones del mes',
  enPalabras: 'Pedidos devueltos desde el 1 de noviembre.',
  total: 0,
  mostradas: 0,
  resultado: { tipo: 'no_se_pudo_calcular', porQue: 'no_disponible' },
  advertencias: [],
}

const REGLAS = [
  { clave: 'envio-fuera-de-la-ciudad', texto: 'Si el pedido es para fuera de Manizales, no prometas fecha y ábreme un Caso.' },
  { clave: 'pago-contra-entrega', texto: 'Acepta pago contra entrega solo en pedidos de hasta $200.000.' },
]

const OJO_FUNCIONANDO = [
  { clave: 'pedido-37', titulo: 'Paola tiene una novedad con su envío a Pasto', detalle: 'Pedido #37 · ayer', accion: 'Ver el pedido', ruta: '/panel/pedidos' },
  { clave: 'pedido-41', titulo: 'Daniela todavía no confirma su pedido', detalle: 'Pedido #41 · $76.000 · hace 12 min', accion: 'Ver el pedido', ruta: '/panel/pedidos' },
] as const

const HOY_FUNCIONANDO: DatosDeHoy['hoy'] = {
  voz: 'tienda',
  recienAbierto: false,
  cifras: {
    semana: { ventas: 1284000, pedidos: 23, clientes: 31 },
    anterior: { ventas: 1088000, pedidos: 19 },
    conversaciones: { total: 14, resueltas: 13 },
  },
  ojo: [...OJO_FUNCIONANDO],
  ultimo: [
    { clave: 'pedido-41', texto: 'Tu agente le tomó un pedido a Daniela Quintero', cuando: 'hace 12 min' },
    { clave: 'santiago', texto: 'Santiago Herrera te escribió', cuando: 'hace 40 min' },
    { clave: 'nicolas', texto: 'Tu agente le tomó un pedido a Nicolás Aristizábal', cuando: 'hace 1 h' },
    { clave: 'andres', texto: 'Andrés Felipe Gómez te escribió', cuando: 'hace 3 h' },
  ],
}

const fila = (numero: number, cliente: string, ciudad: string, items: string, total: number, hace: string): FilaDePedido => ({ id: `p-${numero}`, numero, cliente, items, ciudad, total, hace })
const grupo = (estado: DatosDePedidos['grupos'][number]['estado'], ...filas: FilaDePedido[]) => ({ estado, cuenta: filas.length, filas })

const SIN_PEDIDOS: DatosDePedidos = { cifras: { semana: { ventas: 0, pedidos: 0, clientes: 0 }, conversaciones: { total: 0, resueltas: 0 } }, grupos: [] }
const SIN_CLIENTES: DatosDeClientes = { cuenta: 0, filas: [] }

const PEDIDOS: DatosDePedidos = {
  cifras: { semana: { ventas: 1_284_000, pedidos: 23, clientes: 31 }, conversaciones: { total: 14, resueltas: 13 } },
  grupos: [
    grupo('novedad', fila(37, 'Paola Andrea Vargas', 'Pasto', '2 tueste oscuro, molido 500 g', 72_000, 'ayer')),
    grupo('pendiente', fila(41, 'Daniela Quintero', 'Pereira', '2 tueste medio, grano 500 g', 76_000, 'hace 12 min')),
    grupo('confirmado', fila(40, 'Nicolás Aristizábal', 'Bogotá', 'Suscripción mensual', 62_000, 'hace 1 h'), fila(39, 'Andrés Felipe Gómez', 'Medellín', 'Caja regalo Ladera', 95_000, 'hace 3 h')),
    grupo('enviado', fila(38, 'Laura Valentina Pérez', 'Cali', 'Micro lote Honey, grano 250 g', 32_000, 'ayer'), fila(34, 'Santiago Herrera', 'Barranquilla', '2 tueste medio, molido 500 g', 76_000, 'hace 2 días'), fila(33, 'Luisa Fernanda Ríos', 'Cartagena', 'Caja regalo Ladera', 95_000, 'hace 3 días')),
    grupo('entregado', fila(36, 'Juan David Cárdenas', 'Bogotá', 'Molino manual de café', 119_000, 'hace 2 días'), fila(35, 'Mariana Ospina', 'Manizales', 'Tueste claro, grano 250 g', 24_000, 'hace 2 días'), fila(32, 'Carlos Mario Londoño', 'Medellín', 'Suscripción mensual', 62_000, 'hace 3 días'), fila(30, 'Sebastián Mejía', 'Bucaramanga', 'Tueste medio, molido 500 g', 38_000, 'hace 4 días'), fila(29, 'Daniela Quintero', 'Pereira', 'Micro lote Honey, grano 250 g', 32_000, 'hace 4 días')),
    grupo('cancelado', fila(31, 'Felipe Mora', 'Armenia', 'Tueste claro, molido 250 g', 24_000, 'hace 3 días')),
  ],
}

const cliente = (nombre: string, ciudad: string, pedidos: number, total: number, ultimo: string): FilaDeCliente => ({ id: nombre, nombre, ciudad, pedidos, total, ultimo })
const CLIENTES: DatosDeClientes = {
  cuenta: 7,
  filas: [
    cliente('Daniela Quintero', 'Pereira', 3, 146_000, 'hace 12 min'),
    cliente('Andrés Felipe Gómez', 'Medellín', 5, 291_000, 'hace 3 h'),
    cliente('Laura Valentina Pérez', 'Cali', 4, 164_000, 'ayer'),
    cliente('Juan David Cárdenas', 'Bogotá', 4, 257_000, 'hace 2 días'),
    cliente('Mariana Ospina', 'Manizales', 3, 98_000, 'hace 2 días'),
    cliente('Camila Rojas', 'Bogotá', 6, 342_000, 'hace 3 días'),
    cliente('+573000000000', '', 0, 0, 'hace 4 días'),
  ],
}

const NOMBRE_LARGO = 'María de los Ángeles Fernanda Aristizábal Londoño de la Espriella'
const muchasFilas = (cuenta: number, base: number) => ({
  cuenta,
  filas: Array.from({ length: 50 }, (_, i) => fila(base - i, i === 0 ? NOMBRE_LARGO : 'Daniela Quintero', 'San José del Guaviare', '2 tueste medio, grano 500 g + Molino manual de café + Caja regalo Ladera', 1_284_000, 'hace 12 min')),
})

const SIN_CASOS: DatosDeCasos = { cuentaQueEspera: 0, esperan: [], cuentaDeResueltos: 0, resueltos: [] }
const RESUELTOS: CasoResuelto[] = [
  { id: 'r-1', titulo: 'Pregunta por envío a San Andrés', resolucion: 'Se le explicó que no hay envíos a islas por ahora.', hace: 'hace 6 días', noSalio: false },
  { id: 'r-2', titulo: 'Cambio de dirección después de confirmar', resolucion: 'El pedido no había salido; se cambió la dirección.', hace: 'hace 9 días', noSalio: false },
]
const SOLO_RESUELTOS: DatosDeCasos = { ...SIN_CASOS, cuentaDeResueltos: RESUELTOS.length, resueltos: RESUELTOS }

const SIN_CONVERSACIONES: Pick<NegocioDeMuestra, 'conversaciones' | 'detalles'> = { conversaciones: { cuenta: 0, filas: [], detalle: null, enDetalle: false }, detalles: {} }

const conversacion = (cliente: string, nombre: string, hace: string, mensajes: ['cliente' | 'agente', string][], casoQueEspera: string | null = null) => ({
  fila: { cliente, nombre, ultima: mensajes.at(-1)![1], hace },
  detalle: { cliente, nombre, cuenta: mensajes.length, casoQueEspera, mensajes: mensajes.map(([de, texto], i) => ({ id: `${cliente}-${i}`, de, texto })) },
})

const conConversaciones = (lista: ReturnType<typeof conversacion>[], cuenta = lista.length): Pick<NegocioDeMuestra, 'conversaciones' | 'detalles'> => ({
  conversaciones: { cuenta, filas: lista.map((c) => c.fila), detalle: lista[0].detalle, enDetalle: false },
  detalles: Object.fromEntries(lista.map((c) => [c.fila.cliente, c.detalle])),
})

const CONVERSACIONES = conConversaciones([
  conversacion('daniela', 'Daniela Quintero', 'hace 12 min', [
    ['cliente', 'Hola, quiero pedir 2 tueste medio en grano'],
    ['agente', '¡Hola Daniela! Claro que sí. ¿Dónde te lo entregamos?'],
    ['cliente', 'A Pereira, Carrera 8 # 21-40'],
    ['agente', 'Listo, tu pedido #41 por $76.000 quedó por confirmar. Pagas contra entrega.'],
  ]),
  conversacion('santiago', 'Santiago Herrera', 'hace 40 min', [
    ['cliente', 'Buenas, tengo greca en la casa'],
    ['cliente', '¿Cuál me recomiendas para greca?'],
  ]),
  conversacion(
    'camila',
    'Camila Rojas',
    'hace 1 h',
    [
      ['cliente', 'Hola, ya me llegó el pedido'],
      ['cliente', 'Una bolsa llegó abierta, te mando foto.'],
      ['agente', 'Qué pena, Camila. Ya le aviso a Lucía para resolverlo.'],
    ],
    'La bolsa llegó rota',
  ),
  conversacion('sebastian', 'Sebastián Mejía', 'hace 2 h', [
    ['cliente', '¿Para filtro cuál va bien?'],
    ['agente', 'Con el tueste medio molido vas bien.'],
  ]),
  conversacion('sin-nombre', '+573001112233', 'ayer', [['cliente', 'Hola, ¿tienen envío a Pasto?']]),
])

const MENSAJE_LARGO = 'Buenas tardes, quisiera saber si me pueden enviar el pedido a la vereda La Esperanza, kilómetro 14 de la vía antigua, porque la dirección que aparece en la guía no es la correcta y el mensajero no ha podido llegar.'
const UNA_LARGA = conversacion('larga', NOMBRE_LARGO, 'hace 12 min', Array.from({ length: 200 }, (_, i): ['cliente' | 'agente', string] => [i % 2 ? 'agente' : 'cliente', i === 199 ? 'httpsenlacesinespaciosquenoterminanuncaporquenadielepusoespaciosenningunapartedelmensajeyasiquedoguardado' : MENSAJE_LARGO]), 'Quiere 20 bolsas de café para un evento en Cali')
const MUCHAS_CONVERSACIONES = conConversaciones([{ ...UNA_LARGA, detalle: { ...UNA_LARGA.detalle, cuenta: 1_204 } }, ...Array.from({ length: 99 }, (_, i) => conversacion(`c-${i}`, `Cliente de muestra ${i}`, 'hace 3 días', [['cliente', MENSAJE_LARGO]]))], 1_204)

const TABLERO: DatosDelTablero = {
  voz: 'tienda',
  cifras: { semana: { ventas: 1_284_000, pedidos: 23, clientes: 31 }, anterior: { ventas: 1_088_000, pedidos: 19 }, conversaciones: { total: 14, resueltas: 13 } },
  porAtender: { casos: 0, novedad: 1, pendiente: 1 },
  porDia: [
    { dia: '2026-10-28', pedidos: 3 },
    { dia: '2026-10-29', pedidos: 5 },
    { dia: '2026-10-30', pedidos: 4 },
    { dia: '2026-10-31', pedidos: 8 },
    { dia: '2026-11-01', pedidos: 0 },
    { dia: '2026-11-02', pedidos: 2 },
    { dia: '2026-11-03', pedidos: 6 },
  ],
  porEstado: [
    { estado: 'novedad', cuenta: 1 },
    { estado: 'pendiente', cuenta: 1 },
    { estado: 'confirmado', cuenta: 6 },
    { estado: 'enviado', cuenta: 9 },
    { estado: 'entregado', cuenta: 12 },
    { estado: 'cancelado', cuenta: 1 },
  ],
  recientes: [
    { id: 'r-41', numero: 41, cliente: 'Daniela Quintero', ciudad: 'Pereira', items: '2 tueste medio, grano 500 g', total: 76_000, estado: 'pendiente' },
    { id: 'r-40', numero: 40, cliente: 'Andrés Salazar', ciudad: 'Manizales', items: 'Tueste oscuro, molido 250 g', total: 22_000, estado: 'confirmado' },
    { id: 'r-39', numero: 39, cliente: 'Paola Rojas', ciudad: 'Pasto', items: 'Tueste medio, grano 500 g + Molino manual', total: 118_000, estado: 'novedad' },
    { id: 'r-38', numero: 38, cliente: 'Sara Montoya', ciudad: 'Armenia', items: 'Tueste claro, grano 250 g', total: 26_000, estado: 'enviado' },
    { id: 'r-37', numero: 37, cliente: 'Julián Ramírez', ciudad: 'Bogotá', items: '3 tueste medio, grano 500 g', total: 114_000, estado: 'entregado' },
  ],
}

const TABLERO_VACIO: DatosDelTablero = {
  voz: 'tienda',
  cifras: { semana: { ventas: 0, pedidos: 0, clientes: 0 }, anterior: { ventas: 0, pedidos: 0 }, conversaciones: { total: 0, resueltas: 0 } },
  porAtender: { casos: 0, novedad: 0, pendiente: 0 },
  porDia: TABLERO.porDia.map((d) => ({ ...d, pedidos: 0 })),
  porEstado: [],
  recientes: [],
}

/** Treinta días que suben hasta millones. Cada etiqueta es una fecha distinta y el último punto es el más alto. */
const ventasDeUnMes: SeccionPintada = {
  ...ventasPorDia,
  clave: clave('ventas-del-mes'),
  nombre: 'Ventas de los últimos 30 días, con un nombre tan largo que necesita dos renglones en el teléfono',
  total: 30,
  mostradas: 30,
  resultado: { tipo: 'serie', porTiempo: true, unidad: { tipo: 'dinero' }, puntos: Array.from({ length: 30 }, (_, i) => ({ etiqueta: `2026-10-${String(i + 1).padStart(2, '0')}`, valor: 40_000 * (i + 1) * (i + 1) })) },
}

const ventasPorCiudad: SeccionPintada = {
  ...ventasPorDia,
  clave: clave('ventas-por-ciudad'),
  nombre: 'Ventas por ciudad',
  enPalabras: 'Suma lo vendido en cada ciudad este mes.',
  total: 3,
  mostradas: 3,
  resultado: {
    tipo: 'serie',
    porTiempo: false,
    unidad: { tipo: 'dinero' },
    puntos: [
      { etiqueta: 'San José del Guaviare y municipios cercanos del departamento', valor: 12_840_000 },
      { etiqueta: 'Manizales', valor: 4_120_000 },
      { etiqueta: 'Pereira', valor: 910_000 },
    ],
  },
}

const COLUMNAS_LARGAS = ['Cliente', 'Ciudad', 'Transportadora', 'Guía', 'Días', 'Dirección', 'Total', 'Novedad'].map((titulo) => ({ columna: titulo.toLowerCase(), titulo }))

/** Ocho columnas, valores sin espacios para partir y más filas que las que caben. */
const seccionLarga: SeccionPintada = {
  clave: clave('seccion-larga'),
  tipo: 'seccion',
  nombre: 'Envíos por transportadora',
  enPalabras: 'Cada pedido enviado este mes, con su guía y lo que pasó.',
  total: 312,
  mostradas: 50,
  resultado: {
    tipo: 'filas',
    columnas: COLUMNAS_LARGAS,
    filas: Array.from({ length: 50 }, (_, i) => ({ cliente: i === 0 ? NOMBRE_LARGO : `Cliente de muestra ${i}`, ciudad: 'San José del Guaviare', transportadora: 'Interrapidísimo', 'guía': `GUIA-0000-1111-2222-3333-${i}`, 'días': 4 + i, 'dirección': 'Calle 12 # 34-56, barrio La Esperanza, casa de la esquina', total: 12_840_000, novedad: 'La-transportadora-no-encontró-la-dirección-del-Cliente' })),
  },
  advertencias: [{ tipo: 'filas_recortadas', clave: clave('seccion-larga'), total: 312, mostradas: 50 }],
}

const seccionSinFilas: SeccionPintada = {
  clave: clave('devoluciones-de-hoy'),
  tipo: 'seccion',
  nombre: 'Devoluciones de hoy',
  enPalabras: 'Pedidos devueltos hoy.',
  total: 0,
  mostradas: 0,
  resultado: { tipo: 'filas', columnas: [{ columna: 'cliente', titulo: 'Cliente' }], filas: [] },
  advertencias: [],
}

export const NEGOCIO_FUNCIONANDO: NegocioDeMuestra = {
  nombre: 'Café Ladera',
  pendiente: NADA_PENDIENTE,
  hoy: { hoy: HOY_FUNCIONANDO, link: LINK, reglas: REGLAS },
  tablero: TABLERO,
  pedidos: PEDIDOS,
  clientes: CLIENTES,
  seccionDeCasos: SOLO_RESUELTOS,
  ...CONVERSACIONES,
  indicadores: [pedidosDeHoy, ventasPorDia],
  secciones: [pedidosConNovedad, fallo, seccionSinFilas],
  casos: [],
}

const CASO_DE_MUESTRA = { id: 'caso-1', titulo: 'Quiere 20 bolsas de café para un evento en Cali', propuesta: 'Ofrecerle 10% de descuento y entrega en 4 días' }

const NADA_TODAVIA = { semana: { ventas: 0, pedidos: 0, clientes: 0 }, anterior: { ventas: 0, pedidos: 0 }, conversaciones: { total: 0, resueltas: 0 } }

export const NEGOCIO_RECIEN_ABIERTO: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  pedidos: SIN_PEDIDOS,
  clientes: SIN_CLIENTES,
  seccionDeCasos: SIN_CASOS,
  ...SIN_CONVERSACIONES,
  hoy: { hoy: { voz: 'tienda', recienAbierto: true, cifras: NADA_TODAVIA, ojo: [], ultimo: [] }, link: LINK, reglas: [] },
  tablero: TABLERO_VACIO,
  indicadores: [],
}

export const NEGOCIO_CON_MUCHAS_FILAS: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  indicadores: [pedidosDeHoy, ventasDeUnMes, ventasPorCiudad],
  secciones: [seccionLarga],
  tablero: {
    ...TABLERO,
    cifras: { ...TABLERO.cifras, semana: { ventas: 12_840_000, pedidos: 1_204, clientes: 3_120 }, conversaciones: { total: 1_400, resueltas: 1_312 } },
    porAtender: { casos: 60, novedad: 124, pendiente: 312 },
    porDia: TABLERO.porDia.map((d, i) => ({ ...d, pedidos: 1_000 + i * 240 })),
    recientes: TABLERO.recientes.map((r) => ({ ...r, cliente: NOMBRE_LARGO, ciudad: 'San José del Guaviare', total: 12_840_000, estado: 'pendiente' as const })),
  },
  pedidos: {
    ...PEDIDOS,
    grupos: [
      { estado: 'pendiente', ...muchasFilas(312, 9_999) },
      { estado: 'entregado', ...muchasFilas(12_480, 9_949) },
    ],
  },
  clientes: {
    cuenta: 1_204,
    filas: Array.from({ length: 100 }, (_, i) => cliente(i === 0 ? NOMBRE_LARGO : `Cliente de muestra ${i}`, 'San José del Guaviare', 1_204, 12_840_000, 'hace 12 min')),
  },
  seccionDeCasos: {
    cuentaQueEspera: 60,
    esperan: Array.from({ length: 50 }, (_, i) => ({ id: `e-${i}`, titulo: `${MENSAJE_LARGO} ${i}`, quien: `${NOMBRE_LARGO} · pedido #${1_000 + i}`, detalle: MENSAJE_LARGO, propuesta: '', hace: 'hace 3 días', decision: null })),
    cuentaDeResueltos: 1_204,
    resueltos: Array.from({ length: 50 }, (_, i) => ({ id: `m-${i}`, titulo: MENSAJE_LARGO, resolucion: MENSAJE_LARGO, hace: 'hace 12 min', noSalio: i === 0 })),
  },
  ...MUCHAS_CONVERSACIONES,
}

export const NEGOCIO_SIN_VENTAS: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  hoy: {
    hoy: {
      voz: 'tienda',
      recienAbierto: false,
      cifras: { ...NADA_TODAVIA, semana: { ventas: 0, pedidos: 0, clientes: 1 }, conversaciones: { total: 1, resueltas: 1 } },
      ojo: [],
      ultimo: [{ clave: 'santiago', texto: 'Santiago Herrera te escribió', cuando: 'hace 40 min' }],
    },
    link: LINK,
    reglas: [],
  },
}

export const NEGOCIO_AGENDA: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  nombre: 'Barbería Central',
  tablero: { ...TABLERO_VACIO, voz: 'agenda', cifras: { ...TABLERO_VACIO.cifras, semana: { ventas: 0, pedidos: 0, clientes: 12 }, conversaciones: { total: 4, resueltas: 3 } }, porAtender: { casos: 1, novedad: 0, pendiente: 0 } },
  indicadores: [],
  hoy: {
    hoy: {
      voz: 'agenda',
      recienAbierto: false,
      cifras: { ...NADA_TODAVIA, semana: { ventas: 0, pedidos: 0, clientes: 12 }, conversaciones: { total: 4, resueltas: 3 } },
      ojo: [{ clave: 'caso-2', titulo: 'Pregunta si atienden el festivo', detalle: 'Julián Ramírez', accion: 'Decidir', ruta: '/panel/casos' }],
      ultimo: [{ clave: 'julian', texto: 'Julián Ramírez te escribió', cuando: 'hace 8 min' }],
    },
    link: LINK,
    reglas: [],
  },
}

const tarjeta = (propuesta: string, accion: TarjetaDeAprobacion['accion'], lineas: string[], advertencias: string[] = []): TarjetaDeAprobacion => ({
  propuesta: propuesta as PropuestaId,
  huella: `huella-${propuesta}` as Huella,
  vence: new Date('2030-01-01T00:00:00Z').toISOString() as Instante,
  advertencias,
  lineas,
  accion,
})

const mensaje = (id: string, role: 'user' | 'assistant', ...partes: object[]) => ({ id, role, parts: partes }) as UIMessage
const texto = (text: string) => ({ type: 'text', text })
const conTarjeta = (herramienta: string, t: TarjetaDeAprobacion) => ({
  type: `tool-${herramienta}`,
  toolCallId: `llamada-${t.propuesta}`,
  state: 'output-available',
  input: {},
  output: { resumen: 'Preparado', tarjeta: t },
})

export const HILO_ARMANDOSE: UIMessage[] = [
  mensaje('a1', 'user', texto('Vendo café de especialidad en Manizales')),
  mensaje('a2', 'assistant', texto('Qué rico. Cuéntame cómo se llama tu negocio y cuánto cuesta una bolsa de 250 g.')),
]

const trabajando = (herramienta: string) => ({ type: `tool-${herramienta}`, toolCallId: `llamada-${herramienta}`, state: 'input-available', input: {} })

const REGLA = tarjeta('p-regla', 'aplicar', ['Regla nueva: si el pedido es para fuera de Manizales, no prometer fecha y abrir un Caso.'], ['Esta regla cambia lo que le dice tu agente a los clientes.'])
const CASO = tarjeta('p-caso', 'enviar', ['Responderle a Marcela Ríos: «El envío a Cali cuesta $12.000 y llega en 3 días hábiles.»'])

export const HILO_CON_UN_CASO: UIMessage[] = [
  mensaje('c1', 'user', texto('Cuando un pedido sea para fuera de mi ciudad, no prometas fecha')),
  mensaje('c2', 'assistant', texto('Listo, te dejo la regla para que la apruebes.'), conTarjeta('proponer', REGLA)),
  mensaje('c3', 'assistant', texto('Una clienta preguntó por un envío y necesita tu OK.'), { type: 'data-tarjeta', data: CASO }),
]

const estadoDe = (estado: EstadoDeTarjeta['estado'], accion: TarjetaDeAprobacion['accion'], asunto: EstadoDeTarjeta['asunto'], aprobadaPor: string | null = null, publicada = false): EstadoDeTarjeta => ({ estado, accion, aprobadaPor, asunto, publicada })
const ES_REGLA = { tipo: 'elemento', que: 'regla', clave: null } as const
const CASO_DE_MARCELA = { tipo: 'caso', titulo: 'Quiere saber cuánto cuesta un envío', pedido: 31, cliente: 'Marcela Ríos', escribio: '¿Cuánto cuesta enviar a Cali?', respuesta: 'El envío a Cali cuesta $12.000 y llega en 3 días hábiles.' } as const

export const TARJETAS_CON_UN_CASO: Record<string, EstadoDeTarjeta> = {
  'p-regla': estadoDe('aplicada', 'aplicar', ES_REGLA, 'Daniela'),
  'p-caso': estadoDe('espera_al_dueno', 'enviar', CASO_DE_MARCELA),
}

const VENCIDA = { ...tarjeta('c-vencida', 'aplicar', ['Cerrar los domingos en diciembre']), vence: '2020-01-01T00:00:00.000Z' as Instante }
const SIN_ESTADO_VENCIDA = { ...tarjeta('c-sin-estado', 'enviar', ['Responderle a Marcela Ríos: «Hola, ya te confirmo.»']), vence: '2020-01-01T00:00:00.000Z' as Instante }

export const HILO_CONSTANCIAS: UIMessage[] = [
  mensaje('k0', 'assistant', texto('Así queda cada tarjeta cuando ya se resolvió.')),
  mensaje('k1', 'assistant', { type: 'data-tarjeta', data: tarjeta('c-enviada', 'enviar', ['Responderle a Camila Rojas: «Hola Camila, te la repongo sin costo.»']) }),
  mensaje('k2', 'assistant', { type: 'data-tarjeta', data: tarjeta('c-aplicada', 'aplicar', ['Si el pedido pasa de $150.000, el envío es gratis']) }),
  mensaje('k2b', 'assistant', { type: 'data-tarjeta', data: tarjeta('c-publicada', 'aplicar', ['Si el pedido pasa de $150.000, el envío es gratis']) }),
  mensaje('k2c', 'assistant', { type: 'data-tarjeta', data: tarjeta('c-indicador-publicado', 'deshacer', ['Indicador nuevo «Pedidos de hoy»: Cuenta los pedidos creados hoy.']) }),
  mensaje('k3', 'assistant', { type: 'data-tarjeta', data: tarjeta('c-revertida', 'aplicar', ['Ticket promedio por ciudad']) }),
  mensaje('k4', 'assistant', { type: 'data-tarjeta', data: tarjeta('c-descartada', 'aplicar', ['Devoluciones del mes']) }),
  mensaje('k5', 'assistant', { type: 'data-tarjeta', data: VENCIDA }),
  mensaje('k6', 'assistant', { type: 'data-tarjeta', data: SIN_ESTADO_VENCIDA }),
]

export const TARJETAS_CONSTANCIAS: Record<string, EstadoDeTarjeta> = {
  'c-enviada': estadoDe('aplicada', 'enviar', { tipo: 'caso', titulo: 'La bolsa llegó rota', pedido: 31, cliente: 'Camila Rojas', escribio: 'Una de las bolsas llegó abierta y con café regado dentro de la caja.', respuesta: 'Hola Camila, te la repongo sin costo.' }, 'Lucía'),
  'c-aplicada': estadoDe('aplicada', 'aplicar', ES_REGLA, 'Julián'),
  'c-publicada': estadoDe('aplicada', 'aplicar', ES_REGLA, 'Julián', true),
  'c-indicador-publicado': estadoDe('aplicada', 'deshacer', { tipo: 'elemento', que: 'indicador', clave: null }, 'Julián', true),
  'c-revertida': estadoDe('revertida', 'aplicar', { tipo: 'elemento', que: 'indicador', clave: null }, 'Julián'),
  'c-descartada': estadoDe('descartada', 'aplicar', { tipo: 'elemento', que: 'seccion', clave: null }),
  'c-vencida': estadoDe('vencida', 'aplicar', ES_REGLA),
}

const vence = (t: TarjetaDeAprobacion, cuando: string) => ({ ...t, vence: new Date(cuando).toISOString() as Instante })

export const HILO_VARIAS_DECISIONES: UIMessage[] = [
  mensaje('v1', 'assistant', texto('Te dejé esta regla para que la mires.'), { type: 'data-tarjeta', data: vence(tarjeta('v-regla', 'aplicar', ['Si el pedido pasa de $150.000, el envío es gratis']), '2030-01-01T00:00:00Z') }),
  mensaje('v2', 'assistant', texto('Una clienta preguntó por un envío y necesita tu OK.'), { type: 'data-tarjeta', data: vence(tarjeta('v-caso', 'enviar', ['Responderle a Marcela Ríos: «El envío a Cali cuesta $12.000.»']), '2030-01-02T00:00:00Z') }),
  mensaje('v3', 'assistant', texto('Otra regla, por si te sirve.'), { type: 'data-tarjeta', data: vence(tarjeta('v-otra', 'aplicar', ['No prometer fecha fuera de Manizales']), '2030-01-03T00:00:00Z') }),
]

export const TARJETAS_VARIAS_DECISIONES: Record<string, EstadoDeTarjeta> = {
  'v-regla': estadoDe('espera_al_dueno', 'aplicar', ES_REGLA),
  'v-caso': estadoDe('espera_al_dueno', 'enviar', CASO_DE_MARCELA),
  'v-otra': estadoDe('espera_al_dueno', 'aplicar', ES_REGLA),
}

export const HILO_TRABAJANDO: UIMessage[] = [mensaje('t1', 'user', texto('Quiero ver los pedidos confirmados por día')), mensaje('t2', 'assistant', { ...conTarjeta('ver_negocio', tarjeta('t-nada', 'deshacer', [])), output: { resumen: 'Listo', tarjeta: null } }, trabajando('proponer'))]

export const NEGOCIO_CON_CAMBIOS: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  pendiente: {
    huella: 'vitrina-con-cambios' as Huella,
    items: [
      { clave: clave('regla-fuera-de-ciudad'), linea: 'Si un pedido es para fuera de Manizales, ábreme un Caso y no prometas fecha.', loNotan: 'clientes', aplicadoPor: 'Lucía' },
      { clave: clave('pedidos-de-hoy'), linea: 'Pedidos de hoy', loNotan: 'equipo', aplicadoPor: null },
    ],
  },
}

export const NEGOCIO_CON_UN_CASO: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  casos: [CASO_DE_MUESTRA],
  seccionDeCasos: { ...SOLO_RESUELTOS, cuentaQueEspera: 1, esperan: [{ id: 'caso-1', titulo: CASO_DE_MARCELA.titulo, quien: 'Marcela Ríos · pedido #31', detalle: '', propuesta: '', hace: 'hace 12 min', decision: { tarjeta: CASO, estado: TARJETAS_CON_UN_CASO['p-caso'] } }] },
  hoy: {
    hoy: {
      ...HOY_FUNCIONANDO,
      ojo: [{ clave: 'caso-1', titulo: CASO_DE_MUESTRA.titulo, detalle: 'Marcela Ríos · pedido #44', accion: 'Decidir', ruta: '/panel/casos' }, ...OJO_FUNCIONANDO],
    },
    link: LINK,
    reglas: REGLAS,
  },
}

const decisionDe = (id: string, estado: EstadoDeTarjeta['estado']) => ({ tarjeta: { ...tarjeta(id, 'enviar', []), vence: '2020-01-01T00:00:00.000Z' as Instante }, estado: estadoDe(estado, 'enviar', CASO_DE_MARCELA) })

/** Cada forma de seguir esperando sin un botón vivo, y una respuesta aprobada que no llegó. */
export const NEGOCIO_CASOS_SIN_BOTON: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  casos: [CASO_DE_MUESTRA, CASO_DE_MUESTRA, CASO_DE_MUESTRA],
  seccionDeCasos: {
    cuentaQueEspera: 3,
    esperan: [
      { id: 's-1', titulo: 'Pide factura a nombre de su empresa', quien: 'Julián Ramírez', detalle: 'Necesita factura electrónica y el agente no tiene cómo generarla.', propuesta: 'Responderle: "Hola Julián, ya te confirmo lo de la factura."\nPor tu lado: revisar si se puede facturar a empresa.', hace: 'ayer', decision: null },
      { id: 's-2', titulo: CASO_DE_MARCELA.titulo, quien: 'Marcela Ríos · pedido #31', detalle: '', propuesta: '', hace: 'hace 2 días', decision: decisionDe('s-descartada', 'descartada') },
      { id: 's-3', titulo: CASO_DE_MARCELA.titulo, quien: 'Marcela Ríos · pedido #31', detalle: '', propuesta: '', hace: 'hace 3 días', decision: decisionDe('s-vencida', 'vencida') },
    ],
    cuentaDeResueltos: 1,
    resueltos: [{ id: 's-4', titulo: 'La bolsa llegó rota', resolucion: 'Hola Camila, te la repongo sin costo.', hace: 'hace 3 h', noSalio: true }],
  },
}

const INDICADOR_NUEVO: SeccionPintada = {
  clave: clave('pedidos-confirmados-por-dia'),
  tipo: 'indicador',
  nombre: 'Pedidos confirmados por día',
  enPalabras: 'Cuenta los pedidos confirmados de cada día de esta semana.',
  total: 6,
  mostradas: 6,
  resultado: {
    tipo: 'serie',
    porTiempo: true,
    unidad: { tipo: 'cantidad', nombre: 'pedidos' },
    puntos: [
      { etiqueta: '2026-10-28', valor: 4 },
      { etiqueta: '2026-10-29', valor: 7 },
      { etiqueta: '2026-10-30', valor: 5 },
      { etiqueta: '2026-10-31', valor: 9 },
      { etiqueta: '2026-11-01', valor: 3 },
      { etiqueta: '2026-11-02', valor: 5 },
    ],
  },
  advertencias: [],
}
const ITEM_INDICADOR: ItemDeLoPendiente = { clave: INDICADOR_NUEVO.clave, linea: `Indicador nuevo «${INDICADOR_NUEVO.nombre}»: ${INDICADOR_NUEVO.enPalabras}`, loNotan: 'equipo', aplicadoPor: 'Lucía' }
const ITEM_REGLA: ItemDeLoPendiente = { clave: clave('regla:envio-gratis'), linea: 'Regla nueva: «Si el pedido pasa de $150.000, el envío es gratis»', loNotan: 'clientes', aplicadoPor: 'Lucía' }
const conPendiente = (items: ItemDeLoPendiente[]): LoPendiente => ({ huella: 'vitrina-publicar' as Huella, items })
const ES_INDICADOR = { tipo: 'elemento', que: 'indicador', clave: INDICADOR_NUEVO.clave } as const

const TARJETA_INDICADOR = tarjeta('p-indicador', 'deshacer', [ITEM_INDICADOR.linea])
export const HILO_UN_INDICADOR: UIMessage[] = [
  mensaje('i1', 'user', texto('Quiero ver los pedidos confirmados por día')),
  mensaje('i2', 'assistant', texto('Ya lo puse en tu vista previa, con tus pedidos de esta semana. Cuando te guste, tócale Publicar.'), conTarjeta('proponer', TARJETA_INDICADOR)),
]
export const TARJETAS_UN_INDICADOR: Record<string, EstadoDeTarjeta> = { 'p-indicador': estadoDe('aplicada', 'deshacer', ES_INDICADOR, 'Lucía') }
export const GUION_UN_INDICADOR: GuionDePublicar = { cambios: { 'p-indicador': ITEM_INDICADOR } }
export const NEGOCIO_UN_INDICADOR: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  indicadores: [...NEGOCIO_FUNCIONANDO.indicadores, INDICADOR_NUEVO],
  nuevos: [INDICADOR_NUEVO],
  pendiente: conPendiente([ITEM_INDICADOR]),
}

const OTRO_CAMBIO: ItemDeLoPendiente = { clave: clave('dato:horario'), linea: 'Horario: «De 8 a 6» → «De 9 a 6»', loNotan: 'clientes', aplicadoPor: 'Julián' }
export const GUION_OTRO_DUENO: GuionDePublicar = { ...GUION_UN_INDICADOR, respuestas: [{ tipo: 'cambio', pendiente: conPendiente([OTRO_CAMBIO, ITEM_INDICADOR]) }] }
export const GUION_FALLA: GuionDePublicar = { ...GUION_UN_INDICADOR, respuestas: [{ tipo: 'error', mensaje: 'No pude publicar. Vuelve a tocar el botón en un momento.' }] }

const TARJETA_REGLA_NUEVA = tarjeta('p-envio-gratis', 'aplicar', [ITEM_REGLA.linea])
export const HILO_UNA_REGLA: UIMessage[] = [
  mensaje('r1', 'user', texto('Si el pedido pasa de $150.000, el envío es gratis')),
  mensaje('r2', 'assistant', texto('Así le respondería a un Cliente. No le escribí a nadie.'), conTarjeta('proponer', TARJETA_REGLA_NUEVA)),
]
export const TARJETAS_UNA_REGLA: Record<string, EstadoDeTarjeta> = { 'p-envio-gratis': estadoDe('espera_al_dueno', 'aplicar', ES_REGLA) }
export const GUION_UNA_REGLA: GuionDePublicar = { cambios: { 'p-envio-gratis': ITEM_REGLA } }

const SECCION_QUE_LLEGA: SeccionPintada = { ...NEGOCIO_FUNCIONANDO.secciones[0], clave: clave('pedidos-por-ciudad'), nombre: 'Pedidos por ciudad', enPalabras: 'Lista los pedidos de esta semana con su ciudad.', advertencias: [] }
const ITEM_SECCION: ItemDeLoPendiente = { clave: SECCION_QUE_LLEGA.clave, linea: `Sección nueva «${SECCION_QUE_LLEGA.nombre}»: ${SECCION_QUE_LLEGA.enPalabras}`, loNotan: 'equipo', aplicadoPor: 'Lucía' }
const TARJETA_SECCION = tarjeta('p-seccion', 'deshacer', [ITEM_SECCION.linea])
export const GUION_LLEGA_UNA_SECCION: { seccion: SeccionPintada; guion: GuionDePublicar } = {
  seccion: SECCION_QUE_LLEGA,
  guion: {
    cambios: { 'p-seccion': ITEM_SECCION },
    llega: {
      mensaje: mensaje('s1', 'assistant', texto('Ya la puse en tu vista previa. Cuando te guste, tócale Publicar.'), conTarjeta('proponer', TARJETA_SECCION)),
      seccion: { clave: SECCION_QUE_LLEGA.clave, nombre: SECCION_QUE_LLEGA.nombre },
      item: ITEM_SECCION,
      estado: { 'p-seccion': estadoDe('aplicada', 'deshacer', { tipo: 'elemento', que: 'seccion', clave: SECCION_QUE_LLEGA.clave }, 'Lucía') },
    },
  },
}

export const NEGOCIO_SECCION_SIN_PUBLICAR: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  pendiente: conPendiente([{ clave: clave('pedidos-con-novedad'), linea: 'Sección nueva «Pedidos con novedad»: Lista los pedidos con novedad.', loNotan: 'equipo', aplicadoPor: 'Lucía' }]),
}

export const NEGOCIO_MUCHOS_CAMBIOS: NegocioDeMuestra = {
  ...NEGOCIO_FUNCIONANDO,
  pendiente: conPendiente(
    Array.from({ length: 14 }, (_, i) => ({
      clave: clave(`cambio-${i}`),
      linea: i % 2 ? `Regla nueva: «Si un pedido es para fuera de Manizales y pasa de $150.000, ábreme un Caso, no prometas fecha y dile al Cliente que le confirmo el envío antes de las 6 de la tarde (${i})»` : `Indicador nuevo «Pedidos confirmados por ciudad ${i}»: Cuenta los pedidos confirmados de cada ciudad.`,
      loNotan: i % 2 ? ('clientes' as const) : ('equipo' as const),
      aplicadoPor: i % 3 ? 'María Fernanda Quintero Londoño' : null,
    })),
  ),
}
