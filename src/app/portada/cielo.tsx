'use client'

import { motion, useMotionValueEvent, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'

const NIVEL_DE_NOCHE = 0.06
const ALCANZA_LA_MAQUINA = 0.26
const NIVEL_CON_PLANTILLA = 0.62
const TINTA_OSCURA_DESDE_EL_NIVEL = 0.7

export type LoQueAclara = { largo: number; conPlantilla: boolean; maquina: number; saliendo: boolean }

export function nivelDelCielo({ largo, conPlantilla, maquina, saliendo }: LoQueAclara): number {
  if (saliendo) return 1
  const escrito = largo ? Math.min(1, 0.3 + largo / 72) : 0
  if (conPlantilla) return Math.max(NIVEL_CON_PLANTILLA, escrito)
  return largo ? escrito : NIVEL_DE_NOCHE + ALCANZA_LA_MAQUINA * maquina
}

export function useAmanecer(nivel: number, sinAnimar: boolean): MotionValue<number> {
  const progreso = useSpring(NIVEL_DE_NOCHE, { stiffness: 90, damping: 24 })
  useEffect(() => {
    if (sinAnimar) progreso.jump(nivel)
    else progreso.set(nivel)
  }, [progreso, nivel, sinAnimar])
  return progreso
}

export type Rafaga = { x: number; y: number }

export function Cielo({ progreso, rafaga, children }: { progreso: MotionValue<number>; rafaga: Rafaga | null; children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null)
  const noche = useTransform(progreso, [0, 0.42], [1, 0])
  const madrugada = useTransform(progreso, [0.42, 1], [1, 0])
  const estrellas = useTransform(progreso, [0, 0.4], [1, 0])
  const sol = useTransform(progreso, [0.1, 0.35], [0, 1])
  const solSube = useTransform(progreso, [0, 0.85], ['42%', '0%'])
  useMotionValueEvent(progreso, 'change', (p) => {
    raiz.current?.toggleAttribute('data-aclaro', p > TINTA_OSCURA_DESDE_EL_NIVEL)
  })
  return (
    <div ref={raiz} data-cielo className="cielo-que-amanece relative isolate min-h-[min(88svh,820px)] pb-[120px]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 contain-paint">
        <div className="absolute inset-0 bg-(image:--alba)" />
        <motion.div data-capa-de-noche className="absolute inset-0 bg-(image:--madrugada)" style={{ opacity: madrugada }} />
        <motion.div data-capa-de-noche className="absolute inset-0 bg-(image:--noche)" style={{ opacity: noche }} />
        <motion.div data-capa-de-noche className="estrellas absolute inset-0" style={{ opacity: estrellas }} />
        <motion.div data-capa-de-noche className="sol-de-portada absolute bottom-[-52%] left-1/2 aspect-square w-[min(130vw,900px)] rounded-full" style={{ x: '-50%', y: solSube, opacity: sol }} />
        {rafaga && (
          <motion.div
            className="rafaga-de-sol absolute size-[2000px] rounded-full"
            style={{ left: rafaga.x, top: rafaga.y, x: '-50%', y: '-50%' }}
            initial={{ scale: 0.02, opacity: 1 }}
            animate={{ scale: 1, opacity: [1, 1, 0] }}
            transition={{ duration: 1.1, ease: [0.3, 0.7, 0.3, 1] }}
          />
        )}
      </div>
      {children}
    </div>
  )
}
