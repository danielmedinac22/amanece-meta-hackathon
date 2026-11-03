import { CaretRight } from '@phosphor-icons/react/ssr'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { EstadoDePedido as Estado } from '@/db/esquema'
import { cn } from '@/lib/utils'
import { pesos } from '@/nucleo/estado/elementos'
import type { DatosDeClientes, DatosDePedidos, FilaDePedido, GrupoDePedidos } from '@/nucleo/listas'
import { cifra, ETIQUETA_DE_PEDIDO } from '@/nucleo/listas-palabras'

const TONO: Record<Estado, string> = {
  novedad: 'bg-ojo-suave text-ojo',
  pendiente: 'bg-muted text-foreground',
  confirmado: 'bg-bien-suave text-bien',
  enviado: 'bg-muted text-muted-foreground',
  entregado: 'bg-muted text-muted-foreground',
  cancelado: 'bg-muted text-muted-foreground',
}

export function EstadoDePedido({ estado }: { estado: Estado }) {
  return <Badge className={cn('border-transparent font-normal', TONO[estado])}>{ETIQUETA_DE_PEDIDO[estado]}</Badge>
}

function Cifra({ valor, texto }: { valor: string; texto: string }) {
  return (
    <span>
      <b className="font-semibold text-foreground tabular-nums">{valor}</b> {texto}
    </span>
  )
}

function ResumenDePedidos({ cifras: { semana, conversaciones } }: Pick<DatosDePedidos, 'cifras'>) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-border px-4 py-3 text-[13px] text-muted-foreground">
      {semana.pedidos > 0 ? <Cifra valor={pesos(semana.ventas)} texto="esta semana" /> : <span>Sin ventas esta semana</span>}
      <Cifra valor={cifra(conversaciones.total)} texto={conversaciones.total === 1 ? 'conversación hoy' : 'conversaciones hoy'} />
      {conversaciones.total > 0 && <Cifra valor={cifra(conversaciones.resueltas)} texto={conversaciones.resueltas === 1 ? 'resuelta sin ti' : 'resueltas sin ti'} />}
    </div>
  )
}

function FilaPedido({ p }: { p: FilaDePedido }) {
  return (
    <li className="flex items-center gap-3 border-b border-border/60 px-4 py-2 text-[13px] transition-colors duration-100 hover:bg-muted/60">
      <span className="hidden w-12 shrink-0 text-muted-foreground tabular-nums @xl:block">#{p.numero}</span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{p.cliente}</span>
        {p.items && <span className="text-muted-foreground"> · {p.items}</span>}
      </span>
      <span className="hidden w-28 shrink-0 truncate text-right text-muted-foreground @2xl:block">{p.ciudad}</span>
      <span className="min-w-20 shrink-0 text-right tabular-nums">{pesos(p.total)}</span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground @xl:block">{p.hace}</span>
    </li>
  )
}

function Filas({ grupo }: { grupo: GrupoDePedidos }) {
  return (
    <ul>
      {grupo.filas.map((p) => (
        <FilaPedido key={p.id} p={p} />
      ))}
      {grupo.cuenta > grupo.filas.length && (
        <li className="px-4 py-2 text-xs text-muted-foreground">
          Ves los {cifra(grupo.filas.length)} más recientes de {cifra(grupo.cuenta)}.
        </li>
      )}
    </ul>
  )
}

/** El `top` negativo es el relleno del lienzo: con `top-0` pegaría debajo de él y las filas se verían pasar por encima. */
const ENCABEZADO = 'sticky -top-4 z-1 flex items-center gap-2 bg-muted/70 px-4 py-1.5 text-xs font-medium backdrop-blur lg:-top-6'

function Grupo({ grupo }: { grupo: GrupoDePedidos }) {
  const cuenta = <span className="text-muted-foreground tabular-nums">{cifra(grupo.cuenta)}</span>
  if (grupo.estado === 'cancelado') {
    return (
      <details className="group">
        <summary className={cn(ENCABEZADO, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
          <CaretRight className="size-3 text-muted-foreground group-open:rotate-90" />
          <EstadoDePedido estado={grupo.estado} /> {cuenta}
        </summary>
        <Filas grupo={grupo} />
      </details>
    )
  }
  return (
    <section>
      <h3 className={ENCABEZADO}>
        <EstadoDePedido estado={grupo.estado} /> {cuenta}
      </h3>
      <Filas grupo={grupo} />
    </section>
  )
}

/** Va de borde a borde del lienzo: sale de su relleno para que los encabezados peguen arriba, sin nada encima. */
export function ListaDePedidos({ cifras, grupos }: DatosDePedidos) {
  if (!grupos.length) return <p className="text-sm text-muted-foreground">Todavía no tienes pedidos. Cuando tu agente tome uno, aparece aquí.</p>
  return (
    <div className="-mx-4 -mt-4 lg:-mx-6 lg:-mt-6">
      <ResumenDePedidos cifras={cifras} />
      {grupos.map((g) => (
        <Grupo key={g.estado} grupo={g} />
      ))}
    </div>
  )
}

export function TablaDeClientes({ cuenta, filas }: DatosDeClientes) {
  if (!filas.length) return <p className="text-sm text-muted-foreground">Todavía no te ha escrito nadie. Cuando un Cliente te escriba, aparece aquí.</p>
  return (
    <div className="mx-auto max-w-4xl">
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
          {filas.map((c) => (
            <TableRow key={c.id}>
              {/* `max-w-0` deja que un nombre largo se recorte en vez de empujar la tabla; el ancho lo pone `w-*`. */}
              <TableCell className="w-full max-w-0 truncate font-medium @2xl:w-[35%]" title={c.nombre}>
                {c.nombre}
              </TableCell>
              <TableCell className="hidden text-muted-foreground @xl:table-cell">{c.ciudad}</TableCell>
              <TableCell className="text-right tabular-nums">{cifra(c.pedidos)}</TableCell>
              <TableCell className="text-right tabular-nums">{pesos(c.total)}</TableCell>
              <TableCell className="hidden text-right text-muted-foreground @2xl:table-cell">{c.ultimo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cuenta > filas.length && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          Ves los {cifra(filas.length)} más recientes de {cifra(cuenta)}.
        </p>
      )}
    </div>
  )
}
