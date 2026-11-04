'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PaperPlaneTilt, Robot, UserCircle } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Atencion, ResultadoDeDevolver, ResultadoDeEscribir, ResultadoDeTomar } from '@/nucleo/clientes/toma'
import { rutaDeConversacion } from '@/nucleo/listas-palabras'
import { tocarToma, type ConError } from './tocar-toma'
import { intentoPara, type Intento } from './intento'

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

function Redactor({ texto, setTexto, enviando, alEnviar }: { texto: string; setTexto: (t: string) => void; enviando: boolean; alEnviar: () => Promise<void> }) {
  const enviar = alEnviar
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
  // Vive aquí y no en el redactor: si se acaba el tiempo, lo escrito sigue ahí al volver a tomarla.
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const intento = useRef<Intento | null>(null)

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

  const escribir = async (a: Extract<Atencion, { tipo: 'tuya' }>) => {
    if (!texto.trim() || ocupado) return
    intento.current = intentoPara(intento.current, texto, () => crypto.randomUUID())
    const { id } = intento.current
    const r = await hacer(() => acciones.escribir(cliente, { vez: a.vez, texto, intento: id, visto: a.sinContestar }))
    if (r.tipo === 'error') return setAviso(r.mensaje)
    if (r.tipo === 'sin_saber') {
      setAviso('Todavía no sé si le llegó. Mira la conversación antes de enviarlo de nuevo.')
      return alCambiar()
    }
    intento.current = null
    switch (r.tipo) {
      case 'salio':
        setTexto('')
        setEnviado(true)
        alCambiar()
        return
      case 'no_salio':
        return setAviso(`No salió: ${r.porQue}`)
      case 'ya_no_la_tienes':
        setAviso('Ya no tienes esta conversación y tu mensaje no salió.')
        return alCambiar()
      case 'no_la_tomo':
        return setAviso('WhatsApp no tomó tu mensaje. Vuelve a enviarlo en un momento.')
      case 'no_existe':
        return setAviso('Esta conversación ya no está.')
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
      {atencion.tipo === 'agente' && atencion.espera && <p className="text-ojo">Este Cliente espera respuesta. Tu agente le contesta cuando vuelva a escribir{atencion.ventana ? ', o puedes tomar la conversación' : ''}.</p>}
      {atencion.tipo !== 'de_otro' && !atencion.ventana && <p>{SIN_VENTANA}</p>}
      {atencion.tipo === 'tuya' && atencion.agenteTerminando && <p>Tu agente alcanzó a responderle antes de que la tomaras. Su mensaje puede aparecer en un momento.</p>}
      {aviso && <p className="text-ojo">{aviso}</p>}
      {enviado && !aviso && <p>Enviado.</p>}
      {atencion.tipo !== 'tuya' && texto.trim() && <p>Lo que estabas escribiendo no salió. Si la vuelves a tomar, sigue ahí.</p>}
      {atencion.tipo === 'tuya' && atencion.ventana && <Redactor texto={texto} setTexto={setTexto} enviando={ocupado} alEnviar={() => escribir(atencion)} />}
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
    // Sin `?cliente=`, el detalle es la conversación más reciente: el sondeo saltaría a otra si escribe otro Cliente.
    if (!new URLSearchParams(window.location.search).has('cliente')) router.replace(rutaDeConversacion(cliente), { scroll: false })
    const sondeo = setInterval(() => router.refresh(), SONDEO_MS)
    return () => clearInterval(sondeo)
  }, [tomada, router, cliente])
  return <ControlDeLaToma cliente={cliente} atencion={atencion} caso={caso} acciones={tocarToma} alCambiar={alCambiar} />
}
