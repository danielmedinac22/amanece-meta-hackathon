import { VistaDeAgenda } from '../agenda'
import { leerLaAgenda } from '../leer'
import { SinNegocio } from '../vista'

export default async function Agenda() {
  const datos = await leerLaAgenda()
  return datos ? <VistaDeAgenda {...datos} /> : <SinNegocio />
}
