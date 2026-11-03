import { partirDePlantilla } from '@/negocio/plantilla'
import { contextoDeLaSesion } from '@/negocio/sesion'
import { esIdDePlantilla } from '@/nucleo/plantillas'

/** El Negocio sale de la sesión. Del cuerpo solo se toma cuál de las plantillas, y lo demás se ignora. */
export async function POST(req: Request) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const cuerpo = (await req.json().catch(() => null)) as { plantilla?: unknown } | null
  if (!esIdDePlantilla(cuerpo?.plantilla)) return Response.json({ error: 'Esa plantilla no existe' }, { status: 400 })
  try {
    return Response.json({ mensaje: await partirDePlantilla(ctx, cuerpo.plantilla) })
  } catch (e) {
    console.error('[plantilla]', ctx.negocio, e)
    return Response.json({ error: 'No pude partir de esa plantilla.' }, { status: 500 })
  }
}
