import { aprobar } from '@/nucleo/cambios'
import { contextoDeLaSesion } from '@/negocio/sesion'

/** El reclamo espera como mucho 10 s a otro clic (`lock_timeout`) y el puente escribe en pocos segundos. */
export const maxDuration = 30

/** El botón de la tarjeta. El Dueño sale de la sesión y la huella del cuerpo; `aprobar` valida la forma de los dos. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const { id } = await params
  const cuerpo = (await req.json().catch(() => null)) as { huella?: unknown } | null
  try {
    return Response.json(await aprobar(ctx, id, typeof cuerpo?.huella === 'string' ? cuerpo.huella : ''))
  } catch (e) {
    // Lo que falla después del COMMIT no llega aquí: esto es el reclamo, con ROLLBACK, y la tarjeta sigue sirviendo.
    console.error('[aprobar]', id, e)
    return Response.json({ error: 'No pude aplicarlo. Vuelve a tocar el botón en un momento.' }, { status: 500 })
  }
}
