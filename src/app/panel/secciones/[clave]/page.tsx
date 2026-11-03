import { notFound } from 'next/navigation'
import { leerUnaSeccion } from '../../leer'
import { VistaDeUnaSeccion } from '../../vista'

export default async function UnaSeccion({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params
  const pintada = await leerUnaSeccion(decodeURIComponent(clave))
  if (!pintada) notFound()
  return <VistaDeUnaSeccion p={pintada} />
}
