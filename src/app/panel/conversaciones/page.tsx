import { VistaDeConversaciones } from '../conversaciones'
import { leerConversaciones } from '../leer'
import { SinNegocio } from '../vista'

export default async function Conversaciones({ searchParams }: { searchParams: Promise<{ cliente?: string | string[] }> }) {
  const { cliente } = await searchParams
  const datos = await leerConversaciones(typeof cliente === 'string' ? cliente : undefined)
  return datos ? <VistaDeConversaciones {...datos} /> : <SinNegocio />
}
