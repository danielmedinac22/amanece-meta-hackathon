'use client'

import { ArrowSquareOut, CheckCircle, CircleNotch, Copy, Rocket } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { LoPendiente } from '@/nucleo/cambios'
import { pedirPublicar, type Publicador } from './tocar-publicar'

const QUIEN_LO_NOTA = { clientes: 'Lo notan tus Clientes', equipo: 'Solo lo ven tú y tu equipo' } as const
const ETIQUETA_DEL_LINK = 'Tus Clientes te escriben aquí'

function FilaDelLink({ link }: { link: string }) {
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    if (!copiado) return
    const quitar = setTimeout(() => setCopiado(false), 1500)
    return () => clearTimeout(quitar)
  }, [copiado])
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{ETIQUETA_DEL_LINK}</p>
      <div className="flex items-center gap-1 rounded-lg border border-border p-1 pl-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{decodeURI(link).replace(/^https:\/\//, '')}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 max-lg:size-9"
          aria-label={copiado ? 'Copiado' : `Copiar ${ETIQUETA_DEL_LINK}`}
          onClick={() => {
            navigator.clipboard
              ?.writeText(link)
              .then(() => setCopiado(true))
              .catch(() => {})
          }}
        >
          {copiado ? <CheckCircle weight="fill" className="size-3.5 text-bien" /> : <Copy className="size-3.5" />}
        </Button>
        <a href={link} target="_blank" rel="noreferrer" aria-label={`Abrir ${ETIQUETA_DEL_LINK}`} className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-7 max-lg:size-9' })}>
          <ArrowSquareOut className="size-3.5" />
        </a>
      </div>
    </div>
  )
}

function TextoDelBoton({ publicando, cuantos }: { publicando: boolean; cuantos: number }) {
  const estado = publicando ? 'publicando' : cuantos ? 'pendiente' : 'publicado'
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={estado} className="inline-flex items-center gap-1.5" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
        {estado === 'publicando' ? (
          <>
            <CircleNotch className="size-3.5 animate-spin motion-reduce:animate-none" /> Publicando
          </>
        ) : estado === 'pendiente' ? (
          <>
            <Rocket weight="fill" className="size-3.5" /> Publicar
            <motion.span key={cuantos} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.35 }} className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-foreground/20 px-1 text-[10px] tabular-nums">
              {cuantos}
            </motion.span>
          </>
        ) : (
          <>
            <span aria-hidden className="size-1.5 rounded-full bg-bien" /> Publicado
          </>
        )}
      </motion.span>
    </AnimatePresence>
  )
}

/** Lo aplicado queda en la vista previa hasta que el Dueño lo manda a su link. El botón mantiene `Publicando` hasta que llega la lista nueva. */
export function BotonPublicar({ pendiente, link, publicador = pedirPublicar }: { pendiente: LoPendiente; link: string; publicador?: Publicador }) {
  const router = useRouter()
  const [enCurso, setEnCurso] = useState(false)
  const [refrescando, refrescar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [alguienAplico, setAlguienAplico] = useState(false)
  const [recien, setRecien] = useState(false)
  const cuantos = pendiente.items.length
  const publicando = enCurso || refrescando
  const primeroLosClientes = [...pendiente.items].sort((a, b) => Number(a.loNotan === 'equipo') - Number(b.loNotan === 'equipo'))

  async function publicar() {
    setEnCurso(true)
    setError(null)
    const r = await publicador(pendiente.huella)
    setEnCurso(false)
    if (r.tipo === 'error') return setError(r.mensaje)
    setAlguienAplico(r.tipo === 'cambio')
    setRecien(r.tipo === 'publicado')
    if (r.tipo === 'no_existe') setError('No pude publicar. Intenta de nuevo.')
    refrescar(() => router.refresh())
  }

  return (
    <Popover onOpenChange={(abierto) => !abierto && setRecien(false)}>
      <PopoverTrigger render={<Button size="sm" variant={cuantos ? 'default' : 'outline'} />}>
        <TextoDelBoton publicando={publicando} cuantos={cuantos} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))] gap-3 p-3">
        <FilaDelLink link={link} />
        {cuantos ? (
          <>
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium">Sin publicar</p>
              {alguienAplico && <p className="mt-2 rounded-md bg-ojo-suave px-2 py-1 text-ojo">Alguien aplicó algo más. Revísalo y vuelve a tocar Publicar.</p>}
              <ul className="mt-2 flex max-h-[min(40dvh,18rem)] flex-col gap-2 overflow-y-auto">
                {primeroLosClientes.map((i) => (
                  <li key={i.clave} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ojo" />
                    <span className="min-w-0 wrap-anywhere">
                      <span className="block whitespace-pre-wrap">{i.linea}</span>
                      <span className="block text-xs text-muted-foreground">
                        {QUIEN_LO_NOTA[i.loNotan]}
                        {i.aplicadoPor ? ` · Aplicada por ${i.aplicadoPor}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button className="w-full" disabled={publicando} onClick={publicar}>
              {publicando ? (
                <>
                  <CircleNotch className="size-3.5 animate-spin motion-reduce:animate-none" /> Publicando
                </>
              ) : (
                'Publicar'
              )}
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-1.5 border-t border-border pt-3 text-[13px] text-muted-foreground">
            <motion.span initial={recien ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.35 }} className="inline-flex shrink-0">
              <CheckCircle weight="fill" className="size-3.5 text-bien" />
            </motion.span>
            {recien ? 'Publicado hace un momento. Todo está en tu link.' : 'Todo está en tu link. No hay nada sin publicar.'}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
