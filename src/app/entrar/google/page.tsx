'use client'

import { HandleSSOCallback } from '@clerk/nextjs'
import Link from 'next/link'

const irA = (ruta: string) => {
  window.location.href = ruta
}

/** A donde vuelve Google. Clerk termina el intento aquí, y crea la cuenta si es la primera vez. */
export default function VolverDeGoogle() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-2 bg-(image:--alba) p-5 text-sm text-muted-foreground">
      <p>Entrando…</p>
      {/* Un intento que pide algo que este regreso no atiende se queda aquí sin navegar. */}
      <Link href="/entrar" className="underline underline-offset-4">
        ¿Se quedó aquí? Vuelve a entrar
      </Link>
      <HandleSSOCallback navigateToApp={({ decorateUrl }) => irA(decorateUrl('/panel'))} navigateToSignIn={() => irA('/entrar')} navigateToSignUp={() => irA('/entrar?modo=registro')} />
    </main>
  )
}
