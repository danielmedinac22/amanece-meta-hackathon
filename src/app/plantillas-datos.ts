import { PARTIDAS, type IdDePlantilla } from '@/nucleo/plantillas'
import type { Idioma, SeccionDePlantilla } from './portada/textos'

export type Tono = 'bien' | 'ojo' | 'nada'

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

type LoQueSeTraduce = Pick<Plantilla, 'nombre' | 'promesa' | 'indicadores' | 'tituloBarras' | 'filas' | 'chat' | 'globos'>

const EN_INGLES: Readonly<Record<IdDePlantilla, LoQueSeTraduce>> = {
  tienda: {
    nombre: 'Cash on delivery',
    promesa: 'Takes orders, confirms them and shows you what sold.',
    indicadores: [
      { dato: 'Sales this week (COP)', valor: '840,000' },
      { dato: 'To confirm', valor: '8' },
      { dato: 'Conversations', valor: '46' },
    ],
    tituloBarras: 'Orders per day',
    filas: [
      { nombre: 'Diana Salazar', detalle: 'Bucaramanga · COP 89,000', estado: 'To confirm', tono: 'nada' },
      { nombre: 'Óscar Peña', detalle: 'Neiva · COP 124,000', estado: 'Confirmed', tono: 'bien' },
      { nombre: 'Yuli Cortés', detalle: 'Ibagué · COP 65,000', estado: 'Confirmed', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Hi, I want the black backpack. I’ll pay on delivery.' },
      { de: 'agente', texto: 'Hi Diana, this is Tienda Nativa. Your order comes to COP 89,000 and you pay on delivery. Shall we confirm it?' },
      { de: 'cliente', texto: 'Yes, confirm it' },
      { de: 'agente', texto: 'Done, it’s confirmed.' },
    ],
    globos: [{ de: 'agente', texto: 'Shall we confirm your COP 89,000 order?' }, { de: 'cliente', texto: 'Yes, confirm it' }],
  },
  logistica: {
    nombre: 'Shipping and parcels',
    promesa: 'Answers with your rates and keeps every conversation in view.',
    indicadores: [
      { dato: 'Conversations', valor: '128' },
      { dato: 'Solved without you', valor: '96' },
      { dato: 'Need attention', valor: '7' },
    ],
    tituloBarras: 'Conversations per day',
    filas: [
      { nombre: 'Rosa Mendoza', detalle: 'How much per kilo to Madrid?', estado: 'Solved', tono: 'bien' },
      { nombre: 'Jairo Duque', detalle: 'Can I send perfume?', estado: 'Awaiting your call', tono: 'ojo' },
      { nombre: 'Marta Cano', detalle: 'Do you pick up in Pereira?', estado: 'Solved', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Hi, how much to send to Madrid?' },
      { de: 'agente', texto: 'By sea it’s COP 28,000 per kilo and takes about 6 weeks. By air, COP 65,000 per kilo and 8 days.' },
      { de: 'cliente', texto: 'Can I send perfume?' },
      { de: 'agente', texto: 'I’ll pass that to Envíos Puente, and they’ll answer you here.' },
    ],
    globos: [{ de: 'cliente', texto: 'How much to send to Madrid?' }, { de: 'agente', texto: 'By sea, COP 28,000 per kilo. It takes 6 weeks.' }],
  },
  agenda: {
    nombre: 'Appointment businesses',
    promesa: 'Offers a time, books the appointment and moves it when plans change.',
    indicadores: [
      { dato: 'Appointments this week', valor: '34' },
      { dato: 'Conversations', valor: '52' },
      { dato: 'Need attention', valor: '5' },
    ],
    tituloBarras: 'Appointments per day',
    filas: [
      { nombre: 'Felipe Rueda', detalle: '9:00 a.m. · First visit', estado: 'Booked', tono: 'bien' },
      { nombre: 'Ana Lucía Mora', detalle: '10:30 a.m. · Check-up', estado: 'Moved', tono: 'nada' },
      { nombre: 'Tomás Vélez', detalle: '11:00 a.m. · Check-up', estado: 'Booked', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Hi, I need to move my Thursday appointment' },
      { de: 'agente', texto: 'Sure, Felipe. I have Friday at 9:00 a.m. or Monday at 3:30 p.m. Which works for you?' },
      { de: 'cliente', texto: 'Friday' },
      { de: 'agente', texto: 'Done, Felipe.\n\nAppointment moved: Friday, November 6, 9:00 a.m. (was Thursday, November 5, 3:00 p.m.).' },
    ],
    globos: [{ de: 'cliente', texto: 'I need to move my Thursday appointment' }, { de: 'agente', texto: 'I have Friday at 9:00 a.m.' }],
  },
}

export function plantillasDe(idioma: Idioma): Plantilla[] {
  return idioma === 'es' ? PLANTILLAS : PLANTILLAS.map((p) => ({ ...p, ...EN_INGLES[p.id] }))
}
