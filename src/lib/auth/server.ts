import { auth, clerkClient } from '@clerk/nextjs/server'

/** Lo que el resto del producto sabe de una cuenta. Ningún tipo de Clerk sale de este archivo. */
export type Cuenta = {
  readonly id: string
  /** El id que tenía antes de Clerk. Solo la API de servidor lo escribe: quien se registra no puede ponérselo. */
  readonly idViejo: string | null
  readonly name: string | null
  readonly email: string | null
  readonly emailVerified: boolean
}

/** Sin red: Clerk verifica la sesión con su firma. El Hilo sondea varias veces por minuto y pasa por aquí. */
export async function idDeLaSesion(): Promise<string | null> {
  return (await auth()).userId
}

/** Con red y contra el límite de la API de Clerk: solo para quien todavía no tiene Dueño. Si Clerk falla, lanza. */
export async function leerCuenta(id: string): Promise<Cuenta> {
  const usuario = await (await clerkClient()).users.getUser(id)
  const correo = usuario.primaryEmailAddress
  return {
    id: usuario.id,
    idViejo: usuario.externalId,
    name: usuario.fullName,
    email: correo?.emailAddress ?? null,
    emailVerified: correo?.verification?.status === 'verified',
  }
}
