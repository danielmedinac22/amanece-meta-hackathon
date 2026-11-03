'use client'

import { ArrowCounterClockwise, CaretDown, CheckCircle, Eye, Warning } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Elemento } from '@/nucleo/estado/elementos'
import type { AccionDeTarjeta, RespuestaDeTarjeta, TocarTarjeta } from './tocar-tarjeta'

const ACCIONES = {
  aplicar: { verbo: 'Aplicar', hecha: 'Aplicada', llega: 'Lo notan tus Clientes' },
  enviar: { verbo: 'Enviar', hecha: 'Enviada', llega: 'Sale por WhatsApp a tu Cliente' },
  confirmar: { verbo: 'Están bien y no falta ninguno', hecha: 'Confirmada', llega: 'Lo notan tus Clientes' },
  deshacer: { verbo: 'Deshacer', hecha: 'Deshecha', llega: 'Solo lo ven tú y tu equipo' },
  revertir: { verbo: 'Revertir', hecha: 'Revertida', llega: 'Lo notan tus Clientes' },
} as const satisfies Record<TarjetaDeAprobacion['accion'], { verbo: string; hecha: string; llega: string }>

const ETIQUETAS: Partial<Record<Elemento['tipo'], { abierta: string; constancia: string }>> = {
  regla: { abierta: 'Vista previa · regla nueva', constancia: 'Nueva regla' },
  pregunta: { abierta: 'Vista previa · conocimiento nuevo', constancia: 'Nuevo conocimiento' },
  indicador: { abierta: 'En tu vista previa · nuevo Indicador', constancia: 'Nuevo Indicador' },
  seccion: { abierta: 'En tu vista previa · nueva Sección', constancia: 'Nueva Sección' },
}

const VENCIO = 'Venció sin aplicarse. Pídela de nuevo si todavía la quieres.'
const ENTRA = [0.22, 1, 0.36, 1] as const

export function etiquetaDe(tarjeta: TarjetaDeAprobacion, estado: EstadoDeTarjeta | undefined, cual: 'abierta' | 'constancia' = 'abierta'): string {
  const asunto = estado?.asunto
  if (asunto?.tipo === 'caso') return asunto.pedido ? `${asunto.titulo} · pedido #${asunto.pedido}` : asunto.titulo
  if (tarjeta.accion === 'confirmar') return 'Lo que leí de tu página'
  if (tarjeta.accion === 'enviar') return 'Un Caso'
  const etiquetas = asunto?.tipo === 'elemento' && asunto.que ? ETIQUETAS[asunto.que] : undefined
  return etiquetas?.[cual] ?? 'Un cambio en tu negocio'
}

type Desenlace = { readonly texto: string; readonly bien: boolean }

/** Lo que dice la tarjeta cuando ya no espera: primero lo que acaba de pasar con este clic, después lo guardado. */
function desenlaceDe(accion: TarjetaDeAprobacion['accion'], estado: EstadoDeTarjeta | undefined, r: RespuestaDeTarjeta | null): Desenlace {
  const { hecha } = ACCIONES[accion]
  const cliente = estado?.asunto?.tipo === 'caso' ? estado.asunto.cliente : null
  const por = estado?.aprobadaPor ? `${hecha} por ${estado.aprobadaPor}` : hecha
  const lograda = cliente ? `${hecha} a ${cliente}` : hecha
  const bien = (texto: string) => ({ texto, bien: true })
  const nada = (texto: string) => ({ texto, bien: false })
  switch (r?.tipo) {
    case 'deshecho':
      return bien(hecha)
    case 'aplicado':
      // Si el envío no salió como debía, el desenlace que armó el núcleo lo dice.
      return r.envio && r.envio.tipo !== 'simulado' && r.envio.tipo !== 'enviado' ? nada(r.resumen) : bien(lograda)
    case 'ya_no_cabe':
    case 'conflicto':
      return nada(r.resumen)
    case 'vencido':
      return nada(VENCIO)
    case 'no_existe':
      return nada('Esta tarjeta ya no está disponible.')
    case 'descartada':
      return nada('Descartada')
  }
  switch (estado?.estado) {
    case 'aplicada':
      return bien(cliente ? lograda : por)
    case 'revertida':
      return accion === 'deshacer' ? bien(hecha) : nada(`${por}, y revertida después`)
    case 'descartada':
      return nada('Descartada')
    default:
      return nada(VENCIO)
  }
}

/** La forma de toda decisión: etiqueta, cuerpo y pie. Resuelta, el cuerpo se pliega en su sitio y queda la constancia. */
function Decision({ ancla, etiqueta, constancia, icono, posicion, cuerpo, acciones, hecho }: { ancla: string | undefined; etiqueta: string; constancia: string; icono: ReactNode; posicion: string | null; cuerpo: ReactNode; acciones: ReactNode; hecho: ReactNode }) {
  const [verDetalle, setVerDetalle] = useState(false)
  const quieto = useReducedMotion()
  const plegada = !!hecho && !verDetalle
  return (
    <div id={ancla} className="scroll-mt-12 overflow-hidden rounded-(--radius) border border-border bg-card text-card-foreground">
      <AnimatePresence initial={false}>
        {!plegada && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={quieto ? { duration: 0 } : { duration: 0.26, ease: ENTRA }}>
            <div className="flex items-center gap-2 px-4 pt-3.5 text-xs font-medium text-muted-foreground">
              {icono}
              <span className="min-w-0">{etiqueta}</span>
              {posicion && <span className="ml-auto shrink-0 tabular-nums">{posicion}</span>}
            </div>
            <div className="flex flex-col gap-3 px-4 py-3">{cuerpo}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={cn('flex flex-wrap items-center gap-2 px-4 py-3', !plegada && 'border-t border-border')}>
        {hecho ? (
          <>
            <div className="min-w-0 flex-1">
              {plegada && <p className="mb-0.5 truncate text-xs text-muted-foreground">{constancia}</p>}
              {hecho}
            </div>
            <Button variant="ghost" size="icon" className="size-7" aria-label={plegada ? 'Ver el detalle' : 'Plegar'} onClick={() => setVerDetalle((v) => !v)}>
              <CaretDown className={cn('size-3.5 transition-transform duration-200 motion-reduce:transition-none', !plegada && 'rotate-180')} />
            </Button>
          </>
        ) : (
          acciones
        )}
      </div>
    </div>
  )
}

function Hecho({ desenlace, recien }: { desenlace: Desenlace; recien: boolean }) {
  if (!desenlace.bien) return <p className="text-sm text-muted-foreground">{desenlace.texto}</p>
  return (
    <div className="flex items-center gap-2 text-sm">
      <motion.span initial={recien ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.35 }} className="inline-flex shrink-0">
        <CheckCircle weight="fill" className="size-4 text-bien" />
      </motion.span>
      <span className="min-w-0">{desenlace.texto}</span>
    </div>
  )
}

function Cuerpo({ tarjeta, estado }: { tarjeta: TarjetaDeAprobacion; estado: EstadoDeTarjeta | undefined }) {
  const asunto = estado?.asunto
  return (
    <>
      {tarjeta.advertencias?.map((a, i) => (
        <p key={`a${i}`} className="rounded-[calc(var(--radius)-4px)] bg-ojo-suave px-3 py-2 text-sm text-ojo">
          {a}
        </p>
      ))}
      {asunto?.tipo === 'caso' ? (
        <>
          {asunto.escribio && (
            <div>
              <p className="text-xs text-muted-foreground">{asunto.cliente ?? 'Tu Cliente'} escribió</p>
              <p className="mt-1 text-sm whitespace-pre-wrap">{asunto.escribio}</p>
            </div>
          )}
          <div className="rounded-[calc(var(--radius)-4px)] bg-muted px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Le voy a responder</p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{asunto.respuesta}</p>
          </div>
        </>
      ) : (
        tarjeta.lineas.map((l, i) => (
          <p key={i} className="text-sm whitespace-pre-wrap">
            {l}
          </p>
        ))
      )}
    </>
  )
}

/** Una propuesta en el Hilo o en Casos. Después de un clic muestra lo que respondió la ruta. `ancla` es solo del Hilo: la misma tarjeta puede estar en los dos a la vez. */
export function Tarjeta({ tarjeta, estado, posicion = null, ancla, etiqueta, alTocar, alCambiar }: { tarjeta: TarjetaDeAprobacion; estado: EstadoDeTarjeta | undefined; posicion?: string | null; ancla?: string; etiqueta?: string; alTocar: TocarTarjeta; alCambiar: () => void }) {
  const [enCurso, setEnCurso] = useState(false)
  const [respuesta, setRespuesta] = useState<RespuestaDeTarjeta | null>(null)

  // Recién llegada en el stream todavía no tiene estado: se deja tocar si no venció, y la ruta decide.
  const [vigente] = useState(() => Date.parse(tarjeta.vence) > Date.now())
  // Deshacer es de algo ya aplicado: no vence, y la apaga que ya esté revertido.
  const esDeshacer = tarjeta.accion === 'deshacer'
  const abierta = esDeshacer ? !estado || estado.estado === 'aplicada' : estado ? estado.estado === 'espera_al_dueno' : vigente
  // Un `conflicto` de Aplicar ya descartó la tarjeta y su texto pide proponerlo de nuevo: ahí tocar otra vez no sirve.
  const sirveTocarOtraVez = !respuesta || respuesta.tipo === 'error' || respuesta.tipo === 'ya_no_cabe' || (respuesta.tipo === 'conflicto' && esDeshacer)
  const esperando = sirveTocarOtraVez && abierta
  const { verbo, llega } = ACCIONES[tarjeta.accion]
  const cliente = estado?.asunto?.tipo === 'caso' ? estado.asunto.cliente : null

  async function tocar(accion: AccionDeTarjeta) {
    setEnCurso(true)
    setRespuesta(await alTocar(tarjeta, accion))
    setEnCurso(false)
    alCambiar()
  }

  return (
    <Decision
      ancla={ancla}
      etiqueta={etiqueta ?? etiquetaDe(tarjeta, estado)}
      constancia={etiquetaDe(tarjeta, estado, 'constancia')}
      icono={tarjeta.accion === 'enviar' ? <Warning weight="fill" className="size-3.5 shrink-0 text-ojo" /> : <Eye weight="fill" className="size-3.5 shrink-0" />}
      posicion={posicion}
      cuerpo={<Cuerpo tarjeta={tarjeta} estado={estado} />}
      acciones={
        <>
          {respuesta && (
            <p className="w-full text-xs text-destructive">{respuesta.tipo === 'error' ? respuesta.mensaje : 'resumen' in respuesta ? respuesta.resumen : null}</p>
          )}
          {esDeshacer ? (
            <Button variant="outline" disabled={enCurso} onClick={() => tocar('deshacer')}>
              <ArrowCounterClockwise className="size-3.5" /> {verbo}
            </Button>
          ) : (
            <>
              <Button disabled={enCurso} className="h-auto min-h-8 whitespace-normal" onClick={() => tocar('aprobar')}>
                {verbo}
              </Button>
              <Button variant="ghost" disabled={enCurso} onClick={() => tocar('descartar')}>
                Descartar
              </Button>
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{cliente ? `Sale por WhatsApp a ${cliente}` : llega}</span>
        </>
      }
      hecho={esperando ? null : <Hecho desenlace={desenlaceDe(tarjeta.accion, estado, respuesta)} recien={!!respuesta} />}
    />
  )
}
