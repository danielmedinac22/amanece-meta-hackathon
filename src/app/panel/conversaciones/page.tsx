import { duenoDelPanel } from '../leer'
import { FaltaEstaSeccion } from '../vista'

export default async function Conversaciones() {
  await duenoDelPanel()
  return <FaltaEstaSeccion que="tus conversaciones" />
}
