'use client'

import { useAuth, useSignIn, useSignUp } from '@clerk/nextjs'
import { useEffect } from 'react'
import { motivoDelError, type MotivoDeEntrada } from './errores'
import { PantallaDeEntrada, type Entrador, type ModoDeEntrada, type RespuestaDeEntrada } from './formulario'

const EN_EL_PANEL = '/panel'
const LISTO: RespuestaDeEntrada = { paso: { en: 'listo' } }

type ErrorDeClerk = { code?: string; status?: number; errors?: readonly { code?: string }[] }

function codigoDelError(error: unknown) {
  const { code, status, errors } = (error ?? {}) as ErrorDeClerk
  return { code: errors?.[0]?.code ?? code, status }
}

const fallo = (error: unknown, cambia?: Partial<Record<MotivoDeEntrada, MotivoDeEntrada>>): RespuestaDeEntrada => {
  const motivo = motivoDelError(codigoDelError(error))
  return { motivo: cambia?.[motivo] ?? motivo }
}

/** Una navegación completa: el Panel carga con la cookie nueva y sin nada del enrutador de antes de entrar. */
const navegarCompleto = (url: string) => {
  window.location.href = url
}
const alPanel = ({ decorateUrl }: { decorateUrl: (url: string) => string }) => navegarCompleto(decorateUrl(EN_EL_PANEL))

function useEntradorDeClerk(): Entrador {
  const { signIn } = useSignIn()
  const { signUp } = useSignUp()

  async function terminarEntrada(): Promise<RespuestaDeEntrada> {
    const { error } = await signIn.finalize({ navigate: alPanel })
    return error ? fallo(error) : LISTO
  }

  async function terminarRegistro(): Promise<RespuestaDeEntrada> {
    const { error } = await signUp.finalize({ navigate: alPanel })
    return error ? fallo(error) : LISTO
  }

  /** Lo que sigue después de un paso del intento. Todo estado que no sabemos atender dice `no_se_pudo` y no deja a nadie a medias. */
  async function segunElIntento(): Promise<RespuestaDeEntrada> {
    switch (signIn.status) {
      case 'complete':
        return terminarEntrada()
      case 'needs_client_trust':
      case 'needs_second_factor': {
        const { error } = await signIn.mfa.sendEmailCode()
        if (error) return fallo(error)
        return { paso: { en: 'codigo', por: 'dispositivo', email: signIn.identifier ?? '' } }
      }
      case 'needs_new_password':
        return { paso: { en: 'contrasena_nueva' } }
      case 'needs_identifier':
      case 'needs_first_factor':
      case 'needs_protect_check':
      case null:
        return { motivo: 'no_se_pudo' }
    }
  }

  return async (accion) => {
    try {
      switch (accion.que) {
        case 'credenciales': {
          const { modo, nombre, email, password } = accion.datos
          if (modo === 'entrar') {
            const { error } = await signIn.password({ emailAddress: email, password })
            return error ? fallo(error) : segunElIntento()
          }
          const { error } = await signUp.password({ emailAddress: email, password, firstName: nombre })
          if (error) return fallo(error)
          const envio = await signUp.verifications.sendEmailCode()
          return envio.error ? fallo(envio.error) : { paso: { en: 'codigo', por: 'registro', email } }
        }
        case 'codigo': {
          if (accion.por === 'registro') {
            const { error } = await signUp.verifications.verifyEmailCode({ code: accion.codigo })
            if (error) return fallo(error)
            return signUp.status === 'complete' ? terminarRegistro() : { motivo: 'no_se_pudo' }
          }
          if (accion.por === 'recuperar') {
            const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: accion.codigo })
            return error ? fallo(error) : segunElIntento()
          }
          const { error } = await signIn.mfa.verifyEmailCode({ code: accion.codigo })
          return error ? fallo(error) : segunElIntento()
        }
        case 'reenviar': {
          const envio = accion.por === 'registro' ? signUp.verifications.sendEmailCode() : accion.por === 'recuperar' ? signIn.resetPasswordEmailCode.sendCode() : signIn.mfa.sendEmailCode()
          const { error } = await envio
          return error ? fallo(error) : { paso: { en: 'credenciales' } }
        }
        case 'olvido': {
          const creado = await signIn.create({ identifier: accion.email })
          if (creado.error) return fallo(creado.error, { datos_no_coinciden: 'correo_sin_cuenta' })
          const { error } = await signIn.resetPasswordEmailCode.sendCode()
          return error ? fallo(error) : { paso: { en: 'codigo', por: 'recuperar', email: accion.email } }
        }
        case 'contrasena_nueva': {
          const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password: accion.password })
          return error ? fallo(error) : segunElIntento()
        }
        case 'google': {
          const { error } = await signIn.sso({ strategy: 'oauth_google', redirectCallbackUrl: '/entrar/google', redirectUrl: EN_EL_PANEL })
          return error ? fallo(error) : LISTO
        }
        case 'volver':
          await Promise.all([signIn.reset(), signUp.reset()])
          return { paso: { en: 'credenciales' } }
      }
    } catch (error) {
      const { code, status } = codigoDelError(error)
      return code || status ? fallo(error) : { motivo: 'sin_conexion' }
    }
  }
}

export function EntradaConClerk({ modoInicial }: { modoInicial: ModoDeEntrada }) {
  const entrar = useEntradorDeClerk()
  const { isSignedIn } = useAuth()
  // Un token vencido en una navegación interna llega aquí como si no hubiera sesión, porque Clerk solo lo renueva en
  // una navegación completa. Con la sesión viva, esta la hace; también si entró en otra pestaña.
  useEffect(() => {
    if (isSignedIn) navegarCompleto(EN_EL_PANEL)
  }, [isSignedIn])
  // Si la instancia pide captcha, Clerk lo pinta aquí. En un registro normal queda vacío.
  return <PantallaDeEntrada modoInicial={modoInicial} entrar={entrar} debajo={<div id="clerk-captcha" className="empty:hidden" />} />
}
