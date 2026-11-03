import { abrirEnElAlta } from '@/nucleo/cambios'
import { leerAplicado } from '@/nucleo/estado'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import type { ContextoDelDueno } from '@/nucleo/identidad'
import { guardarEnElHilo, mensajeDelAgente } from './dueno-hilo'

export type RespuestaDeAbrir = { readonly abierto: true } | { readonly abierto: false; readonly falta: readonly string[] }

const QUE_PEDIR = 'Desde ahora me puedes pedir cosas como una regla, un cambio de precio o ver tus pedidos.'

/**
 * El botón `Abrir`: lo mismo que el Agente del dueño con su herramienta, sin pasar por el modelo. Lo que el agente le
 * contaría al abrir queda en el Hilo, una sola vez.
 */
export async function abrirConElBoton(ctx: ContextoDelDueno): Promise<RespuestaDeAbrir> {
  const antes = await leerAplicado(ctx.negocio)
  const r = await abrirEnElAlta(ctx)
  if (!r.abierto) return { abierto: false, falta: r.falta.map((f) => f.enPalabras) }
  if (antes.identidad.modo === 'armando') {
    const { nombre, codigo } = antes.identidad
    const conviene = r.avisos.length ? `\n\nCuando puedas, cuéntame ${r.avisos.map((f) => f.enPalabras).join(', ')}.` : ''
    await guardarEnElHilo(ctx.negocio, ctx.dueno, 'agente', mensajeDelAgente(`${nombre} ya está abierto. Este es tu link para compartir: ${linkDeWhatsapp(nombre, codigo)}\n\n${QUE_PEDIR}${conviene}`))
  }
  return { abierto: true }
}
