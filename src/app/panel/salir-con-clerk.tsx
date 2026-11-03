'use client'

import { useClerk, useUser } from '@clerk/nextjs'
import { motivoDelError, type MotivoDeEntrada } from '@/app/entrar/errores'
import { Button } from '@/components/ui/button'
import { CuentaPorConfirmar } from './espera'
import { ItemDeSalir } from './operacion'

function useSalir() {
  const { signOut } = useClerk()
  return () => signOut({ redirectUrl: '/entrar' })
}

/** En el menú del Dueño. */
export function SalirConClerk() {
  return <ItemDeSalir alTocar={useSalir()} />
}

/** Donde no hay menú, como el armado o la cuenta en espera. */
export function BotonDeSalirConClerk() {
  return (
    <Button variant="ghost" onClick={useSalir()}>
      Cerrar sesión
    </Button>
  )
}

const intentar = async (accion: () => Promise<unknown>): Promise<MotivoDeEntrada | null> => {
  try {
    await accion()
    return null
  } catch (error) {
    const { status, errors } = error as { status?: number; errors?: readonly { code?: string }[] }
    return motivoDelError({ code: errors?.[0]?.code, status })
  }
}

/** Con el correo confirmado, una navegación completa vuelve a pasar por la puerta, que ahora sí lo enlaza. */
export function ConfirmarCorreoConClerk({ email }: { email: string }) {
  const { isLoaded, user } = useUser()
  const correo = () => {
    const principal = user?.primaryEmailAddress
    if (!principal) throw new Error('Sin correo principal')
    return principal
  }
  return (
    <CuentaPorConfirmar
      email={email}
      listo={isLoaded}
      salir={<BotonDeSalirConClerk />}
      mandar={() => intentar(() => correo().prepareVerification({ strategy: 'email_code' }))}
      confirmar={async (codigo) => {
        const fallo = await intentar(() => correo().attemptVerification({ code: codigo }))
        if (!fallo) window.location.reload()
        return fallo
      }}
    />
  )
}
