import { leerCasos } from '../leer'
import { SinNegocio, VistaDeCasos } from '../vista'

export default async function Casos() {
  const casos = await leerCasos()
  return casos ? <VistaDeCasos casos={casos} /> : <SinNegocio />
}
