import { notFound } from 'next/navigation'
import { VistaDeUnPedido } from '../../detalle'
import { leerUnPedido } from '../../leer'
import { SinNegocio } from '../../vista'

export default async function UnPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const datos = await leerUnPedido(id)
  if (!datos) return <SinNegocio />
  if (!datos.pedido) notFound()
  return <VistaDeUnPedido grupos={datos.grupos} pedido={datos.pedido} />
}
