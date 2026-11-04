import type { Icon } from '@phosphor-icons/react'
import { CalendarBlank, ChatsCircle, CurrencyCircleDollar, Robot, Warning } from '@phosphor-icons/react/ssr'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { pesos } from '@/nucleo/estado/elementos'
import { graficaDe } from '@/nucleo/graficas'
import { cifra } from '@/nucleo/listas-palabras'
import type { SeccionPintada } from '@/nucleo/panel'
import type { DatosDelTablero, PedidoReciente } from '@/nucleo/tablero'
import { ETIQUETA_DE_ORIGEN, tarjetasDelTablero, type TarjetaDelTablero } from '@/nucleo/tablero-palabras'
import type { FilaDeCita } from '@/nucleo/citas'
import { EstadoDeCita } from './agenda'
import { Barras, Reparto } from './graficas'
import { EstadoDePedido } from './listas'
import { Indicadores } from './pieza'

const ICONO: Record<TarjetaDelTablero['clave'], Icon> = { negocio: CurrencyCircleDollar, citas: CalendarBlank, conversaciones: ChatsCircle, resueltas: Robot, atencion: Warning }

function Tarjeta({ t }: { t: TarjetaDelTablero }) {
  const I = ICONO[t.clave]
  return (
    <div className="flex min-w-0 flex-col rounded-(--radius) border border-border bg-card p-3 @sm:p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] leading-tight text-muted-foreground">{t.dato}</p>
        {/* A 320 px un ícono no deja caber `Conversaciones`. El de lo que espera al Dueño se queda: es lo único que dice que espera. */}
        <span className={cn('size-7 shrink-0 items-center justify-center rounded-lg', t.espera ? 'flex bg-ojo-suave text-ojo' : 'hidden bg-muted text-muted-foreground @sm:flex')}>
          <I className="size-4" />
        </span>
      </div>
      <p className="mt-2 font-heading text-lg font-semibold tracking-tight tabular-nums wrap-anywhere @sm:text-xl @lg:text-2xl">{t.valor}</p>
      <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{t.nota}</p>
    </div>
  )
}

function Bloque({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-(--radius) border border-border bg-card p-4">
      <p className="text-sm font-medium">{titulo}</p>
      <p className="mb-3 text-xs text-muted-foreground">{nota}</p>
      {children}
    </div>
  )
}

function Recientes({ filas }: { filas: readonly PedidoReciente[] }) {
  return (
    <div className="min-w-0 rounded-(--radius) border border-border bg-card px-3 pt-3 pb-1">
      <p className="mb-1 px-1 text-sm font-medium">Pedidos recientes</p>
      {filas.length === 0 ? (
        <p className="px-1 pb-2 text-sm text-muted-foreground">Todavía no tienes pedidos. Cuando tu agente tome uno, aparece aquí.</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="hidden w-12 @xl:table-cell">#</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden @2xl:table-cell">Pidió</TableHead>
              <TableHead className="px-1 text-right @sm:px-2">Total</TableHead>
              <TableHead className="px-1 text-right @sm:px-2">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="hidden text-muted-foreground tabular-nums @xl:table-cell">{p.numero}</TableCell>
                {/* `max-w-0` deja que un nombre largo se recorte en vez de empujar la tabla; el ancho lo pone `w-*`. */}
                <TableCell className="w-full max-w-0 @2xl:w-[30%]">
                  <div className="truncate font-medium" title={p.cliente}>
                    {p.cliente}
                  </div>
                  {p.ciudad && <div className="truncate text-xs text-muted-foreground">{p.ciudad}</div>}
                </TableCell>
                <TableCell className="hidden max-w-60 truncate text-muted-foreground @2xl:table-cell" title={p.items}>
                  {p.items}
                </TableCell>
                <TableCell className="px-1 text-right tabular-nums @sm:px-2">{pesos(p.total)}</TableCell>
                <TableCell className="px-1 text-right @sm:px-2">
                  <EstadoDePedido estado={p.estado} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function ProximasCitas({ filas }: { filas: readonly FilaDeCita[] }) {
  return (
    <div className="min-w-0 rounded-(--radius) border border-border bg-card px-3 pt-3 pb-1">
      <p className="mb-1 px-1 text-sm font-medium">Próximas citas</p>
      {filas.length === 0 ? (
        <p className="px-1 pb-2 text-sm text-muted-foreground">No tienes citas por venir. Cuando un Cliente acepte una hora, aparece aquí.</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden @2xl:table-cell">Cuándo</TableHead>
              <TableHead className="px-1 text-right @sm:px-2">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="w-full max-w-0 @2xl:w-[45%]">
                  <div className="truncate font-medium" title={c.cliente}>
                    {c.cliente}
                  </div>
                  <div className="truncate text-xs text-muted-foreground @2xl:hidden">{c.cuando}</div>
                  {c.asunto && <div className="truncate text-xs text-muted-foreground">{c.asunto}</div>}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground tabular-nums @2xl:table-cell">{c.cuando}</TableCell>
                <TableCell className="px-1 text-right @sm:px-2">
                  <EstadoDeCita estado={c.estado} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/** Lo que cambia con la voz. Tarjetas, Indicadores y `De dónde llegan` son iguales para todos. */
function porVoz({ citas, porDia }: DatosDelTablero) {
  return citas
    ? { titulo: 'Citas por día', nota: 'Esta semana, de lunes a domingo. No cuenta las canceladas.', vacio: 'Todavía no hay citas esta semana.', puntos: citas.porDia.map((d) => ({ etiqueta: d.dia, valor: d.citas })) }
    : { titulo: 'Pedidos por día', nota: 'Últimos 7 días. No cuenta lo cancelado ni lo que falta confirmar.', vacio: 'Todavía no hay pedidos en estos 7 días.', puntos: porDia.map((d) => ({ etiqueta: d.dia, valor: d.pedidos })) }
}

export function VistaDelTablero({ indicadores, tablero }: { indicadores: readonly SeccionPintada[]; tablero: DatosDelTablero }) {
  const lado = porVoz(tablero)
  const grafica = graficaDe(lado.puntos, { tipo: 'cantidad', nombre: '' })
  const deClientes = tablero.porOrigen.reduce((s, f) => s + f.cuenta, 0)
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        {tarjetasDelTablero(tablero).map((t) => (
          <Tarjeta key={t.clave} t={t} />
        ))}
      </div>
      {indicadores.length > 0 && <Indicadores indicadores={indicadores} />}
      <div className="grid gap-3 @3xl:grid-cols-[1.5fr_1fr]">
        <Bloque titulo={lado.titulo} nota={lado.nota}>
          {grafica ? <Barras grafica={grafica} titulo={lado.titulo} alto={168} /> : <p className="text-sm text-muted-foreground">{lado.vacio}</p>}
        </Bloque>
        <Bloque titulo="De dónde llegan" nota="Todos tus Clientes, por cómo te escribieron la primera vez.">
          {deClientes > 0 ? <Reparto filas={tablero.porOrigen.map((f) => ({ clave: f.origen, etiqueta: ETIQUETA_DE_ORIGEN[f.origen], cifra: cifra(f.cuenta), parte: f.cuenta / deClientes }))} /> : <p className="text-sm text-muted-foreground">Todavía no tienes Clientes. Cuando alguien te escriba, aparece aquí.</p>}
          {tablero.porOrigen.some((f) => f.origen === 'sin_dato') && <p className="mt-3 text-xs text-pretty text-muted-foreground">Sin dato: no se sabe cómo llegaron. Aquí van también quienes te escribieron antes de que esto se guardara.</p>}
        </Bloque>
      </div>
      {tablero.citas && <ProximasCitas filas={tablero.citas.proximas} />}
      {/* Una agenda con pedidos también los ve: el Rubro es texto libre y puede haber reconocido mal una tienda. */}
      {(!tablero.citas || tablero.recientes.length > 0) && <Recientes filas={tablero.recientes} />}
    </div>
  )
}
