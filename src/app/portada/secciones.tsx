import type { Icon } from '@phosphor-icons/react'
import { ArrowRight, CalendarBlank, CaretDown, Package, Truck, WhatsappLogo } from '@phosphor-icons/react/dist/ssr'
import qrcode from 'qrcode-generator'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import { CambioDeIdioma } from './cambio-de-idioma'
import type { IconoDeRubro, Idioma, TextosDePortada } from './textos'
import { WhatsappDeMuestra } from './whatsapp'

export const BLOQUE = 'mx-auto w-full max-w-[1120px] px-5 py-[clamp(52px,9vw,104px)]'
export const TITULO = 'font-heading text-[clamp(28px,4.6vw,46px)] leading-[1.08] font-semibold tracking-tight text-balance'
export const APOYO = 'mt-3 max-w-[58ch] text-[17px] text-pretty text-muted-foreground'
export const NOTA = 'text-xs text-muted-foreground'

const ICONOS: Record<IconoDeRubro, Icon> = { paquete: Package, camion: Truck, agenda: CalendarBlank }

export function Rubros({ t, enLinea }: { t: TextosDePortada['rubros']; enLinea: string }) {
  return (
    <section className={BLOQUE}>
      <h2 className={TITULO}>{t.titulo}</h2>
      <p className={APOYO}>{t.subtitulo}</p>
      <div className="mt-8 grid gap-3.5 md:grid-cols-3">
        {t.tarjetas.map((r) => {
          const Icono = ICONOS[r.icono]
          return (
            <article key={r.titulo} className="flex flex-col gap-2.5 rounded-(--radius) border border-border bg-card p-4 text-card-foreground">
              <h3 className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
                <Icono className="size-5 shrink-0 text-muted-foreground" />
                {r.titulo}
              </h3>
              <p className="text-sm text-pretty text-muted-foreground">{r.descripcion}</p>
              <WhatsappDeMuestra negocio={r.negocio} enLinea={enLinea} mensajes={r.mensajes} className="mt-auto rounded-[11px]" />
            </article>
          )
        })}
      </div>
      <p className={`${NOTA} mt-3`}>{t.nota}</p>
    </section>
  )
}

function CodigoQr({ enlace, alt }: { enlace: string; alt: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(enlace)
  qr.make()
  const lado = qr.getModuleCount()
  let trazo = ''
  for (let fila = 0; fila < lado; fila++) for (let col = 0; col < lado; col++) if (qr.isDark(fila, col)) trazo += `M${col} ${fila}h1v1h-1z`
  return (
    <div className="qr-de-portada size-[170px] shrink-0 rounded-[14px] p-[11px] ring-1 ring-border">
      <svg role="img" aria-label={alt} viewBox={`0 0 ${lado} ${lado}`} className="block size-full" shapeRendering="crispEdges">
        <path d={trazo} fill="currentColor" />
      </svg>
    </div>
  )
}

export function CafeLadera({ t }: { t: TextosDePortada['qr'] }) {
  const enlace = linkDeWhatsapp('Café Ladera', 'LADERA')
  return (
    <section className={`${BLOQUE} grid items-center gap-[30px] md:grid-cols-[auto_minmax(0,1fr)]`}>
      <CodigoQr enlace={enlace} alt={t.alt} />
      <div>
        <h2 className={TITULO}>{t.titulo}</h2>
        <p className={APOYO}>{t.descripcion}</p>
        <p className="mt-3 max-w-[58ch] text-sm text-pretty text-muted-foreground">{t.aviso}</p>
        <a href={enlace} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'mt-3.5' })}>
          <WhatsappLogo className="size-4" />
          {t.boton}
        </a>
      </div>
    </section>
  )
}

export function Preguntas({ t }: { t: TextosDePortada['preguntas'] }) {
  return (
    <section className={`${BLOQUE} grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-11`}>
      <h2 className={TITULO}>{t.titulo}</h2>
      <div>
        {t.lista.map((p, i) => (
          <details key={p.pregunta} open={i === 0} className="group border-b border-border py-[13px]">
            <summary className="flex cursor-pointer list-none justify-between gap-2.5 font-semibold [&::-webkit-details-marker]:hidden">
              {p.pregunta}
              <CaretDown className="mt-[3px] size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-[7px] text-pretty text-muted-foreground">{p.respuesta}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

export function Cierre({ t, cta }: { t: TextosDePortada['cierre']; cta: string }) {
  return (
    <section className="mx-auto w-full max-w-[1120px] px-5 py-[clamp(56px,10vw,120px)]">
      <h2 className="max-w-[17ch] font-heading text-[clamp(34px,6.4vw,68px)] leading-[1.02] font-semibold tracking-tight text-balance">{t.titulo}</h2>
      <Link href="/entrar?modo=registro" className={buttonVariants({ size: 'lg', className: 'mt-[26px]' })}>
        {cta}
        <ArrowRight className="size-4" />
      </Link>
    </section>
  )
}

export function Pie({ t, idioma }: { t: TextosDePortada['pie']; idioma: Idioma }) {
  return (
    <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-2.5 px-5 pt-[18px] pb-[30px] text-[12.5px] text-muted-foreground">
      <span>{t.texto}</span>
      <span className="flex items-center gap-3">
        <Link href="/privacidad" className="underline underline-offset-2">
          {t.privacidad}
        </Link>
        <CambioDeIdioma idioma={idioma} />
      </span>
    </footer>
  )
}
