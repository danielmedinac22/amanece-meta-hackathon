import type { SeccionPintada } from '@/nucleo/panel'
import { Fallo, Indicador, Seccion } from './pieza'

export function SinNegocio() {
  return <p className="text-muted-foreground">Cuando le cuentes a tu agente de tu negocio, aquí lo vas a ver tomar forma.</p>
}

function Indicadores({ indicadores }: { indicadores: SeccionPintada[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {indicadores.map((p) => (p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo key={p.clave} nombre={p.nombre} /> : <Indicador key={p.clave} p={p} />))}
    </div>
  )
}

export function VistaDelTablero({ indicadores }: { indicadores: SeccionPintada[] }) {
  return indicadores.length ? <Indicadores indicadores={indicadores} /> : <p className="text-muted-foreground">Todavía no tienes indicadores. Pídele a tu agente el número que quieres mirar.</p>
}

export function VistaDeUnaSeccion({ p }: { p: SeccionPintada }) {
  return p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo nombre={p.nombre} /> : <Seccion p={p} />
}
