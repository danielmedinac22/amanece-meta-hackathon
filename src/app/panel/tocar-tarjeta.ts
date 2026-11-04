import type { ResultadoDeAprobar, ResultadoDeDeshacer, TarjetaDeAprobacion } from '@/nucleo/cambios'

export type AccionDeTarjeta = 'aprobar' | 'descartar' | 'deshacer'
export type RespuestaDeTarjeta = ResultadoDeAprobar | ResultadoDeDeshacer | { readonly tipo: 'descartada' } | { readonly tipo: 'error'; readonly mensaje: string }
export type TocarTarjeta = (tarjeta: TarjetaDeAprobacion, accion: AccionDeTarjeta) => Promise<RespuestaDeTarjeta>

/** El botón de una tarjeta de verdad: la huella ata el clic a exactamente lo que se mostró. */
export const tocarTarjeta: TocarTarjeta = async (tarjeta, accion) => {
  try {
    const r = await fetch(`/api/propuestas/${tarjeta.propuesta}/${accion}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ huella: tarjeta.huella }),
    })
    const datos = (await r.json().catch(() => ({ error: 'No pude hacerlo. Intenta de nuevo.' }))) as RespuestaDeTarjeta | { error: string }
    return 'error' in datos ? { tipo: 'error', mensaje: datos.error } : datos
  } catch {
    return { tipo: 'error', mensaje: 'No me pude conectar. Intenta de nuevo.' }
  }
}
