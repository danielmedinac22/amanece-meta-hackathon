import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { EstadoVisibleDeCita } from '@/nucleo/citas-palabras'
import type { DatosDeAgenda, FilaDeCita } from '@/nucleo/citas'
import { cifra, rutaDeCliente } from '@/nucleo/listas-palabras'
import { IrASeccion } from './ir-a-seccion'

const TONO: Record<EstadoVisibleDeCita, string> = {
  Agendada: 'bg-bien-suave text-bien',
  Movida: 'bg-muted text-foreground',
  Cancelada: 'bg-muted text-muted-foreground',
  'Ya pasó': 'bg-muted text-muted-foreground',
}

export function EstadoDeCita({ estado }: { estado: EstadoVisibleDeCita }) {
  return <Badge className={cn('border-transparent font-normal', TONO[estado])}>{estado}</Badge>
}

function Fila({ c }: { c: FilaDeCita }) {
  return (
    <li className="border-b border-border/60">
      <IrASeccion href={rutaDeCliente(c.clienteId)} prefetch={false} className="flex items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-150 hover:bg-muted/60">
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-medium">{c.cliente}</span>
            {c.asunto && <span className="text-muted-foreground"> · {c.asunto}</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {c.cuando}
            {c.antes && ` · antes ${c.antes}`}
          </span>
        </span>
        <span className="shrink-0">
          <EstadoDeCita estado={c.estado} />
        </span>
      </IrASeccion>
    </li>
  )
}

/** Va de borde a borde del lienzo, como Pedidos: una agenda se lee por lo que viene. */
export function VistaDeAgenda({ grupos }: DatosDeAgenda) {
  if (!grupos.length) return <p className="text-sm text-muted-foreground">Todavía no tienes citas. Cuando un Cliente acepte una hora, tu agente la guarda y aparece aquí.</p>
  return (
    <div className="-mx-4 -mt-4 lg:-mx-6 lg:-mt-6">
      {grupos.map((g) => (
        <section key={g.clave}>
          <h3 className="flex items-center gap-2 bg-muted/70 px-4 py-1.5 text-xs font-medium">
            {g.nombre} <span className="font-normal text-muted-foreground tabular-nums">{cifra(g.cuenta)}</span>
          </h3>
          <ul>
            {g.filas.map((c) => (
              <Fila key={c.id} c={c} />
            ))}
          </ul>
          {g.cuenta > g.filas.length && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Ves las {cifra(g.filas.length)} primeras de {cifra(g.cuenta)}.
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
