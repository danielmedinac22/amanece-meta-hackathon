import type { ResultadoDeDevolver, ResultadoDeEscribir, ResultadoDeTomar } from '@/nucleo/clientes/toma'
import type { AccionesDeToma } from './toma'

export type ConError<T> = T | { readonly tipo: 'error'; readonly mensaje: string }

/** No lanza: la pantalla decide qué decir, y lo que estaba escrito se queda. */
async function pedir<T>(cliente: string, accion: 'tomar' | 'devolver' | 'escribir', cuerpo: unknown): Promise<ConError<T>> {
  try {
    const r = await fetch(`/api/conversaciones/${cliente}/${accion}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    const datos = (await r.json().catch(() => ({ error: 'No pude hacerlo. Intenta de nuevo.' }))) as T | { error: string }
    return typeof datos === 'object' && datos !== null && 'error' in datos ? { tipo: 'error', mensaje: datos.error } : (datos as T)
  } catch {
    return { tipo: 'error', mensaje: 'No me pude conectar. Intenta de nuevo.' }
  }
}

export const tocarToma: AccionesDeToma = {
  tomar: (cliente) => pedir<ResultadoDeTomar>(cliente, 'tomar', {}),
  devolver: (cliente, vez) => pedir<ResultadoDeDevolver>(cliente, 'devolver', { vez }),
  escribir: (cliente, e) => pedir<ResultadoDeEscribir>(cliente, 'escribir', e),
}
