import { leerClientes } from '../leer'
import { TablaDeClientes } from '../listas'
import { SinNegocio } from '../vista'

export default async function Clientes() {
  const datos = await leerClientes()
  return datos ? <TablaDeClientes {...datos} /> : <SinNegocio />
}
