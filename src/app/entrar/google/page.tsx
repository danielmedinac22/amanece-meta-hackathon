'use client'

import { HandleSSOCallback } from '@clerk/nextjs'

const irA = (ruta: string) => {
  window.location.href = ruta
}

/** A donde vuelve Google. Clerk termina el intento aquí, y crea la cuenta si es la primera vez. */
export default function VolverDeGoogle() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-(image:--alba) p-5 text-sm text-muted-foreground">
      <p>Entrando…</p>
      <HandleSSOCallback navigateToApp={({ decorateUrl }) => irA(decorateUrl('/panel'))} navigateToSignIn={() => irA('/entrar')} navigateToSignUp={() => irA('/entrar?modo=registro')} />
    </main>
  )
}
