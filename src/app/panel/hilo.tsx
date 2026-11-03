'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { useRecogerLoEscrito, type LoEscrito } from '../lo-escrito'
import { VistaDelHilo } from './hilo-vista'
import { tocarTarjeta } from './tocar-tarjeta'

type HiloLeido = { mensajes: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }

/** La conexión del Hilo: `useChat`, el sondeo y lo que pasa después de un clic. `alTerminar` es lo que hace al acabar un turno; por defecto, volver a leer el Panel. */
export function useHilo({ inicial, tarjetas, alTerminar }: { inicial: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta>; alTerminar?: (mensaje: UIMessage) => void }) {
  const router = useRouter()
  const [estados, setEstados] = useState(tarjetas)
  // El layout vuelve a leer con cada `router.refresh`: una decisión tomada en Casos llega sin esperar el sondeo.
  const [leidas, setLeidas] = useState(tarjetas)
  if (leidas !== tarjetas) {
    setLeidas(tarjetas)
    setEstados(tarjetas)
  }
  const { messages, sendMessage, setMessages, status, error } = useChat({
    messages: inicial,
    transport: new DefaultChatTransport({ api: '/api/dueno/chat' }),
    onFinish: ({ message }) => (alTerminar ? alTerminar(message) : router.refresh()),
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

  const alEnviar = useCallback((contenido: string) => void sendMessage({ text: contenido }), [sendMessage])
  const alRecoger = useCallback(
    async ({ texto, plantilla }: LoEscrito) => {
      // Si la plantilla falla, el Dueño no pierde lo que escribió: el armado sigue sin ella.
      const r = plantilla ? await fetch('/api/dueno/plantilla', { method: 'POST', body: JSON.stringify({ plantilla }) }).catch(() => null) : null
      const linea = r?.ok ? ((await r.json()) as { mensaje: UIMessage | null }).mensaje : null
      // El sondeo pudo traerla mientras tanto.
      if (linea) setMessages((ms) => (ms.some((m) => m.id === linea.id) ? ms : [...ms, linea]))
      alEnviar(texto)
    },
    [alEnviar, setMessages],
  )
  // Se espera el saludo: el primer sondeo da de alta al Dueño, y lo escrito debe quedar en el Hilo después de saludar.
  useRecogerLoEscrito(messages.length > 0, alRecoger)

  return { messages, estados, status, error, ocupado, alEnviar, alCambiar }
}

export function Hilo({ inicial, tarjetas, estado }: { inicial: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta>; estado: 'armando' | 'listo' | null }) {
  const { messages, estados, status, error, alEnviar, alCambiar } = useHilo({ inicial, tarjetas })
  return <VistaDelHilo messages={messages} estados={estados} estado={estado} status={status} error={error} alEnviar={alEnviar} alTocar={tocarTarjeta} alCambiar={alCambiar} />
}
