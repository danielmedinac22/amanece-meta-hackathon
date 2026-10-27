'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { VistaPrevia } from './vista-previa'

/** Lo que el Dueño ve mientras su Agente del dueño usa una herramienta. */
const ETIQUETAS: Record<string, string> = {
  guardar_conocimiento: 'Guardó lo que sabe de tu negocio',
  guardar_productos: 'Actualizó tu catálogo',
  abrir_negocio: 'Dejó listo a tu agente de clientes',
  ver_negocio: 'Revisó tu negocio',
  proponer_regla: 'Preparó una regla',
  proponer_conocimiento: 'Preparó un cambio en lo que sabe',
  proponer_seccion: 'Preparó una sección',
  proponer_indicador: 'Preparó un indicador',
  aplicar_cambio: 'Aplicó el cambio',
  revertir_cambio: 'Revirtió el cambio',
  listar_cambios: 'Revisó tus cambios',
  listar_casos: 'Revisó tus casos',
  resolver_caso: 'Le respondió al cliente',
  registrar_capacidad_faltante: 'Anotó algo que todavía no sabe hacer',
}

const SUGERENCIAS_ARMANDO = ['Vendo café de especialidad en Manizales', 'Tengo una panadería en Bogotá']
const SUGERENCIAS_LISTO = [
  'Si preguntan por envíos fuera de la ciudad, no prometas fecha y abre un caso',
  'Quiero ver los pedidos confirmados por día',
  'Muéstrame los pedidos con novedad',
]

export function Hilo({ inicial, estado }: { inicial: UIMessage[]; estado: 'armando' | 'listo' | null }) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const final = useRef<HTMLDivElement>(null)
  const { messages, sendMessage, setMessages, status, error } = useChat({
    messages: inicial,
    transport: new DefaultChatTransport({ api: '/api/dueno/chat' }),
    onFinish: () => router.refresh(),
  })
  const ocupado = status === 'submitted' || status === 'streaming'

  // Los Casos llegan solos al Hilo: se revisa cada tanto si el Agente del dueño escribió algo nuevo.
  useEffect(() => {
    if (ocupado) return
    const intervalo = setInterval(async () => {
      const respuesta = await fetch('/api/dueno/chat').catch(() => null)
      if (!respuesta?.ok) return
      const servidor = (await respuesta.json()) as UIMessage[] | { mensajes: UIMessage[] }
      const lista = Array.isArray(servidor) ? servidor : servidor.mensajes
      if (lista.length > messages.length) {
        setMessages(lista)
        router.refresh()
      }
    }, 8000)
    return () => clearInterval(intervalo)
  }, [ocupado, messages.length, setMessages, router])

  useEffect(() => final.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

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
          <div className="rounded-2xl bg-tarjeta p-4 text-sm">
            Hola, soy tu agente. Trabajo para tu negocio todo el día. Cuéntame qué vendes y cómo trabajas, y armo el agente
            que atiende a tus clientes por WhatsApp.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl bg-sol px-4 py-2.5 text-white' : 'max-w-full'}>
              {m.parts.map((parte, i) => {
                if (parte.type === 'text') return <p key={i} className="whitespace-pre-wrap leading-relaxed">{parte.text}</p>
                if (parte.type.startsWith('tool-')) {
                  const herramienta = parte.type.slice(5)
                  const p = parte as { state: string; output?: unknown; errorText?: string }
                  return (
                    <div key={i} className="my-2">
                      <span className="inline-flex items-center gap-2 rounded-full border border-borde bg-tarjeta px-3 py-1 text-xs text-suave">
                        <span className={p.state === 'output-available' ? 'text-verde' : p.state === 'output-error' ? 'text-red-700' : 'animate-pulse text-sol'}>●</span>
                        {ETIQUETAS[herramienta] ?? herramienta}
                      </span>
                      {p.state === 'output-available' && <VistaPrevia salida={p.output} />}
                    </div>
                  )
                }
                return null
              })}
            </div>
          </div>
        ))}
        {status === 'submitted' && <p className="animate-pulse text-sm text-suave">Pensando…</p>}
        {error && <p className="text-sm text-red-700">Algo falló. Intenta de nuevo.</p>}
        <div ref={final} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {sugerencias.map((s) => (
          <button key={s} onClick={() => enviar(s)} disabled={ocupado} className="rounded-full border border-borde bg-tarjeta px-3 py-1 text-xs text-suave hover:border-sol disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escríbele a tu agente…"
          className="flex-1 rounded-full border border-borde bg-tarjeta px-4 py-3"
        />
        <button disabled={ocupado || !texto.trim()} className="rounded-full bg-sol px-5 font-medium text-white disabled:opacity-50">
          Enviar
        </button>
      </form>
    </div>
  )
}
