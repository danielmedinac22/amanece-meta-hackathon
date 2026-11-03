import type { UIMessage } from 'ai'
import type { TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { EstadoDeTarjeta } from './dueno-chat'

/** Toda salida de herramienta que deja una tarjeta: `proponer`, `leer_enlace` y `guardar_*`. Al modelo solo le llega `resumen`. */
export type SalidaConTarjeta = { readonly resumen: string; readonly tarjeta: TarjetaDeAprobacion | null }

/**
 * La única que sabe qué parte del Hilo trae una tarjeta: `data-tarjeta` (el aviso de un Caso) o la salida de
 * cualquier herramienta con `tarjeta`. Sin `import` de servidor: la usan el Hilo del navegador y `dueno-chat`.
 */
export function tarjetaDeLaParte(parte: UIMessage['parts'][number]): TarjetaDeAprobacion | null {
  if (parte.type === 'data-tarjeta') return parte.data as TarjetaDeAprobacion
  if (!parte.type.startsWith('tool-') || !('state' in parte) || parte.state !== 'output-available') return null
  const salida = (parte as { output?: unknown }).output
  const tarjeta = salida && typeof salida === 'object' && 'tarjeta' in salida ? (salida as SalidaConTarjeta).tarjeta : null
  return tarjeta && typeof tarjeta === 'object' && 'propuesta' in tarjeta ? tarjeta : null
}

/** Deshacer no cuenta: es de algo que ya pasó. Una recién llegada en el stream todavía no tiene estado y cuenta si no venció, igual que en la tarjeta. */
function tarjetasQueEsperan(mensajes: readonly UIMessage[], estados: Record<string, EstadoDeTarjeta>, ahora: number): TarjetaDeAprobacion[] {
  const tarjetas = mensajes.flatMap((m) => m.parts.flatMap((p) => tarjetaDeLaParte(p) ?? []))
  return tarjetas.filter((t) => {
    const estado = estados[t.propuesta]
    return t.accion !== 'deshacer' && (estado ? estado.estado === 'espera_al_dueno' : Date.parse(t.vence) > ahora)
  })
}

/** La tarjeta más reciente que espera al Dueño, o null. */
export function decisionQueEspera(mensajes: readonly UIMessage[], estados: Record<string, EstadoDeTarjeta>, ahora = Date.now()): string | null {
  return tarjetasQueEsperan(mensajes, estados, ahora).at(-1)?.propuesta ?? null
}

/** Las que esperan, la más urgente primero: antes lo que un Cliente está esperando y después lo que vence antes. */
export function decisionesEnEspera(mensajes: readonly UIMessage[], estados: Record<string, EstadoDeTarjeta>, ahora = Date.now()): TarjetaDeAprobacion[] {
  return tarjetasQueEsperan(mensajes, estados, ahora).toSorted((a, b) => Number(b.accion === 'enviar') - Number(a.accion === 'enviar') || Date.parse(a.vence) - Date.parse(b.vence))
}
