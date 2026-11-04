'use client'

import { CheckCircle, MinusCircle } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AccionDeMuestra } from './textos'

type Resuelta = { resultado: string; negativa: boolean } | null

export function TarjetaDeMuestra({ etiqueta, titulo, principal, secundaria, nota, children }: { etiqueta: string; titulo: string; principal: AccionDeMuestra; secundaria: AccionDeMuestra; nota: string; children: ReactNode }) {
  const [resuelta, setResuelta] = useState<Resuelta>(null)
  const Icono = resuelta?.negativa ? MinusCircle : CheckCircle
  return (
    <div className="rounded-(--radius) border border-border bg-card p-3.5 text-left text-sm leading-[1.45] text-card-foreground shadow-alzada">
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-[260ms] ease-entra', resuelta ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]')} inert={!!resuelta}>
        <div className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
          <p className="text-xs font-semibold text-muted-foreground">{etiqueta}</p>
          {children}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => setResuelta({ resultado: principal.resultado, negativa: false })}>
              {principal.texto}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setResuelta({ resultado: secundaria.resultado, negativa: true })}>
              {secundaria.texto}
            </Button>
            <small className="ml-auto text-xs text-muted-foreground">{nota}</small>
          </div>
        </div>
      </div>
      {resuelta && (
        <div role="status" className="flex items-center gap-2">
          <Icono weight="fill" className={cn('size-4 shrink-0', resuelta.negativa ? 'text-muted-foreground' : 'text-bien')} />
          <span className="min-w-0 flex-1">
            <b className="block leading-[1.3] font-semibold">{titulo}</b>
            <small className="block text-[12.5px] text-muted-foreground">{resuelta.resultado}</small>
          </span>
        </div>
      )}
    </div>
  )
}
