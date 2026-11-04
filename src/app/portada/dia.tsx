'use client'

import { AnimatePresence, motion, useMotionTemplate, useMotionValueEvent, useScroll, useTransform } from 'motion/react'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CIELO_ABAJO, CIELO_ARRIBA, PARADAS_DEL_CIELO } from './cielo-del-dia'

const ENTRA = [0.22, 1, 0.36, 1] as const
const TINTA_OSCURA_DESDE_EL_SCROLL = 0.38
const SOL_TENUE = 0.26
const SOL_TENUE_HASTA_EL_SCROLL = 0.405
const CAMBIA_EL_RELOJ = 0.56

type Hora = { hora: string; meridiano: string }

export function Dia({ titulo, nota, primera, children }: { titulo: string; nota: string; primera: Hora; children: ReactNode }) {
  const raiz = useRef<HTMLElement>(null)
  const contenido = useRef<HTMLDivElement>(null)
  const [reloj, setReloj] = useState(primera)
  const { scrollYProgress: p } = useScroll({ target: raiz, offset: ['start start', 'end end'] })

  const arriba = useTransform(p, PARADAS_DEL_CIELO, CIELO_ARRIBA)
  const abajo = useTransform(p, PARADAS_DEL_CIELO, CIELO_ABAJO)
  const fondo = useMotionTemplate`linear-gradient(180deg, ${arriba}, ${abajo})`
  const estrellas = useTransform(p, [0, 0.34], [1, 0])
  const solSube = useTransform(p, [0.24, 0.54], ['92svh', '-3svh'])
  const sol = useTransform(p, [0.33, 0.4, SOL_TENUE_HASTA_EL_SCROLL, 0.43, 0.62, 0.82], [0, SOL_TENUE, SOL_TENUE, 1, 1, 0])

  useMotionValueEvent(p, 'change', (v) => {
    contenido.current?.toggleAttribute('data-aclaro', v > TINTA_OSCURA_DESDE_EL_SCROLL)
    const linea = innerHeight * CAMBIA_EL_RELOJ
    let actual: HTMLElement | null = null
    for (const m of raiz.current?.querySelectorAll<HTMLElement>('[data-hora]') ?? []) if (m.getBoundingClientRect().top < linea) actual = m
    const hora = actual?.dataset.hora ?? primera.hora
    const meridiano = actual?.dataset.meridiano ?? primera.meridiano
    setReloj((r) => (r.hora === hora && r.meridiano === meridiano ? r : { hora, meridiano }))
  })

  return (
    <motion.section ref={raiz} style={{ '--cielo-arriba': arriba } as CSSProperties} className="relative grid grid-cols-[minmax(0,1fr)] *:[grid-area:1/1]">
      <motion.div aria-hidden className="sticky top-0 h-svh self-start overflow-hidden" style={{ background: fondo }}>
        <motion.div className="estrellas absolute inset-0" style={{ opacity: estrellas }} />
        <motion.div className="sol-de-portada absolute top-0 left-1/2 aspect-square w-[min(120vw,760px)] rounded-full" style={{ x: '-50%', y: solSube, opacity: sol }} />
      </motion.div>
      <div ref={contenido} className="tinta-del-dia relative z-[1] min-w-0">
        <div className="mx-auto w-full max-w-[1120px] px-5 pt-[clamp(52px,9vw,100px)]">
          <h2 className="max-w-[18ch] font-heading text-[clamp(28px,4.6vw,46px)] leading-[1.08] font-semibold tracking-tight text-balance">{titulo}</h2>
          <p className="mt-2 text-xs opacity-75">{nota}</p>
        </div>
        <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[minmax(0,1fr)] px-5 md:grid-cols-[minmax(0,.86fr)_minmax(0,1fr)] md:gap-[30px]">
          <div
            aria-hidden
            className="sticky top-[max(8px,env(safe-area-inset-top))] z-[3] -ml-3 w-max self-start rounded-[14px] bg-[color-mix(in_srgb,var(--cielo-arriba)_88%,transparent)] px-3 py-1.5 font-heading text-[40px] leading-[.95] font-semibold tracking-[-.04em] whitespace-nowrap tabular-nums backdrop-blur-[10px] md:top-[20svh] md:ml-0 md:rounded-none md:bg-transparent md:p-0 md:text-[clamp(58px,10.5vw,128px)] md:backdrop-blur-none"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={reloj.hora} className="inline-block" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: ENTRA }}>
                {reloj.hora}
              </motion.span>
            </AnimatePresence>
            <small className="ml-[.15em] text-[.32em] font-medium tracking-[-.01em]">{reloj.meridiano}</small>
          </div>
          <div className="flex min-w-0 flex-col gap-[clamp(90px,24svh,220px)] pt-[6svh] pb-[22svh] md:pt-[12svh] md:pb-[26svh]">{children}</div>
        </div>
      </div>
    </motion.section>
  )
}
