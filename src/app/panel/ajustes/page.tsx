import { VistaDeAjustes } from '../ajustes'
import { leerAjustes } from '../leer'
import { SinNegocio } from '../vista'

export default async function Ajustes() {
  const ajustes = await leerAjustes()
  return ajustes ? <VistaDeAjustes {...ajustes} /> : <SinNegocio />
}
