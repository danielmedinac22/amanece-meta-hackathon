import { InicioHoy } from './inicio-hoy'
import { leerInicio } from './leer'
import { SinNegocio } from './vista'

export default async function Inicio() {
  const hoy = await leerInicio()
  return hoy ? <InicioHoy {...hoy} /> : <SinNegocio />
}
