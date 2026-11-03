'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PaperPlaneTilt, Robot, UserCircle } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Atencion, ResultadoDeDevolver, ResultadoDeEscribir, ResultadoDeTomar } from '@/nucleo/clientes/toma'
import { tocarToma, type ConError } from './tocar-toma'

export type EscritoDelDueno = { readonly vez: number; readonly texto: string; readonly intento: string; readonly visto: string | null }

export type AccionesDeToma = {
  tomar(cliente: string): Promise<ConError<ResultadoDeTomar>>
  devolver(cliente: string, vez: number): Promise<ConError<ResultadoDeDevolver>>
  escribir(cliente: string, e: EscritoDelDueno): Promise<ConError<ResultadoDeEscribir>>
}

const SIN_VENTANA = 'Pasaron más de 24 horas desde su último mensaje y WhatsApp no deja escribirle hasta que vuelva a escribir.'
const SONDEO_MS = 8000

/** Cuenta desde que monta, con lo que dijo la base: la pantalla nunca compara relojes. */
function useQueda(quedaMs: number, alVencer: () => void): number {
  const [queda, setQueda] = useState(quedaMs)
  const [anterior, setAnterior] = useState(quedaMs)
  if (anterior !== quedaMs) {
    setAnterior(quedaMs)
    setQueda(quedaMs)
  }
  useEffect(() => {
    const desde = Date.now()
    const reloj = setInterval(() => {
      const resta = quedaMs - (Date.now() - desde)
      setQueda(resta)
      if (resta <= 0) {
        clearInterval(reloj)
        alVencer()
      }
    }, 1000)
    return () => clearInterval(reloj)
  }, [quedaMs, alVencer])
  return queda
}

const enCuanto = (ms: number) => {
  const minutos = Math.ceil(ms / 60_000)
  return minutos <= 1 ? 'en menos de 1 min' : `en ${minutos} min`
}

function Vuelve({ quedaMs, alVencer }: { quedaMs: number; alVencer: () => void }) {
  return <>vuelve a tu agente {enCuanto(useQueda(quedaMs, alVencer))}</>
}

function Redactor({ enviando, alEnviar }: { enviando: boolean; alEnviar: (texto: string) => Promise<boolean> }) {
  const [texto, setTexto] = useState('')
  const enviar = async () => {
    if (await alEnviar(texto)) setTexto('')
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void enviar()
      }}
    >
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Escríbele al Cliente"
        placeholder="Escríbele al Cliente"
        rows={1}
        className="max-h-32 min-h-9 flex-1 resize-none text-[13px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void enviar()
          }
        }}
      />
      <Button type="submit" size="sm" disabled={enviando || !texto.trim()}>
        <PaperPlaneTilt className="size-3.5" /> Enviar
      </Button>
    </form>
  )
}

/** El pie de una conversación: quién atiende, cuánto le queda y, si es tuya, desde dónde le escribes. */
export function ControlDeLaToma({ cliente, atencion, caso, acciones, alCambiar }: { cliente: string; atencion: Atencion; caso: ReactNode; acciones: AccionesDeToma; alCambiar: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  // Se queda si la red falló: el reintento lleva el mismo, y si el primero sí llegó no sale dos veces.
  const intento = useRef<string | null>(null)

  const hacer = async <T,>(accion: () => Promise<T>): Promise<T> => {
    setOcupado(true)
    setAviso(null)
    setEnviado(false)
    try {
      return await accion()
    } finally {
      setOcupado(false)
    }
  }

  const tomar = async () => {
    const r = await hacer(() => acciones.tomar(cliente))
    if (r.tipo === 'error') return setAviso(r.mensaje)
    if (r.tipo === 'la_tiene') setAviso(`Ya la tiene ${r.quien || 'otro Dueño'}.`)
    if (r.tipo === 'no_existe') setAviso('Esta conversación ya no está.')
    alCambiar()
  }

  const devolver = async () => {
    const r = await hacer(() => acciones.devolver(cliente, atencion.vez))
    if (r.tipo === 'error') return setAviso(r.mensaje)
    if (r.tipo === 'no_existe') setAviso('Esta conversación ya no está.')
    alCambiar()
  }

  const escribir = async (texto: string, a: Extract<Atencion, { tipo: 'tuya' }>): Promise<boolean> => {
    if (!texto.trim() || ocupado) return false
    intento.current ??= crypto.randomUUID()
    const r = await hacer(() => acciones.escribir(cliente, { vez: a.vez, texto, intento: intento.current!, visto: a.sinContestar }))
    if (r.tipo === 'error') {
      setAviso(r.mensaje)
      return false
    }
    intento.current = null
    switch (r.tipo) {
      case 'salio':
        setEnviado(true)
        alCambiar()
        return true
      case 'no_salio':
        setAviso(`No salió: ${r.porQue}`)
        return false
      case 'ya_no_la_tienes':
        setAviso('Ya no tienes esta conversación y tu mensaje no salió. Volvió a tu agente.')
        alCambiar()
        return false
      case 'no_la_tomo':
        setAviso('WhatsApp no tomó tu mensaje. Vuelve a enviarlo en un momento.')
        return false
      case 'no_existe':
        setAviso('Esta conversación ya no está.')
        return false
    }
  }

  const devolverBoton = (
    <Button variant="outline" size="sm" className="ml-auto" disabled={ocupado} onClick={() => void devolver()}>
      <Robot className="size-3.5" /> Devolver al agente
    </Button>
  )

  return (
    <div className="flex min-h-14 flex-col justify-center gap-2 border-t border-border p-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {atencion.tipo === 'agente' && (
          <>
            <span>Tu agente está atendiendo</span>
            {caso}
            {atencion.ventana && (
              <Button variant="outline" size="sm" className="ml-auto" disabled={ocupado} onClick={() => void tomar()}>
                <UserCircle className="size-3.5" /> Tomar la conversación
              </Button>
            )}
          </>
        )}
        {atencion.tipo === 'tuya' && (
          <>
            <span className="font-medium text-foreground">
              La tienes tú · <Vuelve quedaMs={atencion.quedaMs} alVencer={alCambiar} />
            </span>
            {caso}
            {devolverBoton}
          </>
        )}
        {atencion.tipo === 'de_otro' && (
          <>
            <span>
              La tiene {atencion.quien} · <Vuelve quedaMs={atencion.quedaMs} alVencer={alCambiar} />
            </span>
            {caso}
            {devolverBoton}
          </>
        )}
      </div>
      {atencion.tipo === 'agente' && atencion.espera && <p className="text-ojo">Este Cliente espera respuesta. Tu agente le contesta cuando vuelva a escribir, o puedes tomar la conversación.</p>}
      {atencion.tipo !== 'de_otro' && !atencion.ventana && <p>{SIN_VENTANA}</p>}
      {atencion.tipo === 'tuya' && atencion.agenteTerminando && <p>Tu agente alcanzó a responderle antes de que la tomaras. Su mensaje puede aparecer en un momento.</p>}
      {aviso && <p className="text-ojo">{aviso}</p>}
      {enviado && !aviso && <p>Enviado.</p>}
      {atencion.tipo === 'tuya' && atencion.ventana && <Redactor enviando={ocupado} alEnviar={(texto) => escribir(texto, atencion)} />}
    </div>
  )
}

/** Mientras alguien la tenga, se refresca sola: un mensaje del Cliente no pasa por `router.refresh` de nadie. */
export function TomaEnLaRuta({ cliente, atencion, caso }: { cliente: string; atencion: Atencion; caso: ReactNode }) {
  const router = useRouter()
  const alCambiar = useCallback(() => router.refresh(), [router])
  const tomada = atencion.tipo !== 'agente'
  useEffect(() => {
    if (!tomada) return
    const sondeo = setInterval(() => router.refresh(), SONDEO_MS)
    return () => clearInterval(sondeo)
  }, [tomada, router])
  return <ControlDeLaToma cliente={cliente} atencion={atencion} caso={caso} acciones={tocarToma} alCambiar={alCambiar} />
}
