import { and, eq, inArray } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { Conocimiento, PreguntaFrecuente } from '@/db/esquema'

/**
 * Escritura del conocimiento y del catálogo de un Negocio. La usan el Agente del dueño mientras arma el
 * Negocio (escribe directo) y `aplicarCambio` / `revertirCambio` (escriben lo que el Dueño aprobó).
 */
export type Producto = typeof esquema.productos.$inferSelect

export type ParcheDeConocimiento = {
  nombre?: string
  rubro?: string
  descripcion?: string
  ciudad?: string
  horario?: string
  envios?: string
  pagos?: string
  tono?: string
  /** Preguntas frecuentes que se suman; si la pregunta ya existe, se reemplaza su respuesta. */
  preguntasNuevas?: PreguntaFrecuente[]
}

export type ProductoNuevo = { nombre: string; descripcion?: string; precio: number }
export type ProductoEditado = { id: string; nombre?: string; descripcion?: string; precio?: number; activo?: boolean }
export type ParcheDeProductos = { agregar?: ProductoNuevo[]; editar?: ProductoEditado[]; desactivar?: string[] }

/** Lo que había antes de aplicar, con lo mínimo para volver atrás. */
export type AnteriorDeConocimiento = {
  nombre?: string
  rubro?: string
  conocimiento?: Partial<Conocimiento>
}

const CAMPOS_DE_TEXTO = ['descripcion', 'ciudad', 'horario', 'envios', 'pagos', 'tono'] as const

export const normalizar = (texto: string) =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

export async function leerNegocio(negocioId: string) {
  const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocioId))
  if (!negocio) throw new Error('El Negocio no existe')
  return negocio
}

export function parcheVacio(parche: ParcheDeConocimiento) {
  return Object.values(parche).every((v) => v === undefined || (Array.isArray(v) && v.length === 0))
}

type Negocio = typeof esquema.negocios.$inferSelect

/** Qué columnas cambian con el parche y qué había antes en ellas. No escribe nada. */
function calcularParche(negocio: Negocio, parche: ParcheDeConocimiento) {
  const anterior: AnteriorDeConocimiento = {}
  const conocimiento: Conocimiento = { ...negocio.conocimiento }
  const tocados: Partial<Conocimiento> = {}

  for (const campo of CAMPOS_DE_TEXTO) {
    const nuevo = parche[campo]
    if (nuevo === undefined) continue
    tocados[campo] = negocio.conocimiento[campo]
    conocimiento[campo] = nuevo
  }
  if (parche.preguntasNuevas?.length) {
    tocados.preguntas = negocio.conocimiento.preguntas
    const preguntas = [...negocio.conocimiento.preguntas]
    for (const nueva of parche.preguntasNuevas) {
      const i = preguntas.findIndex((p) => normalizar(p.pregunta) === normalizar(nueva.pregunta))
      if (i >= 0) preguntas[i] = nueva
      else preguntas.push(nueva)
    }
    conocimiento.preguntas = preguntas
  }
  if (Object.keys(tocados).length) anterior.conocimiento = tocados

  const columnas: { nombre?: string; rubro?: string; conocimiento?: Conocimiento } = {}
  if (parche.nombre !== undefined) {
    anterior.nombre = negocio.nombre
    columnas.nombre = parche.nombre
  }
  if (parche.rubro !== undefined) {
    anterior.rubro = negocio.rubro
    columnas.rubro = parche.rubro
  }
  if (anterior.conocimiento) columnas.conocimiento = conocimiento
  return { anterior, columnas }
}

/** Lo que el parche pisaría hoy, para guardarlo en la propuesta sin escribir. */
export async function instantaneaDeConocimiento(negocioId: string, parche: ParcheDeConocimiento) {
  return calcularParche(await leerNegocio(negocioId), parche).anterior
}

/** Los productos de este Negocio que el parche edita o desactiva, como están hoy. */
export async function productosQueToca(negocioId: string, parche: ParcheDeProductos) {
  const ids = [...new Set([...(parche.editar ?? []).map((e) => e.id), ...(parche.desactivar ?? [])])]
  if (!ids.length) return []
  return db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, negocioId), inArray(esquema.productos.id, ids)))
}

/** Escribe el parche y devuelve lo que había en los campos que tocó. */
export async function aplicarParcheDeConocimiento(negocioId: string, parche: ParcheDeConocimiento): Promise<AnteriorDeConocimiento> {
  const { anterior, columnas } = calcularParche(await leerNegocio(negocioId), parche)
  if (Object.keys(columnas).length) await db.update(esquema.negocios).set(columnas).where(eq(esquema.negocios.id, negocioId))
  return anterior
}

export async function restaurarConocimiento(negocioId: string, anterior: AnteriorDeConocimiento) {
  const negocio = await leerNegocio(negocioId)
  const columnas: { nombre?: string; rubro?: string; conocimiento?: Conocimiento } = {}
  if (anterior.nombre !== undefined) columnas.nombre = anterior.nombre
  if (anterior.rubro !== undefined) columnas.rubro = anterior.rubro
  if (anterior.conocimiento) columnas.conocimiento = { ...negocio.conocimiento, ...anterior.conocimiento }
  if (Object.keys(columnas).length) await db.update(esquema.negocios).set(columnas).where(eq(esquema.negocios.id, negocioId))
}

/** Agrega, edita o desactiva productos. Devuelve las filas como estaban y los ids de las nuevas. */
export async function aplicarParcheDeProductos(negocioId: string, parche: ParcheDeProductos) {
  const ediciones: ProductoEditado[] = [...(parche.editar ?? []), ...(parche.desactivar ?? []).map((id) => ({ id, activo: false }))]
  // Solo los productos de este Negocio: un id de otro Negocio no encuentra nada.
  const previos = await productosQueToca(negocioId, parche)
  const propios = new Set(previos.map((p) => p.id))
  for (const e of ediciones) {
    if (!propios.has(e.id)) continue
    const { id, ...cambios } = e
    const set = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
    if (Object.keys(set).length) await db.update(esquema.productos).set(set).where(and(eq(esquema.productos.id, id), eq(esquema.productos.negocioId, negocioId)))
  }

  const creados: string[] = []
  if (parche.agregar?.length) {
    const filas = await db
      .insert(esquema.productos)
      .values(parche.agregar.map((p) => ({ negocioId, nombre: p.nombre, descripcion: p.descripcion ?? '', precio: Math.round(p.precio) })))
      .returning({ id: esquema.productos.id })
    creados.push(...filas.map((f) => f.id))
  }
  return { anteriores: previos, creados }
}

export async function restaurarProductos(negocioId: string, anteriores: Producto[], creados: string[]) {
  for (const p of anteriores) {
    await db
      .update(esquema.productos)
      .set({ nombre: p.nombre, descripcion: p.descripcion, precio: p.precio, activo: p.activo })
      .where(and(eq(esquema.productos.id, p.id), eq(esquema.productos.negocioId, negocioId)))
  }
  // Los productos que creó el Cambio se desactivan, no se borran.
  if (creados.length) {
    await db.update(esquema.productos).set({ activo: false }).where(and(eq(esquema.productos.negocioId, negocioId), inArray(esquema.productos.id, creados)))
  }
}

/** Mientras se arma el Negocio: crea los productos o actualiza el que ya tiene ese nombre. */
export async function guardarProductos(negocioId: string, productos: ProductoNuevo[]) {
  const actuales = await db.select().from(esquema.productos).where(eq(esquema.productos.negocioId, negocioId))
  let creados = 0
  let actualizados = 0
  for (const p of productos) {
    const existente = actuales.find((a) => normalizar(a.nombre) === normalizar(p.nombre))
    if (existente) {
      await db
        .update(esquema.productos)
        .set({ descripcion: p.descripcion ?? existente.descripcion, precio: Math.round(p.precio), activo: true })
        .where(eq(esquema.productos.id, existente.id))
      actualizados++
    } else {
      await db.insert(esquema.productos).values({ negocioId, nombre: p.nombre, descripcion: p.descripcion ?? '', precio: Math.round(p.precio) })
      creados++
    }
  }
  return { creados, actualizados }
}

const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`

/** El parche en palabras, para que el Dueño lo vea antes de aplicarlo. */
export async function describirParche(negocioId: string, conocimiento: ParcheDeConocimiento, productos: ParcheDeProductos) {
  const negocio = await leerNegocio(negocioId)
  const lineas: string[] = []
  const etiquetas: Record<(typeof CAMPOS_DE_TEXTO)[number], string> = {
    descripcion: 'Descripción',
    ciudad: 'Ciudad',
    horario: 'Horario',
    envios: 'Envíos',
    pagos: 'Pagos',
    tono: 'Tono',
  }
  for (const campo of CAMPOS_DE_TEXTO) {
    const nuevo = conocimiento[campo]
    if (nuevo === undefined) continue
    const antes = negocio.conocimiento[campo]
    lineas.push(`${etiquetas[campo]}: ${antes ? `"${antes}" → ` : ''}"${nuevo}"`)
  }
  for (const q of conocimiento.preguntasNuevas ?? []) lineas.push(`Pregunta frecuente: "${q.pregunta}" → "${q.respuesta}"`)
  if (conocimiento.nombre !== undefined) lineas.push(`Nombre del Negocio: "${negocio.nombre}" → "${conocimiento.nombre}"`)
  if (conocimiento.rubro !== undefined) lineas.push(`Rubro: "${negocio.rubro}" → "${conocimiento.rubro}"`)

  const previos = await productosQueToca(negocioId, productos)
  for (const p of productos.agregar ?? []) lineas.push(`Producto nuevo: ${p.nombre}, ${pesos(p.precio)}`)
  for (const e of productos.editar ?? []) {
    const antes = previos.find((p) => p.id === e.id)
    if (!antes) {
      lineas.push(`(No encontré el producto ${e.id} en este Negocio; no se toca)`)
      continue
    }
    const partes: string[] = []
    if (e.nombre !== undefined) partes.push(`nombre "${antes.nombre}" → "${e.nombre}"`)
    if (e.precio !== undefined) partes.push(`precio ${pesos(antes.precio)} → ${pesos(e.precio)}`)
    if (e.descripcion !== undefined) partes.push('descripción nueva')
    if (e.activo !== undefined) partes.push(e.activo ? 'se activa' : 'se desactiva')
    lineas.push(`Producto ${antes.nombre}: ${partes.join(', ')}`)
  }
  for (const id of productos.desactivar ?? []) {
    const antes = previos.find((p) => p.id === id)
    lineas.push(antes ? `Producto ${antes.nombre}: se desactiva` : `(No encontré el producto ${id} en este Negocio; no se toca)`)
  }
  return lineas
}
