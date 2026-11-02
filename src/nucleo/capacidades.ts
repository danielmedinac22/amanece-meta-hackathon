/**
 * Lo que Amanece sabe que no tiene, y por qué un pedido del Dueño quedó como Capacidad faltante.
 */
import { sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { DelEquipo } from '@/lib/equipo'
import { marcar, type CapacidadFaltanteId, type NegocioId } from './identidad'
import type { Cuando, Efecto } from './estado/elementos'
import type { ErrorDeConsulta, NombreDeFuente } from './consultas/tipos'
import { explicar } from './consultas/validar'

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
  /** El redactor declinó: el catálogo no trae el dato ("días de entrega"). `fuente` la eligió de la lista cerrada. */
  | { readonly tipo: 'no_se_puede'; readonly fuente: NombreDeFuente | 'ninguna'; readonly falta: string }
  /** Tres intentos sin una consulta válida. El error es tipado: la cola agrupa por él. */
  | { readonly tipo: 'sin_converger'; readonly ultimoError: ErrorDeConsulta }
  | { readonly tipo: 'fuera_de_la_lista'; readonly descripcion: string }
  /** Una regla de la tabla vieja que la migración no traduce: espera a que el Dueño la pida de nuevo. */
  | { readonly tipo: 'regla_vieja' }

/** Lo que se lee de una fila: las de antes de 0004 que no se pudieron tipar vuelven con su texto. */
export type MotivoGuardado = MotivoDeFaltante | { readonly tipo: 'anterior'; readonly texto: string }

/**
 * Pura. `no_hay:cobrar`, `no_se_puede:pedidos`, `dato:pedidos.entregado_en`, `sin_converger:forma`: cuántos Negocios
 * piden lo mismo.
 */
export function claveDeAgrupacion(m: MotivoDeFaltante): string {
  switch (m.tipo) {
    case 'no_hay':
      return `no_hay:${m.que}`
    case 'sin_cumplidor':
      return `sin_cumplidor:${m.que.join(',')}`
    case 'no_se_puede':
      return `no_se_puede:${m.fuente}`
    case 'sin_converger':
      return m.ultimoError.tipo === 'dato_inexistente' && m.ultimoError.campo ? `dato:${m.ultimoError.fuente}.${m.ultimoError.campo}` : `sin_converger:${m.ultimoError.tipo}`
    case 'fuera_de_la_lista':
    case 'regla_vieja':
      return m.tipo
  }
}

function detalle(m: MotivoDeFaltante): string {
  switch (m.tipo) {
    case 'no_se_puede':
      return m.falta
    case 'sin_converger':
      return explicar(m.ultimoError)
    case 'fuera_de_la_lista':
      return m.descripcion
    default:
      return ''
  }
}

/** El texto de antes de 0004, que se sigue escribiendo en `motivo`. */
export function motivoEnTexto(m: MotivoDeFaltante): string {
  const d = detalle(m)
  return d ? `${claveDeAgrupacion(m)}: ${d}` : claveDeAgrupacion(m)
}

/** Escribe las palabras del Dueño, el motivo tipado, su clave y el texto de antes. */
export async function registrarFaltante(negocio: NegocioId, palabrasDelDueno: string, motivo: MotivoDeFaltante): Promise<CapacidadFaltanteId> {
  const [fila] = await db
    .insert(esquema.capacidadesFaltantes)
    .values({ negocioId: negocio, pedido: palabrasDelDueno, motivo: motivoEnTexto(motivo), tipo: motivo.tipo, claveDeAgrupacion: claveDeAgrupacion(motivo), detalle: motivo })
    .returning({ id: esquema.capacidadesFaltantes.id })
  return marcar.capacidadFaltante(fila.id)
}

export type GrupoDeFaltantes = {
  readonly clave: string
  readonly tipo: MotivoGuardado['tipo']
  readonly veces: number
  readonly negocios: number
  readonly ultima: Date
}

/**
 * Para `/medicion`: cuántas veces y en cuántos Negocios se pidió cada cosa que no hay. Sin las palabras del Dueño:
 * esas las lee el equipo con `scripts/faltantes.mts`. Pide la prueba de que quien mira es del equipo.
 */
export async function faltantesPorMotivo(equipo: DelEquipo): Promise<readonly GrupoDeFaltantes[]> {
  void equipo
  const t = esquema.capacidadesFaltantes
  return db
    .select({ clave: t.claveDeAgrupacion, tipo: t.tipo, veces: sql<number>`count(*)::int`, negocios: sql<number>`count(distinct ${t.negocioId})::int`, ultima: sql<Date>`max(${t.creado})`.mapWith(t.creado) })
    .from(t)
    .groupBy(t.claveDeAgrupacion, t.tipo)
    .orderBy(sql`count(*) desc`, sql`max(${t.creado}) desc`)
}

type Es<A extends true> = A
type Tipos = (typeof esquema.TIPOS_DE_MOTIVO)[number]
/** El `CHECK` de la base y el tipo dicen los mismos motivos. */
type _TiposDeMotivo = Es<[Tipos] extends [MotivoGuardado['tipo']] ? ([MotivoGuardado['tipo']] extends [Tipos] ? true : false) : false>
export type ComprobacionesDeCapacidades = [_TiposDeMotivo]
