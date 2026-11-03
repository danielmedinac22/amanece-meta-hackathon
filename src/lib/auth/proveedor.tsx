import { ClerkProvider } from '@clerk/nextjs'
import { shadcn } from '@clerk/ui/themes'
import type { ReactNode } from 'react'

const VERIFICANDO = { title: 'Un momento', subtitle: 'Estoy revisando que todo esté bien.', loading: 'Revisando…', retryButton: 'Volver a intentar' }

/**
 * Solo en `/entrar` y `/panel`: la portada no carga el script de Clerk. El Panel lo necesita aunque no pinte nada de
 * Clerk, porque el token dura un minuto y este es quien lo renueva mientras el Hilo sondea. Lo único que Clerk pinta es
 * el diálogo de su protección contra bots, y por eso lleva el tema, que toma nuestros tokens, y estas palabras.
 */
export function ProveedorDeSesion({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider signInUrl="/entrar" signUpUrl="/entrar?modo=registro" afterSignOutUrl="/entrar" appearance={{ theme: shadcn }} localization={{ signIn: { protectCheck: VERIFICANDO }, signUp: { protectCheck: VERIFICANDO } }}>
      {children}
    </ClerkProvider>
  )
}
