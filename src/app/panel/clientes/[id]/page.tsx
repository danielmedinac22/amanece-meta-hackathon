import { notFound } from 'next/navigation'
import { VistaDeUnCliente } from '../../detalle'
import { leerUnCliente } from '../../leer'
import { SinNegocio } from '../../vista'

export default async function UnCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const datos = await leerUnCliente(id)
  if (!datos) return <SinNegocio />
  if (!datos.cliente) notFound()
  return <VistaDeUnCliente lista={datos.lista} cliente={datos.cliente} />
}
