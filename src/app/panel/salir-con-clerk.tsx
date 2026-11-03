'use client'

import { useClerk } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { ItemDeSalir } from './operacion'

function useSalir() {
  const { signOut } = useClerk()
  return () => signOut({ redirectUrl: '/entrar' })
}

/** En el menú del Dueño. */
export function SalirConClerk() {
  return <ItemDeSalir alTocar={useSalir()} />
}

/** Donde no hay menú, como la cuenta en espera. */
export function BotonDeSalirConClerk() {
  return (
    <Button variant="ghost" onClick={useSalir()}>
      Cerrar sesión
    </Button>
  )
}
