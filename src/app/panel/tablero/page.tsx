import { leerTablero } from '../leer'
import { VistaDelTablero } from '../tablero'
import { SinNegocio } from '../vista'

export default async function Tablero() {
  const datos = await leerTablero()
  return datos ? <VistaDelTablero {...datos} /> : <SinNegocio />
}
