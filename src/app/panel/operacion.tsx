'use client'

import { ArrowLineLeft, CaretUp, PushPin, Robot, Storefront, Table, type Icon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useMemo, useReducer, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import type { LoPendiente } from '@/nucleo/cambios'
import type { SeccionPintada } from '@/nucleo/panel'
import { DISPOSICION_INICIAL, HiloEnLaOperacion, disponer, type Disposicion, type Pestana } from './disposicion'
import { AlIrASeccion } from './ir-a-seccion'
import { BotonPublicar } from './publicar'
import { SinPublicar } from './sin-publicar'
import type { Publicador } from './tocar-publicar'
import { SECCIONES, nombreDeLaRuta, rutaDePropia, type Cuentas, type SeccionPropia } from './secciones'

/** Lo que la cáscara pinta. Quien la arma lee; ella no toca datos. */
export type DatosDeLaOperacion = {
  dueno: string
  negocio:
    | (Cuentas & {
        nombre: string
        ciudad: string
        propias: readonly SeccionPropia[]
        /** Lo que hay por publicar; `null` es Armándose, donde todavía no se publica. */
        publicar: (LoPendiente & { link: string; nuevos: readonly SeccionPintada[] }) | null
      })
    | null
}

type Props = {
  datos: DatosDeLaOperacion
  ruta: string
  /** Sin esto los enlaces navegan. La vitrina lo usa para recorrer las Secciones sin salir de la escena. */
  alIr?: (ruta: string) => void
  /** Sin esto Publicar va a la ruta. La vitrina lo usa para recorrerlo sin base de datos. */
  publicador?: Publicador
  hilo: ReactNode
  children: ReactNode
  sidebarAbierto?: boolean
  cajonAbierto?: boolean
  inicial?: Partial<Disposicion>
}

const ItemConEntrada = motion.create(SidebarMenuItem)
const ICONOS_DE_PESTANA: { id: Pestana; nombre: string; icono: Icon }[] = [
  { id: 'agente', nombre: 'Tu agente', icono: Robot },
  { id: 'negocio', nombre: 'Tu negocio', icono: Storefront },
]

export function Operacion({ datos, ruta, alIr, publicador, hilo, children, sidebarAbierto = true, cajonAbierto = false, inicial }: Props) {
  const [disposicion, cambiar] = useReducer(disponer, { ...DISPOSICION_INICIAL, ...inicial })
  const { lugar, pestana, decision, movido } = disposicion
  const { negocio } = datos
  const avisarDecision = useCallback((id: string | null) => cambiar({ tipo: 'decision', id }), [])
  const publicar = negocio?.publicar
  const sinPublicar = useMemo(() => ({ claves: new Set<string>(publicar?.items.map((i) => i.clave)), indicadores: publicar?.nuevos ?? [] }), [publicar])

  const hiloEnLaOperacion = useMemo(
    () => ({
      vista: `${lugar}-${pestana}`,
      avisarDecision,
      controles:
        lugar === 'fijo' ? null : (
          <span className="hidden shrink-0 flotante:flex">
            <Button variant="ghost" size="icon-lg" aria-label={lugar === 'conversacion' ? 'Plegar la conversación' : 'Ver la conversación'} onClick={() => cambiar({ tipo: 'alternar_conversacion' })}>
              <CaretUp className={cn('size-3.5 transition-transform duration-200 ease-mueve motion-reduce:transition-none', lugar === 'conversacion' && 'rotate-180')} />
            </Button>
            <Button variant="ghost" size="icon-lg" aria-label="Fijar la conversación al lado" onClick={() => cambiar({ tipo: 'fijar' })}>
              <PushPin className="size-3.5" />
            </Button>
          </span>
        ),
    }),
    [lugar, pestana, avisarDecision],
  )

  function alTocarUnaSeccion(evento: MouseEvent, destino: string) {
    if (alIr) {
      evento.preventDefault()
      alIr(destino)
    }
    cambiar({ tipo: 'pestana', pestana: 'negocio' })
  }

  return (
    <SidebarProvider defaultOpen={sidebarAbierto} defaultOpenMobile={cajonAbierto} className="h-dvh min-h-0" style={{ '--sidebar-width': '13.5rem' } as CSSProperties}>
      <BarraLateral datos={datos} ruta={ruta} alTocar={alTocarUnaSeccion} />
      <SinPublicar.Provider value={sinPublicar}>
        <SidebarInset data-lugar={lugar} data-movido={movido || undefined} className="min-h-0 min-w-0 overflow-hidden lg:flex-row">
          <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2 lg:hidden">
            <SidebarTrigger />
            <span className="min-w-0 truncate font-heading font-semibold">{negocio?.nombre ?? 'Tu negocio'}</span>
            {negocio?.publicar && (
              <span className="ml-auto">
                <BotonPublicar pendiente={negocio.publicar} link={negocio.publicar.link} publicador={publicador} />
              </span>
            )}
          </header>

          {/* El Hilo se sale del flujo en PC: este espacio es el que se pliega y empuja el lienzo. */}
          <div aria-hidden className="hidden shrink-0 transition-[width] duration-280 ease-mueve motion-reduce:transition-none lg:block lg:w-[348px] flotante:w-0" />

          <section data-pano="hilo" aria-label="Tu agente" className={cn('flex min-h-0 flex-1 flex-col fijo:absolute fijo:inset-y-0 fijo:left-0 fijo:z-10 fijo:w-[348px] fijo:border-r fijo:border-border fijo:bg-background flotante:absolute flotante:bottom-5 flotante:left-1/2 flotante:z-10 flotante:w-[min(560px,calc(100%-3rem))] flotante:flex-none flotante:-translate-x-1/2', pestana !== 'agente' && 'max-lg:hidden')}>
            <div className="hidden h-12 shrink-0 items-center gap-1.5 px-3 fijo:flex">
              <SidebarTrigger />
              <span className="font-heading text-[15px] font-semibold">Tu agente</span>
              <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => cambiar({ tipo: 'ocultar' })}>
                <ArrowLineLeft className="size-3.5" /> Ocultar
              </Button>
            </div>
            <div className="min-h-0 flex-1 p-3 fijo:pt-0 flotante:p-0">
              <HiloEnLaOperacion.Provider value={hiloEnLaOperacion}>{hilo}</HiloEnLaOperacion.Provider>
            </div>
          </section>

          <section data-pano="lienzo" className={cn('min-h-0 min-w-0 flex-1 lg:bg-muted/40 lg:p-2', pestana !== 'negocio' && 'max-lg:hidden')}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card lg:rounded-lg lg:border lg:border-border">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 lg:px-4">
                <span className="hidden flotante:flex">
                  <SidebarTrigger />
                </span>
                <h1 className="min-w-0 truncate font-heading text-[15px] font-semibold">{nombreDeLaRuta(ruta, negocio?.propias ?? [])}</h1>
                <div className="ml-auto flex items-center gap-2">
                  {negocio && <EstadoDelNegocio publicar={negocio.publicar} />}
                  {negocio?.publicar && (
                    <span className="hidden lg:contents">
                      <BotonPublicar pendiente={negocio.publicar} link={negocio.publicar.link} publicador={publicador} />
                    </span>
                  )}
                </div>
              </div>
              <div className="@container min-h-0 flex-1 overflow-y-auto p-4 lg:p-6 flotante:pb-28">
                <AlIrASeccion.Provider value={alTocarUnaSeccion}>{children}</AlIrASeccion.Provider>
              </div>
            </div>
          </section>

          <nav aria-label="Dónde estás" className="grid shrink-0 grid-cols-2 border-t border-border pb-[env(safe-area-inset-bottom)] lg:hidden">
            {ICONOS_DE_PESTANA.map(({ id, nombre, icono: I }) => (
              <button key={id} type="button" onClick={() => cambiar({ tipo: 'pestana', pestana: id })} aria-current={pestana === id ? 'page' : undefined} className={cn('relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', pestana === id ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                <I weight={pestana === id ? 'fill' : 'regular'} className="size-5" />
                {nombre}
                {id === 'agente' && decision && pestana !== 'agente' && <span role="img" className="absolute top-2 left-[calc(50%+8px)] size-2 rounded-full bg-ojo" aria-label="Algo espera tu decisión" />}
              </button>
            ))}
          </nav>
        </SidebarInset>
      </SinPublicar.Provider>
    </SidebarProvider>
  )
}

/** La cáscara de verdad: la ruta sale de la URL y los enlaces navegan. */
export function OperacionEnLaRuta(props: Omit<Props, 'ruta' | 'alIr' | 'inicial' | 'cajonAbierto'>) {
  return <Operacion {...props} ruta={usePathname()} />
}

function EstadoDelNegocio({ publicar }: { publicar: LoPendiente | null }) {
  const { texto, color } = !publicar ? { texto: 'Armándose', color: 'bg-ojo-suave text-ojo' } : publicar.items.length ? { texto: 'Vista previa', color: 'bg-ojo-suave text-ojo' } : { texto: 'Atendiendo', color: 'bg-bien-suave text-bien' }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={texto} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
        <Badge className={cn('border-transparent', color)}>{texto}</Badge>
      </motion.span>
    </AnimatePresence>
  )
}

type AlTocar = (evento: MouseEvent, destino: string) => void

function BarraLateral({ datos, ruta, alTocar }: { datos: DatosDeLaOperacion; ruta: string; alTocar: AlTocar }) {
  const { negocio, dueno } = datos
  const nombre = negocio?.nombre ?? 'Tu negocio'
  const { setOpenMobile } = useSidebar()
  // Solo entra con animación lo que llegó después de abrir: también la primera Sección, que trae su grupo con ella.
  const [yaEstaban] = useState(() => new Set(negocio?.propias.map((p) => p.clave)))
  const tocar: AlTocar = (evento, destino) => {
    alTocar(evento, destino)
    setOpenMobile(false)
  }
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={nombre} render={<Link href="/panel" onClick={(e) => tocar(e, '/panel')} />}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary font-heading text-sm font-semibold text-sidebar-primary-foreground">{nombre[0]}</span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{nombre}</span>
                {negocio?.ciudad && <span className="truncate text-xs text-muted-foreground">{negocio.ciudad}</span>}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SECCIONES.map((s) => {
                const activa = ruta === s.ruta
                const cuenta = negocio && s.cuenta?.(negocio)
                return (
                  <SidebarMenuItem key={s.ruta}>
                    <SidebarMenuButton isActive={activa} tooltip={s.nombre} render={<Link href={s.ruta} onClick={(e) => tocar(e, s.ruta)} />}>
                      <s.icono weight={activa ? 'fill' : 'regular'} />
                      <span>{s.nombre}</span>
                    </SidebarMenuButton>
                    {cuenta ? (
                      <>
                        <SidebarMenuBadge className="bg-transparent">
                          <motion.span key={cuenta} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.35 }} className="flex h-5 min-w-5 items-center justify-center rounded-md bg-ojo-suave px-1 text-ojo tabular-nums">
                            {cuenta}
                          </motion.span>
                        </SidebarMenuBadge>
                        {/* Plegado no cabe el número, pero no se puede perder que algo espera. */}
                        <span className="pointer-events-none absolute top-1 right-1 hidden size-1.5 rounded-full bg-ojo group-data-[collapsible=icon]:block" />
                      </>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {negocio && negocio.propias.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="overflow-hidden">Tus secciones</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {negocio.propias.map((p) => {
                  const destino = rutaDePropia(p.clave)
                  return (
                    <ItemConEntrada key={p.clave} initial={yaEstaban.has(p.clave) ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
                      <SidebarMenuButton isActive={ruta === destino} tooltip={p.nombre} render={<Link href={destino} onClick={(e) => tocar(e, destino)} />}>
                        <Table weight={ruta === destino ? 'fill' : 'regular'} />
                        <span>{p.nombre}</span>
                      </SidebarMenuButton>
                    </ItemConEntrada>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex h-8 items-center gap-2 px-1.5 text-sm">
          <Avatar className="size-5 shrink-0">
            <AvatarFallback className="text-[9px]">{dueno.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="truncate group-data-[collapsible=icon]:hidden">{dueno}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
