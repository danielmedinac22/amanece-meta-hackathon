import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { ProveedorDeSesion } from '@/lib/auth/proveedor'
import { leerHiloConTarjetas } from '@/negocio/dueno-chat'
import { ArmadoEnLaRuta } from './armado'
import { CuentaEnEspera } from './espera'
import { Hilo } from './hilo'
import { duenoDelPanel, leerArmado, leerOperacion } from './leer'
import { OperacionEnLaRuta } from './operacion'
import { BotonDeSalirConClerk, SalirConClerk } from './salir-con-clerk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function LayoutDelPanel({ children }: { children: ReactNode }) {
  return <ProveedorDeSesion>{await lienzoDelPanel(children)}</ProveedorDeSesion>
}

async function lienzoDelPanel(children: ReactNode) {
  const { negocio, ctx, enEspera } = await duenoDelPanel()
  if (enEspera) return <CuentaEnEspera salir={<BotonDeSalirConClerk />} />
  const hiloLeido = ctx ? leerHiloConTarjetas(ctx) : { mensajes: [], tarjetas: {} }
  if (negocio?.estado !== 'listo') {
    const [armado, hilo] = await Promise.all([leerArmado(), hiloLeido])
    return <ArmadoEnLaRuta datos={armado} inicial={hilo.mensajes} tarjetas={hilo.tarjetas} />
  }
  const [datos, hilo, galletas] = await Promise.all([leerOperacion(), hiloLeido, cookies()])

  return (
    <OperacionEnLaRuta datos={datos} salir={<SalirConClerk />} sidebarAbierto={galletas.get('sidebar_state')?.value !== 'false'} hilo={<Hilo inicial={hilo.mensajes} tarjetas={hilo.tarjetas} />}>
      {children}
    </OperacionEnLaRuta>
  )
}
