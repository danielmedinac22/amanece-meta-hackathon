'use client'

import { useMemo } from 'react'
import { VistaDeUnCliente, VistaDeUnPedido } from '@/app/panel/detalle'
import type { DatosDeClientes, DatosDePedidos, DetalleDeCliente, DetalleDeConversacion, DetalleDePedido, FilaDePedido, PedidoDelCliente } from '@/nucleo/listas'
import { rutaDeCliente, rutaDePedido } from '@/nucleo/listas-palabras'

export type FilasDeMuestra = { pedidos: DatosDePedidos; clientes: DatosDeClientes; detalles: Record<string, DetalleDeConversacion> }

const CUENTAN_COMO_VENTA: readonly string[] = ['confirmado', 'enviado', 'entregado', 'novedad']

function itemsDe(linea: string, total: number): DetalleDePedido['items'] {
  const partes = linea.split(' + ')
  return partes.map((parte) => {
    const [, cuantas, nombre] = /^(?:(\d+) )?(.*)$/.exec(parte)!
    const cantidad = Number(cuantas ?? 1)
    return { nombre: nombre[0].toUpperCase() + nombre.slice(1), cantidad, precio: Math.round(total / partes.length / cantidad) }
  })
}

/** Lo vendido que una tabla cuenta y su lista no trae se completa, para que el detalle de un Cliente diga lo mismo que su fila. */
function abiertosDe({ pedidos, clientes, detalles }: FilasDeMuestra): { pedidos: DetalleDePedido[]; clientes: DetalleDeCliente[] } {
  const conversacionDe = (nombre: string) => {
    const d = Object.values(detalles).find((c) => c.nombre === nombre)
    return d ? { ...d, mensajes: d.mensajes.slice(-20) } : null
  }
  const telefono = (nombre: string) => (nombre.startsWith('+') ? null : '+573001112233')
  const direccion = (ciudad: string) => (ciudad.length > 15 ? 'Vereda La Esperanza, kilómetro 14 de la vía antigua, entrando por la tienda de don Hernando, casa de dos pisos con portón verde' : 'Carrera 8 # 21-40')
  const filas = pedidos.grupos.flatMap((g) => g.filas.map((f) => ({ ...f, estado: g.estado })))
  const nombres = [...new Set([...clientes.filas.map((c) => c.nombre), ...filas.map((f) => f.cliente)])]
  const completas: (FilaDePedido & { estado: DetalleDePedido['estado'] })[] = [...filas]
  const abiertos = nombres.map((nombre): DetalleDeCliente => {
    const suyas = filas.filter((f) => f.cliente === nombre)
    const vendidas = suyas.filter((f) => CUENTAN_COMO_VENTA.includes(f.estado))
    const fila = clientes.filas.find((c) => c.nombre === nombre) ?? { id: nombre, nombre, ciudad: suyas[0]?.ciudad ?? '', pedidos: vendidas.length, total: vendidas.reduce((s, f) => s + f.total, 0), ultimo: suyas[0]?.hace ?? 'hace 3 días' }
    const faltan = Math.max(0, fila.pedidos - vendidas.length)
    const resto = fila.total - vendidas.reduce((s, f) => s + f.total, 0)
    const antiguas = Array.from({ length: Math.min(faltan, 50) }, (_, i) => ({ id: `${nombre}-${i}`, numero: 28 - i, cliente: nombre, items: 'Tueste medio, grano 500 g', ciudad: fila.ciudad, total: Math.round(resto / faltan), hace: 'hace 2 semanas', estado: 'entregado' as const }))
    completas.push(...antiguas)
    const suyos: PedidoDelCliente[] = [...suyas, ...antiguas].slice(0, 50)
    return { ...fila, telefono: telefono(nombre), cuentaDeSuyos: suyas.length + faltan, suyos, conversacion: conversacionDe(nombre) }
  })
  return {
    pedidos: completas.map((f) => ({ id: f.id, numero: f.numero, estado: f.estado, total: f.total, ciudad: f.ciudad, direccion: direccion(f.ciudad), hace: f.hace, items: itemsDe(f.items, f.total), cliente: { id: f.cliente, nombre: f.cliente, telefono: telefono(f.cliente) }, conversacion: conversacionDe(f.cliente) })),
    clientes: abiertos,
  }
}

/** Se arma en el navegador y solo el que se abre: en el servidor, cada fila pintaría otra vez su lista en cada escena. */
export function DetalleDeMuestra({ filas, ruta }: { filas: FilasDeMuestra; ruta: string }) {
  const abiertos = useMemo(() => abiertosDe(filas), [filas])
  const pedido = abiertos.pedidos.find((p) => rutaDePedido(p.id) === ruta)
  if (pedido) return <VistaDeUnPedido key={ruta} grupos={filas.pedidos.grupos} pedido={pedido} />
  const cliente = abiertos.clientes.find((c) => rutaDeCliente(c.id) === ruta)
  return cliente ? <VistaDeUnCliente key={ruta} lista={filas.clientes} cliente={cliente} /> : null
}
