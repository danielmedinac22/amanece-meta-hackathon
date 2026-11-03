'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useContext } from 'react'
import { Indicadores } from './pieza'
import { SinPublicar } from './sin-publicar'

/** Inicio y Pedidos muestran un Indicador solo mientras está en la vista previa: su lugar es el Tablero. */
export function LoNuevo() {
  const { claves, indicadores } = useContext(SinPublicar)
  const nuevos = indicadores.filter((p) => claves.has(p.clave))
  return (
    <AnimatePresence initial={false}>
      {nuevos.length > 0 && (
        <motion.div key="nuevos" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
          <Indicadores indicadores={nuevos} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
