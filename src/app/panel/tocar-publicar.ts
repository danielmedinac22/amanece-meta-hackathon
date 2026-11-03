import type { ResultadoDePublicar } from '@/nucleo/cambios'

export type RespuestaDePublicar = ResultadoDePublicar | { readonly tipo: 'error'; readonly mensaje: string }
export type Publicador = (huella: string) => Promise<RespuestaDePublicar>

/** El botón de verdad: la huella ata el clic a la lista que el Dueño tiene abierta. */
export const pedirPublicar: Publicador = async (huella) => {
  try {
    const r = await fetch('/api/publicar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ huella }) })
    const datos = (await r.json().catch(() => ({ error: 'No pude publicar. Intenta de nuevo.' }))) as ResultadoDePublicar | { error: string }
    return 'error' in datos ? { tipo: 'error', mensaje: datos.error } : datos
  } catch {
    return { tipo: 'error', mensaje: 'No me pude conectar. Intenta de nuevo.' }
  }
}
