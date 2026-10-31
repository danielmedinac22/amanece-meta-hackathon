import { descartar } from '@/nucleo/cambios'
import { contextoDeLaSesion } from '@/negocio/sesion'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  return Response.json(await descartar(ctx, (await params).id))
}
