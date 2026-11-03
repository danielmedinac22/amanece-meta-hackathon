'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { VistaDelHilo } from './hilo-vista'
import { tocarTarjeta } from './tocar-tarjeta'

type HiloLeido = { mensajes: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }

export function Hilo({ inicial, tarjetas, estado }: { inicial: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta>; estado: 'armando' | 'listo' | null }) {
  const router = useRouter()
  const [estados, setEstados] = useState(tarjetas)
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
    // Sin esperar el intervalo: una tarjeta recién llegada en el stream todavía no trae su estado ni su Caso.
    const primera = setTimeout(releer)
    const intervalo = setInterval(releer, 8000)
    return () => {
      clearTimeout(primera)
      clearInterval(intervalo)
    }
  }, [ocupado, releer])

  /** Después de un clic: la línea del desenlace y el Panel, que pudo cambiar. */
  const alCambiar = useCallback(() => {
    releer()
    router.refresh()
  }, [releer, router])

  return <VistaDelHilo messages={messages} estados={estados} estado={estado} status={status} error={error} alEnviar={(contenido) => sendMessage({ text: contenido })} alTocar={tocarTarjeta} alCambiar={alCambiar} />
}
