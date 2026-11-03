'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PALABRAS_DE_ENTRADA, type MotivoDeEntrada } from './errores'

export type ModoDeEntrada = 'entrar' | 'registro'
export type DatosDeEntrada = { modo: ModoDeEntrada; nombre: string; email: string; password: string }
/** Quién autentica queda afuera: esta pantalla solo sabe que entró (`null`) o por qué no. */
export type Entrador = (datos: DatosDeEntrada) => Promise<MotivoDeEntrada | null>

const TEXTOS: Record<ModoDeEntrada, { titulo: string; nota: string; verbo: string; enCurso: string; otro: string }> = {
  entrar: { titulo: 'Entra a tu negocio', nota: 'Con el correo y la contraseña de tu cuenta.', verbo: 'Entrar', enCurso: 'Entrando…', otro: '¿Primera vez? Arma tu negocio' },
  registro: { titulo: 'Arma tu negocio', nota: 'Con tu correo y una contraseña. Lo demás te lo pregunta tu agente.', verbo: 'Crear cuenta', enCurso: 'Creando tu cuenta…', otro: '¿Ya tienes cuenta? Entra' },
}

function Campo({ etiqueta, nota, ...props }: ComponentProps<typeof Input> & { etiqueta: string; nota?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {etiqueta}
      <Input required className="h-11 px-3.5 text-base font-normal md:text-sm" {...props} />
      {nota && <span className="text-xs font-normal text-muted-foreground">{nota}</span>}
    </label>
  )
}

/** El mismo cielo de Alba: el titular arriba y el formulario en la hoja que sube. En teléfono la hoja llega hasta abajo. */
export function PantallaDeEntrada({ modoInicial, entrar, alEntrar }: { modoInicial: ModoDeEntrada; entrar: Entrador; alEntrar: () => void }) {
  const [modo, setModo] = useState(modoInicial)
  const [motivo, setMotivo] = useState<MotivoDeEntrada | null>(null)
  const [enviando, setEnviando] = useState(false)
  const textos = TEXTOS[modo]
  const registro = modo === 'registro'

  async function enviar(formulario: FormData) {
    setEnviando(true)
    setMotivo(null)
    const email = String(formulario.get('email'))
    const nombre = String(formulario.get('nombre') ?? '') || email
    const fallo = await entrar({ modo, nombre, email, password: String(formulario.get('password')) })
    // Si entró se queda en `enviando`: el botón no vuelve a invitar mientras carga el Panel.
    if (!fallo) return alEntrar()
    setMotivo(fallo)
    setEnviando(false)
  }

  function cambiarDeModo() {
    setModo(registro ? 'entrar' : 'registro')
    setMotivo(null)
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-(image:--alba)">
      <header className="flex h-14 shrink-0 items-center px-5">
        <Link href="/" className="font-heading text-[17px] font-semibold tracking-tight">
          Amanece
        </Link>
      </header>
      <div className="flex flex-1 flex-col sm:items-center sm:justify-center sm:px-5 sm:pb-14">
        <h1 className="my-auto px-5 py-8 font-heading text-[clamp(34px,5.6vw,52px)] leading-[1.04] font-semibold tracking-tight text-balance sm:my-0 sm:px-0 sm:pt-0 sm:pb-7 sm:text-center">{textos.titulo}</h1>
        <section className="w-full rounded-t-[calc(var(--radius)*1.6)] bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-card-foreground shadow-alzada motion-safe:animate-[sube_240ms_var(--ease-entra)] sm:max-w-sm sm:rounded-[calc(var(--radius)*1.6)] sm:p-6">
          <p className="text-sm text-pretty text-muted-foreground">{textos.nota}</p>
          <form action={enviar} className="mt-4 flex flex-col gap-3.5">
            {registro && <Campo etiqueta="Tu nombre" name="nombre" autoComplete="name" />}
            <Campo etiqueta="Correo" name="email" type="email" autoComplete="email" inputMode="email" />
            <Campo etiqueta="Contraseña" name="password" type="password" minLength={8} autoComplete={registro ? 'new-password' : 'current-password'} nota={registro ? 'Mínimo 8 caracteres.' : undefined} />
            {motivo && (
              <p role="alert" className="text-sm text-pretty text-destructive">
                {PALABRAS_DE_ENTRADA[motivo]}
              </p>
            )}
            <Button type="submit" size="lg" disabled={enviando} className="mt-1 h-11 overflow-hidden text-base">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={enviando ? textos.enCurso : textos.verbo} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
                  {enviando ? textos.enCurso : textos.verbo}
                </motion.span>
              </AnimatePresence>
            </Button>
          </form>
          <Button type="button" variant="ghost" onClick={cambiarDeModo} className="mt-2 w-full text-muted-foreground">
            {textos.otro}
          </Button>
        </section>
      </div>
    </main>
  )
}
