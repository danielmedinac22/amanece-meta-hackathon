import { leerPedidos } from '../leer'
import { ListaDePedidos } from '../listas'
import { SinNegocio } from '../vista'

export default async function Pedidos() {
  const datos = await leerPedidos()
  return datos ? <ListaDePedidos {...datos} /> : <SinNegocio />
}
