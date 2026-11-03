'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/cliente'
import { motivoDelError } from './errores'
import { PantallaDeEntrada, type Entrador, type ModoDeEntrada } from './formulario'

const entrarConNeonAuth: Entrador = async ({ modo, nombre, email, password }) => {
  try {
    const { error } = modo === 'registro' ? await authClient.signUp.email({ email, password, name: nombre }) : await authClient.signIn.email({ email, password })
    return error ? motivoDelError(error) : null
  } catch {
    return 'sin_conexion'
  }
}

export function EntradaConNeonAuth({ modoInicial }: { modoInicial: ModoDeEntrada }) {
  const router = useRouter()
  return (
    <PantallaDeEntrada
      modoInicial={modoInicial}
      entrar={entrarConNeonAuth}
      alEntrar={() => {
        router.push('/panel')
        router.refresh()
      }}
    />
  )
}
