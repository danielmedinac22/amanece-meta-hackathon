'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth/cliente'

export function FormularioDeEntrada() {
  const router = useRouter()
  const [registro, setRegistro] = useState(useSearchParams().get('modo') === 'registro')
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
      <form action={enviar} className="mt-6 flex flex-col gap-3">
        {registro && <Input name="nombre" placeholder="Tu nombre" required className="h-11 bg-card px-4" />}
        <Input name="email" type="email" placeholder="Correo" required className="h-11 bg-card px-4" />
        <Input name="password" type="password" placeholder="Contraseña" minLength={8} required className="h-11 bg-card px-4" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={enviando} className="mt-2 h-11 text-base">
          {enviando ? 'Un momento…' : registro ? 'Crear cuenta' : 'Entrar'}
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={() => setRegistro(!registro)} className="mt-4 text-muted-foreground">
        {registro ? '¿Ya tienes cuenta? Entra' : '¿Primera vez? Arma tu negocio'}
      </Button>
    </div>
  )
}
