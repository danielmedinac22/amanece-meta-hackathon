import { duenoDelPanel } from '../leer'
import { FaltaEstaSeccion } from '../vista'

export default async function Pedidos() {
  await duenoDelPanel()
  return <FaltaEstaSeccion que="tus pedidos" />
}
