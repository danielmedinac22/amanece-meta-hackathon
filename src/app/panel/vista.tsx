import { buttonVariants } from '@/components/ui/button'
import type { LoPendiente } from '@/nucleo/cambios'
import type { SeccionPintada } from '@/nucleo/panel'
import { Fallo, Indicador, Seccion } from './pieza'

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
            <h2 className="font-heading text-2xl font-semibold">{nombre}</h2>
            <p className="text-sm text-muted-foreground">{detalle}</p>
          </div>
          {link && (
            <a href={link} target="_blank" className={buttonVariants({ variant: pendiente.items.length ? 'outline' : 'default' })}>
              Escríbele por WhatsApp
            </a>
          )}
        </div>
        {link && (
          <p className="mt-3 text-xs text-muted-foreground">
            Comparte este link con tus clientes: <span className="break-all font-mono">{link}</span>
          </p>
        )}
      </div>

      {indicadores.length > 0 && <Indicadores indicadores={indicadores} />}

      {casos.length > 0 && <CasosParaTi casos={casos} />}

      {secciones.map((p) => (
        <VistaDeUnaSeccion key={p.clave} p={p} />
      ))}

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

function Indicadores({ indicadores }: { indicadores: SeccionPintada[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {indicadores.map((p) => (p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo key={p.clave} nombre={p.nombre} /> : <Indicador key={p.clave} p={p} />))}
    </div>
  )
}

function CasosParaTi({ casos }: { casos: DatosDelNegocio['casos'] }) {
  return (
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
  )
}

export function VistaDeCasos({ casos }: { casos: DatosDelNegocio['casos'] }) {
  return casos.length ? <CasosParaTi casos={casos} /> : <p className="text-muted-foreground">Nada espera tu decisión. Cuando algo la necesite, aparece aquí y tu agente te avisa.</p>
}

export function VistaDelTablero({ indicadores }: { indicadores: SeccionPintada[] }) {
  return indicadores.length ? <Indicadores indicadores={indicadores} /> : <p className="text-muted-foreground">Todavía no tienes indicadores. Pídele a tu agente el número que quieres mirar.</p>
}

export function VistaDeUnaSeccion({ p }: { p: SeccionPintada }) {
  return p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo nombre={p.nombre} /> : <Seccion p={p} />
}

/** Las Secciones cuyo ticket no está hecho: dicen que faltan en vez de pintar nada inventado. */
export function FaltaEstaSeccion({ que }: { que: string }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-2 text-center">
      <p className="font-heading text-xl font-semibold">Aquí van a estar {que}.</p>
      <p className="text-muted-foreground">Esta Sección todavía falta. Mientras tanto, pídele a tu agente lo que necesites ver.</p>
    </div>
  )
}
