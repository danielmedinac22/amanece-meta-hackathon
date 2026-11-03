import { actorDelBoton } from '@/nucleo/acciones'
import { publicar } from '@/nucleo/cambios'
import { contextoDeLaSesion } from '@/negocio/sesion'

/** Publicar espera como mucho 10 s a otro clic (`lock_timeout`). */
export const maxDuration = 30

/** El botón Publicar. El Dueño sale de la sesión y la huella de lo que vio, del cuerpo. */
export async function POST(req: Request) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const cuerpo = (await req.json().catch(() => null)) as { huella?: unknown } | null
  try {
    return Response.json(await publicar(actorDelBoton(ctx), typeof cuerpo?.huella === 'string' ? cuerpo.huella : ''))
  } catch (e) {
    console.error('[publicar]', ctx.negocio, e)
    return Response.json({ error: 'No pude publicar. Vuelve a tocar el botón en un momento.' }, { status: 500 })
  }
}
