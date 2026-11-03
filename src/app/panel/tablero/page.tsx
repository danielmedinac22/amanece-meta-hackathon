import { leerIndicadores } from '../leer'
import { SinNegocio, VistaDelTablero } from '../vista'

export default async function Tablero() {
  const indicadores = await leerIndicadores()
  return indicadores ? <VistaDelTablero indicadores={indicadores} /> : <SinNegocio />
}
