import type { SeccionPintada } from '@/nucleo/panel'
import { Fallo, SeccionEntera } from './pieza'

export function SinNegocio() {
  return <p className="text-muted-foreground">Cuando le cuentes a tu agente de tu negocio, aquí lo vas a ver tomar forma.</p>
}

export function VistaDeUnaSeccion({ p }: { p: SeccionPintada }) {
  return p.resultado.tipo === 'no_se_pudo_calcular' ? <Fallo clave={p.clave} nombre={p.nombre} /> : <SeccionEntera p={p} />
}
