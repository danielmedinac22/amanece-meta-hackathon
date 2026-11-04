import { cn } from '@/lib/utils'
import { CUANTOS_ROTULOS, type Grafica } from '@/nucleo/graficas'

const ESPERA_POR_BARRA_MS = 40
const ESPERA_MAXIMA_MS = 240

/** Con pocas barras el rótulo va centrado; con muchas, las de los bordes lo anclan para no salirse. */
function ancla(i: number, n: number) {
  if (n <= CUANTOS_ROTULOS && i > 0 && i < n - 1) return 'left-1/2 -translate-x-1/2'
  if (i < n / 3) return 'left-0'
  return i >= (2 * n) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
}

/** Barras verticales sobre un solo eje. Cada cifra se ve al tocar su barra; sin tocarla, un lector de pantalla lee la lista. */
export function Barras({ grafica: { barras, marcas }, titulo, alto = 120 }: { grafica: Grafica; titulo: string; alto?: number }) {
  return (
    <div className="flex gap-1.5 pt-5">
      <div aria-hidden className="relative w-11 shrink-0" style={{ height: alto }}>
        {marcas.map((m) => (
          <span key={m.altura} className="absolute right-0 translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ bottom: `${m.altura}%` }}>
            {m.texto}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: alto }}>
          {marcas.map((m) => (
            <span key={m.altura} aria-hidden className="absolute inset-x-0 border-t border-border" style={{ bottom: `${m.altura}%` }} />
          ))}
          <ol aria-label={titulo} className="absolute inset-0 flex items-end gap-0.5">
            {barras.map((b, i) => (
              <li key={i} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="sr-only">
                  {b.cuando}: {b.cifra}
                </span>
                <span className="relative w-full max-w-6 shrink-0" style={{ height: `${b.alto}%`, minHeight: b.alto > 0 ? 2 : 0 }}>
                  <span className="barra-crece absolute inset-0 rounded-t-[4px] bg-primary group-hover:opacity-80 group-focus:opacity-80" style={{ animationDelay: `${Math.min(i * ESPERA_POR_BARRA_MS, ESPERA_MAXIMA_MS)}ms` }} />
                  {b.rotulo && (
                    <span aria-hidden className={cn('absolute bottom-full mb-0.5 bg-card px-0.5 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums', ancla(i, barras.length))}>
                      {b.rotulo}
                    </span>
                  )}
                </span>
                <span aria-hidden className={cn('absolute bottom-full z-10 mb-1 hidden rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm group-hover:block group-focus:block', ancla(i, barras.length))}>
                  <b className="font-semibold tabular-nums">{b.cifra}</b> <span className="text-muted-foreground">{b.cuando}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div aria-hidden className="mt-1 flex justify-between gap-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
          {barras.length > CUANTOS_ROTULOS ? (
            <>
              <span>{barras[0].eje}</span>
              <span>{barras.at(-1)!.eje}</span>
            </>
          ) : (
            barras.map((b, i) => (
              <span key={i} className="min-w-0 flex-1 text-center">
                {b.eje}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export type FilaDeReparto = { clave: string; etiqueta: string; cifra: string; parte: number }

/** Barras horizontales con su nombre y su cifra arriba. `parte` va de 0 a 1. */
export function Reparto({ filas }: { filas: readonly FilaDeReparto[] }) {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {filas.map((f) => (
        <li key={f.clave}>
          <div className="mb-1 flex justify-between gap-2">
            <span className="min-w-0 wrap-anywhere">{f.etiqueta}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{f.cifra}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(1, Math.max(0, f.parte)) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
