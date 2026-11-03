import { InicioHoy } from './inicio-hoy'
import { leerInicio } from './leer'
import { SinNegocio, VistaDelNegocio } from './vista'

export default async function Inicio() {
  const inicio = await leerInicio()
  if (!inicio) return <SinNegocio />
  return inicio.tipo === 'hoy' ? <InicioHoy {...inicio.datos} /> : <VistaDelNegocio datos={inicio.datos} />
}
