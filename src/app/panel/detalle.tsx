import { ArrowLeft } from '@phosphor-icons/react/ssr'
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { pesos } from '@/nucleo/estado/elementos'
import type { DatosDeClientes, DetalleDeCliente, DetalleDeConversacion, DetalleDePedido, GrupoDePedidos, PedidoDelCliente } from '@/nucleo/listas'
import { cifra, rutaDeCliente, rutaDePedido } from '@/nucleo/listas-palabras'
import { CasoQueEspera, Mensajes, rutaDeConversacion } from './conversaciones'
import { IrASeccion } from './ir-a-seccion'
import { Cifra, EstadoDePedido, GruposAlLado, TablaDeClientes } from './listas'

const RUTA_DE_PEDIDOS = '/panel/pedidos'
const RUTA_DE_CLIENTES = '/panel/clientes'

/**
 * Lista y detalle, como Conversaciones, y en teléfono una pantalla a la vez. La lista va en su propio `@container`:
 * sus filas esconden columnas según el ancho, y aquí ese ancho es el de la columna. La flecha también va en PC, porque
 * sin elegir nada la lista vuelve a ocupar todo el lienzo.
 */
function ListaYDetalle({ lista, volver, volverA, titulo, children }: { lista: ReactNode; volver: string; volverA: string; titulo: ReactNode; children: ReactNode }) {
  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] min-h-[420px] lg:-m-6 lg:h-[calc(100%+3rem)]">
      <div className="@container hidden w-[42%] max-w-72 shrink-0 overflow-y-auto border-r border-border @xl:block">{lista}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border p-1.5">
          <IrASeccion href={volver} scroll={false} aria-label={volverA} className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-8 shrink-0' })}>
            <ArrowLeft className="size-4" />
          </IrASeccion>
          {titulo}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  )
}

function Conversacion({ conversacion }: { conversacion: DetalleDeConversacion | null }) {
  return (
    <Bloque titulo="Conversación">
      {conversacion ? (
        <>
          <Mensajes d={conversacion} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <IrASeccion href={rutaDeConversacion(conversacion.cliente)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Ver toda la conversación
            </IrASeccion>
            {conversacion.casoQueEspera && <CasoQueEspera titulo={conversacion.casoQueEspera} />}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no te ha escrito. Cuando lo haga, aparece aquí.</p>
      )}
    </Bloque>
  )
}

export function VistaDeUnPedido({ grupos, pedido }: { grupos: GrupoDePedidos[]; pedido: DetalleDePedido }) {
  const entrega = [pedido.direccion, pedido.ciudad].filter(Boolean).join(', ')
  return (
    <ListaYDetalle
      lista={<GruposAlLado grupos={grupos} elegido={pedido.id} />}
      volver={RUTA_DE_PEDIDOS}
      volverA="Volver a los pedidos"
      titulo={
        <>
          <span className="shrink-0 text-sm font-medium tabular-nums">Pedido #{pedido.numero}</span>
          <EstadoDePedido estado={pedido.estado} />
          <span className="ml-auto shrink-0 pr-1.5 text-xs text-muted-foreground">{pedido.hace}</span>
        </>
      }
    >
      <Bloque titulo="Lo que pidió">
        <ul className="text-[13px]">
          {pedido.items.map((i, n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
              <span className="min-w-0 wrap-anywhere">{i.cantidad === 1 ? i.nombre : `${i.cantidad} × ${i.nombre}`}</span>
              <span className="shrink-0 tabular-nums">{pesos(i.cantidad * i.precio)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 py-1.5 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{pesos(pedido.total)}</span>
          </li>
        </ul>
      </Bloque>
      {entrega && (
        <Bloque titulo="Entrega">
          <p className="text-[13px] wrap-anywhere">{entrega}</p>
        </Bloque>
      )}
      <Bloque titulo="Cliente">
        <p className="text-[13px] wrap-anywhere">
          <IrASeccion href={rutaDeCliente(pedido.cliente.id)} scroll={false} className="font-medium underline-offset-2 hover:underline">
            {pedido.cliente.nombre}
          </IrASeccion>
          {pedido.cliente.telefono && <span className="text-muted-foreground"> · {pedido.cliente.telefono}</span>}
        </p>
      </Bloque>
      <Conversacion conversacion={pedido.conversacion} />
    </ListaYDetalle>
  )
}

function SuPedido({ p }: { p: PedidoDelCliente }) {
  return (
    <li className="border-b border-border/60">
      <IrASeccion href={rutaDePedido(p.id)} prefetch={false} scroll={false} className="flex items-center gap-3 py-2 text-[13px] transition-colors duration-100 hover:bg-muted/60">
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground tabular-nums">#{p.numero}</span>
          {p.items && <span> · {p.items}</span>}
        </span>
        <EstadoDePedido estado={p.estado} />
        <span className="min-w-20 shrink-0 text-right tabular-nums">{pesos(p.total)}</span>
      </IrASeccion>
    </li>
  )
}

export function VistaDeUnCliente({ lista, cliente }: { lista: DatosDeClientes; cliente: DetalleDeCliente }) {
  const quien = [cliente.telefono, cliente.ciudad].filter(Boolean).join(' · ')
  return (
    <ListaYDetalle
      lista={<TablaDeClientes {...lista} elegido={cliente.id} />}
      volver={RUTA_DE_CLIENTES}
      volverA="Volver a los Clientes"
      titulo={
        <>
          <span className="min-w-0 truncate text-sm font-medium">{cliente.nombre}</span>
          <span className="ml-auto shrink-0 pr-1.5 text-xs text-muted-foreground">{cliente.ultimo}</span>
        </>
      }
    >
      {(quien || cliente.pedidos > 0) && (
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
          {quien && <span className="wrap-anywhere">{quien}</span>}
          {cliente.pedidos > 0 && <Cifra valor={pesos(cliente.total)} texto={cliente.pedidos === 1 ? 'en 1 pedido' : `en ${cifra(cliente.pedidos)} pedidos`} />}
        </div>
      )}
      <Bloque titulo="Sus pedidos">
        {cliente.suyos.length > 0 ? (
          <>
            <ul>
              {cliente.suyos.map((p) => (
                <SuPedido key={p.id} p={p} />
              ))}
            </ul>
            {cliente.cuentaDeSuyos > cliente.suyos.length && (
              <p className="py-2 text-xs text-muted-foreground">
                Ves los {cifra(cliente.suyos.length)} más recientes de {cifra(cliente.cuentaDeSuyos)}.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no ha pedido nada. Cuando tu agente le tome uno, aparece aquí.</p>
        )}
      </Bloque>
      <Conversacion conversacion={cliente.conversacion} />
    </ListaYDetalle>
  )
}

export function NoEstaEnTuNegocio({ titulo, texto, volver, volverA }: { titulo: string; texto: string; volver: string; volverA: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-2 pt-8">
      <p className="font-heading text-xl font-semibold tracking-tight text-balance">{titulo}</p>
      <p className="text-sm text-muted-foreground">{texto}</p>
      <IrASeccion href={volver} className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-2' })}>
        {volverA}
      </IrASeccion>
    </div>
  )
}

export const PedidoQueNoEsta = () => <NoEstaEnTuNegocio titulo="Este pedido no está en tu negocio." texto="Puede que el enlace sea de otro negocio, o que esté mal copiado." volver={RUTA_DE_PEDIDOS} volverA="Ver tus pedidos" />
export const ClienteQueNoEsta = () => <NoEstaEnTuNegocio titulo="Este Cliente no está en tu negocio." texto="Puede que el enlace sea de otro negocio, o que esté mal copiado." volver={RUTA_DE_CLIENTES} volverA="Ver tus Clientes" />
