'use client'

import { ArrowsClockwise, ArrowUp, X } from '@phosphor-icons/react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { buttonVariants, Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { IdDePlantilla } from '@/nucleo/plantillas'
import { guardarLoEscrito, olvidarLoEscrito, useLaPlantillaEscrita, useLoEscrito } from './lo-escrito'
import { TarjetaPlantilla } from './plantillas'
import { plantillasDe } from './plantillas-datos'
import { CambioDeIdioma } from './portada/cambio-de-idioma'
import { Cielo, nivelDelCielo, useAmanecer, type Rafaga } from './portada/cielo'
import { RUTA_DE_IDIOMA, TEXTOS, type Idioma } from './portada/textos'

const ENTRA = [0.22, 1, 0.36, 1] as const
const DURA_LA_SALIDA_MS = 700

const conMenosMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Escribe los ejemplos dentro del marcador, uno tras otro, mientras la caja siga vacía. */
function useMaquina(pausa: boolean, ejemplos: readonly string[]) {
  const [escribiendo, setEscribiendo] = useState<{ texto: string; fraccion: number } | null>(null)
  useEffect(() => {
    if (pausa || conMenosMovimiento()) return
    let i = 0
    let c = 0
    let borrando = false
    let id = 0
    const mostrar = (f: string, n: number) => setEscribiendo({ texto: f.slice(0, n), fraccion: n / f.length })
    const paso = () => {
      const f = ejemplos[i]
      if (!borrando) {
        c++
        mostrar(f, c)
        if (c === f.length) {
          borrando = true
          id = window.setTimeout(paso, 1800)
          return
        }
        id = window.setTimeout(paso, 34)
      } else {
        c -= 2
        mostrar(f, Math.max(0, c))
        if (c <= 0) {
          borrando = false
          c = 0
          i = (i + 1) % ejemplos.length
          id = window.setTimeout(paso, 260)
          return
        }
        id = window.setTimeout(paso, 16)
      }
    }
    id = window.setTimeout(paso, 500)
    return () => clearTimeout(id)
  }, [pausa, ejemplos])
  return pausa ? null : escribiendo
}

type PropsDeCaja = {
  idioma: Idioma
  texto: string
  marcador: string
  plantilla: IdDePlantilla | null
  boton: RefObject<HTMLButtonElement | null>
  alCambiar: (t: string) => void
  alEmpezar: () => void
  alQuitarPlantilla: () => void
}

function Caja({ idioma, texto, marcador, plantilla, boton, alCambiar, alEmpezar, alQuitarPlantilla }: PropsDeCaja) {
  const t = TEXTOS[idioma].alba
  const nombreDe = (id: IdDePlantilla) => plantillasDe(idioma).find((p) => p.id === id)?.nombre
  const raiz = useRef<HTMLFormElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!plantilla) return
    raiz.current?.scrollIntoView({ behavior: conMenosMovimiento() ? 'auto' : 'smooth', block: 'center' })
    area.current?.focus({ preventScroll: true })
  }, [plantilla])
  return (
    <form
      ref={raiz}
      onSubmit={(e) => {
        e.preventDefault()
        alEmpezar()
      }}
      className="mt-7 w-full rounded-[calc(var(--radius)+4px)] border border-border bg-card p-3 text-left text-foreground shadow-alzada transition-[border-color] duration-150 focus-within:border-ring"
    >
      <AnimatePresence initial={false}>
        {plantilla && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: ENTRA }} className="overflow-hidden">
            <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted py-1 pr-1 pl-2.5 text-[13px]">
              <ArrowsClockwise className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {t.parteDe} {nombreDe(plantilla)}
              </span>
              <button type="button" aria-label={t.quitarPlantilla} onClick={alQuitarPlantilla} className="flex size-5 items-center justify-center rounded-md hover:bg-background">
                <X className="size-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <textarea
        ref={area}
        rows={2}
        value={texto}
        onChange={(e) => alCambiar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            alEmpezar()
          }
        }}
        placeholder={marcador}
        aria-label={t.marcador}
        className="w-full resize-none bg-transparent px-1.5 py-1 text-base outline-none placeholder:text-muted-foreground max-sm:min-h-21"
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground max-sm:hidden">{t.siTienesPagina}</span>
        <Button ref={boton} type="submit" size="icon" aria-label={t.empezar} disabled={!texto.trim()} className="size-8 rounded-full not-disabled:bg-(image:--sol) not-disabled:text-(--sol-foreground)">
          <ArrowUp weight="bold" className="size-4" />
        </Button>
      </div>
    </form>
  )
}

const Hoja = memo(function Hoja({ idioma, plantilla, alRemixear }: { idioma: Idioma; plantilla: IdDePlantilla | null; alRemixear: (id: IdDePlantilla | null) => void }) {
  const t = TEXTOS[idioma].alba
  return (
    <section className="relative z-10 -mt-[92px] rounded-t-[22px] bg-background pt-5 text-foreground shadow-[0_-10px_30px_-18px_rgb(30_30_60/.2)]">
      <div className="mx-auto w-full max-w-[1120px] px-5 pb-12">
        <Tabs defaultValue="plantillas">
          <TabsList>
            <TabsTrigger value="plantillas">{t.plantillas}</TabsTrigger>
            <TabsTrigger value="puede">{t.loQuePuede}</TabsTrigger>
          </TabsList>
          <TabsContent value="plantillas" className="mt-4">
            <div data-carrusel className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
              {plantillasDe(idioma).map((p) => (
                <div key={p.id} className="flex w-[82%] shrink-0 snap-start sm:w-auto">
                  <TarjetaPlantilla p={p} idioma={idioma} elegida={plantilla === p.id} alRemixear={alRemixear} />
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="puede" className="mt-4">
            <ul className="flex max-w-3xl flex-col">
              {t.filasDeLoQuePuede.map((x, i) => (
                <motion.li key={x.que} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay: 0.1 + i * 0.05, ease: ENTRA }} className="grid gap-x-4 gap-y-0.5 border-t border-border/70 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-baseline">
                  <span className="text-[14.5px] font-medium text-pretty">{x.que}</span>
                  <span className="text-[13.5px] text-pretty text-muted-foreground">{x.ejemplo}</span>
                </motion.li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
        <p className="mt-3 text-xs text-muted-foreground">{t.nota}</p>
      </div>
    </section>
  )
})

/**
 * Nada de aquí habla con el servidor, así que un visitante sin cuenta no gasta modelo. Seguir pasa por `/panel`: la
 * puerta de sesión decide si pide la cuenta, y lo escrito espera en el navegador. `alSeguir` existe para la vitrina.
 */
export function Alba({ alSeguir, idioma = 'es' }: { alSeguir?: () => void; idioma?: Idioma }) {
  const textos = TEXTOS[idioma]
  const t = textos.alba
  const router = useRouter()
  const guardado = useLoEscrito()
  const [escrito, setEscrito] = useState<string | null>(null)
  const texto = escrito ?? guardado ?? ''
  const plantillaGuardada = useLaPlantillaEscrita()
  // `undefined`: el Dueño no ha tocado nada aquí, y vale lo que venía guardado de antes de pedir la cuenta.
  const [elegida, setElegida] = useState<IdDePlantilla | null>()
  const plantilla = elegida === undefined ? plantillaGuardada : elegida
  const cielo = useRef<HTMLDivElement>(null)
  const cieloEnVista = useInView(cielo)
  const maquina = useMaquina(!!texto || !cieloEnVista, t.ejemplos)
  const [rafaga, setRafaga] = useState<Rafaga | null>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const salida = useRef(0)
  useEffect(() => () => clearTimeout(salida.current), [])

  const loDeAhora = useRef({ texto, plantilla })
  useEffect(() => {
    loDeAhora.current = { texto, plantilla }
  })
  useEffect(
    () => () => {
      if (loDeAhora.current.texto.trim()) guardarLoEscrito(loDeAhora.current.texto, loDeAhora.current.plantilla)
    },
    [],
  )

  useEffect(() => {
    document.documentElement.lang = idioma
    return () => {
      document.documentElement.lang = 'es'
    }
  }, [idioma])

  const nivel = nivelDelCielo({ largo: texto.trim().length, conPlantilla: !!plantilla, maquina: maquina?.fraccion ?? 0, saliendo: !!rafaga })
  const volvioConAlgo = escrito === null && elegida === undefined && !!(guardado || plantillaGuardada)
  const progreso = useAmanecer(nivel, volvioConAlgo)

  const empezar = () => {
    if (!texto.trim() || rafaga) return
    guardarLoEscrito(texto, plantilla)
    const seguir = alSeguir ?? (() => router.push('/panel'))
    if (conMenosMovimiento()) return seguir()
    const b = boton.current!.getBoundingClientRect()
    const c = boton.current!.closest('[data-cielo]')!.getBoundingClientRect()
    setRafaga({ x: b.left + b.width / 2 - c.left, y: b.top + b.height / 2 - c.top })
    salida.current = window.setTimeout(seguir, DURA_LA_SALIDA_MS)
  }

  return (
    <div className="relative flex-1">
      <div ref={cielo}>
        <Cielo progreso={progreso} rafaga={rafaga}>
          <header className="mx-auto flex h-14 w-full max-w-[1180px] items-center justify-between gap-3 px-5">
            <Link href={RUTA_DE_IDIOMA[idioma]} className="flex items-center gap-[7px] font-heading text-[17px] font-semibold tracking-tight">
              <i aria-hidden className="size-[9px] rounded-full bg-current" />
              Amanece
            </Link>
            <div className="flex items-center gap-1.5">
              <CambioDeIdioma idioma={idioma} />
              <Link href="/panel" prefetch={false} className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-inherit' })}>
                {textos.entrar}
              </Link>
            </div>
          </header>
          <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-5 pt-[7vh] pb-6 text-center sm:pt-[10vh]">
            <h1 className="font-heading text-[clamp(34px,5.6vw,58px)] leading-[1.04] font-semibold tracking-tight text-balance">{t.titulo}</h1>
            <p className="mt-3 max-w-[46ch] text-[17px] leading-normal text-pretty">{t.subtitulo}</p>
            <Caja
              idioma={idioma}
              texto={texto}
              marcador={maquina?.texto ?? t.marcador}
              plantilla={plantilla}
              boton={boton}
              alCambiar={(x) => {
                setEscrito(x)
                setElegida(plantilla)
                if (!x.trim()) olvidarLoEscrito()
              }}
              alEmpezar={empezar}
              alQuitarPlantilla={() => setElegida(null)}
            />
          </div>
        </Cielo>
      </div>
      <Hoja idioma={idioma} plantilla={plantilla} alRemixear={setElegida} />
    </div>
  )
}
