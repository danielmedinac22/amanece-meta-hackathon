import type { SeccionPintada } from '@/nucleo/panel'
import { Fallo, Indicador, Seccion } from './pieza'

/** Lo que Inicio pinta mientras el Negocio se arma. Quien lo arma lee; quien lo pinta no toca datos. */
export type DatosDelNegocio = {
  nombre: string
  detalle: string
  indicadores: SeccionPintada[]
  secciones: SeccionPintada[]
  casos: { id: string; titulo: string; propuesta: string | null }[]
  reglas: { clave: string; texto: string }[]
}

export function SinNegocio() {
  return <p className="text-muted-foreground">Cuando le cuentes a tu agente de tu negocio, aquí lo vas a ver tomar forma.</p>
}

export function VistaDelNegocio({ datos }: { datos: DatosDelNegocio }) {
  const { nombre, detalle, indicadores, secciones, casos, reglas } = datos
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-2xl font-semibold">{nombre}</h2>
        <p className="text-sm text-muted-foreground">{detalle}</p>
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

export function VistaDelTablero({ indicadores }: { indicadores: SeccionPintada[] }) {
  return indicadores.length ? <Indicadores indicadores={indicadores} /> : <p className="text-muted-foreground">Todavía no tienes indicadores. Pídele a tu agente el número que quieres mirar.</p>
}

export function VistaDeUnaSeccion({ p }: { p: SeccionPintada }) {
  return p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo nombre={p.nombre} /> : <Seccion p={p} />
}
