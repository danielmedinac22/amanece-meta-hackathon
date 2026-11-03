import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { leerHiloConTarjetas } from '@/negocio/dueno-chat'
import { ArmadoEnLaRuta } from './armado'
import { Hilo } from './hilo'
import { duenoDelPanel, leerArmado, leerOperacion } from './leer'
import { OperacionEnLaRuta } from './operacion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function LayoutDelPanel({ children }: { children: ReactNode }) {
  const { negocio, ctx } = await duenoDelPanel()
  const hiloLeido = ctx ? leerHiloConTarjetas(ctx) : { mensajes: [], tarjetas: {} }
  if (negocio?.estado !== 'listo') {
    const [armado, hilo] = await Promise.all([leerArmado(), hiloLeido])
    return <ArmadoEnLaRuta datos={armado} inicial={hilo.mensajes} tarjetas={hilo.tarjetas} />
  }
  const [datos, hilo, galletas] = await Promise.all([leerOperacion(), hiloLeido, cookies()])

  return (
    <OperacionEnLaRuta datos={datos} sidebarAbierto={galletas.get('sidebar_state')?.value !== 'false'} hilo={<Hilo inicial={hilo.mensajes} tarjetas={hilo.tarjetas} />}>
      {children}
    </OperacionEnLaRuta>
  )
}
