export type Tono = 'bien' | 'ojo' | 'nada'

export type Plantilla = {
  id: 'logistica' | 'tienda' | 'agenda'
  nombre: string
  promesa: string
  negocio: string
  secciones: string[]
  indicadores: { dato: string; valor: string }[]
  barras: number[]
  tituloBarras: string
  filas: { nombre: string; detalle: string; estado: string; tono: Tono }[]
  chat: { de: 'cliente' | 'agente'; texto: string }[]
  globos: { de: 'cliente' | 'agente'; texto: string }[]
}

/** Negocios inventados, a propósito y a la vista de todos: `DESIGN.md` los pide así, y ningún dato de aquí sale de un Negocio. */
export const PLANTILLAS: Plantilla[] = [
  {
    id: 'tienda',
    nombre: 'Venta contra entrega',
    promesa: 'Toma pedidos, los confirma y sigue cada envío.',
    negocio: 'Tienda Nativa',
    secciones: ['Inicio', 'Pedidos', 'Conversaciones', 'Clientes'],
    indicadores: [
      { dato: 'Confirmados hoy', valor: '32' },
      { dato: 'Por confirmar', valor: '8' },
      { dato: 'Con novedad', valor: '3' },
    ],
    barras: [18, 24, 21, 30, 27, 36, 32],
    tituloBarras: 'Pedidos confirmados',
    filas: [
      { nombre: 'Diana Salazar', detalle: 'Bucaramanga · $89.000', estado: 'Por confirmar', tono: 'nada' },
      { nombre: 'Óscar Peña', detalle: 'Neiva · $124.000', estado: 'Confirmado', tono: 'bien' },
      { nombre: 'Yuli Cortés', detalle: 'Ibagué · $65.000', estado: 'Con novedad', tono: 'ojo' },
    ],
    chat: [
      { de: 'agente', texto: 'Hola Diana, soy de Tienda Nativa. Tu pedido por $89.000 sale mañana, pagas al recibir. ¿Lo confirmamos?' },
      { de: 'cliente', texto: 'Sí, pero cámbialo a la dirección de mi trabajo' },
      { de: 'agente', texto: 'Listo, queda para la Calle 45 # 27-10. Confirmado.' },
    ],
    globos: [{ de: 'agente', texto: '¿Confirmamos tu pedido por $89.000?' }, { de: 'cliente', texto: 'Sí, confirmado' }],
  },
  {
    id: 'logistica',
    nombre: 'Envíos y paquetería',
    promesa: 'Cotiza por peso y destino, y deja cada contacto en tu bandeja.',
    negocio: 'Envíos Puente',
    secciones: ['Tablero', 'Bandeja', 'Contactos', 'Tarifas'],
    indicadores: [
      { dato: 'Conversaciones hoy', valor: '128' },
      { dato: 'Resueltas sin ti', valor: '75 %' },
      { dato: 'Necesitan atención', valor: '7' },
    ],
    barras: [62, 88, 74, 96, 110, 128, 104],
    tituloBarras: 'Conversaciones',
    filas: [
      { nombre: 'Rosa Mendoza', detalle: '12 kg a Madrid, por barco', estado: 'Cotizado', tono: 'bien' },
      { nombre: 'Jairo Duque', detalle: '¿Puedo enviar perfumes?', estado: 'Atiendes tú', tono: 'ojo' },
      { nombre: 'Marta Cano', detalle: 'Recogida en Pereira', estado: 'Agendada', tono: 'nada' },
    ],
    chat: [
      { de: 'cliente', texto: 'Buenas, ¿cuánto vale enviar 12 kilos a Madrid?' },
      { de: 'agente', texto: 'Por barco son $340.000 y tarda unas 6 semanas. Por avión, $780.000 y tarda 8 días. ¿Por cuál te lo cotizo?' },
      { de: 'cliente', texto: 'Por barco' },
    ],
    globos: [{ de: 'cliente', texto: '¿Cuánto vale enviar 12 kilos a Madrid?' }, { de: 'agente', texto: 'Por barco, $340.000. Tarda 6 semanas.' }],
  },
  {
    id: 'agenda',
    nombre: 'Servicios con agenda',
    promesa: 'Agenda citas, las recuerda y mueve las que cambian.',
    negocio: 'Consultorio Alameda',
    secciones: ['Agenda', 'Conversaciones', 'Pacientes', 'Tablero'],
    indicadores: [
      { dato: 'Citas de hoy', valor: '14' },
      { dato: 'Confirmadas', valor: '11' },
      { dato: 'Sin confirmar', valor: '3' },
    ],
    barras: [9, 12, 14, 11, 15, 8, 14],
    tituloBarras: 'Citas agendadas',
    filas: [
      { nombre: 'Felipe Rueda', detalle: '9:00 a. m. · Primera cita', estado: 'Confirmada', tono: 'bien' },
      { nombre: 'Ana Lucía Mora', detalle: '10:30 a. m. · Control', estado: 'Sin confirmar', tono: 'ojo' },
      { nombre: 'Tomás Vélez', detalle: '11:15 a. m. · Control', estado: 'Confirmada', tono: 'bien' },
    ],
    chat: [
      { de: 'cliente', texto: 'Hola, necesito mover mi cita del jueves' },
      { de: 'agente', texto: 'Claro, Felipe. Tengo viernes a las 9:00 a. m. o lunes a las 3:30 p. m. ¿Cuál te sirve?' },
      { de: 'cliente', texto: 'El viernes' },
    ],
    globos: [{ de: 'cliente', texto: 'Necesito mover mi cita del jueves' }, { de: 'agente', texto: 'Tengo viernes a las 9:00 a. m.' }],
  },
]
