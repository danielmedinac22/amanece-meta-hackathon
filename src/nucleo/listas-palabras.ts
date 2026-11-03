import type { EstadoDePedido, ItemDePedido } from '@/db/esquema'

/** De lo que más le pide al Dueño a lo que ya no le pide nada. */
export const ORDEN_DE_PEDIDOS = ['novedad', 'pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'] as const satisfies readonly EstadoDePedido[]

export const ETIQUETA_DE_PEDIDO: Record<EstadoDePedido, string> = {
  novedad: 'Con novedad',
  pendiente: 'Por confirmar',
  confirmado: 'Confirmado',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

/** Solo baja la inicial de una palabra normal: una sigla como `XL` se queda como está. */
const enMinuscula = (nombre: string) => (/^\p{Lu}\p{Ll}/u.test(nombre) ? nombre[0].toLowerCase() + nombre.slice(1) : nombre)

/** `2 tueste medio, grano 500 g + Molino manual`. El nombre de un producto puede llevar coma, así que los separa un `+`. */
export const lineaDeItems = (items: readonly Pick<ItemDePedido, 'nombre' | 'cantidad'>[]) => items.map((i) => (i.cantidad === 1 ? i.nombre : `${i.cantidad} ${enMinuscula(i.nombre)}`)).join(' + ')

/** Un Cliente que no ha dicho su nombre se reconoce por su teléfono. */
export const nombreDelCliente = (nombre: string, telefono: string) => nombre.trim() || `+${telefono.replace(/^\+/, '')}`

export const cifra = (n: number) => n.toLocaleString('es-CO')
