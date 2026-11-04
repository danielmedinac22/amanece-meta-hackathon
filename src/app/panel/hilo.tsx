'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import { PARTE_DE_ARCHIVO, type Adjunto } from '@/nucleo/archivos'
import { useRecogerLoEscrito, type LoEscrito } from '../lo-escrito'
import { VistaDelHilo } from './hilo-vista'
import { loQueVuelve, type Devuelto, type Enviado } from './lo-que-vuelve'
import { subirArchivo } from './subir-archivo'
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
    // `tarjetas` cambia con cada `router.refresh`: la línea de Publicar llega con la tarjeta, sin esperar el intervalo.
  }, [ocupado, releer, tarjetas])

  /** Después de un clic: la línea del desenlace y el Panel, que pudo cambiar. */
  const alCambiar = useCallback(() => {
    releer()
    router.refresh()
  }, [releer, router])

  const enviado = useRef<Enviado | null>(null)
  const [devuelto, setDevuelto] = useState<Devuelto | null>(null)

  // La caja ya se vació al enviar. Lo que el servidor no guardó vuelve a ella y sale de la conversación.
  useEffect(() => {
    const quedo = enviado.current
    if (!error || !quedo) return
    enviado.current = null
    void (async () => {
      const servidor = await fetch('/api/dueno/chat')
        .then((r) => (r.ok ? (r.json() as Promise<HiloLeido>) : null))
        .catch(() => null)
      const vuelve = loQueVuelve(quedo, error, messages, servidor?.mensajes ?? null)
      if (!vuelve) return
      setDevuelto(vuelve)
      setMessages(servidor?.mensajes ?? ((ms) => (ms.at(-1)?.role === 'user' ? ms.slice(0, -1) : ms)))
    })()
  }, [error, messages, setMessages])

  const alEnviar = useCallback(
    (contenido: string, adjuntos: readonly Adjunto[] = []) => {
      enviado.current = { texto: contenido, adjuntos }
      setDevuelto(null)
      if (!adjuntos.length) return void sendMessage({ text: contenido })
      const archivos = adjuntos.map((data) => ({ type: PARTE_DE_ARCHIVO, data }) as const)
      void sendMessage({ parts: contenido.trim() ? [{ type: 'text', text: contenido }, ...archivos] : archivos })
    },
    [sendMessage],
  )
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

  return { messages, estados, status, error, devuelto, ocupado, alEnviar, alCambiar }
}

export function Hilo({ inicial, tarjetas }: { inicial: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }) {
  const { messages, estados, status, error, devuelto, alEnviar, alCambiar } = useHilo({ inicial, tarjetas })
  return <VistaDelHilo messages={messages} estados={estados} status={status} error={error} devuelto={devuelto} alEnviar={alEnviar} alSubir={subirArchivo} alTocar={tocarTarjeta} alCambiar={alCambiar} />
}
