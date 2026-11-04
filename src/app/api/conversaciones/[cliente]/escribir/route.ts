import { escribirAlCliente } from '@/nucleo/clientes/toma'
import { contextoDeLaSesion } from '@/negocio/sesion'

export const maxDuration = 30

/** El núcleo valida la forma y el Negocio. Quién escribe sale de la sesión, nunca del cuerpo. */
export async function POST(req: Request, { params }: { params: Promise<{ cliente: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const { cliente } = await params
  const c = (await req.json().catch(() => null)) as { vez?: unknown; texto?: unknown; intento?: unknown; visto?: unknown } | null
  if (typeof c?.vez !== 'number' || typeof c.texto !== 'string' || typeof c.intento !== 'string' || !(c.visto === null || typeof c.visto === 'string')) {
    return Response.json({ error: 'No pude enviarlo. Recarga e intenta de nuevo.' }, { status: 400 })
  }
  try {
    return Response.json(await escribirAlCliente(ctx, { cliente, vez: c.vez, texto: c.texto, intento: c.intento, visto: c.visto }))
  } catch (e) {
    console.error('[escribir]', cliente, e)
    return Response.json({ error: 'No pude enviarlo. Tu mensaje sigue aquí: vuelve a intentar.' }, { status: 500 })
  }
}
