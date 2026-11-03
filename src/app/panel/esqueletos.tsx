import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/*
 * Cada esqueleto repite las clases de caja de su vista, para que al llegar los datos nada salte.
 * `probar-vitrina` mide cada par: si una vista cambia de medidas, esa prueba falla.
 */

const veces = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Ocupa una línea del texto que la envuelve, no importa su tamaño. */
function Linea({ className }: { className: string }) {
  return (
    <span className="flex h-[1lh] items-center">
      <Skeleton className={cn('h-[0.72em] rounded-sm motion-reduce:animate-none', className)} />
    </span>
  )
}

function Forma({ className }: { className: string }) {
  return <Skeleton className={cn('shrink-0 motion-reduce:animate-none', className)} />
}

function Cargando({ que, className, children }: { que: string; className: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={`Cargando ${que}`} className={className}>
      {children}
    </div>
  )
}

export function EsqueletoDeInicio() {
  return (
    <Cargando que="tu negocio" className="mx-auto flex max-w-[38rem] flex-col gap-7 pt-2">
      <div className="font-heading text-[clamp(20px,5cqw,28px)] leading-[1.28]">
        <Linea className="w-full" />
        <Linea className="w-full" />
        <Linea className="w-full" />
        <span className="@xl:hidden">
          <Linea className="w-2/3" />
        </span>
      </div>
      <section>
        <h3 className="mb-2 text-sm">
          <Linea className="w-28" />
        </h3>
        <ul className="flex flex-col gap-2">
          {veces(2).map((i) => (
            <li key={i} className="flex items-center gap-x-3 rounded-(--radius) border border-border p-3">
              <Forma className="size-4 rounded-full" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <Linea className="w-3/4" />
                  <span className="@xl:hidden">
                    <Linea className="w-1/2" />
                  </span>
                </p>
                <p className="text-xs">
                  <Linea className="w-1/2" />
                </p>
              </div>
              <Forma className="h-7 w-20 rounded-[min(var(--radius-md),12px)]" />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 text-sm">
          <Linea className="w-20" />
        </h3>
        <ul>
          {veces(3).map((i) => (
            <li key={i} className="flex items-center gap-3 border-b border-border/60 py-2.5 text-sm last:border-0">
              <Forma className="size-3.5 rounded-full" />
              <span className="min-w-0 flex-1">
                <Linea className="w-2/3" />
              </span>
              <span className="w-12 text-xs">
                <Linea className="w-full" />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Cargando>
  )
}

export function EsqueletoDeCasos() {
  return (
    <Cargando que="tus Casos" className="mx-auto flex max-w-156 flex-col gap-6">
      <section>
        <p className="mb-2 text-sm">
          <Linea className="w-32" />
        </p>
        <div className="flex flex-col gap-3">
          {veces(2).map((i) => (
            <div key={i} className="overflow-hidden rounded-(--radius) border border-border bg-card">
              <div className="px-4 pt-3.5 text-xs">
                <Linea className="w-40" />
              </div>
              <div className="flex flex-col gap-3 px-4 py-3">
                <Forma className="h-16 w-full rounded-[calc(var(--radius)-4px)]" />
              </div>
              <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                <Forma className="h-8 w-20 rounded-[min(var(--radius-md),12px)]" />
                <Forma className="h-8 w-20 rounded-[min(var(--radius-md),12px)]" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </Cargando>
  )
}

export function EsqueletoDeConversaciones() {
  return (
    <Cargando que="tus conversaciones" className="-m-4 flex h-[calc(100%+2rem)] min-h-[420px] lg:-m-6 lg:h-[calc(100%+3rem)]">
      <div className="w-full shrink-0 overflow-hidden border-border p-2 @xl:w-[42%] @xl:max-w-72 @xl:border-r">
        <ul>
          {veces(7).map((i) => (
            <li key={i} className="flex items-start gap-2.5 p-2">
              <Forma className="size-7 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">
                  <Linea className="w-2/3" />
                </span>
                <span className="block text-xs">
                  <Linea className="w-full" />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden min-w-0 flex-1 flex-col @xl:flex">
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-4">
          <Forma className="h-9 w-1/2 rounded-xl" />
          <Forma className="ml-auto h-14 w-3/5 rounded-xl" />
          <Forma className="h-9 w-2/5 rounded-xl" />
          <Forma className="ml-auto h-9 w-1/2 rounded-xl" />
        </div>
        <div className="flex items-center gap-2 border-t border-border p-3 text-xs text-muted-foreground">Tu agente está atendiendo</div>
      </div>
    </Cargando>
  )
}

function GruposCargando() {
  return [3, 5].map((filas, g) => (
    <section key={g}>
      <h3 className="flex items-center gap-2 bg-muted/70 px-4 py-1.5 text-xs">
        <Forma className="h-5 w-20 rounded-4xl" />
      </h3>
      <ul>
        {veces(filas).map((i) => (
          <li key={i} className="flex items-center gap-3 border-b border-border/60 px-4 py-2 text-[13px]">
            <span className="min-w-0 flex-1">
              <Linea className="w-3/5" />
            </span>
            <span className="min-w-20">
              <Linea className="ml-auto w-16" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  ))
}

export function EsqueletoDePedidos() {
  return (
    <Cargando que="tus pedidos" className="-mx-4 -mt-4 lg:-mx-6 lg:-mt-6">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-border px-4 py-3 text-[13px]">
        <Linea className="w-36" />
        <Linea className="w-36" />
        <Linea className="w-28" />
      </div>
      <GruposCargando />
    </Cargando>
  )
}

export function EsqueletoDeClientes() {
  return (
    <Cargando que="tus Clientes" className="mx-auto max-w-4xl">
      <TablaCargando />
    </Cargando>
  )
}

function TablaCargando() {
  return (
    <>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead className="hidden @xl:table-cell">Ciudad</TableHead>
            <TableHead className="text-right">Pedidos</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden text-right @2xl:table-cell">Último</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {veces(8).map((i) => (
            <TableRow key={i}>
              <TableCell className="w-full max-w-0 @2xl:w-[35%]">
                <Linea className="w-3/5" />
              </TableCell>
              <TableCell className="hidden @xl:table-cell">
                <Linea className="w-20" />
              </TableCell>
              <TableCell>
                <Linea className="ml-auto w-6" />
              </TableCell>
              <TableCell>
                <Linea className="ml-auto w-16" />
              </TableCell>
              <TableCell className="hidden @2xl:table-cell">
                <Linea className="ml-auto w-14" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

function BloqueDeGrafica({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-(--radius) border border-border bg-card p-4">
      <p className="text-sm">
        <Linea className="w-32" />
      </p>
      <p className="mb-3 text-xs">
        <Linea className="w-3/5" />
      </p>
      {children}
    </div>
  )
}

export function EsqueletoDelTablero() {
  return (
    <Cargando que="tu Tablero" className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        {veces(4).map((i) => (
          <div key={i} className="flex min-w-0 flex-col rounded-(--radius) border border-border bg-card p-3 @sm:p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 text-[13px] leading-tight">
                <Linea className="w-20" />
              </p>
              <Forma className="hidden size-7 rounded-lg @sm:block" />
            </div>
            <p className="mt-2 font-heading text-lg @sm:text-xl @lg:text-2xl">
              <Linea className="w-3/5" />
            </p>
            <p className="mt-0.5 text-xs">
              <Linea className="w-4/5" />
              <span className="hidden @3xl:block">
                <Linea className="w-1/2" />
              </span>
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 @3xl:grid-cols-[1.5fr_1fr]">
        <BloqueDeGrafica>
          <Forma className="h-[225px] w-full rounded-[calc(var(--radius)-4px)] @3xl:h-[240px]" />
        </BloqueDeGrafica>
        <BloqueDeGrafica>
          <div className="flex h-[240px] flex-col justify-between">
            {veces(4).map((i) => (
              <Forma key={i} className="h-10 w-full rounded-sm" />
            ))}
          </div>
        </BloqueDeGrafica>
      </div>
      <div className="min-w-0 rounded-(--radius) border border-border bg-card px-3 pt-3 pb-1">
        <p className="mb-1 px-1 text-sm">
          <Linea className="w-32" />
        </p>
        <ul>
          {veces(4).map((i) => (
            <li key={i} className="flex h-[53px] items-center gap-3 border-b border-border/60 px-2 text-[13px] last:border-0">
              <span className="min-w-0 flex-1">
                <Linea className="w-1/2" />
              </span>
              <Forma className="h-5 w-20 rounded-4xl" />
            </li>
          ))}
        </ul>
      </div>
    </Cargando>
  )
}

export function EsqueletoDeUnaSeccion() {
  return (
    <Cargando que="esta Sección" className="mx-auto max-w-4xl">
      <p className="mb-3 text-sm">
        <Linea className="w-3/5" />
      </p>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            {veces(3).map((i) => (
              <TableHead key={i}>
                <Linea className="w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {veces(6).map((f) => (
            <TableRow key={f}>
              {veces(3).map((c) => (
                <TableCell key={c}>
                  <Linea className="w-3/5" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Cargando>
  )
}

function FilaDeAjuste({ children = <Linea className="w-2/5" /> }: { children?: ReactNode }) {
  return (
    <li className="border-b border-border py-3.5 last:border-0">
      <p className="text-xs">
        <Linea className="w-16" />
      </p>
      <div className="mt-0.5 text-sm">{children}</div>
    </li>
  )
}

export function EsqueletoDeAjustes() {
  return (
    <Cargando que="los ajustes de tu negocio" className="mx-auto flex max-w-xl flex-col">
      <p className="mb-4 text-sm">
        <Linea className="w-full" />
        <span className="@lg:hidden">
          <Linea className="w-1/3" />
        </span>
      </p>
      <ul>
        <FilaDeAjuste>
          <Linea className="w-2/5" />
          <p className="mt-0.5 text-xs">
            <Linea className="w-3/5" />
          </p>
        </FilaDeAjuste>
        <FilaDeAjuste />
        <FilaDeAjuste>
          <Forma className="mt-1.5 h-[46px] w-full rounded-(--radius)" />
        </FilaDeAjuste>
        <FilaDeAjuste />
      </ul>
    </Cargando>
  )
}

function DetalleCargando({ que, lista, children }: { que: string; lista: ReactNode; children: ReactNode }) {
  return (
    <Cargando que={que} className="-m-4 flex h-[calc(100%+2rem)] min-h-[420px] lg:-m-6 lg:h-[calc(100%+3rem)]">
      <div className="@container hidden w-[42%] max-w-72 shrink-0 overflow-hidden border-r border-border @xl:block">{lista}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border p-1.5">
          <Forma className="size-8 rounded-md" />
          <span className="w-24 text-sm">
            <Linea className="w-full" />
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-4">{children}</div>
      </div>
    </Cargando>
  )
}

function BloqueCargando({ titulo, filas }: { titulo: string; filas: number }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{titulo}</h3>
      <ul className="text-[13px]">
        {veces(filas).map((i) => (
          <li key={i} className="border-b border-border/60 py-1.5">
            <Linea className="w-3/5" />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function EsqueletoDeUnPedido() {
  return (
    <DetalleCargando que="este pedido" lista={<GruposCargando />}>
      <BloqueCargando titulo="Lo que pidió" filas={2} />
      <BloqueCargando titulo="Entrega" filas={1} />
      <BloqueCargando titulo="Cliente" filas={1} />
    </DetalleCargando>
  )
}

export function EsqueletoDeUnCliente() {
  return (
    <DetalleCargando que="este Cliente" lista={<TablaCargando />}>
      <div className="text-[13px]">
        <Linea className="w-40" />
      </div>
      <BloqueCargando titulo="Sus pedidos" filas={3} />
    </DetalleCargando>
  )
}
