/**
 * El dinero nunca lo calcula el modelo. Pura: la misma en `crear_pedido` de producción y en el ensayo.
 */
import { comoMonto, type BorradorDePedido, type Clave, type Monto } from '../estado/elementos'
import type { EstadoDelNegocio } from '../estado'

export type Cotizacion = {
  readonly lineas: readonly { readonly producto: Clave; readonly nombre: string; readonly cantidad: number; readonly precio: Monto; readonly subtotal: Monto }[]
  readonly total: Monto
}

/** Productos vigentes y activos. Un producto repetido se suma; uno que no existe o no se vende, `noCubre`. */
export function cotizar(pedido: BorradorDePedido, estado: EstadoDelNegocio): Cotizacion | { readonly noCubre: string } {
  const cantidades = new Map<Clave, number>()
  for (const i of pedido.items) cantidades.set(i.producto, (cantidades.get(i.producto) ?? 0) + i.cantidad)
  if (!cantidades.size) return { noCubre: 'El pedido no tiene productos' }
  const lineas: Cotizacion['lineas'][number][] = []
  for (const [producto, cantidad] of cantidades) {
    const v = estado.vigente(producto)
    if (!v || v.elemento.tipo !== 'producto' || !v.elemento.activo) return { noCubre: `El producto ${producto} no está en el catálogo` }
    if (!Number.isInteger(cantidad) || cantidad < 1) return { noCubre: `La cantidad de ${v.elemento.nombre} tiene que ser un entero positivo` }
    lineas.push({ producto, nombre: v.elemento.nombre, cantidad, precio: v.elemento.precio, subtotal: comoMonto(v.elemento.precio * cantidad) })
  }
  return { lineas, total: comoMonto(lineas.reduce((s, l) => s + l.subtotal, 0)) }
}
