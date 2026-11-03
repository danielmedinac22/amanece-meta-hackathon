import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { leerHiloConTarjetas } from '@/negocio/dueno-chat'
import { Hilo } from './hilo'
import { duenoDelPanel, leerOperacion } from './leer'
import { OperacionEnLaRuta } from './operacion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function LayoutDelPanel({ children }: { children: ReactNode }) {
  const { negocio, ctx } = await duenoDelPanel()
  const [datos, hilo, galletas] = await Promise.all([leerOperacion(), ctx ? leerHiloConTarjetas(ctx) : { mensajes: [], tarjetas: {} }, cookies()])

  return (
    <OperacionEnLaRuta datos={datos} sidebarAbierto={galletas.get('sidebar_state')?.value !== 'false'} hilo={<Hilo inicial={hilo.mensajes} tarjetas={hilo.tarjetas} estado={negocio?.estado ?? null} />}>
      {children}
    </OperacionEnLaRuta>
  )
}
