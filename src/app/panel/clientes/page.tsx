import { duenoDelPanel } from '../leer'
import { FaltaEstaSeccion } from '../vista'

export default async function Clientes() {
  await duenoDelPanel()
  return <FaltaEstaSeccion que="tus clientes" />
}
