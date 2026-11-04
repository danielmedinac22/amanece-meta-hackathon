import { abrirConElBoton } from '@/negocio/abrir'
import { contextoDeLaSesion } from '@/negocio/sesion'

export async function POST() {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  try {
    return Response.json(await abrirConElBoton(ctx))
  } catch (e) {
    console.error('[abrir]', ctx.negocio, e)
    return Response.json({ error: 'No pude abrir tu negocio. Vuelve a tocar el botón en un momento.' }, { status: 500 })
  }
}
