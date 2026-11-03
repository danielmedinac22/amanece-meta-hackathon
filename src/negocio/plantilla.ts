import { generateId, type UIMessage } from 'ai'
import { guardarEnElAlta } from '@/nucleo/cambios'
import { leerAplicado } from '@/nucleo/estado'
import { normalizar } from '@/nucleo/estado/elementos'
import type { ContextoDelDueno } from '@/nucleo/identidad'
import { PARTE_DE_PLANTILLA, PARTIDAS, plantillaDelHilo, type IdDePlantilla } from '@/nucleo/plantillas'
import { guardarEnElHilo, leerHilo } from './dueno-hilo'

/**
 * El armado parte de una plantilla: el Rubro si no hay uno, sus reglas y la línea del agente en el Hilo. No toca lo que
 * el Dueño ya tiene. Repetirla no duplica nada, y con el Negocio abierto no hace nada: lo que el Dueño escribió sigue
 * siendo un mensaje normal para su agente. `null` si no hubo línea nueva.
 */
export async function partirDePlantilla(ctx: ContextoDelDueno, id: IdDePlantilla): Promise<UIMessage | null> {
  const [estado, hilo] = await Promise.all([leerAplicado(ctx.negocio), leerHilo(ctx.dueno)])
  if (estado.identidad.modo !== 'armando' || plantillaDelHilo(hilo)) return null
  const partida = PARTIDAS[id]
  const hay = new Set(estado.vigentes('regla').map((v) => normalizar(v.elemento.nombre)))
  const r = await guardarEnElAlta(ctx, {
    nombre: null,
    rubro: estado.identidad.rubro.trim() ? null : partida.rubro,
    quiere: partida.reglas.filter((e) => !hay.has(normalizar(e.nombre))).map((elemento) => ({ tipo: 'poner', elemento, reemplaza: null })),
  })
  if ('problemas' in r) throw new Error(`La plantilla ${id} no se pudo guardar: ${JSON.stringify(r.problemas)}`)
  if (r.sinFuente.length || r.porConfirmar.length) throw new Error(`La plantilla ${id} trae cifras que nadie escribió`)
  const linea: UIMessage = {
    id: generateId(),
    role: 'assistant',
    parts: [
      { type: PARTE_DE_PLANTILLA, data: { id } },
      { type: 'text', text: partida.primero, state: 'done' },
    ],
  }
  await guardarEnElHilo(ctx.negocio, ctx.dueno, 'agente', linea)
  return linea
}
