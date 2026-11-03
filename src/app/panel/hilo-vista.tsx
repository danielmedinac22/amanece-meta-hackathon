'use client'

import { ArrowUp, CaretUp, CheckCircle, Warning } from '@phosphor-icons/react'
import type { ChatStatus, UIMessage } from 'ai'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import { decisionesEnEspera, decisionQueEspera, tarjetaDeLaParte } from '@/negocio/partes-del-hilo'
import { HiloEnLaOperacion } from './disposicion'
import { etiquetaDe, Tarjeta } from './tarjeta'
import type { TocarTarjeta } from './tocar-tarjeta'

/** Lo que el Dueño ve mientras su Agente del dueño usa una herramienta. */
const ETIQUETAS: Record<string, string> = {
  leer_enlace: 'Leyó lo que publicaste',
  guardar_conocimiento: 'Guardó lo que sabe de tu negocio',
  guardar_productos: 'Actualizó tu catálogo',
  abrir_negocio: 'Dejó listo a tu agente de clientes',
  ver_negocio: 'Revisó tu negocio',
  proponer: 'Preparó lo que pediste',
  descartar_propuesta: 'Descartó una propuesta',
  listar_propuestas: 'Revisó lo que se ha pedido',
  listar_casos: 'Revisó tus casos',
  registrar_capacidad_faltante: 'Anotó algo que todavía no sabe hacer',
}

const SUGERENCIAS_ARMANDO = ['No tengo página: vendo café de especialidad en Manizales', 'Tengo una panadería en Bogotá']
const SUGERENCIAS_LISTO = ['Quiero ver los pedidos confirmados por día', 'Muéstrame los pedidos con novedad']

export type DatosDelHilo = {
  messages: UIMessage[]
  estados: Record<string, EstadoDeTarjeta>
  estado: 'armando' | 'listo' | null
  status: ChatStatus
  error: Error | undefined
}

export function Puntos() {
  return (
    <span className="puntos inline-flex items-center">
      <i />
      <i />
      <i />
    </span>
  )
}

/** Mientras lee un enlace dice cuál; lo demás lleva su etiqueta. */
function etiquetaDelRastro(herramienta: string, parte: { state: string; input?: unknown }) {
  const url = herramienta === 'leer_enlace' && parte.state.startsWith('input') ? (parte.input as { url?: unknown } | undefined)?.url : null
  return typeof url === 'string' ? `Leyendo ${url}` : (ETIQUETAS[herramienta] ?? herramienta)
}

function Rastro({ estado, children }: { estado: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      {estado === 'output-available' ? <CheckCircle weight="fill" className="size-3.5 shrink-0" /> : estado === 'output-error' ? <Warning weight="fill" className="size-3.5 shrink-0 text-destructive" /> : <Puntos />}
      <span>{children}</span>
    </div>
  )
}

/** Pinta la conversación. Quien la conecta decide qué pasa al enviar y al tocar una tarjeta: esta vista no habla con ninguna ruta. */
export function VistaDelHilo({ messages, estados, estado, status, error, alEnviar, alTocar, alCambiar }: DatosDelHilo & { alEnviar: (contenido: string) => void; alTocar: TocarTarjeta; alCambiar: () => void }) {
  const final = useRef<HTMLDivElement>(null)
  // Lo que ya estaba al abrir no entra con movimiento: solo lo que llega después.
  const [yaEstaban] = useState(messages.length)
  const ocupado = status === 'submitted' || status === 'streaming'
  const { vista, controles, avisarDecision } = useContext(HiloEnLaOperacion)

  // `vista` porque oculta no se puede bajar: al volver a verse tiene que quedar en lo último que llegó.
  useEffect(() => {
    final.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, vista])

  useEffect(() => {
    avisarDecision(decisionQueEspera(messages, estados))
  }, [messages, estados, avisarDecision])

  const sugerencias = estado === 'listo' ? SUGERENCIAS_LISTO : SUGERENCIAS_ARMANDO
  const enEspera = decisionesEnEspera(messages, estados)
  const posicionDe = (propuesta: string) => {
    const i = enEspera.findIndex((t) => t.propuesta === propuesta)
    return enEspera.length > 1 && i >= 0 ? `${i + 1} de ${enEspera.length}` : null
  }
  const tarjeta = (t: NonNullable<ReturnType<typeof tarjetaDeLaParte>>) => <Tarjeta tarjeta={t} estado={estados[t.propuesta]} posicion={posicionDe(t.propuesta)} ancla={`tarjeta-${t.propuesta}`} alTocar={alTocar} alCambiar={alCambiar} />

  return (
    <div className="flex h-full min-h-0 flex-col flotante:h-auto">
      <div data-conversacion className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 motion-safe:scroll-smooth flotante:mb-2 flotante:max-h-[58vh] flotante:flex-none flotante:rounded-lg flotante:border flotante:bg-background flotante:p-4 flotante:shadow-alzada plegada:hidden">
        {enEspera.length > 1 && (
          <button type="button" onClick={() => document.getElementById(`tarjeta-${enEspera[0].propuesta}`)?.scrollIntoView({ block: 'start' })} className="sticky top-0 z-10 flex w-full shrink-0 items-center gap-2 rounded-[calc(var(--radius)-4px)] border border-border bg-card px-3 py-2 text-left text-xs">
            <Warning weight="fill" className="size-3.5 shrink-0 text-ojo" />
            <span className="shrink-0 font-medium tabular-nums">1 de {enEspera.length}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{etiquetaDe(enEspera[0], estados[enEspera[0].propuesta])}</span>
            <CaretUp className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
        {messages.length === 0 && (
          <p className="text-(length:--texto-hilo) leading-normal text-pretty">
            Hola, soy tu agente. Trabajo para tu negocio todo el día. Si ya lo tienes publicado en una página o en Instagram,
            pégame el enlace y lo leo. Si no, cuéntame cómo se llama y qué vendes.
          </p>
        )}
        {messages.map((m, indice) => (
          <MensajeDelHilo key={m.id} m={m} entra={indice >= yaEstaban} tarjeta={tarjeta} />
        ))}
        {status === 'submitted' && (
          <span role="status" aria-label="Tu agente está escribiendo" className="py-1">
            <Puntos />
          </span>
        )}
        {error && <p className="text-sm text-destructive">Algo falló. Intenta de nuevo.</p>}
        <div ref={final} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 flotante:hidden">
        {sugerencias.map((s) => (
          <Button key={s} variant="outline" size="xs" onClick={() => alEnviar(s)} disabled={ocupado} className="h-auto max-w-full shrink rounded-full bg-background px-2.5 py-1 text-left font-normal whitespace-normal text-muted-foreground hover:text-foreground">
            {s}
          </Button>
        ))}
      </div>
      <Redactor ocupado={ocupado} alEnviar={alEnviar}>
        {controles}
      </Redactor>
    </div>
  )
}

/** Un mensaje de la conversación. `tarjeta` pinta una decisión, o devuelve `null` si quien la pinta la lleva a otro lado. */
export function MensajeDelHilo({ m, entra, tarjeta }: { m: UIMessage; entra: boolean; tarjeta: (t: TarjetaDeAprobacion) => ReactNode }) {
  return (
    <div className={[m.role === 'user' ? 'flex justify-end' : 'flex flex-col gap-3', entra ? 'motion-safe:animate-[sube_240ms_var(--ease-entra)]' : ''].join(' ')}>
      {m.role === 'user' ? (
        <div className="max-w-[85%] rounded-[calc(var(--radius)+2px)] bg-secondary px-3.5 py-2 text-(length:--texto-hilo) leading-[1.45] text-pretty whitespace-pre-wrap text-secondary-foreground">
          {m.parts.map((parte, i) => (parte.type === 'text' ? <span key={i}>{parte.text}</span> : null))}
        </div>
      ) : (
        m.parts.map((parte, i) => {
          if (parte.type === 'text') return <p key={i} className="text-(length:--texto-hilo) leading-normal text-pretty whitespace-pre-wrap">{parte.text}</p>
          const t = tarjetaDeLaParte(parte)
          if (parte.type.startsWith('tool-')) {
            const herramienta = parte.type.slice(5)
            const conEstado = parte as { state: string; input?: unknown }
            return (
              <div key={i} className="flex flex-col gap-3">
                <Rastro estado={conEstado.state}>{etiquetaDelRastro(herramienta, conEstado)}</Rastro>
                {t && tarjeta(t)}
              </div>
            )
          }
          return t ? <div key={i}>{tarjeta(t)}</div> : null
        })
      )}
    </div>
  )
}

/** La caja donde el Dueño escribe, en el Hilo y en la carta del armado. `children` son los controles que van al lado de enviar. */
export function Redactor({ ocupado, alEnviar, children }: { ocupado: boolean; alEnviar: (contenido: string) => void; children?: ReactNode }) {
  const [texto, setTexto] = useState('')
  function enviar() {
    if (!texto.trim() || ocupado) return
    alEnviar(texto)
    setTexto('')
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        enviar()
      }}
      className="mt-2 flex items-end gap-2 rounded-(--radius) border border-border bg-card p-2 flotante:mt-0 flotante:items-center flotante:gap-1 flotante:rounded-lg flotante:p-1 flotante:shadow-alzada"
    >
      <textarea
        rows={1}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            enviar()
          }
        }}
        placeholder="Escríbele a tu agente"
        aria-label="Escríbele a tu agente"
        className="field-sizing-content max-h-32 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="icon" aria-label="Enviar" disabled={ocupado || !texto.trim()} className="size-9 rounded-full not-disabled:bg-(image:--sol) not-disabled:text-(--sol-foreground)">
        <ArrowUp weight="bold" className="size-4" />
      </Button>
      {children}
    </form>
  )
}
