'use client'

import { CheckCircle } from '@phosphor-icons/react'
import { motion, useInView } from 'motion/react'
import { useEffect, useReducer, useRef } from 'react'
import { cn } from '@/lib/utils'
import { TarjetaDeMuestra } from './tarjeta-de-muestra'
import type { MensajeDeMuestra, Pregunta, TextosDeDificil } from './textos'
import { CabeceraDeWhatsapp, Globo } from './whatsapp'

const ENTRA = [0.22, 1, 0.36, 1] as const
const ESCRIBIENDO_MS = 850

type Mensaje = { id: number; de: MensajeDeMuestra['de']; texto: string }
type Conversacion = { mensajes: Mensaje[]; escribiendo: number | null; respondida: number | null; ultima: number | null }
type Paso = { tipo: 'preguntar'; indice: number } | { tipo: 'responder' }

const VACIA: Conversacion = { mensajes: [], escribiendo: null, respondida: null, ultima: null }

function responder(c: Conversacion, preguntas: readonly Pregunta[]): Conversacion {
  if (c.escribiendo === null) return c
  return { ...c, mensajes: [...c.mensajes, { id: c.mensajes.length, de: 'agente', texto: preguntas[c.escribiendo].respuesta }], escribiendo: null, respondida: c.escribiendo }
}

/** Pura. Preguntar mientras escribe no deja una pregunta sin respuesta: primero contesta la que iba. */
const avanzar = (preguntas: readonly Pregunta[]) => (c: Conversacion, paso: Paso): Conversacion => {
  if (paso.tipo === 'responder') return responder(c, preguntas)
  const antes = responder(c, preguntas)
  return { mensajes: [...antes.mensajes, { id: antes.mensajes.length, de: 'cliente', texto: preguntas[paso.indice].pregunta }], escribiendo: paso.indice, respondida: null, ultima: paso.indice }
}

export function PreguntaDificil({ t, enLinea }: { t: TextosDeDificil; enLinea: string }) {
  const [c, dar] = useReducer(avanzar(t.preguntas), VACIA)
  const seccion = useRef<HTMLDivElement>(null)
  const chat = useRef<HTMLDivElement>(null)
  const espera = useRef(0)
  const enVista = useInView(seccion, { once: true, amount: 0.35 })

  const preguntar = (indice: number) => {
    clearTimeout(espera.current)
    dar({ tipo: 'preguntar', indice })
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) dar({ tipo: 'responder' })
    else espera.current = window.setTimeout(() => dar({ tipo: 'responder' }), ESCRIBIENDO_MS)
  }

  const yaPregunto = useRef(false)
  useEffect(() => {
    if (!enVista || yaPregunto.current) return
    yaPregunto.current = true
    preguntar(0)
  }, [enVista])
  useEffect(() => () => clearTimeout(espera.current), [])
  useEffect(() => {
    const el = chat.current
    if (el) el.scrollTop = el.scrollHeight
  }, [c.mensajes.length, c.escribiendo])

  const respondida = c.respondida === null ? null : t.preguntas[c.respondida]

  return (
    <div ref={seccion} className="mt-8 grid items-start gap-[26px] lg:grid-cols-[minmax(0,.9fr)_296px_minmax(0,1.05fr)]">
      <div className="flex flex-col gap-[7px]">
        <small className="text-[13px] font-medium text-muted-foreground">{t.preguntale}</small>
        {t.preguntas.map((p, i) => (
          <button
            key={p.pregunta}
            type="button"
            aria-pressed={c.ultima === i}
            onClick={() => {
              yaPregunto.current = true
              preguntar(i)
            }}
            className={cn('min-h-11 rounded-[13px] px-3.5 py-3 text-left leading-[1.3] font-medium transition-colors duration-150', c.ultima === i ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-sidebar-accent')}
          >
            {p.pregunta}
          </button>
        ))}
      </div>
      <div className="mx-auto h-[420px] w-full max-w-[296px] rounded-[36px] border border-border bg-sidebar p-[7px] shadow-alzada lg:h-[456px]">
        <div className="flex h-full flex-col overflow-hidden rounded-[29px] bg-muted text-foreground">
          <CabeceraDeWhatsapp negocio={t.negocio} enLinea={enLinea} />
          <div ref={chat} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
            {c.mensajes.map((m) => (
              <Globo key={m.id} de={m.de}>
                {m.texto}
              </Globo>
            ))}
            {c.escribiendo !== null && (
              <span aria-hidden className="puntos self-start rounded-[9px] bg-popover px-3 py-2.5">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex min-h-[260px] min-w-0 flex-col gap-2.5">
        <small className="text-[13px] font-medium text-muted-foreground">{t.loQueTeLlega}</small>
        {respondida && (
          <motion.div key={c.mensajes.length} className="flex flex-col gap-2.5" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: ENTRA }}>
            {respondida.caso ? (
              <TarjetaDeMuestra etiqueta={t.tarjeta.etiqueta} titulo={respondida.caso.titulo} principal={t.tarjeta.principal} secundaria={t.tarjeta.secundaria} nota={t.tarjeta.nota}>
                <b className="font-semibold">{respondida.caso.titulo}</b>
                <p className="rounded-[calc(var(--radius)-4px)] bg-muted px-2.5 py-2">{respondida.caso.respuesta}</p>
              </TarjetaDeMuestra>
            ) : (
              <div className="flex items-center gap-[9px] rounded-(--radius) bg-bien-suave px-3.5 py-[13px] font-semibold text-bien">
                <CheckCircle weight="fill" className="size-[18px] shrink-0" />
                {t.nada}
              </div>
            )}
            <p className="text-base leading-[1.4]">
              <b className="mb-1 block text-[13px] leading-[1.3] font-semibold text-muted-foreground">{t.porQue}</b>
              {respondida.porQue}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
