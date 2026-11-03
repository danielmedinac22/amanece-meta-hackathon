/**
 * La puerta de lo que solo ve el equipo de Amanece, como `/medicion`. Falla cerrada: sin `EQUIPO_DE_AMANECE` no
 * entra nadie, y un correo sin verificar tampoco, porque cualquiera podría registrarse con el de otro.
 */
import { auth } from '@/lib/auth/server'
import type { Marca } from '@/nucleo/identidad'

/** Solo la produce `delEquipo`: lo que pide esta prueba no compila sin ella. */
export type DelEquipo = Marca<{ readonly email: string }, 'DelEquipo'>

type Usuario = { readonly email?: string | null; readonly emailVerified?: boolean | null }

/** Pura. El usuario, si su correo verificado está en la lista (correos separados por coma). */
export function delEquipo(usuario: Usuario | null | undefined, lista: string | undefined = process.env.EQUIPO_DE_AMANECE): DelEquipo | null {
  const equipo = (lista ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const email = usuario?.email?.trim().toLowerCase()
  return email && usuario?.emailVerified === true && equipo.includes(email) ? ({ email } as DelEquipo) : null
}

export async function esDelEquipo(): Promise<DelEquipo | null> {
  const { data } = await auth.getSession()
  return delEquipo(data?.user)
}
