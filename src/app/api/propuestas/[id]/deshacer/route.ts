import { deshacer } from '@/nucleo/cambios'
import { contextoDeLaSesion } from '@/negocio/sesion'

/** El reclamo espera como mucho 10 s a otro clic (`lock_timeout`). */
export const maxDuration = 30

/** El botón Deshacer de lo que ya se aplicó en el Panel. El Dueño sale de la sesión y la huella del cuerpo. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const { id } = await params
  const cuerpo = (await req.json().catch(() => null)) as { huella?: unknown } | null
  try {
    return Response.json(await deshacer(ctx, id, typeof cuerpo?.huella === 'string' ? cuerpo.huella : ''))
  } catch (e) {
    console.error('[deshacer]', id, e)
    return Response.json({ error: 'No pude deshacerlo. Vuelve a tocar el botón en un momento.' }, { status: 500 })
  }
}
