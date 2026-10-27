'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
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
      <Link href="/" className="text-lg font-semibold tracking-tight">
        <span className="text-sol">●</span> Amanece
      </Link>
      <h1 className="mt-8 text-2xl font-semibold">{registro ? 'Arma tu negocio' : 'Entra a tu negocio'}</h1>
      <form action={enviar} className="mt-6 flex flex-col gap-3">
        {registro && <input name="nombre" placeholder="Tu nombre" required className="rounded-xl border border-borde bg-tarjeta px-4 py-3" />}
        <input name="email" type="email" placeholder="Correo" required className="rounded-xl border border-borde bg-tarjeta px-4 py-3" />
        <input name="password" type="password" placeholder="Contraseña" minLength={8} required className="rounded-xl border border-borde bg-tarjeta px-4 py-3" />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button disabled={enviando} className="mt-2 rounded-full bg-sol px-6 py-3 font-medium text-white disabled:opacity-60">
          {enviando ? 'Un momento…' : registro ? 'Crear cuenta' : 'Entrar'}
        </button>
      </form>
      <button onClick={() => setRegistro(!registro)} className="mt-4 text-sm text-suave hover:text-tinta">
        {registro ? '¿Ya tienes cuenta? Entra' : '¿Primera vez? Arma tu negocio'}
      </button>
    </div>
  )
}
