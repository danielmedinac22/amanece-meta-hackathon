import { VistaDeConversaciones } from '../conversaciones'
import { leerConversaciones } from '../leer'
import { TomaEnLaRuta } from '../toma'
import { SinNegocio } from '../vista'

export default async function Conversaciones({ searchParams }: { searchParams: Promise<{ cliente?: string | string[] }> }) {
  const { cliente } = await searchParams
  const datos = await leerConversaciones(typeof cliente === 'string' ? cliente : undefined)
  return datos ? <VistaDeConversaciones {...datos} Toma={TomaEnLaRuta} /> : <SinNegocio />
}
