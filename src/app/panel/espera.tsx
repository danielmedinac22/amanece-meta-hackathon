import type { ReactNode } from 'react'

/** Una cuenta que todavía no llega a su Negocio. No se le crea uno vacío: el suyo sigue guardado. */
export function CuentaEnEspera({ salir }: { salir: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-3 bg-(image:--alba) px-5 text-center">
      <h1 className="font-heading text-[clamp(28px,5vw,40px)] leading-[1.08] font-semibold tracking-tight text-balance">Estoy pasando tu cuenta</h1>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">Si ya tenías un negocio aquí, sigue guardado. Vuelve a entrar en un rato. Si sigue igual, escríbele a quien te ayudó a empezar.</p>
      <div className="mt-2">{salir}</div>
    </main>
  )
}
