import { after } from 'next/server'
import { devolver } from '@/nucleo/clientes/toma'
import { contextoDeLaSesion } from '@/negocio/sesion'

/** Lo que el Cliente dejó sin contestar lo contesta un turno del agente, después de responderle a la pantalla. */
export const maxDuration = 300

export async function POST(req: Request, { params }: { params: Promise<{ cliente: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const { cliente } = await params
  const cuerpo = (await req.json().catch(() => null)) as { vez?: unknown } | null
  if (typeof cuerpo?.vez !== 'number') return Response.json({ error: 'No pude devolverla. Recarga e intenta de nuevo.' }, { status: 400 })
  try {
    return Response.json(
      await devolver(ctx, cliente, cuerpo.vez, (trabajo) =>
        after(() => trabajo().catch((e) => console.error('[devolver] no pude contestar lo debido', cliente, e))),
      ),
    )
  } catch (e) {
    console.error('[devolver]', cliente, e)
    return Response.json({ error: 'No pude devolverla. Vuelve a intentar en un momento.' }, { status: 500 })
  }
}
