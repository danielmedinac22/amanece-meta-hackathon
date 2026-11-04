import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { EncryptedPDFError, PDFDocument } from 'pdf-lib'
import { db, esquema } from '@/db'
import type { LoExtraido } from '@/nucleo/cambios/lectura'
import { pareceId, reconocerTipo, TIPOS_DE_ARCHIVO, TOPES_DE_ARCHIVO as TOPES, type Adjunto, type Rechazo, type TipoDeArchivo } from '@/nucleo/archivos'
import type { ContextoDelDueno } from '@/nucleo/identidad'

/**
 * El único módulo que conoce la tabla y los bytes: guardarlos en otro almacén cambia este archivo. El Negocio y el Dueño
 * salen de `ctx`, y uno ajeno da lo mismo que uno que no existe.
 */
const a = esquema.archivosDueno

const SIN_BYTES = { id: a.id, tipo: a.tipo, nombre: a.nombre, paginas: a.paginas, paginasDelOriginal: a.paginasDelOriginal }
type FilaSinBytes = { id: string; tipo: TipoDeArchivo; nombre: string; paginas: number | null; paginasDelOriginal: number | null }

const comoAdjunto = ({ id, tipo, nombre, paginas, paginasDelOriginal }: FilaSinBytes): Adjunto => ({ id, clase: TIPOS_DE_ARCHIVO[tipo], nombre, paginas, paginasDelOriginal })

const suyo = (ctx: ContextoDelDueno, id: string) => and(eq(a.id, id), eq(a.negocioId, ctx.negocio), eq(a.duenoId, ctx.dueno))

/**
 * El PDF se reescribe siempre, no solo cuando se pasa de páginas: lo que recibe el modelo es lo que contamos, aunque un PDF
 * armado a propósito se cuente distinto en otro lector.
 */
async function primerasPaginas(bytes: Uint8Array): Promise<{ bytes: Uint8Array; paginas: number; paginasDelOriginal: number | null } | { rechazo: Rechazo }> {
  try {
    const original = await PDFDocument.load(bytes, { updateMetadata: false })
    const total = original.getPageCount()
    if (!total) return { rechazo: 'pdf_ilegible' }
    const nuevo = await PDFDocument.create()
    const paginas = await nuevo.copyPages(original, original.getPageIndices().slice(0, TOPES.paginasPdf))
    for (const p of paginas) nuevo.addPage(p)
    return { bytes: await nuevo.save(), paginas: paginas.length, paginasDelOriginal: total > paginas.length ? total : null }
  } catch (e) {
    return { rechazo: e instanceof EncryptedPDFError ? 'pdf_protegido' : 'pdf_ilegible' }
  }
}

const limpiarNombre = (nombre: string) =>
  nombre
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, TOPES.largoNombre) || 'Archivo'

export async function guardarArchivo(ctx: ContextoDelDueno, subido: { readonly nombre: string; readonly bytes: Uint8Array }): Promise<{ adjunto: Adjunto } | { rechazo: Rechazo }> {
  const tipo = reconocerTipo(subido.bytes)
  if (!tipo) return { rechazo: 'no_permitido' }
  if (subido.bytes.length > TOPES.bytes) return { rechazo: 'muy_grande' }
  const pdf = tipo === 'application/pdf' ? await primerasPaginas(subido.bytes) : null
  if (pdf && 'rechazo' in pdf) return pdf
  const bytes = pdf?.bytes ?? subido.bytes
  if (bytes.length > TOPES.bytes) return { rechazo: 'muy_grande' }

  await db.delete(a).where(and(eq(a.negocioId, ctx.negocio), isNull(a.enviado), lt(a.creado, sql`now() - make_interval(hours => ${TOPES.horasSinEnviar})`)))
  const [uso] = await db
    .select({ hoy: sql<number>`count(*) filter (where ${a.creado} > now() - interval '24 hours')`.mapWith(Number), peso: sql<number>`coalesce(sum(${a.tamano}), 0)`.mapWith(Number) })
    .from(a)
    .where(eq(a.negocioId, ctx.negocio))
  if ((uso?.hoy ?? 0) >= TOPES.porDia) return { rechazo: 'cupo_del_dia' }
  if ((uso?.peso ?? 0) + bytes.length > TOPES.bytesPorNegocio) return { rechazo: 'cupo_del_negocio' }

  const [fila] = await db
    .insert(a)
    .values({ negocioId: ctx.negocio, duenoId: ctx.dueno, tipo, nombre: limpiarNombre(subido.nombre), paginas: pdf?.paginas ?? null, paginasDelOriginal: pdf?.paginasDelOriginal ?? null, tamano: bytes.length, bytes })
    .returning(SIN_BYTES)
  return { adjunto: comoAdjunto(fila) }
}

/**
 * Los adjuntos de un mensaje, armados desde la fila: del navegador solo se cree el id. `null` si alguno no es del Dueño o son
 * demasiados, y entonces el mensaje entero no se guarda. Mandar dos veces el mismo id da lo mismo.
 */
export async function adjuntosParaElMensaje(ctx: ContextoDelDueno, ids: readonly unknown[]): Promise<readonly Adjunto[] | null> {
  if (!ids.every(pareceId)) return null
  const unicos = [...new Set(ids.map((id) => id.toLowerCase()))]
  if (unicos.length > TOPES.porMensaje) return null
  if (!unicos.length) return []
  const filas = await db
    .update(a)
    .set({ enviado: sql`coalesce(${a.enviado}, now())` })
    .where(and(inArray(a.id, unicos), eq(a.negocioId, ctx.negocio), eq(a.duenoId, ctx.dueno)))
    .returning(SIN_BYTES)
  if (filas.length !== unicos.length) return null
  return unicos.map((id) => comoAdjunto(filas.find((f) => f.id === id)!))
}

/** Lo que pide el navegador para mostrar el archivo. */
export async function verArchivo(ctx: ContextoDelDueno, id: string): Promise<{ readonly bytes: Uint8Array; readonly tipo: TipoDeArchivo; readonly nombre: string } | null> {
  if (!pareceId(id)) return null
  const [fila] = await db.select({ bytes: a.bytes, tipo: a.tipo, nombre: a.nombre }).from(a).where(suyo(ctx, id))
  return fila ?? null
}

export type ParaLeer = { readonly tipo: TipoDeArchivo; readonly bytes: Uint8Array; readonly adjunto: Adjunto }

/**
 * Gasta una lectura y entrega los bytes. Una sola sentencia, para que dos a la vez del mismo archivo no pasen su tope. El cupo del
 * día cuenta las lecturas de los archivos leídos en las últimas 24 horas: un archivo viejo que se vuelve a leer cuenta de más.
 * Archivos distintos a la vez pueden pasarlo por lo que quepa en un turno, que es poco y no vale un candado.
 */
export async function tomarParaLeer(ctx: ContextoDelDueno, id: string): Promise<ParaLeer | 'agotado' | 'cupo_del_dia' | null> {
  if (!pareceId(id)) return null
  const [fila] = await db
    .update(a)
    .set({ lecturas: sql`${a.lecturas} + 1`, ultimaLectura: sql`now()` })
    .where(
      and(
        suyo(ctx, id),
        lt(a.lecturas, TOPES.lecturasPorArchivo),
        sql`(select coalesce(sum(x.lecturas), 0) from archivos_dueno x where x.negocio_id = ${ctx.negocio} and x.ultima_lectura > now() - interval '24 hours') < ${TOPES.lecturasPorDia}`,
      ),
    )
    .returning({ ...SIN_BYTES, bytes: a.bytes })
  if (fila) return { tipo: fila.tipo, bytes: fila.bytes, adjunto: comoAdjunto(fila) }
  const [existe] = await db.select({ lecturas: a.lecturas }).from(a).where(suyo(ctx, id))
  if (!existe) return null
  return existe.lecturas >= TOPES.lecturasPorArchivo ? 'agotado' : 'cupo_del_dia'
}

export async function guardarLoLeido(ctx: ContextoDelDueno, id: string, extraido: LoExtraido): Promise<void> {
  await db.update(a).set({ extraido }).where(suyo(ctx, id))
}

/** Lo que el lector ya sacó de ese archivo, si ya lo leyó. Sirve para cargarlo sin pagar otra lectura. */
export async function loYaLeido(ctx: ContextoDelDueno, id: string): Promise<{ readonly adjunto: Adjunto; readonly extraido: LoExtraido } | null> {
  if (!pareceId(id)) return null
  const [fila] = await db.select({ ...SIN_BYTES, extraido: a.extraido }).from(a).where(suyo(ctx, id))
  return fila?.extraido ? { adjunto: comoAdjunto(fila), extraido: fila.extraido } : null
}
