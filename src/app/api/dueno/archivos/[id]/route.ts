import { verArchivo } from '@/negocio/archivos'
import { contextoDeLaSesion } from '@/negocio/sesion'

/** Un archivo ajeno y uno que no existe responden lo mismo. El navegador recibe el tipo reconocido al subirlo, y `nosniff` le impide adivinar otro. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  const archivo = await verArchivo(ctx, (await params).id)
  if (!archivo) return Response.json({ error: 'Ese archivo no está.' }, { status: 404 })
  return new Response(new Uint8Array(archivo.bytes), {
    headers: {
      'Content-Type': archivo.tipo,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
