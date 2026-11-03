'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { PALABRAS_DE_ENTRADA, type MotivoDeEntrada } from '@/app/entrar/errores'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function Marco({ titulo, nota, salir, children }: { titulo: string; nota: string; salir: ReactNode; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-3 bg-(image:--alba) px-5 text-center">
      <h1 className="font-heading text-[clamp(28px,5vw,40px)] leading-[1.08] font-semibold tracking-tight text-balance">{titulo}</h1>
      <p className="max-w-sm text-sm text-pretty break-words text-muted-foreground">{nota}</p>
      {children}
      <div className="mt-2">{salir}</div>
    </main>
  )
}

/** Una cuenta que todavía no llega a su Negocio. No se le crea uno vacío: el suyo sigue guardado. */
export function CuentaPorPasar({ salir }: { salir: ReactNode }) {
  return <Marco titulo="Estoy pasando tu cuenta" nota="Si ya tenías un negocio aquí, sigue guardado. Vuelve a entrar en un rato. Si sigue igual, escríbele a quien te ayudó a empezar." salir={salir} />
}

export type ConfirmarCorreo = { mandar: () => Promise<MotivoDeEntrada | null>; confirmar: (codigo: string) => Promise<MotivoDeEntrada | null> }

/**
 * Un correo sin verificar no llega a ningún Negocio. Aquí su dueño lo confirma con un código, y al confirmarlo la puerta
 * lo deja pasar. Quién manda el código queda afuera: la vitrina la pinta sin proveedor.
 */
export function CuentaPorConfirmar({ email, salir, listo = true, mandar, confirmar }: ConfirmarCorreo & { email: string; salir: ReactNode; listo?: boolean }) {
  const [mandado, setMandado] = useState(false)
  const [motivo, setMotivo] = useState<MotivoDeEntrada | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function pedirCodigo() {
    setEnviando(true)
    setMotivo(null)
    const fallo = await mandar()
    setMotivo(fallo)
    setMandado(!fallo)
    setEnviando(false)
  }

  /** Si confirmó se queda en `enviando`: quien lo pintó recarga y ya llega al Panel. */
  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setEnviando(true)
    setMotivo(null)
    const fallo = await confirmar(String(new FormData(evento.currentTarget).get('codigo') ?? '').trim())
    if (!fallo) return
    setMotivo(fallo)
    setEnviando(false)
  }

  const nota = mandado ? `Te mandé un código a ${email}. Escríbelo aquí y sigues a tu negocio.` : `Antes de seguir a tu negocio te mando un código a ${email}.`
  return (
    <Marco titulo="Confirma tu correo" nota={nota} salir={salir}>
      <section className="mt-2 flex w-full max-w-sm flex-col gap-3 rounded-[calc(var(--radius)*1.6)] bg-card p-5 text-left text-card-foreground shadow-alzada">
        {mandado && (
          <form onSubmit={enviar} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Código
              <Input required name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus className="h-11 px-3.5 text-base font-normal md:text-sm" />
            </label>
            <Button type="submit" size="lg" disabled={enviando} className="h-11 text-base">
              {enviando ? 'Confirmando…' : 'Confirmar'}
            </Button>
          </form>
        )}
        {motivo && (
          <p role="alert" className="text-sm text-pretty text-destructive">
            {PALABRAS_DE_ENTRADA[motivo]}
          </p>
        )}
        {mandado ? (
          <Button type="button" variant="ghost" onClick={pedirCodigo} className="w-full text-muted-foreground">
            Mándame otro código
          </Button>
        ) : (
          <Button type="button" size="lg" disabled={enviando || !listo} onClick={pedirCodigo} className="h-11 text-base">
            {enviando ? 'Mandándolo…' : 'Mandarme el código'}
          </Button>
        )}
      </section>
    </Marco>
  )
}
