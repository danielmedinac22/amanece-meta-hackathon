/** Los pasos del armado de Café Ladera, inventados como los de `datos.ts`, con los textos del prototipo. */
import type { UIMessage } from 'ai'
import type { DatoQueSe, DatosDelArmado, FilaQueYaSe } from '@/nucleo/armado'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { EMPIEZA_A_CORREGIR } from '@/nucleo/armado-paso'
import type { Huella, Instante, PropuestaId } from '@/nucleo/identidad'
import { PARTE_DE_PLANTILLA, PARTIDAS, type IdDePlantilla } from '@/nucleo/plantillas'

const mensaje = (id: string, role: 'user' | 'assistant', ...partes: object[]) => ({ id, role, parts: partes }) as UIMessage
const texto = (text: string) => ({ type: 'text', text })

const LINK = 'https://wa.me/12024745452?text=(LADERA)%20Hola%20Caf%C3%A9%20Ladera'
const ORDEN: readonly DatoQueSe[] = ['Nombre', 'Qué haces', 'Ciudad', 'Productos', 'Envíos', 'Horario', 'Cómo cobras', 'Tono']

/** Lo que trae una página. El nombre no: lo dice el Dueño. */
const LEIDO: Partial<Record<DatoQueSe, string>> = {
  Productos: '8 con precio',
  Envíos: 'Todo el país, 2 a 8 días',
  Horario: 'Lun a sáb, 8 a. m. a 6 p. m.',
}
const SABIDO = { ...LEIDO, Nombre: 'Café Ladera' }

const filas = (valores: Partial<Record<DatoQueSe, string>>, estado: FilaQueYaSe['estado'] = 'sabido'): FilaQueYaSe[] => ORDEN.map((dato) => (valores[dato] ? { dato, valor: valores[dato], estado } : { dato, valor: null, estado: 'falta' }))

const PRODUCTOS = [
  { nombre: 'Tueste medio, grano 500 g', precio: '$38.000' },
  { nombre: 'Tueste medio, molido 500 g', precio: '$38.000' },
  { nombre: 'Tueste claro, grano 250 g', precio: '$24.000' },
]
const SIN_NADA: DatosDelArmado = { nombre: null, link: null, filas: filas({}), lectura: null, faltaParaAbrir: ['el nombre del Negocio', 'al menos un producto con su precio'], productos: [] }
const TODO_DICHO = { nombre: 'Café Ladera', link: LINK, lectura: null, faltaParaAbrir: [], productos: PRODUCTOS.map((p) => ({ ...p, estado: 'Listo' as const })) }

export const ARMADO_VACIO = SIN_NADA

export const ARMADO_CONOCIENDO = SIN_NADA
export const HILO_CONOCIENDO: UIMessage[] = [mensaje('a1', 'user', texto('Vendo café de especialidad en Manizales')), mensaje('a2', 'assistant', texto('Qué rico. Cuéntame cómo se llama tu negocio y cuánto cuesta una bolsa de 250 g.'))]

export const ARMADO_LEYENDO = SIN_NADA
export const HILO_LEYENDO: UIMessage[] = [mensaje('l1', 'user', texto('cafeladera.com')), mensaje('l2', 'assistant', { type: 'tool-leer_enlace', toolCallId: 'llamada-leer', state: 'input-available', input: { url: 'cafeladera.com' } })]

export const ARMADO_CONFIRMAR: DatosDelArmado = {
  nombre: null,
  link: null,
  filas: filas(LEIDO, 'en_la_tarjeta'),
  lectura: { productos: 8 },
  faltaParaAbrir: ['el nombre del Negocio', 'al menos un producto con su precio'],
  productos: PRODUCTOS.map((p) => ({ ...p, estado: 'Por confirmar' })),
}
const LO_LEIDO: TarjetaDeAprobacion = {
  propuesta: 'p-lectura' as PropuestaId,
  huella: 'huella-lectura' as Huella,
  vence: new Date('2030-01-01T00:00:00Z').toISOString() as Instante,
  advertencias: [],
  lineas: ['Tueste medio, grano 500 g: $38.000', 'Tueste medio, molido 500 g: $38.000', 'Tueste claro, grano 250 g: $24.000', 'Micro lote Honey, grano 250 g: $32.000', 'Y 4 más'],
  accion: 'confirmar',
}
export const HILO_CONFIRMAR: UIMessage[] = [
  mensaje('c1', 'user', texto('cafeladera.com')),
  mensaje('c2', 'assistant', { type: 'tool-leer_enlace', toolCallId: 'llamada-leer', state: 'output-available', input: { url: 'cafeladera.com' }, output: { resumen: 'Leído', tarjeta: LO_LEIDO } }, texto('Leí tu página. Revisa si estos productos están bien y toca el botón.')),
]
export const TARJETAS_CONFIRMAR: Record<string, EstadoDeTarjeta> = { 'p-lectura': { estado: 'espera_al_dueno', accion: 'confirmar', aprobadaPor: null, asunto: null, publicada: false } }

/** Una tarjeta real de una página con productos y descripción: más alta de lo que cabe en una pantalla de 900 px. */
const LO_LEIDO_LARGO: TarjetaDeAprobacion = {
  ...LO_LEIDO,
  propuesta: 'p-larga' as PropuestaId,
  huella: 'huella-larga' as Huella,
  lineas: [
    'Esto leí de tu página (cafeladera.com). Tu agente de clientes no lo usa hasta que lo confirmes.',
    'Nombre: «Café Ladera» · lo leí',
    'Tueste medio, grano 500 g · $38.000 · lo leí',
    'Tueste medio, molido 500 g · $38.000 · lo leí',
    'Tueste claro, grano 250 g · $24.000 · lo leí',
    'Micro lote Honey, grano 250 g · $32.000 · lo leí',
    'Descripción: «Desde 2009 tostamos en Manizales café de fincas que conocemos por su nombre, y lo enviamos recién tostado a cualquier ciudad de Colombia para que llegue a tu casa con todo su sabor.» · lo leí',
    'Si algo está mal o falta un producto, escríbeselo a tu agente antes de confirmar.',
  ],
}
export const HILO_TARJETA_LARGA: UIMessage[] = [
  mensaje('g1', 'user', texto('cafeladera.com')),
  mensaje('g2', 'assistant', { type: 'tool-leer_enlace', toolCallId: 'llamada-larga', state: 'output-available', input: { url: 'cafeladera.com' }, output: { resumen: 'Leído', tarjeta: LO_LEIDO_LARGO } }, texto('Ya leí tu página. Revisa la tarjeta y toca el botón si está bien.')),
]
export const TARJETAS_LARGA: Record<string, EstadoDeTarjeta> = { 'p-larga': TARJETAS_CONFIRMAR['p-lectura'] }

/** Una página sin precios: la tarjeta solo trae texto, y después del botón todavía falta el nombre y lo que vende. */
const LEIDO_SIN_PRECIOS: Partial<Record<DatoQueSe, string>> = { 'Qué haces': 'Café de especialidad de Manizales', Ciudad: 'Manizales' }
export const ARMADO_SIN_PRECIOS: DatosDelArmado = { ...SIN_NADA, filas: filas(LEIDO_SIN_PRECIOS, 'en_la_tarjeta'), lectura: { productos: 0 } }
export const ARMADO_TRAS_EL_BOTON: DatosDelArmado = { ...SIN_NADA, filas: filas(LEIDO_SIN_PRECIOS) }
const LO_LEIDO_SIN_PRECIOS: TarjetaDeAprobacion = { ...LO_LEIDO, propuesta: 'p-sin-precios' as PropuestaId, huella: 'huella-sin-precios' as Huella, lineas: ['Descripción: «Café de especialidad de Manizales» · lo leí', 'Ciudad: «Manizales» · lo leí'] }
export const HILO_SIN_PRECIOS: UIMessage[] = [
  mensaje('s1', 'user', texto('cafeladera.com')),
  mensaje('s2', 'assistant', { type: 'tool-leer_enlace', toolCallId: 'llamada-sin-precios', state: 'output-available', input: { url: 'cafeladera.com' }, output: { resumen: 'Leído', tarjeta: LO_LEIDO_SIN_PRECIOS } }, texto('Ya leí tu página. Revisa la tarjeta y toca el botón si está bien. ¿Cómo se llama tu negocio?')),
]
export const TARJETAS_SIN_PRECIOS: Record<string, EstadoDeTarjeta> = { 'p-sin-precios': TARJETAS_CONFIRMAR['p-lectura'] }

/** El Dueño dijo en palabras que un producto ya no va: la tarjeta se rearmó sin él. */
const LO_LEIDO_CORREGIDO: TarjetaDeAprobacion = { ...LO_LEIDO, propuesta: 'p-lectura-corregida' as PropuestaId, huella: 'huella-corregida' as Huella, advertencias: ['Quité Tueste claro, grano 250 g.'], lineas: ['Tueste medio, grano 500 g: $38.000', 'Tueste medio, molido 500 g: $38.000', 'Micro lote Honey, grano 250 g: $32.000', 'Y 4 más'] }
export const ARMADO_CORREGIDA: DatosDelArmado = { ...ARMADO_CONFIRMAR, lectura: { productos: 7 }, productos: ARMADO_CONFIRMAR.productos.filter((p) => !p.nombre.startsWith('Tueste claro')) }
export const HILO_CORREGIDA: UIMessage[] = [
  ...HILO_CONFIRMAR,
  mensaje('c3', 'user', texto(`${EMPIEZA_A_CORREGIR}el tueste claro ya no lo vendo`)),
  mensaje('c4', 'assistant', { type: 'tool-corregir_tarjeta', toolCallId: 'llamada-corregir', state: 'output-available', input: { quitar: ['tueste claro'] }, output: { resumen: 'Quité', tarjeta: LO_LEIDO_CORREGIDO } }, texto('Listo, ya no está. Revisa lo demás y toca el botón.')),
]
export const TARJETAS_CORREGIDA: Record<string, EstadoDeTarjeta> = { 'p-lectura': { ...TARJETAS_CONFIRMAR['p-lectura'], estado: 'descartada' }, 'p-lectura-corregida': TARJETAS_CONFIRMAR['p-lectura'] }

export const ARMADO_COBRO: DatosDelArmado = { ...TODO_DICHO, filas: filas({ ...SABIDO, Tono: 'De tú, con cariño' }) }
/** Lo que dijo el Dueño no coincidió con nada: la tarjeta sigue igual, y el rastro no puede decir que corrigió. */
export const HILO_NO_CORRIGIO: UIMessage[] = [
  ...HILO_CONFIRMAR,
  mensaje('n1', 'user', texto(`${EMPIEZA_A_CORREGIR}la bicicleta ya no la vendo`)),
  mensaje('n2', 'assistant', { type: 'tool-corregir_tarjeta', toolCallId: 'llamada-sin-cambio', state: 'output-available', input: { quitar: ['bicicleta'] }, output: { resumen: 'Nada coincide', tarjeta: null } }, texto('No encontré una bicicleta en la tarjeta. ¿Cómo sale ahí?')),
]
export const ARMADO_COBRO_CORREGIDO: DatosDelArmado = { ...ARMADO_COBRO, filas: filas({ ...SABIDO, Tono: 'De tú, con cariño', Productos: '7 con precio' }), productos: ARMADO_COBRO.productos.filter((p) => !p.nombre.startsWith('Tueste claro')) }
export const HILO_COBRO: UIMessage[] = [mensaje('p1', 'user', texto('Hablo de tú, con cariño.')), mensaje('p2', 'assistant', texto('Listo. Y tus clientes, ¿cómo te pagan?'))]

export const ARMADO_COBRO_CON_MAS_FALTANTES: DatosDelArmado = { ...TODO_DICHO, filas: filas({ Nombre: 'Café Ladera', Productos: '8 con precio' }) }

export const ARMADO_LISTO: DatosDelArmado = { ...TODO_DICHO, filas: filas({ ...SABIDO, Tono: 'De tú, con cariño', 'Cómo cobras': 'Contra entrega' }) }
export const HILO_LISTO: UIMessage[] = [mensaje('o1', 'user', texto('Mis clientes me pagan contra entrega.')), mensaje('o2', 'assistant', texto('Perfecto. Cuando quieras, abrimos.'))]

/** El Dueño dijo primero cómo cobra y su tono, antes del nombre y de un solo producto. */
export const ARMADO_FUERA_DE_ORDEN: DatosDelArmado = { ...SIN_NADA, filas: filas({ 'Cómo cobras': 'Contra entrega', Tono: 'De tú, con cariño' }) }
export const HILO_FUERA_DE_ORDEN: UIMessage[] = [mensaje('f1', 'user', texto('Cobro contra entrega y le hablo de tú a la gente, con cariño.')), mensaje('f2', 'assistant', texto('Anotado. ¿Cómo se llama tu negocio y qué vendes?'))]

/** Un valor largo no puede sacar la carta de su ancho. */
export const ARMADO_TEXTOS_LARGOS: DatosDelArmado = {
  ...ARMADO_LISTO,
  nombre: 'Tostadora y Cafetería de Especialidad La Ladera de Manizales',
  filas: filas({ ...SABIDO, Nombre: 'Tostadora y Cafetería de Especialidad La Ladera de Manizales', Envíos: 'A todo el país con Servientrega e Interrapidísimo, de 2 a 8 días hábiles según la ciudad, y el envío cuesta entre $9.000 y $18.000', 'Cómo cobras': 'Contra entrega', Tono: 'De tú, con cariño' }),
  productos: [{ nombre: 'Micro lote Honey de la finca El Mirador, grano entero en bolsa de 250 g', precio: '$132.000', estado: 'Listo' }],
}

/** La línea que deja `partirDePlantilla`, con el mismo texto. */
export const lineaDePlantilla = (id: IdDePlantilla): UIMessage => mensaje(`plantilla-${id}`, 'assistant', { type: PARTE_DE_PLANTILLA, data: { id } }, texto(PARTIDAS[id].primero))

export const HILO_DESDE_PLANTILLA: UIMessage[] = [
  mensaje('t1', 'assistant', texto('¡Hola! Soy tu Agente en Amanece.')),
  lineaDePlantilla('agenda'),
  mensaje('t2', 'user', texto('Tengo un consultorio de fisioterapia en Pereira.')),
  mensaje('t3', 'assistant', texto('Qué bien. ¿Cómo se llama el consultorio y qué servicios das, con su precio?')),
]
