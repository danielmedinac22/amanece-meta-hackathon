import { CasosEnLaRuta } from '../casos'
import { leerLosCasos } from '../leer'
import { SinNegocio } from '../vista'

export default async function Casos() {
  const datos = await leerLosCasos()
  return datos ? <CasosEnLaRuta {...datos} /> : <SinNegocio />
}
