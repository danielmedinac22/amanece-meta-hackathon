'use client'

import { ArrowUp } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { buttonVariants, Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { guardarLoEscrito, olvidarLoEscrito, useLoEscrito } from './lo-escrito'
import { TarjetaPlantilla } from './plantillas'
import { PLANTILLAS } from './plantillas-datos'

const ENTRA = [0.22, 1, 0.36, 1] as const

const EJEMPLOS = ['cafeladera.co', 'Vendo ropa por Instagram y cobro contra entrega', 'Envío paquetes a Europa y cotizo por kilo', 'Agendo citas en mi consultorio de Pereira']
const MARCADOR = 'Pega el link de tu negocio o cuéntame qué haces'

/** Solo lo que el producto hace hoy: cada fila tiene detrás una función que existe. Una promesa nueva entra aquí cuando la función exista. */
const LO_QUE_PUEDE = [
  { que: 'Le respondo a tus Clientes por WhatsApp', ejemplo: 'Sí, te llega a Pereira en 3 días.' },
  { que: 'Tomo pedidos y los confirmo', ejemplo: 'Tu pedido #41 quedó por $76.000. Pagas al recibir.' },
  { que: 'Te busco solo cuando algo necesita tu decisión', ejemplo: 'Una bolsa llegó rota. ¿Se la repongo?' },
  { que: 'Te agrego al Panel lo que quieras ver de tus datos', ejemplo: 'Muéstrame los pedidos confirmados por día.' },
]

/** Escribe los ejemplos dentro del marcador, uno tras otro, mientras la caja siga vacía. */
function useMaquina(pausa: boolean) {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    if (pausa || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let i = 0
    let c = 0
    let borrando = false
    let id = 0
    const paso = () => {
      const f = EJEMPLOS[i]
      if (!borrando) {
        c++
        setT(f.slice(0, c))
        if (c === f.length) {
          borrando = true
          id = window.setTimeout(paso, 1800)
          return
        }
        id = window.setTimeout(paso, 34)
      } else {
        c -= 2
        setT(f.slice(0, Math.max(0, c)))
        if (c <= 0) {
          borrando = false
          c = 0
          i = (i + 1) % EJEMPLOS.length
          id = window.setTimeout(paso, 260)
          return
        }
        id = window.setTimeout(paso, 16)
      }
    }
    id = window.setTimeout(paso, 500)
    return () => clearTimeout(id)
  }, [pausa])
  return pausa ? null : t
}

function Caja({ texto, alCambiar, alEmpezar }: { texto: string; alCambiar: (t: string) => void; alEmpezar: () => void }) {
  const marcador = useMaquina(!!texto) ?? MARCADOR
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        alEmpezar()
      }}
      className="mt-7 w-full rounded-[calc(var(--radius)+4px)] border border-border bg-card p-3 text-left shadow-alzada transition-[border-color] duration-150 focus-within:border-ring"
    >
      <textarea
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
        aria-label={MARCADOR}
        className="w-full resize-none bg-transparent px-1.5 py-1 text-base outline-none placeholder:text-muted-foreground max-sm:min-h-14"
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground max-sm:hidden">Si tienes página, la leo</span>
        <Button type="submit" size="icon" aria-label="Empezar" disabled={!texto.trim()} className="size-8 rounded-full not-disabled:bg-(image:--sol) not-disabled:text-(--sol-foreground)">
          <ArrowUp weight="bold" className="size-4" />
        </Button>
      </div>
    </form>
  )
}

/**
 * Nada de aquí habla con el servidor, así que un visitante sin cuenta no gasta modelo. Seguir pasa por `/panel`: la
 * puerta de sesión decide si pide la cuenta, y lo escrito espera en el navegador. `alSeguir` existe para la vitrina.
 */
export function Alba({ alSeguir }: { alSeguir?: () => void }) {
  const router = useRouter()
  const guardado = useLoEscrito()
  const [escrito, setEscrito] = useState<string | null>(null)
  const texto = escrito ?? guardado ?? ''

  const guardar = () => {
    if (texto.trim()) guardarLoEscrito(texto)
  }
  const empezar = () => {
    if (!texto.trim()) return
    guardar()
    if (alSeguir) alSeguir()
    else router.push('/panel')
  }

  return (
    <div className="relative flex-1">
      <div className="alba-llena pointer-events-none absolute inset-x-0 top-0 h-[780px] sm:h-[860px]" aria-hidden />
      <header className="relative mx-auto flex h-14 w-full max-w-[1180px] items-center justify-between px-5">
        <span className="font-heading text-[17px] font-semibold tracking-tight text-foreground">Amanece</span>
        <Link href="/panel" prefetch={false} onClick={guardar} className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-foreground' })}>
          Entrar
        </Link>
      </header>
      <main className="relative mx-auto flex w-full max-w-[720px] flex-col items-center px-5 pt-[9vh] pb-14 text-center sm:pt-[13vh]">
        <h1 className="font-heading text-[clamp(34px,5.6vw,58px)] leading-[1.04] font-semibold tracking-tight text-balance text-foreground">¿Qué hace tu negocio?</h1>
        <p className="mt-2 text-lg text-pretty text-foreground/75">Tu agente lo atiende por WhatsApp. Cuéntale y lo arma.</p>
        <Caja
          texto={texto}
          alCambiar={(t) => {
            setEscrito(t)
            if (!t.trim()) olvidarLoEscrito()
          }}
          alEmpezar={empezar}
        />
      </main>
      <section className="relative mx-auto w-full max-w-[1120px] px-3 pb-12 sm:px-6">
        <div className="rounded-[calc(var(--radius)+10px)] border border-border/70 bg-background p-5 shadow-[0_-20px_60px_-30px_rgb(30_30_60/.3)]">
          <Tabs defaultValue="plantillas">
            <TabsList>
              <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
              <TabsTrigger value="puede">Lo que puede hacer</TabsTrigger>
            </TabsList>
            <TabsContent value="plantillas" className="mt-4">
              <div data-carrusel className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
                {PLANTILLAS.map((p) => (
                  <div key={p.id} className="flex w-[82%] shrink-0 snap-start sm:w-auto">
                    <TarjetaPlantilla p={p} />
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="puede" className="mt-4">
              <ul className="flex max-w-3xl flex-col">
                {LO_QUE_PUEDE.map((x, i) => (
                  <motion.li key={x.que} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay: 0.1 + i * 0.05, ease: ENTRA }} className="grid gap-x-4 gap-y-0.5 border-t border-border/70 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-baseline">
                    <span className="text-[14.5px] font-medium text-pretty">{x.que}</span>
                    <span className="text-[13.5px] text-pretty text-muted-foreground">{x.ejemplo}</span>
                  </motion.li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </div>
  )
}
