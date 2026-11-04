import { SIN_CONEXION, type Adjunto } from '@/nucleo/archivos'

export type SubirArchivo = (archivo: Blob, nombre: string) => Promise<{ readonly adjunto: Adjunto } | { readonly error: string }>

export const subirArchivo: SubirArchivo = async (archivo, nombre) => {
  const cuerpo = new FormData()
  cuerpo.set('archivo', archivo, nombre)
  try {
    const r = await fetch('/api/dueno/archivos', { method: 'POST', body: cuerpo })
    const datos = (await r.json().catch(() => null)) as { adjunto?: Adjunto; error?: string } | null
    return r.ok && datos?.adjunto ? { adjunto: datos.adjunto } : { error: datos?.error ?? SIN_CONEXION }
  } catch {
    return { error: SIN_CONEXION }
  }
}
