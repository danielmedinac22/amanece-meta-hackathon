'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { ControlDeLaToma, type AccionesDeToma } from '@/app/panel/toma'
import type { Atencion, ResultadoDeEscribir } from '@/nucleo/clientes/toma'

const TREINTA_MINUTOS = 30 * 60_000
const delAgente = (vez: number): Atencion => ({ tipo: 'agente', vez, ventana: true, espera: false })

/** Sin sesión ni base: las acciones cambian un estado local, y `alEscribir` es lo que contestaría la compuerta. */
export function TomaDeMuestra({ cliente, atencion, caso, alEscribir = { tipo: 'salio' } }: { cliente: string; atencion: Atencion; caso: ReactNode; alEscribir?: ResultadoDeEscribir }) {
  const [actual, setActual] = useState(atencion)
  const alCambiar = useCallback(() => {
    // Lo único que la vitrina no resuelve en su acción es el reloj que llega a cero.
    setActual((a) => (a.tipo !== 'agente' && a.quedaMs < 60_000 ? delAgente(a.vez) : a))
  }, [])
  const acciones: AccionesDeToma = {
    async tomar() {
      setActual((a) => ({ tipo: 'tuya', vez: a.vez + 1, ventana: true, quedaMs: TREINTA_MINUTOS, sinContestar: null, agenteTerminando: false }))
      return { tipo: 'tomada' }
    },
    async devolver() {
      setActual((a) => delAgente(a.vez))
      return { tipo: 'devuelta' }
    },
    async escribir() {
      if (alEscribir.tipo === 'ya_no_la_tienes') setActual((a) => delAgente(a.vez))
      return alEscribir
    },
  }
  return <ControlDeLaToma cliente={cliente} atencion={actual} caso={caso} acciones={acciones} alCambiar={alCambiar} />
}
