import { PARTIDAS, type IdDePlantilla } from '@/nucleo/plantillas'

export type Tono = 'bien' | 'ojo' | 'nada'

/** Solo las Secciones que tiene un Panel de verdad. Algo que el Panel no tiene no se puede poner en una tarjeta. */
export type SeccionDePlantilla = 'Inicio' | 'Casos' | 'Agenda' | 'Conversaciones' | 'Pedidos' | 'Clientes' | 'Tablero'

export type Plantilla = {
  id: IdDePlantilla
  nombre: string
  promesa: string
  negocio: string
  secciones: SeccionDePlantilla[]
  indicadores: { dato: string; valor: string }[]
  barras: number[]
  tituloBarras: string
  filas: { nombre: string; detalle: string; estado: string; tono: Tono }[]
  chat: { de: 'cliente' | 'agente'; texto: string }[]
  globos: { de: 'cliente' | 'agente'; texto: string }[]
}

/**
 * Negocios inventados, a propósito y a la vista de todos: `DESIGN.md` los pide así. Nada de aquí sale de un Negocio ni
 * entra a uno. Lo que muestran es lo que el producto hace hoy: lo que falta para el texto del prototipo está en `tanda.md`.
 */
export const PLANTILLAS: Plantilla[] = [
  {
    id: 'tienda',
    nombre: PARTIDAS.tienda.nombre,
    promesa: 'Toma pedidos, los confirma y te muestra lo que se vendió.',
    negocio: 'Tienda Nativa',
    secciones: ['Inicio', 'Pedidos', 'Conversaciones', 'Clientes'],
    indicadores: [
      { dato: 'Ventas de la semana', valor: '$840.000' },
      { dato: 'Por confirmar', valor: '8' },
      { dato: 'Conversaciones', valor: '46' },
    ],
    barras: [18, 24, 21, 30, 27, 36, 32],
    tituloBarras: 'Pedidos por día',
    filas: [
      { nombre: 'Diana Salazar', detalle: 'Bucaramanga · $89.000', estado: 'Por confirmar', tono: 'nada' },
      { nombre: 'Óscar Peña', detalle: 'Neiva · $124.000', estado: 'Confirmado', tono: 'bien' },
      { nombre: 'Yuli Cortés', detalle: 'Ibagué · $65.000', estado: 'Confirmado', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Hola, quiero la mochila negra. Pago al recibir.' },
      { de: 'agente', texto: 'Hola Diana, soy de Tienda Nativa. Tu pedido queda por $89.000 y pagas al recibir. ¿Lo confirmamos?' },
      { de: 'cliente', texto: 'Sí, confírmalo' },
      { de: 'agente', texto: 'Listo, quedó confirmado.' },
    ],
    globos: [{ de: 'agente', texto: '¿Confirmamos tu pedido por $89.000?' }, { de: 'cliente', texto: 'Sí, confírmalo' }],
  },
  {
    id: 'logistica',
    nombre: PARTIDAS.logistica.nombre,
    promesa: 'Responde con tus tarifas y te deja cada conversación a la vista.',
    negocio: 'Envíos Puente',
    secciones: ['Tablero', 'Conversaciones', 'Clientes', 'Casos'],
    indicadores: [
      { dato: 'Conversaciones', valor: '128' },
      { dato: 'Resueltas sin ti', valor: '96' },
      { dato: 'Necesitan atención', valor: '7' },
    ],
    barras: [62, 88, 74, 96, 110, 128, 104],
    tituloBarras: 'Conversaciones por día',
    filas: [
      { nombre: 'Rosa Mendoza', detalle: '¿Cuánto vale el kilo a Madrid?', estado: 'Resuelta', tono: 'bien' },
      { nombre: 'Jairo Duque', detalle: '¿Puedo enviar perfumes?', estado: 'Espera tu decisión', tono: 'ojo' },
      { nombre: 'Marta Cano', detalle: '¿Recogen en Pereira?', estado: 'Resuelta', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Buenas, ¿cuánto vale enviar a Madrid?' },
      { de: 'agente', texto: 'Por barco son $28.000 el kilo y tarda unas 6 semanas. Por avión, $65.000 el kilo y tarda 8 días.' },
      { de: 'cliente', texto: '¿Puedo enviar perfumes?' },
      { de: 'agente', texto: 'Eso se lo paso a Envíos Puente, y te responden por aquí.' },
    ],
    globos: [{ de: 'cliente', texto: '¿Cuánto vale enviar a Madrid?' }, { de: 'agente', texto: 'Por barco, $28.000 el kilo. Tarda 6 semanas.' }],
  },
  {
    id: 'agenda',
    nombre: PARTIDAS.agenda.nombre,
    promesa: 'Propone una hora, agenda la cita y mueve las que cambian.',
    negocio: 'Consultorio Alameda',
    secciones: ['Agenda', 'Conversaciones', 'Clientes', 'Tablero'],
    indicadores: [
      { dato: 'Citas de la semana', valor: '34' },
      { dato: 'Conversaciones', valor: '52' },
      { dato: 'Necesitan atención', valor: '5' },
    ],
    barras: [9, 12, 14, 11, 15, 8, 14],
    tituloBarras: 'Citas por día',
    filas: [
      { nombre: 'Felipe Rueda', detalle: '9:00 a. m. · Primera cita', estado: 'Agendada', tono: 'bien' },
      { nombre: 'Ana Lucía Mora', detalle: '10:30 a. m. · Control', estado: 'Movida', tono: 'nada' },
      { nombre: 'Tomás Vélez', detalle: '11:00 a. m. · Control', estado: 'Agendada', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Hola, necesito mover mi cita del jueves' },
      { de: 'agente', texto: 'Claro, Felipe. Tengo viernes a las 9:00 a. m. o lunes a las 3:30 p. m. ¿Cuál te sirve?' },
      { de: 'cliente', texto: 'El viernes' },
      { de: 'agente', texto: 'Listo, Felipe.\n\nCita movida: viernes 6 de noviembre, 9:00 a. m. (antes jueves 5 de noviembre, 3:00 p. m.).' },
    ],
    globos: [{ de: 'cliente', texto: 'Necesito mover mi cita del jueves' }, { de: 'agente', texto: 'Tengo viernes a las 9:00 a. m.' }],
  },
]
