'use client'

import { ArrowRight, CaretDown, CheckCircle, Circle } from '@phosphor-icons/react'
import type { ChatStatus, UIMessage } from 'ai'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { RespuestaDeAbrir } from '@/negocio/abrir'
import { decisionesEnEspera } from '@/negocio/partes-del-hilo'
import { abrioElAgente, cuantoGuardo, estaLeyendo, pasoDelArmado, titularDe, ultimoTurno } from '@/nucleo/armado-paso'
import type { DatosDelArmado, FilaQueYaSe, ProductoEnElPanel } from '@/nucleo/armado'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import { plantillaDelHilo } from '@/nucleo/plantillas'
import { EscribirleAlAgente, type Borrador } from './disposicion'
import { useHilo } from './hilo'
import { MensajeDelHilo, Puntos, RastroDePlantilla, Redactor, type AlEnviar } from './hilo-vista'
import { subirArchivo, type SubirArchivo } from './subir-archivo'
import { seccionesDe } from './secciones'
import { Tarjeta } from './tarjeta'
import { tocarTarjeta, type TocarTarjeta } from './tocar-tarjeta'
import type { Devuelto } from './lo-que-vuelve'

const ENTRA = [0.22, 1, 0.36, 1] as const
const SALE_EL_CIELO_MS = 500

/** Lo que el Dueño toca es lo que el agente recibe: el cobro lo guarda él, y la carta lo ve en el estado. */
const FORMAS_DE_COBRO = [
  { opcion: 'Contra entrega', mensaje: 'Mis clientes me pagan contra entrega.' },
  { opcion: 'Por transferencia', mensaje: 'Mis clientes me pagan por transferencia.' },
  { opcion: 'De las dos formas', mensaje: 'Mis clientes me pagan contra entrega o por transferencia.' },
] as const

type DatosDeLaCarta = {
  datos: DatosDelArmado
  messages: UIMessage[]
  estados: Record<string, EstadoDeTarjeta>
  status: ChatStatus
  error: Error | undefined
  devuelto?: Devuelto | null
}

/** Un Negocio armándose: la conexión de verdad. Lo que se guarda en medio de un turno también se vuelve a leer, para que las filas se marquen una por una. */
export function ArmadoEnLaRuta({ datos, inicial, tarjetas, salir }: { datos: DatosDelArmado; inicial: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta>; salir: ReactNode }) {
  const router = useRouter()
  // Si abrió el agente, la vista primero saca el cielo y después vuelve a leer.
  const { messages, estados, status, error, devuelto, ocupado, alEnviar, alCambiar } = useHilo({
    inicial,
    tarjetas,
    alTerminar: (m) => {
      if (!abrioElAgente([m])) router.refresh()
    },
  })
  const guardo = cuantoGuardo(messages)
  useEffect(() => {
    if (ocupado && guardo) router.refresh()
  }, [ocupado, guardo, router])
  const alSalir = useCallback(() => router.refresh(), [router])
  return <VistaDelArmado salir={salir} datos={datos} messages={messages} estados={estados} status={status} error={error} devuelto={devuelto} alEnviar={alEnviar} alSubir={subirArchivo} alTocar={tocarTarjeta} alCambiar={alCambiar} alAbrir={abrir} alSalir={alSalir} />
}

async function abrir(): Promise<RespuestaDeAbrir | { error: string }> {
  const r = await fetch('/api/dueno/abrir', { method: 'POST' }).catch(() => null)
  return r?.ok ? ((await r.json()) as RespuestaDeAbrir) : { error: 'No pude abrir tu negocio. Vuelve a tocar el botón en un momento.' }
}

/** Pinta la carta y Tu Panel. Quien la conecta decide qué pasa al enviar, al tocar y al abrir: esta vista no habla con ninguna ruta. */
export function VistaDelArmado({ datos, messages, estados, status, error, devuelto, alEnviar, alSubir, alTocar, alCambiar, alAbrir, alSalir, salir }: DatosDeLaCarta & { salir?: ReactNode; alEnviar: AlEnviar; alSubir: SubirArchivo; alTocar: TocarTarjeta; alCambiar: () => void; alAbrir: () => Promise<RespuestaDeAbrir | { error: string }>; alSalir: () => void }) {
  const ocupado = status === 'submitted' || status === 'streaming'
  const [pospusoElCobro, setPospusoElCobro] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [yaEstaban] = useState(messages.length)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const escribir = useCallback((texto: string) => setBorrador({ texto }), [])

  const paso = pasoDelArmado(datos, { leyendo: ocupado && estaLeyendo(messages), pospusoElCobro })
  const saliendo = abierto || (!ocupado && abrioElAgente(messages))

  useEffect(() => {
    if (!saliendo) return
    const espera = setTimeout(alSalir, SALE_EL_CIELO_MS)
    return () => clearTimeout(espera)
  }, [saliendo, alSalir])

  const espera = decisionesEnEspera(messages, estados).find((t) => t.accion === 'confirmar') ?? null
  const decision = (t: TarjetaDeAprobacion, etiqueta?: string) => (
    <EscribirleAlAgente.Provider key={t.propuesta} value={escribir}>
      <Tarjeta tarjeta={t} estado={estados[t.propuesta]} etiqueta={etiqueta} alTocar={alTocar} alCambiar={alCambiar} />
    </EscribirleAlAgente.Provider>
  )
  // La que espera va abajo de la conversación, como la decisión de este paso, aunque haya llegado en un turno anterior.
  const enLaConversacion = (t: TarjetaDeAprobacion) => (t.propuesta === espera?.propuesta ? null : decision(t))
  const cuantos = datos.lectura?.productos

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <motion.div className="cielo pointer-events-none absolute inset-x-0 top-0 h-[300px]" aria-hidden animate={saliendo ? { y: -300, opacity: 0 } : { y: 0, opacity: 1 }} transition={{ duration: SALE_EL_CIELO_MS / 1000, ease: ENTRA }} />
      <div className="relative flex-1 overflow-y-auto">
        <header className="mx-auto flex h-14 w-full max-w-[1180px] items-center justify-between px-5">
          <span className="font-heading text-[17px] font-semibold tracking-tight">Amanece</span>
          {salir}
        </header>
        <div className="mx-auto grid w-full max-w-[1180px] gap-x-10 px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex min-w-0 flex-col">
            <main className="flex flex-col gap-5 pt-4 pb-6 lg:pt-8">
              <div>
                <p className="font-heading text-lg text-foreground/75">Tu agente</p>
                <div className="relative mt-1 min-h-[1.05em] font-heading text-[clamp(32px,4.4vw,50px)] leading-[1.04] font-semibold tracking-tight text-balance">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.h1 key={titularDe(paso, datos)} initial={{ opacity: 0, y: 8, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }} transition={{ duration: 0.22, ease: ENTRA }}>
                      {titularDe(paso, datos)}
                    </motion.h1>
                  </AnimatePresence>
                </div>
              </div>

              <Conversacion messages={messages} yaEstaban={yaEstaban} tarjeta={enLaConversacion} />
              {status === 'submitted' && (
                <span role="status" aria-label="Tu agente está escribiendo" className="py-1">
                  <Puntos />
                </span>
              )}
              {error && <p className="text-sm text-destructive">{devuelto?.aviso ?? 'Algo falló. Intenta de nuevo.'}</p>}

              {espera && <div className="shadow-alzada rounded-(--radius)">{decision(espera, cuantos ? `Lo que encontré · ${cuantos} productos` : undefined)}</div>}
              {paso === 'cobro' && <ComoTePagan ocupado={ocupado} alElegir={alEnviar} alPosponer={() => setPospusoElCobro(true)} />}
              {paso === 'listo' && datos.nombre && datos.link && <ListoParaAbrir nombre={datos.nombre} link={datos.link} ocupado={ocupado} alAbrir={alAbrir} alAbierto={() => setAbierto(true)} />}

              <motion.section layout="position" className="mt-1">
                <h2 className="mb-3 font-heading text-lg font-semibold">Lo que ya sé</h2>
                <ListaQueYaSe filas={datos.filas} />
              </motion.section>
            </main>
            <div className="sticky bottom-0 mt-auto bg-linear-to-t from-background from-70% to-transparent pt-5 pb-4">
              <Redactor ocupado={ocupado} alEnviar={alEnviar} alSubir={alSubir} borrador={borrador} devuelto={devuelto} />
            </div>
          </div>
          <aside className="pb-8 lg:sticky lg:top-4 lg:self-start lg:pt-8">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              Tu Panel
              {paso === 'listo' ? (
                <span className="text-xs font-normal text-muted-foreground">listo para abrir</span>
              ) : (
                <span className="inline-flex" aria-label="Armándose">
                  <Puntos />
                </span>
              )}
            </p>
            <div className="shadow-alzada overflow-hidden rounded-(--radius) border border-border">
              <AEscala ancho={640} alto={440}>
                <MiniPanel datos={datos} completo={paso === 'listo'} />
              </AEscala>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

/** La carta muestra el último turno: un paso a la vez. Lo de antes queda a un toque, porque el Dueño pudo haber dicho algo que quiera volver a leer. */
function Conversacion({ messages, yaEstaban, tarjeta }: { messages: UIMessage[]; yaEstaban: number; tarjeta: (t: TarjetaDeAprobacion) => ReactNode }) {
  const [verAntes, setVerAntes] = useState(false)
  const { antes, turno } = ultimoTurno(messages)
  const entra = (m: UIMessage) => messages.indexOf(m) >= yaEstaban
  // La línea de la plantilla queda antes del último turno, y el rastro se ve aunque lo anterior esté plegado.
  const plantillaPlegada = verAntes ? null : plantillaDelHilo(antes)
  if (!messages.length)
    return (
      <p className="text-(length:--texto-hilo) leading-normal text-pretty">
        Hola, soy tu agente. Trabajo para tu negocio todo el día. Si ya lo tienes publicado en una página o en Instagram, pégame el enlace y lo leo. Si no, cuéntame cómo se llama y qué vendes.
      </p>
    )
  return (
    <div className="flex flex-col gap-4">
      {antes.length > 0 && (
        <button type="button" onClick={() => setVerAntes((v) => !v)} className="flex w-fit items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 hover:underline">
          {verAntes ? 'Ocultar lo anterior' : 'Ver lo anterior'}
          <CaretDown className={cn('size-3 transition-transform duration-200 motion-reduce:transition-none', verAntes && 'rotate-180')} />
        </button>
      )}
      {plantillaPlegada && <RastroDePlantilla id={plantillaPlegada} />}
      {verAntes && antes.map((m) => <MensajeDelHilo key={m.id} m={m} entra={false} tarjeta={tarjeta} />)}
      {turno.map((m) => (
        <MensajeDelHilo key={m.id} m={m} entra={entra(m)} tarjeta={tarjeta} />
      ))}
    </div>
  )
}

function ComoTePagan({ ocupado, alElegir, alPosponer }: { ocupado: boolean; alElegir: (mensaje: string) => void; alPosponer: () => void }) {
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (ocupado || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      const forma = FORMAS_DE_COBRO[Number(e.key) - 1]
      if (forma) alElegir(forma.mensaje)
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [ocupado, alElegir])

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: ENTRA }}>
      <div className="shadow-alzada rounded-(--radius) border border-border bg-card p-4 text-card-foreground">
        <p className="mb-2 text-xs font-medium text-muted-foreground">¿Cómo te pagan tus clientes?</p>
        <div className="-mx-1 flex flex-col">
          {FORMAS_DE_COBRO.map(({ opcion, mensaje }, i) => (
            <button key={opcion} type="button" disabled={ocupado} onClick={() => alElegir(mensaje)} className="flex items-center gap-3 rounded-[calc(var(--radius)-4px)] px-2 py-2.5 text-left text-sm transition-colors duration-150 not-disabled:hover:bg-muted disabled:opacity-60">
              <kbd className="flex size-5 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground">{i + 1}</kbd>
              {opcion}
              <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={alPosponer} className="mt-2 px-1 text-[13px] text-muted-foreground underline-offset-4 hover:underline">
        Te lo digo después
      </button>
    </motion.div>
  )
}

function ListoParaAbrir({ nombre, link, ocupado, alAbrir, alAbierto }: { nombre: string; link: string; ocupado: boolean; alAbrir: () => Promise<RespuestaDeAbrir | { error: string }>; alAbierto: () => void }) {
  const [abriendo, setAbriendo] = useState(false)
  const [problema, setProblema] = useState<string | null>(null)
  async function abrir() {
    setAbriendo(true)
    setProblema(null)
    const r = await alAbrir()
    setAbriendo(false)
    if ('error' in r) setProblema(r.error)
    else if (r.abierto) alAbierto()
    else setProblema(`Todavía me falta ${r.falta.join(' y ')}.`)
  }
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: ENTRA }} className="shadow-alzada flex flex-col gap-4 rounded-(--radius) border border-border bg-card p-5 text-card-foreground">
      <p className="text-pretty">Ya sé lo necesario para atender a tus clientes. Cuando abras, este va a ser tu link para compartir:</p>
      <p className="rounded-[calc(var(--radius)-4px)] bg-muted px-3 py-2 font-mono text-[13px] break-all">{decodeURIComponent(link.replace(/^https:\/\//, ''))}</p>
      {problema && <p className="text-sm text-destructive">{problema}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" disabled={abriendo || ocupado} onClick={abrir} className="h-auto min-h-9 max-w-full py-2 whitespace-normal">
          Abrir {nombre}
        </Button>
      </div>
    </motion.div>
  )
}

function ListaQueYaSe({ filas }: { filas: readonly FilaQueYaSe[] }) {
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {filas.map((f) => (
        <li key={f.dato} className="flex items-center gap-2.5">
          {f.estado === 'sabido' ? (
            <motion.span key="sabido" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.35 }} className="shrink-0">
              <CheckCircle weight="fill" role="img" aria-label="Lo sé" className="size-4 text-bien" />
            </motion.span>
          ) : (
            <Circle role="img" aria-label={f.estado === 'falta' ? 'Falta' : 'Por confirmar'} className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="w-24 shrink-0 text-muted-foreground">{f.dato}</span>
          <span title={f.valor ?? undefined} className={cn('min-w-0 truncate', f.estado !== 'sabido' && 'text-muted-foreground')}>
            {f.valor ?? 'Falta confirmarlo'}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function AEscala({ ancho, alto, children }: { ancho: number; alto: number; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(0.4)
  useLayoutEffect(() => {
    const el = caja.current!
    const medir = () => setEscala(el.clientWidth / ancho)
    medir()
    const o = new ResizeObserver(medir)
    o.observe(el)
    return () => o.disconnect()
  }, [ancho])
  return (
    <div ref={caja} className="relative w-full overflow-hidden" style={{ aspectRatio: `${ancho} / ${alto}` }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: ancho, height: alto, transform: `scale(${escala})` }}>
        {children}
      </div>
    </div>
  )
}

// Un Negocio armándose no atiende a nadie: `recibirMensaje` le responde con un aviso, así que sus cifras son cero de verdad.
const INDICADORES_EN_CEROS = [
  { dato: 'Ventas de la semana', valor: '$0' },
  { dato: 'Por confirmar', valor: '0' },
  { dato: 'Conversaciones', valor: '0' },
] as const
const DIAS_DE_LA_SEMANA = 7
const FILAS_EN_GRIS = 3

const TONO_DEL_PRODUCTO: Record<ProductoEnElPanel['estado'], string> = { Listo: 'bg-bien-suave text-bien', 'Por confirmar': 'bg-ojo-suave text-ojo' }

/** Un dibujo del Panel: gris hasta que hay productos, y las Secciones van apareciendo con lo que el agente sabe. */
function MiniPanel({ datos, completo }: { datos: DelMiniPanel; completo: boolean }) {
  const nombre = datos.nombre ?? 'Tu negocio'
  const sabidas = datos.filas.filter((f) => f.estado === 'sabido').length
  const todas = seccionesDe('tienda')
  const secciones = completo ? todas : todas.slice(0, 1 + sabidas)
  const conDatos = datos.productos.length > 0
  return (
    <div className="flex h-full w-full bg-card text-[15px] text-card-foreground" aria-hidden>
      <div className="flex w-[170px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-[13px] font-semibold text-primary-foreground">{nombre[0]}</span>
          <span className="truncate text-[13px] font-medium">{nombre}</span>
        </div>
        <AnimatePresence initial={false}>
          {secciones.map((s, i) => (
            <motion.div key={s.ruta} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, ease: ENTRA }} className={cn('truncate rounded-md px-2.5 py-1.5 text-[13px]', i === 0 ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground')}>
              {s.nombre}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-3 gap-2.5">
          {INDICADORES_EN_CEROS.map((d) => (
            <div key={d.dato} className="rounded-xl border border-border p-2.5">
              <div className="truncate text-[11px] text-muted-foreground">{d.dato}</div>
              {conDatos ? <div className="mt-0.5 font-heading text-[26px] leading-tight font-semibold tabular-nums tracking-tight">{d.valor}</div> : <div className="mt-2 h-5 w-10 rounded bg-muted" />}
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 text-[11px] text-muted-foreground">Pedidos por día</div>
          <div className="flex h-[52px] items-end gap-1.5">
            {Array.from({ length: DIAS_DE_LA_SEMANA }, (_, i) => (
              <div key={i} className={cn('h-[5%] flex-1 rounded-t-[3px]', conDatos ? 'bg-primary' : 'bg-muted')} />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
          {conDatos
            ? datos.productos.map((p, i) => (
                <div key={p.nombre} className={cn('flex items-center gap-2 px-3 py-2', i > 0 && 'border-t border-border')}>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    <span className="font-medium">{p.nombre}</span> <span className="text-muted-foreground">· {p.precio}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', TONO_DEL_PRODUCTO[p.estado])}>{p.estado}</span>
                </div>
              ))
            : Array.from({ length: FILAS_EN_GRIS }, (_, i) => (
                <div key={i} className={cn('flex items-center gap-2 px-3 py-2', i > 0 && 'border-t border-border')}>
                  <div className="h-3.5 flex-1 rounded bg-muted" style={{ maxWidth: `${70 - i * 12}%` }} />
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}

type DelMiniPanel = Pick<DatosDelArmado, 'nombre' | 'filas' | 'productos'>
