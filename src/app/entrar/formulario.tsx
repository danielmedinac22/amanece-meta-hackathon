'use client'

import { GoogleLogo } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLoEscrito } from '../lo-escrito'
import { MINIMO_DE_CONTRASENA, PALABRAS_DE_ENTRADA, type MotivoDeEntrada } from './errores'

export type ModoDeEntrada = 'entrar' | 'registro'
export type DatosDeEntrada = { modo: ModoDeEntrada; nombre: string; email: string; password: string }
export type PorQueElCodigo = 'registro' | 'dispositivo' | 'recuperar'

/** En qué punto va el Dueño. `listo` es que ya entró y solo falta llegar al Panel. */
export type PasoDeEntrada = { en: 'credenciales' } | { en: 'olvido' } | { en: 'codigo'; por: PorQueElCodigo; email: string } | { en: 'contrasena_nueva' } | { en: 'listo' }

/** Lo que el Dueño pide. Esta pantalla no sabe qué hay detrás de cada pedido. */
export type AccionDeEntrada =
  | { que: 'credenciales'; datos: DatosDeEntrada }
  | { que: 'olvido'; email: string }
  | { que: 'codigo'; por: PorQueElCodigo; codigo: string }
  | { que: 'reenviar'; por: PorQueElCodigo }
  | { que: 'contrasena_nueva'; password: string }
  | { que: 'google' }
  | { que: 'volver' }

export type RespuestaDeEntrada = { paso: PasoDeEntrada } | { motivo: MotivoDeEntrada }
/** Quién autentica queda afuera: esta pantalla solo sabe qué sigue o por qué no. */
export type Entrador = (accion: AccionDeEntrada) => Promise<RespuestaDeEntrada>

type Textos = { titulo: string; nota: string; verbo: string; enCurso: string }

const TEXTOS_DE_CREDENCIALES: Record<ModoDeEntrada, Textos & { otro: string }> = {
  entrar: { titulo: 'Entra a tu negocio', nota: 'Con el correo y la contraseña de tu cuenta.', verbo: 'Entrar', enCurso: 'Entrando…', otro: '¿Primera vez? Arma tu negocio' },
  registro: { titulo: 'Arma tu negocio', nota: 'Con tu correo y una contraseña. Lo demás te lo pregunta tu agente.', verbo: 'Crear cuenta', enCurso: 'Creando tu cuenta…', otro: '¿Ya tienes cuenta? Entra' },
}

const TEXTOS_DE_CODIGO: Record<PorQueElCodigo, Omit<Textos, 'nota'> & { nota: (email: string) => string }> = {
  registro: { titulo: 'Confirma tu correo', nota: (email) => `Te mandé un código a ${email}. Escríbelo aquí.`, verbo: 'Confirmar', enCurso: 'Confirmando…' },
  dispositivo: { titulo: 'Confirma que eres tú', nota: (email) => `Es la primera vez que entras desde aquí. Te mandé un código a ${email}.`, verbo: 'Entrar', enCurso: 'Entrando…' },
  recuperar: { titulo: 'Recupera tu cuenta', nota: (email) => `Te mandé un código a ${email}. Con él creas una contraseña nueva.`, verbo: 'Seguir', enCurso: 'Revisando…' },
}

const TEXTOS_DE_OLVIDO: Textos = { titulo: 'Recupera tu cuenta', nota: 'Escribe tu correo y te mando un código.', verbo: 'Mandarme el código', enCurso: 'Mandándolo…' }
const TEXTOS_DE_CONTRASENA: Textos = { titulo: 'Crea tu contraseña nueva', nota: 'Con esta entras de ahora en adelante.', verbo: 'Guardar y entrar', enCurso: 'Guardando…' }

const NOTA_DE_CONTRASENA = `Mínimo ${MINIMO_DE_CONTRASENA} caracteres.`

function textosDe(paso: PasoDeEntrada, modo: ModoDeEntrada): Textos {
  if (paso.en === 'codigo') return { ...TEXTOS_DE_CODIGO[paso.por], nota: TEXTOS_DE_CODIGO[paso.por].nota(paso.email) }
  if (paso.en === 'olvido') return TEXTOS_DE_OLVIDO
  if (paso.en === 'contrasena_nueva') return TEXTOS_DE_CONTRASENA
  return TEXTOS_DE_CREDENCIALES[modo]
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

/**
 * El mismo cielo de Alba: el titular arriba y el formulario en la hoja que sube. En teléfono la hoja llega hasta abajo.
 * `debajo` es lo que el proveedor necesita en la página, como el lugar de su captcha.
 */
export function PantallaDeEntrada({ modoInicial, pasoInicial = { en: 'credenciales' }, entrar, debajo }: { modoInicial: ModoDeEntrada; pasoInicial?: PasoDeEntrada; entrar: Entrador; debajo?: ReactNode }) {
  const loEscrito = useLoEscrito()
  const [eleccion, setEleccion] = useState<ModoDeEntrada | null>(null)
  // Quien viene de la caja casi siempre es nuevo. Un Dueño que ya tiene cuenta está a un toque de entrar.
  const modo = eleccion ?? (loEscrito !== null ? 'registro' : modoInicial)
  const [paso, setPaso] = useState<PasoDeEntrada>(pasoInicial)
  const [motivo, setMotivo] = useState<MotivoDeEntrada | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [reenviado, setReenviado] = useState(false)
  const textos = textosDe(paso, modo)
  const registro = modo === 'registro'
  const enCredenciales = paso.en === 'credenciales'

  /** Si entró se queda en `enviando`: el botón no vuelve a invitar mientras carga el Panel o abre Google. */
  async function pedir(accion: AccionDeEntrada) {
    setEnviando(true)
    setMotivo(null)
    const respuesta = await entrar(accion)
    if ('motivo' in respuesta) {
      setMotivo(respuesta.motivo)
      setEnviando(false)
      return
    }
    if (respuesta.paso.en === 'listo') return
    setPaso(respuesta.paso)
    setReenviado(false)
    setEnviando(false)
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    // Con `action`, React vacía el formulario al terminar: un error obligaría a escribir todo otra vez.
    evento.preventDefault()
    const formulario = new FormData(evento.currentTarget)
    const dato = (nombre: string) => String(formulario.get(nombre) ?? '')
    if (paso.en === 'credenciales') {
      const email = dato('email')
      return pedir({ que: 'credenciales', datos: { modo, nombre: dato('nombre') || email, email, password: dato('password') } })
    }
    if (paso.en === 'olvido') return pedir({ que: 'olvido', email: dato('email') })
    if (paso.en === 'codigo') return pedir({ que: 'codigo', por: paso.por, codigo: dato('codigo').trim() })
    if (paso.en === 'contrasena_nueva') return pedir({ que: 'contrasena_nueva', password: dato('password') })
  }

  function cambiarDeModo() {
    setEleccion(registro ? 'entrar' : 'registro')
    setMotivo(null)
  }

  function volver() {
    void entrar({ que: 'volver' })
    setPaso({ en: 'credenciales' })
    setMotivo(null)
    setEnviando(false)
  }

  async function reenviar(por: PorQueElCodigo) {
    setMotivo(null)
    const respuesta = await entrar({ que: 'reenviar', por })
    if ('motivo' in respuesta) return setMotivo(respuesta.motivo)
    setReenviado(true)
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
          <p className="text-sm text-pretty break-words text-muted-foreground">{textos.nota}</p>
          {loEscrito && enCredenciales && (
            <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="text-muted-foreground">{registro ? 'Crea tu cuenta y sigo con lo que me contaste:' : 'Entra y sigo con lo que me contaste:'}</p>
              <p className="mt-0.5 line-clamp-3 break-words">{loEscrito}</p>
            </div>
          )}
          <form key={paso.en} onSubmit={enviar} className="mt-4 flex flex-col gap-3.5">
            {enCredenciales && registro && <Campo etiqueta="Tu nombre" name="nombre" autoComplete="name" />}
            {(enCredenciales || paso.en === 'olvido') && <Campo etiqueta="Correo" name="email" type="email" autoComplete="email" inputMode="email" />}
            {enCredenciales && <Campo etiqueta="Contraseña" name="password" type="password" minLength={registro ? MINIMO_DE_CONTRASENA : undefined} autoComplete={registro ? 'new-password' : 'current-password'} nota={registro ? NOTA_DE_CONTRASENA : undefined} />}
            {paso.en === 'codigo' && <Campo etiqueta="Código" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />}
            {paso.en === 'contrasena_nueva' && <Campo etiqueta="Contraseña nueva" name="password" type="password" minLength={MINIMO_DE_CONTRASENA} autoComplete="new-password" nota={NOTA_DE_CONTRASENA} autoFocus />}
            {motivo && (
              <p role="alert" className="text-sm text-pretty text-destructive">
                {PALABRAS_DE_ENTRADA[motivo]}
              </p>
            )}
            {reenviado && <p className="text-sm text-muted-foreground">Te mandé otro. Revisa también el correo no deseado.</p>}
            {debajo}
            <Button type="submit" size="lg" disabled={enviando} className="mt-1 h-11 overflow-hidden text-base">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={enviando ? textos.enCurso : textos.verbo} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
                  {enviando ? textos.enCurso : textos.verbo}
                </motion.span>
              </AnimatePresence>
            </Button>
          </form>
          {enCredenciales && (
            <Button type="button" variant="outline" size="lg" disabled={enviando} onClick={() => pedir({ que: 'google' })} className="mt-2 h-11 w-full text-base">
              <GoogleLogo weight="bold" aria-hidden />
              Seguir con Google
            </Button>
          )}
          {enCredenciales && !registro && (
            <Button type="button" variant="ghost" onClick={() => setPaso({ en: 'olvido' })} className="mt-2 w-full text-muted-foreground">
              ¿Olvidaste tu contraseña?
            </Button>
          )}
          {paso.en === 'codigo' && (
            <Button type="button" variant="ghost" onClick={() => reenviar(paso.por)} className="mt-2 w-full text-muted-foreground">
              Mándame otro código
            </Button>
          )}
          {enCredenciales ? (
            <Button type="button" variant="ghost" onClick={cambiarDeModo} className="mt-2 w-full text-muted-foreground">
              {TEXTOS_DE_CREDENCIALES[modo].otro}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={volver} className="mt-2 w-full text-muted-foreground">
              Volver
            </Button>
          )}
        </section>
      </div>
    </main>
  )
}
