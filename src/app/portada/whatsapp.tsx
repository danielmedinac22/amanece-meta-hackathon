import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { MensajeDeMuestra } from './textos'

export function CabeceraDeWhatsapp({ negocio, enLinea }: { negocio: string; enLinea: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-primary px-3 py-2.5 text-primary-foreground">
      <span aria-hidden className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-current/15 font-heading text-[13px] font-semibold">
        {negocio[0]}
      </span>
      <div className="min-w-0 leading-tight">
        <strong className="block truncate text-[13.5px] font-semibold">{negocio}</strong>
        <small className="text-[11px] opacity-80">{enLinea}</small>
      </div>
    </div>
  )
}

export function Globo({ de, children, hora }: { de: MensajeDeMuestra['de']; children: ReactNode; hora?: string }) {
  return (
    <div className={cn('max-w-[84%] rounded-[9px] px-2.5 py-1.5 text-[13.5px] leading-[1.36] text-pretty shadow-xs', de === 'cliente' ? 'self-end bg-globo-cliente text-globo-cliente-foreground' : 'self-start bg-popover text-popover-foreground')}>
      {children}
      {hora && <small className="mt-px block text-right text-[11px] opacity-70">{hora}</small>}
    </div>
  )
}

export function WhatsappDeMuestra({ negocio, enLinea, mensajes, className }: { negocio: string; enLinea: string; mensajes: readonly MensajeDeMuestra[]; className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden bg-muted text-foreground', className)}>
      <CabeceraDeWhatsapp negocio={negocio} enLinea={enLinea} />
      <div className="flex flex-col gap-1.5 p-3">
        {mensajes.map((m) => (
          <Globo key={m.texto} de={m.de} hora={m.hora}>
            {m.texto}
          </Globo>
        ))}
      </div>
    </div>
  )
}
