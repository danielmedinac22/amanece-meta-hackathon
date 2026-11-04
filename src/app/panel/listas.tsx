import { CaretRight } from '@phosphor-icons/react/ssr'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { EstadoDePedido as Estado } from '@/db/esquema'
import { cn } from '@/lib/utils'
import { pesos } from '@/nucleo/estado/elementos'
import type { DatosDeClientes, DatosDePedidos, FilaDePedido, GrupoDePedidos } from '@/nucleo/listas'
import { cifra, ETIQUETA_DE_PEDIDO, rutaDeCliente, rutaDePedido } from '@/nucleo/listas-palabras'
import { ALaVista, IrASeccion } from './ir-a-seccion'
import { LoNuevo } from './lo-nuevo'

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

export function Cifra({ valor, texto }: { valor: string; texto: string }) {
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

function FilaPedido({ p, elegido }: { p: FilaDePedido; elegido?: string }) {
  const elegida = p.id === elegido
  return (
    <li className="scroll-mt-8 border-b border-border/60">
      {/* Sin prefetch: cien filas serían cien lecturas de la base antes de que el Dueño toque una. */}
      <IrASeccion href={rutaDePedido(p.id)} prefetch={false} scroll={false} aria-current={elegida ? 'true' : undefined} className={cn('flex items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-100 hover:bg-muted/60', elegida && 'bg-muted')}>
        {elegida && <ALaVista />}
        <span className="hidden w-12 shrink-0 text-muted-foreground tabular-nums @xl:block">#{p.numero}</span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{p.cliente}</span>
          {p.items && <span className="text-muted-foreground"> · {p.items}</span>}
        </span>
        <span className="hidden w-28 shrink-0 truncate text-right text-muted-foreground @2xl:block">{p.ciudad}</span>
        <span className="min-w-20 shrink-0 text-right tabular-nums">{pesos(p.total)}</span>
        <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground @xl:block">{p.hace}</span>
      </IrASeccion>
    </li>
  )
}

function Filas({ grupo, elegido }: { grupo: GrupoDePedidos; elegido?: string }) {
  return (
    <ul>
      {grupo.filas.map((p) => (
        <FilaPedido key={p.id} p={p} elegido={elegido} />
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
const EN_EL_LIENZO = '-top-4 lg:-top-6'
const ENCABEZADO = 'sticky z-1 flex items-center gap-2 bg-muted/70 px-4 py-1.5 text-xs font-medium backdrop-blur'

function Grupo({ grupo, elegido, pegado }: { grupo: GrupoDePedidos; elegido?: string; pegado: string }) {
  const cuenta = <span className="text-muted-foreground tabular-nums">{cifra(grupo.cuenta)}</span>
  if (grupo.estado === 'cancelado') {
    return (
      <details className="group" open={grupo.filas.some((p) => p.id === elegido)}>
        <summary className={cn(ENCABEZADO, pegado, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
          <CaretRight className="size-3 text-muted-foreground group-open:rotate-90" />
          <EstadoDePedido estado={grupo.estado} /> {cuenta}
        </summary>
        <Filas grupo={grupo} elegido={elegido} />
      </details>
    )
  }
  return (
    <section>
      <h3 className={cn(ENCABEZADO, pegado)}>
        <EstadoDePedido estado={grupo.estado} /> {cuenta}
      </h3>
      <Filas grupo={grupo} elegido={elegido} />
    </section>
  )
}

/** Los grupos en la columna del detalle, que se desplaza sola: ahí el encabezado pega en su borde, sin relleno encima. */
export function GruposAlLado({ grupos, elegido }: { grupos: GrupoDePedidos[]; elegido: string }) {
  return grupos.map((g) => <Grupo key={g.estado} grupo={g} elegido={elegido} pegado="top-0" />)
}

/** Va de borde a borde del lienzo: sale de su relleno para que los encabezados peguen arriba, sin nada encima. */
export function ListaDePedidos({ cifras, grupos }: DatosDePedidos) {
  if (!grupos.length)
    return (
      <div className="flex flex-col gap-4">
        <LoNuevo />
        <p className="text-sm text-muted-foreground">Todavía no tienes pedidos. Cuando tu agente tome uno, aparece aquí.</p>
      </div>
    )
  return (
    <div className="-mx-4 -mt-4 lg:-mx-6 lg:-mt-6">
      <ResumenDePedidos cifras={cifras} />
      <div className="p-3 empty:hidden">
        <LoNuevo />
      </div>
      {grupos.map((g) => (
        <Grupo key={g.estado} grupo={g} pegado={EN_EL_LIENZO} />
      ))}
    </div>
  )
}

export function TablaDeClientes({ cuenta, filas, elegido }: DatosDeClientes & { elegido?: string }) {
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
            <TableRow key={c.id} className={cn('relative', c.id === elegido && 'bg-muted')}>
              {/* `max-w-0` deja que un nombre largo se recorte en vez de empujar la tabla; el ancho lo pone `w-*`. */}
              <TableCell className="w-full max-w-0 truncate font-medium @2xl:w-[35%]" title={c.nombre}>
                {/* `after` estira el enlace a toda la fila: una tabla no puede llevar un `a` alrededor de sus celdas. */}
                <IrASeccion href={rutaDeCliente(c.id)} prefetch={false} scroll={false} aria-current={c.id === elegido ? 'true' : undefined} className="after:absolute after:inset-0">
                  {c.id === elegido && <ALaVista />}
                  {c.nombre}
                </IrASeccion>
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
