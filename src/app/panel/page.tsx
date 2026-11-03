import { leerInicio } from './leer'
import { SinNegocio, VistaDelNegocio } from './vista'

export default async function Inicio() {
  const datos = await leerInicio()
  return datos ? <VistaDelNegocio datos={datos} /> : <SinNegocio />
}
