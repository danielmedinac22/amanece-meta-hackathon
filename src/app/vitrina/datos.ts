/** Datos inventados para pintar la vitrina. Solo `src/app/vitrina/` los importa: ninguna pantalla real los toca. */
import type { UIMessage } from 'ai'
import type { DatosDelNegocio } from '@/app/panel/vista'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { LoPendiente, TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Supuesto } from '@/nucleo/consultas/tipos'
import type { Clave } from '@/nucleo/estado/elementos'
import type { Huella, Instante, PropuestaId } from '@/nucleo/identidad'
import type { SeccionPintada } from '@/nucleo/panel'

const clave = (c: string) => c as Clave
const LINK = 'https://wa.me/573000000000?text=Hola%20Caf%C3%A9%20Ladera%20LADERA'
const NADA_PENDIENTE: LoPendiente = { items: [], huella: 'vitrina-sin-cambios' as Huella }

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

export const NEGOCIO_ARMANDOSE: DatosDelNegocio = {
  nombre: 'Café Ladera',
  detalle: 'Armándose · 0 productos',
  link: null,
  pendiente: NADA_PENDIENTE,
  indicadores: [],
  secciones: [],
  casos: [],
  reglas: [],
}

export const NEGOCIO_FUNCIONANDO: DatosDelNegocio = {
  nombre: 'Café Ladera',
  detalle: 'Café de especialidad · Manizales · 12 productos',
  link: LINK,
  pendiente: NADA_PENDIENTE,
  indicadores: [pedidosDeHoy, ventasPorDia],
  secciones: [pedidosConNovedad, fallo],
  casos: [],
  reglas: [
    { clave: 'envio-fuera-de-la-ciudad', texto: 'Si el pedido es para fuera de Manizales, no prometas fecha y ábreme un Caso.' },
    { clave: 'pago-contra-entrega', texto: 'Acepta pago contra entrega solo en pedidos de hasta $200.000.' },
  ],
}

export const NEGOCIO_CON_UN_CASO: DatosDelNegocio = {
  ...NEGOCIO_FUNCIONANDO,
  casos: [{ id: 'caso-1', titulo: 'Quiere 20 bolsas de café para un evento en Cali', propuesta: 'Ofrecerle 10% de descuento y entrega en 4 días' }],
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

const REGLA = tarjeta('p-regla', 'aplicar', ['Regla nueva: si el pedido es para fuera de Manizales, no prometer fecha y abrir un Caso.'], ['Esta regla cambia lo que le dice tu agente a los clientes.'])
const CASO = tarjeta('p-caso', 'enviar', ['Marcela Ríos escribió: ¿Cuánto cuesta enviar a Cali?', 'Respuesta propuesta: El envío a Cali cuesta $12.000 y llega en 3 días hábiles.'])

export const HILO_CON_UN_CASO: UIMessage[] = [
  mensaje('c1', 'user', texto('Cuando un pedido sea para fuera de mi ciudad, no prometas fecha')),
  mensaje('c2', 'assistant', texto('Listo, te dejo la regla para que la apruebes.'), conTarjeta('proponer', REGLA)),
  mensaje('c3', 'assistant', texto('Una clienta preguntó por un envío y necesita tu OK.'), conTarjeta('proponer', CASO)),
]

export const TARJETAS_CON_UN_CASO: Record<string, EstadoDeTarjeta> = {
  'p-regla': { estado: 'aplicada', accion: 'aplicar', aprobadaPor: 'Daniela' },
  'p-caso': { estado: 'espera_al_dueno', accion: 'enviar', aprobadaPor: null },
}

export const NEGOCIO_CON_CAMBIOS: DatosDelNegocio = {
  ...NEGOCIO_FUNCIONANDO,
  pendiente: {
    huella: 'vitrina-con-cambios' as Huella,
    items: [
      { clave: clave('regla-fuera-de-ciudad'), linea: 'Si un pedido es para fuera de Manizales, ábreme un Caso y no prometas fecha.', loNotan: 'clientes', aplicadoPor: 'Lucía' },
      { clave: clave('pedidos-de-hoy'), linea: 'Pedidos de hoy', loNotan: 'equipo', aplicadoPor: null },
    ],
  },
}
