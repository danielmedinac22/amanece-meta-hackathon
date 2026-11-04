import { guardarArchivo } from '@/negocio/archivos'
import { contextoDeLaSesion } from '@/negocio/sesion'
import { RECHAZO_EN_PALABRAS, TOPES_DE_ARCHIVO } from '@/nucleo/archivos'

/** Lo que agrega `multipart/form-data` encima del archivo. */
const MARGEN_DEL_FORMULARIO = 400_000

/** Sube un archivo. El Negocio sale de la sesión; el tipo, de sus primeros bytes. */
export async function POST(req: Request) {
  const ctx = await contextoDeLaSesion()
  if (!ctx) return Response.json({ error: 'Inicia sesión para continuar' }, { status: 401 })
  if (Number(req.headers.get('content-length')) > TOPES_DE_ARCHIVO.bytes + MARGEN_DEL_FORMULARIO) return Response.json({ error: RECHAZO_EN_PALABRAS.muy_grande }, { status: 413 })
  const archivo = (await req.formData().catch(() => null))?.get('archivo')
  if (!(archivo instanceof File)) return Response.json({ error: RECHAZO_EN_PALABRAS.no_permitido }, { status: 400 })
  try {
    const r = await guardarArchivo(ctx, { nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) })
    return 'rechazo' in r ? Response.json({ error: RECHAZO_EN_PALABRAS[r.rechazo] }, { status: 422 }) : Response.json(r, { status: 201 })
  } catch (e) {
    console.error('[archivos]', ctx.negocio, e)
    return Response.json({ error: 'No pude guardar ese archivo. Vuelve a intentarlo.' }, { status: 500 })
  }
}
