'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth/cliente'
import { useLoEscrito } from '../lo-escrito'

export function FormularioDeEntrada() {
  const router = useRouter()
  const pidioRegistro = useSearchParams().get('modo') === 'registro'
  const loEscrito = useLoEscrito()
  const [eleccion, setEleccion] = useState<boolean | null>(null)
  // Quien viene de la caja casi siempre es nuevo. Un Dueño que ya tiene cuenta está a un toque de entrar.
  const registro = eleccion ?? (pidioRegistro || loEscrito !== null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(formulario: FormData) {
    setEnviando(true)
    setError('')
    const email = String(formulario.get('email'))
    const password = String(formulario.get('password'))
    try {
      const { error } = registro
        ? await authClient.signUp.email({ email, password, name: String(formulario.get('nombre') || email) })
        : await authClient.signIn.email({ email, password })
      if (error) {
        setError(error.message ?? 'No pudimos entrar. Revisa tus datos.')
        return
      }
      router.push('/panel')
      router.refresh()
    } catch {
      setError('No pudimos entrar. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div>
      <Link href="/" className="font-heading text-lg font-semibold tracking-tight">
        <span className="text-primary">●</span> Amanece
      </Link>
      <h1 className="mt-8 font-heading text-2xl font-semibold">{registro ? 'Arma tu negocio' : 'Entra a tu negocio'}</h1>
      {loEscrito && (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
          <p className="text-muted-foreground">{registro ? 'Crea tu cuenta y sigo con lo que me contaste:' : 'Entra y sigo con lo que me contaste:'}</p>
          <p className="mt-0.5 line-clamp-3 break-words">{loEscrito}</p>
        </div>
      )}
      <form action={enviar} className="mt-6 flex flex-col gap-3">
        {registro && <Input name="nombre" placeholder="Tu nombre" required className="h-11 bg-card px-4" />}
        <Input name="email" type="email" placeholder="Correo" required className="h-11 bg-card px-4" />
        <Input name="password" type="password" placeholder="Contraseña" minLength={8} required className="h-11 bg-card px-4" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={enviando} className="mt-2 h-11 text-base">
          {enviando ? 'Un momento…' : registro ? 'Crear cuenta' : 'Entrar'}
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={() => setEleccion(!registro)} className="mt-4 text-muted-foreground">
        {registro ? '¿Ya tienes cuenta? Entra' : '¿Primera vez? Arma tu negocio'}
      </Button>
    </div>
  )
}
