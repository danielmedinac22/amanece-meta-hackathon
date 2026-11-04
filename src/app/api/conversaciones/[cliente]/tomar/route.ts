import { tomar } from '@/nucleo/clientes/toma'
import { contextoDeLaSesion } from '@/negocio/sesion'

export const maxDuration = 30

/** El Dueño sale de la sesión; `tomar` revisa que el Cliente sea de su Negocio. */
export async function POST(_: Request, { params }: { params: Promise<{ cliente: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const { cliente } = await params
  try {
    return Response.json(await tomar(ctx, cliente))
  } catch (e) {
    console.error('[tomar]', cliente, e)
    return Response.json({ error: 'No pude tomarla. Tu agente sigue atendiendo.' }, { status: 500 })
  }
}
