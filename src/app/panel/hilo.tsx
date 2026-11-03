'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { tarjetaDeLaParte } from '@/negocio/partes-del-hilo'
import { Tarjeta } from './tarjeta'

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
const SUGERENCIAS_LISTO = [
  'Cuando un pedido sea para fuera de mi ciudad, ábreme un Caso y no prometas fecha',
  'Quiero ver los pedidos confirmados por día',
  'Muéstrame los pedidos con novedad',
]

type HiloLeido = { mensajes: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }

export function Hilo({ inicial, tarjetas, estado }: { inicial: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta>; estado: 'armando' | 'listo' | null }) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const [estados, setEstados] = useState(tarjetas)
  const final = useRef<HTMLDivElement>(null)
  const { messages, sendMessage, setMessages, status, error } = useChat({
    messages: inicial,
    transport: new DefaultChatTransport({ api: '/api/dueno/chat' }),
    onFinish: () => router.refresh(),
  })
  const ocupado = status === 'submitted' || status === 'streaming'

  // Los Casos y las líneas de lo que se aprobó llegan solos: se revisa cada tanto el Hilo y el estado de sus tarjetas.
  const releer = useCallback(async () => {
    const respuesta = await fetch('/api/dueno/chat').catch(() => null)
    if (!respuesta?.ok) return
    const servidor = (await respuesta.json()) as HiloLeido
    setEstados(servidor.tarjetas)
    // Mientras llega una respuesta, useChat es dueño de los mensajes: el siguiente intervalo los trae.
    if (!ocupado && servidor.mensajes.length > messages.length) {
      setMessages(servidor.mensajes)
      router.refresh()
    }
  }, [ocupado, messages.length, setMessages, router])

  useEffect(() => {
    if (ocupado) return
    const intervalo = setInterval(releer, 8000)
    return () => clearInterval(intervalo)
  }, [ocupado, releer])

  /** Después de un clic: la línea del desenlace y el Panel, que pudo cambiar. */
  const alCambiar = useCallback(() => {
    releer()
    router.refresh()
  }, [releer, router])

  useEffect(() => {
    final.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function enviar(contenido: string) {
    if (!contenido.trim() || ocupado) return
    sendMessage({ text: contenido })
    setTexto('')
  }

  const sugerencias = estado === 'listo' ? SUGERENCIAS_LISTO : SUGERENCIAS_ARMANDO

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="rounded-lg bg-card p-4 text-sm">
            Hola, soy tu agente. Trabajo para tu negocio todo el día. Si ya lo tienes publicado en una página o en Instagram,
            pégame el enlace y lo leo. Si no, cuéntame cómo se llama y qué vendes.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[85%] rounded-lg bg-primary px-4 py-2.5 text-primary-foreground' : 'max-w-full'}>
              {m.parts.map((parte, i) => {
                if (parte.type === 'text') return <p key={i} className="whitespace-pre-wrap leading-relaxed">{parte.text}</p>
                const t = tarjetaDeLaParte(parte)
                if (parte.type.startsWith('tool-')) {
                  const herramienta = parte.type.slice(5)
                  const p = parte as { state: string }
                  return (
                    <div key={i} className="my-2">
                      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                        <span className={p.state === 'output-available' ? 'text-bien' : p.state === 'output-error' ? 'text-destructive' : 'animate-pulse text-ojo'}>●</span>
                        {ETIQUETAS[herramienta] ?? herramienta}
                      </span>
                      {t && <Tarjeta tarjeta={t} estado={estados[t.propuesta]} alCambiar={alCambiar} />}
                    </div>
                  )
                }
                return t ? <Tarjeta key={i} tarjeta={t} estado={estados[t.propuesta]} alCambiar={alCambiar} /> : null
              })}
            </div>
          </div>
        ))}
        {status === 'submitted' && <p className="animate-pulse text-sm text-muted-foreground">Pensando…</p>}
        {error && <p className="text-sm text-destructive">Algo falló. Intenta de nuevo.</p>}
        <div ref={final} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {sugerencias.map((s) => (
          <Button key={s} variant="outline" size="xs" onClick={() => enviar(s)} disabled={ocupado} className="h-auto max-w-full shrink rounded-full bg-card px-3 py-1 text-left font-normal whitespace-normal text-muted-foreground">
            {s}
          </Button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
        className="mt-3 flex gap-2"
      >
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escríbele a tu agente…" className="h-11 flex-1 rounded-full bg-card px-4" />
        <Button type="submit" disabled={ocupado || !texto.trim()} className="h-11 rounded-full px-5">
          Enviar
        </Button>
      </form>
    </div>
  )
}
