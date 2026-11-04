'use client'

import { useContext } from 'react'
import { Button } from '@/components/ui/button'
import type { PorCompletar as Fila } from '@/nucleo/armado'
import { EscribirleAlAgente } from './disposicion'

/** Como `Cambiar` en Ajustes: empieza el mensaje en el redactor, y el agente trae la tarjeta para aplicarlo y después Publicar. */
export function PorCompletar({ filas }: { filas: readonly Fila[] }) {
  const escribir = useContext(EscribirleAlAgente)
  if (!filas.length) return null
  return (
    <section className="mt-2">
      <h2 className="font-heading text-lg font-semibold">Para que tu agente atienda mejor</h2>
      <p className="mt-0.5 mb-2 text-sm text-muted-foreground">Ya está atendiendo. Esto le falta saber.</p>
      <ul className="flex flex-col divide-y divide-border rounded-(--radius) border border-border">
        {filas.map((f) => (
          <li key={f.dato} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{f.dato}</p>
              <p className="text-[13px] text-pretty text-muted-foreground">{f.para}</p>
            </div>
            <Button variant="outline" size="sm" aria-label={`Decirle: ${f.dato}`} className="shrink-0" onClick={() => escribir(f.empieza)}>
              Decírselo
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
