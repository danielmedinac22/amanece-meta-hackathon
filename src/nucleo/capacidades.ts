/**
 * Lo que Amanece sabe que no tiene, y por qué un pedido del Dueño quedó como Capacidad faltante.
 */
import { db, esquema } from '@/db'
import { marcar, type CapacidadFaltanteId, type NegocioId } from './identidad'
import type { Cuando, Efecto } from './estado/elementos'

/** Lista cerrada. El Agente del dueño clasifica contra ella; la cola del equipo agrupa por ella. */
export const LO_QUE_NO_HAY = {
  cobrar: 'Cobrar, facturar o recibir pagos',
  agendar: 'Agendar citas o reservas',
  escribir_primero: 'Escribirle primero a un Cliente: campañas, recordatorios o publicidad',
  cotizar_con_transportadora: 'Cotizar o despachar con una transportadora',
  roles_del_negocio: 'Dueños con permisos distintos o empleados',
  integracion_externa: 'Conectarse con otro sistema (tienda en línea, inventario, contabilidad)',
  uso_general: 'Tareas que no son del Negocio',
  escribir_desde_otro_numero: 'Escribir desde otro número de WhatsApp',
  cambiar_la_compuerta: 'Saltarse la ventana de 24 horas u otra norma de envío',
  conducta_sin_efecto: 'Una instrucción de conducta que el código no puede hacer cumplir',
} as const

export type LoQueNoHay = keyof typeof LO_QUE_NO_HAY

export type MotivoDeFaltante =
  | { readonly tipo: 'no_hay'; readonly que: LoQueNoHay }
  /** La regla se puede escribir con los tipos finales, pero hoy nada la hace cumplir. */
  | { readonly tipo: 'sin_cumplidor'; readonly que: readonly (Cuando['tipo'] | Efecto['tipo'])[] }
  | { readonly tipo: 'sin_converger'; readonly ultimoError: string }
  | { readonly tipo: 'fuera_de_la_lista'; readonly descripcion: string }
  /** Una regla de la tabla vieja que la migración no traduce: espera a que el Dueño la pida de nuevo. */
  | { readonly tipo: 'regla_vieja' }

/** Pura. `no_hay:cobrar`, `sin_cumplidor:tema`: cuántos Negocios piden lo mismo. */
export function claveDeAgrupacion(m: MotivoDeFaltante): string {
  switch (m.tipo) {
    case 'no_hay':
      return `no_hay:${m.que}`
    case 'sin_cumplidor':
      return `sin_cumplidor:${m.que.join(',')}`
    case 'sin_converger':
    case 'fuera_de_la_lista':
    case 'regla_vieja':
      return m.tipo
  }
}

function detalle(m: MotivoDeFaltante): string {
  switch (m.tipo) {
    case 'sin_converger':
      return m.ultimoError
    case 'fuera_de_la_lista':
      return m.descripcion
    default:
      return ''
  }
}

export function motivoEnTexto(m: MotivoDeFaltante): string {
  const d = detalle(m)
  return d ? `${claveDeAgrupacion(m)}: ${d}` : claveDeAgrupacion(m)
}

export async function registrarFaltante(negocio: NegocioId, palabrasDelDueno: string, motivo: MotivoDeFaltante): Promise<CapacidadFaltanteId> {
  const [fila] = await db
    .insert(esquema.capacidadesFaltantes)
    .values({ negocioId: negocio, pedido: palabrasDelDueno, motivo: motivoEnTexto(motivo) })
    .returning({ id: esquema.capacidadesFaltantes.id })
  return marcar.capacidadFaltante(fila.id)
}
