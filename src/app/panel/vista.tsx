import Link from 'next/link'
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import type { LoPendiente } from '@/nucleo/cambios'
import type { SeccionPintada } from '@/nucleo/panel'
import { Fallo, Indicador, Seccion } from './pieza'
import { BotonPublicar } from './publicar'

/** Todo lo que el Panel de un Negocio necesita para pintarse. Quien lo arma lee; quien lo pinta no toca datos. */
export type DatosDelNegocio = {
  nombre: string
  detalle: string
  /** El link de WhatsApp del Negocio cuando está listo; `null` es Armándose. */
  link: string | null
  pendiente: LoPendiente
  indicadores: SeccionPintada[]
  secciones: SeccionPintada[]
  casos: { id: string; titulo: string; propuesta: string | null }[]
  reglas: { clave: string; texto: string }[]
}

export function MarcoDelPanel({ nombreDelNegocio, equipo, hilo, children }: { nombreDelNegocio: string | null; equipo: boolean; hilo: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-col px-4 py-4 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="font-heading text-lg font-semibold tracking-tight">
          <span className="text-primary">●</span> Amanece
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {nombreDelNegocio && <span className="hidden sm:inline">{nombreDelNegocio}</span>}
          {equipo && (
            <Link href="/medicion" className="hover:text-foreground">
              Medición
            </Link>
          )}
        </div>
      </header>

      <div className="mt-4 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="flex min-h-[60vh] flex-col rounded-lg border border-border bg-background p-4 lg:min-h-0">
          <h2 className="mb-3 font-heading text-sm font-medium text-muted-foreground">Tu agente</h2>
          {hilo}
        </section>

        <section className="min-h-0 overflow-y-auto pb-8">{children}</section>
      </div>
    </main>
  )
}

export function SinNegocio() {
  return <p className="text-muted-foreground">Cuando le cuentes a tu agente de tu negocio, aquí lo vas a ver tomar forma.</p>
}

export function VistaDelNegocio({ datos }: { datos: DatosDelNegocio }) {
  const { nombre, detalle, link, pendiente, indicadores, secciones, casos, reglas } = datos
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold">{nombre}</h1>
            <p className="text-sm text-muted-foreground">{detalle}</p>
          </div>
          {link ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs ${pendiente.items.length ? 'bg-ojo-suave text-ojo' : 'border border-border text-bien'}`}>{pendiente.items.length ? 'Vista previa' : 'Atendiendo'}</span>
              <BotonPublicar pendiente={pendiente} />
              <a href={link} target="_blank" className={buttonVariants({ variant: pendiente.items.length ? 'outline' : 'default' })}>
                Escríbele por WhatsApp
              </a>
            </div>
          ) : (
            <span className="rounded-full bg-ojo-suave px-3 py-1 text-xs text-ojo">Armándose</span>
          )}
        </div>
        {link && (
          <p className="mt-3 text-xs text-muted-foreground">
            Comparte este link con tus clientes: <span className="break-all font-mono">{link}</span>
          </p>
        )}
      </div>

      {indicadores.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {indicadores.map((p) => (p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo key={p.clave} nombre={p.nombre} /> : <Indicador key={p.clave} p={p} />))}
        </div>
      )}

      {casos.length > 0 && (
        <div className="rounded-lg border border-ojo/40 bg-ojo-suave p-4">
          <p className="font-heading font-medium">Casos para ti</p>
          <ul className="mt-2 space-y-2 text-sm">
            {casos.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.titulo}</span>
                {c.propuesta && <span className="text-foreground/75"> · {c.propuesta}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {secciones.map((p) => (p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo key={p.clave} nombre={p.nombre} /> : <Seccion key={p.clave} p={p} />))}

      {reglas.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-heading font-medium">Reglas de tu agente de clientes</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {reglas.map((r) => (
              <li key={r.clave}>{r.texto}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
