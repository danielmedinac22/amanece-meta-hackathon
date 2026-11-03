import type { ComponentType, ReactNode } from 'react'
import { ArrowLeft, User, Warning } from '@phosphor-icons/react/ssr'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Atencion } from '@/nucleo/clientes/toma'
import type { DatosDeConversaciones, DetalleDeConversacion, FilaDeConversacion } from '@/nucleo/listas'
import { cifra, rutaDeConversacion } from '@/nucleo/listas-palabras'
import { IrASeccion } from './ir-a-seccion'

const RUTA = '/panel/conversaciones'

/** Un Cliente sin nombre sale con su teléfono: ahí no hay iniciales que poner. */
const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

function FilaConversacion({ c, elegida }: { c: FilaDeConversacion; elegida: boolean }) {
  return (
    <li>
      {/* Sin prefetch: cien filas serían cien lecturas de la base antes de que el Dueño toque una. */}
      <IrASeccion href={rutaDeConversacion(c.cliente)} prefetch={false} scroll={false} aria-current={elegida ? 'true' : undefined} className={cn('flex w-full items-start gap-2.5 rounded-[calc(var(--radius)-4px)] p-2 text-left transition-colors duration-150 hover:bg-muted', elegida && '@xl:bg-muted')}>
        <Avatar className="size-7">
          <AvatarFallback className="text-[10px]">{iniciales(c.nombre) || <User className="size-3.5" />}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-medium">{c.nombre}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{c.hace.replace('hace ', '')}</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">{c.ultima}</span>
        </span>
      </IrASeccion>
    </li>
  )
}

const ESTILO_DEL_MENSAJE = { cliente: 'bg-muted', agente: 'bg-primary text-primary-foreground', dueno: 'bg-secondary text-secondary-foreground' } as const

/** Lo que se dijeron, del más viejo al más nuevo. */
export function Mensajes({ d }: { d: DetalleDeConversacion }) {
  return (
    <div className="mb-auto space-y-2">
      {d.cuenta > d.mensajes.length && (
        <p className="pb-2 text-center text-xs text-muted-foreground">
          Ves los últimos {cifra(d.mensajes.length)} de {cifra(d.cuenta)}.
        </p>
      )}
      {d.mensajes.map((m) => (
        <div key={m.id} className={cn('flex', m.de !== 'cliente' && 'justify-end')}>
          <div className={cn('max-w-[80%] rounded-xl px-3 py-2 text-[13px] wrap-anywhere whitespace-pre-wrap', ESTILO_DEL_MENSAJE[m.de])}>
            {m.de === 'dueno' && <p className="text-[11px] font-medium text-muted-foreground">Dueño</p>}
            <p>{m.texto}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function CasoQueEspera({ titulo, className }: { titulo: string; className?: string }) {
  return (
    <IrASeccion href="/panel/casos" title={titulo} className={buttonVariants({ variant: 'outline', size: 'sm', className })}>
      <Warning weight="fill" className="size-3.5 text-ojo" /> Un Caso espera tu decisión
    </IrASeccion>
  )
}

/** El control viene de afuera: en la ruta le habla a la base, y en la vitrina se simula sin sesión. */
export type ControlDeToma = ComponentType<{ cliente: string; atencion: Atencion; caso: ReactNode }>

function Detalle({ d, atencion, Toma }: { d: DetalleDeConversacion; atencion: Atencion; Toma: ControlDeToma }) {
  return (
    <>
      <div className="flex items-center gap-1 border-b border-border p-1.5 @xl:hidden">
        <IrASeccion href={RUTA} scroll={false} aria-label="Volver a las conversaciones" className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-8 shrink-0' })}>
          <ArrowLeft className="size-4" />
        </IrASeccion>
        <span className="min-w-0 truncate text-sm font-medium">{d.nombre}</span>
      </div>
      {/* `flex-col-reverse` abre abajo, en lo último que se dijo, sin mover el scroll a mano; `mb-auto` deja arriba una conversación corta. */}
      <div key={d.cliente} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto p-4">
        <Mensajes d={d} />
      </div>
      <Toma key={d.cliente} cliente={d.cliente} atencion={atencion} caso={d.casoQueEspera && <CasoQueEspera titulo={d.casoQueEspera} />} />
    </>
  )
}

/** Sale del relleno del lienzo: las dos columnas van de borde a borde y cada una se desplaza sola. */
export function VistaDeConversaciones({ cuenta, filas, detalle, enDetalle, atencion, Toma }: DatosDeConversaciones & { atencion: Atencion | null; Toma: ControlDeToma }) {
  if (!detalle || !atencion) return <p className="text-sm text-muted-foreground">Todavía no te ha escrito nadie. Cuando un Cliente te escriba, aparece aquí.</p>
  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] min-h-[420px] lg:-m-6 lg:h-[calc(100%+3rem)]">
      <div className={cn('w-full shrink-0 overflow-y-auto border-border p-2 @xl:block @xl:w-[42%] @xl:max-w-72 @xl:border-r', enDetalle && 'hidden')}>
        <ul>
          {filas.map((c) => (
            <FilaConversacion key={c.cliente} c={c} elegida={c.cliente === detalle.cliente} />
          ))}
        </ul>
        {cuenta > filas.length && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Ves las {cifra(filas.length)} más recientes de {cifra(cuenta)}.
          </p>
        )}
      </div>
      <div className={cn('min-w-0 flex-1 flex-col @xl:flex', enDetalle ? 'flex' : 'hidden')}>
        <Detalle d={detalle} atencion={atencion} Toma={Toma} />
      </div>
    </div>
  )
}
