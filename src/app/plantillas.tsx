'use client'

import { ArrowsClockwise, Eye, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { IdDePlantilla } from '@/nucleo/plantillas'
import { AEscala } from './panel/armado'
import type { Plantilla, Tono } from './plantillas-datos'

const TONO: Record<Tono, string> = {
  bien: 'bg-(--bien-suave) text-(--bien)',
  ojo: 'bg-(--ojo-suave) text-(--ojo)',
  nada: 'bg-muted text-muted-foreground',
}

const GLOBO = { cliente: 'bg-globo-cliente text-globo-cliente-foreground', agente: 'bg-popover text-popover-foreground' } as const

function PanelDePlantilla({ p }: { p: Plantilla }) {
  const max = Math.max(...p.barras, 1)
  return (
    <div className="flex h-full w-full bg-card text-[15px] text-card-foreground" aria-hidden>
      <div className="flex w-[170px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-[13px] font-semibold text-primary-foreground">{p.negocio[0]}</span>
          <span className="truncate text-[13px] font-medium">{p.negocio}</span>
        </div>
        {p.secciones.map((s, i) => (
          <div key={s} className={cn('truncate rounded-md px-2.5 py-1.5 text-[13px]', i === 0 ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground')}>
            {s}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-3 gap-2.5">
          {p.indicadores.map((d) => (
            <div key={d.dato} className="rounded-xl border border-border p-2.5">
              <div className="truncate text-[11px] text-muted-foreground">{d.dato}</div>
              <div className="mt-0.5 font-heading text-[26px] leading-tight font-semibold tabular-nums tracking-tight">{d.valor}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 text-[11px] text-muted-foreground">{p.tituloBarras}</div>
          <div className="flex h-[52px] items-end gap-1.5">
            {p.barras.map((n, i) => (
              <div key={i} className="flex-1 rounded-t-[3px] bg-primary" style={{ height: `${Math.max(5, (n / max) * 100)}%` }} />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
          {p.filas.map((f, i) => (
            <div key={f.nombre} className={cn('flex items-center gap-2 px-3 py-2', i > 0 && 'border-t border-border')}>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-medium">{f.nombre}</span> <span className="text-muted-foreground">· {f.detalle}</span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', TONO[f.tono])}>{f.estado}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function VerPlantilla({ p, abierta, alCerrar, alRemixear }: { p: Plantilla; abierta: boolean; alCerrar: () => void; alRemixear: () => void }) {
  return (
    <Dialog open={abierta} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-4xl" showCloseButton={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-heading text-lg font-semibold tracking-tight">{p.nombre}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{p.promesa}</DialogDescription>
          </div>
          <Button
            onClick={() => {
              alRemixear()
              alCerrar()
            }}
          >
            <ArrowsClockwise className="size-4" /> Remixear
          </Button>
          <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={alCerrar}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid gap-4 bg-muted/40 p-4 md:grid-cols-[1fr_270px]">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Lo que tú ves</p>
            <div className="overflow-hidden rounded-(--radius) border border-border">
              <AEscala ancho={640} alto={440}>
                <PanelDePlantilla p={p} />
              </AEscala>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Lo que ve tu Cliente en WhatsApp</p>
            <div className="flex flex-col gap-1.5">
              {p.chat.map((c, i) => (
                <p key={i} className={cn('max-w-[86%] rounded-2xl px-3 py-2 text-[13px] leading-snug text-pretty', c.de === 'cliente' ? 'self-end bg-globo-cliente text-globo-cliente-foreground' : 'self-start border border-border bg-card')}>
                  {c.texto}
                </p>
              ))}
            </div>
          </div>
        </div>
        <p className="p-4 text-sm text-pretty text-muted-foreground">{p.negocio} es un negocio de ejemplo. Al remixear, tu agente arma el tuyo con tus datos, y nada de este ejemplo entra a tu negocio.</p>
      </DialogContent>
    </Dialog>
  )
}

export function TarjetaPlantilla({ p, elegida, alRemixear }: { p: Plantilla; elegida: boolean; alRemixear: (id: IdDePlantilla | null) => void }) {
  const [viendo, setViendo] = useState(false)
  return (
    <article className={cn('flex w-full min-w-0 flex-col overflow-hidden rounded-(--radius) border bg-card transition-[border-color,box-shadow] duration-200', elegida ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-border hover:shadow-alzada')}>
      <button type="button" onClick={() => setViendo(true)} className="relative block w-full cursor-zoom-in overflow-hidden border-b border-border text-left" aria-label={`Ver cómo queda ${p.nombre}`}>
        <AEscala ancho={640} alto={400}>
          <PanelDePlantilla p={p} />
        </AEscala>
        <div className="pointer-events-none absolute right-2.5 bottom-2.5 flex w-[72%] flex-col gap-1">
          {p.globos.map((g, i) => (
            <p key={i} className={cn('w-fit rounded-xl px-2.5 py-1.5 text-[11px] leading-snug shadow-md', g.de === 'cliente' && 'ml-auto', GLOBO[g.de])}>
              {g.texto}
            </p>
          ))}
        </div>
      </button>
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex-1">
          <h3 className="font-heading text-[15.5px] font-semibold tracking-tight">{p.nombre}</h3>
          <p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">{p.promesa}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={elegida ? 'default' : 'secondary'} className="flex-1" onClick={() => alRemixear(elegida ? null : p.id)}>
            <ArrowsClockwise className="size-3.5" /> {elegida ? 'Elegida' : 'Remixear'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setViendo(true)}>
            <Eye className="size-3.5" /> Ver
          </Button>
        </div>
      </div>
      <VerPlantilla p={p} abierta={viendo} alCerrar={() => setViendo(false)} alRemixear={() => alRemixear(p.id)} />
    </article>
  )
}
