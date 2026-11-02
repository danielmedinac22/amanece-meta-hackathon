import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, esquema } from '@/db'
import type { Vista } from '@/db/esquema'
import { generarPieza } from '@/agentes/generador'
import { correrAislado, type ResultadoAislado } from '@/lib/aislado'
import { datosDelNegocio } from '@/negocio/datos'
import { normalizar } from '@/nucleo/estado/elementos'
import type { NegocioId } from '@/nucleo/identidad'
import { MEDIDA_VACIA, sumar, type Medida } from '@/negocio/dueno-modelo'

/**
 * Las piezas del Panel (Sección e Indicador) hasta el 2-nov: se proponen, se aplican y se revierten. Solo las usa
 * `src/nucleo/cambios/puente.ts`. Toda función recibe el `negocioId` de quien llama y lo usa en cada consulta.
 */
export type Cambio = typeof esquema.cambios.$inferSelect
export type Pieza = typeof esquema.piezas.$inferSelect
export type PiezaConResultado = { pieza: Pieza; resultado: ResultadoAislado }

type PropuestaDePieza = { nombre: string; descripcion: string; codigo: string; vista: Vista | null; clave?: string }

/** Intentos para que una pieza corra bien: el primero y dos correcciones con el error a la vista. */
const INTENTOS_DE_PIEZA = 3
const FILAS_EN_LA_VISTA_PREVIA = 25
const FILAS_EN_EL_PANEL = 200

// --- Lo que debe devolver el código generado --------------------------------------------------------

const textoOpcional = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined)

const resultadoDeIndicador = z.object({
  valor: z.union([z.number().finite(), z.string()], { error: 'debe ser un número finito o un texto' }),
  unidad: textoOpcional,
  serie: z
    .array(z.object({ etiqueta: z.string(), valor: z.number().finite() }))
    .nullish()
    .transform((v) => v ?? undefined),
  nota: textoOpcional,
})

export type ResultadoDeIndicador = z.infer<typeof resultadoDeIndicador>
export type FilaDeSeccion = Record<string, string | number | boolean | null>

const celda = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])

/** Revisa la forma del valor que devolvió la pieza. Si no cuadra, el error vuelve al generador. */
function validarForma(tipo: 'seccion' | 'indicador', valor: unknown, vista: Vista | null): { ok: true; valor: ResultadoDeIndicador | FilaDeSeccion[] } | { ok: false; error: string } {
  if (tipo === 'indicador') {
    const r = resultadoDeIndicador.safeParse(valor)
    if (r.success) return { ok: true, valor: r.data }
    return { ok: false, error: `El resultado no tiene la forma { valor, unidad?, serie?, nota? }: ${r.error.issues.map((i) => `${i.path.join('.') || 'resultado'}: ${i.message}`).join('; ')}` }
  }
  if (!Array.isArray(valor)) return { ok: false, error: `consultar debe devolver un arreglo de filas y devolvió ${valor === null ? 'null' : typeof valor}` }
  if (valor.length > 500) return { ok: false, error: `consultar devolvió ${valor.length} filas; el máximo es ${FILAS_EN_EL_PANEL}` }
  const filas = z.array(z.record(z.string(), celda)).safeParse(valor)
  if (!filas.success) return { ok: false, error: `Cada fila debe ser un objeto plano con valores string, number, boolean o null: ${filas.error.issues[0]?.message ?? 'forma inválida'} en ${filas.error.issues[0]?.path.join('.')}` }
  if (!vista?.columnas?.length) return { ok: false, error: 'Falta la vista: tipo y columnas' }
  if (filas.data.length) {
    const claves = new Set(filas.data.flatMap((f) => Object.keys(f)))
    const faltantes = vista.columnas.filter((c) => !claves.has(c.clave)).map((c) => c.clave)
    if (faltantes.length) return { ok: false, error: `Las columnas ${faltantes.join(', ')} de la vista no existen en las filas; las claves de las filas son: ${[...claves].join(', ')}` }
  }
  return { ok: true, valor: filas.data.slice(0, FILAS_EN_EL_PANEL) }
}

/** Lo que se guarda como vista previa: unas pocas filas, no las 200. */
function recortar(valor: ResultadoDeIndicador | FilaDeSeccion[]) {
  return Array.isArray(valor) ? valor.slice(0, FILAS_EN_LA_VISTA_PREVIA) : valor
}

// --- Registro del Cambio y su medición --------------------------------------------------------------

async function registrarCambio(valores: {
  negocioId: string
  duenoId: string | null
  tipo: Cambio['tipo']
  pedido: string
  resumen: string
  estado?: Cambio['estado']
  propuesta: Record<string, unknown>
  anterior?: Record<string, unknown> | null
  vistaPrevia: unknown
  medida: Medida
  inicio: number
}) {
  const [cambio] = await db
    .insert(esquema.cambios)
    .values({
      negocioId: valores.negocioId,
      duenoId: valores.duenoId,
      tipo: valores.tipo,
      pedido: valores.pedido,
      resumen: valores.resumen.slice(0, 300),
      estado: valores.estado ?? 'propuesto',
      propuesta: valores.propuesta,
      anterior: valores.anterior ?? null,
      vistaPrevia: valores.vistaPrevia,
      tokensEntrada: valores.medida.entrada,
      tokensSalida: valores.medida.salida,
      costoUsd: valores.medida.costo,
      msHastaPropuesta: Date.now() - valores.inicio,
    })
    .returning()
  return cambio
}

// --- Sección e Indicador ----------------------------------------------------------------------------

/** La pieza activa con ese nombre, si el Dueño está cambiando una que ya existe. */
async function piezaActivaConNombre(negocioId: string, tipo: 'seccion' | 'indicador', nombre: string) {
  const activas = await db
    .select()
    .from(esquema.piezas)
    .where(and(eq(esquema.piezas.negocioId, negocioId), eq(esquema.piezas.tipo, tipo), eq(esquema.piezas.activa, true)))
  return activas.find((p) => normalizar(p.nombre) === normalizar(nombre)) ?? null
}

/**
 * Pide el código al generador, lo corre aislado sobre los datos del Negocio y, si falla o devuelve otra
 * forma, le devuelve el error al generador hasta 2 veces. Si no logra una pieza que corra, el Cambio queda
 * `descartado` con el error, para que se vea qué se gastó.
 */
export async function proponerPieza(
  negocioId: NegocioId,
  duenoId: string | null,
  pedido: string,
  tipo: 'seccion' | 'indicador',
  nombre: string,
  /** Quién escribe el código; solo cambia en las pruebas del reintento. */
  generar: typeof generarPieza = generarPieza,
) {
  const inicio = Date.now()
  const funcion = tipo === 'indicador' ? 'calcular' : 'consultar'
  const datos = await datosDelNegocio(negocioId)
  const activa = await piezaActivaConNombre(negocioId, tipo, nombre)

  let medida = MEDIDA_VACIA
  let intentoFallido: { codigo: string; error: string } | undefined
  let ultima: { descripcion: string; codigo: string; vista: Vista | null } | null = null
  let intentos = 0

  while (intentos < INTENTOS_DE_PIEZA) {
    intentos++
    let generada
    try {
      generada = await generar({ negocioId, tipo, nombre, pedido, datos, codigoActual: activa?.codigo, intentoFallido })
    } catch (e) {
      intentoFallido = { codigo: ultima?.codigo ?? '', error: `El generador no respondió: ${e instanceof Error ? e.message : String(e)}` }
      break
    }
    medida = sumar(medida, generada.medida)
    ultima = generada.pieza

    const corrida = await correrAislado(generada.pieza.codigo, funcion, datos)
    const forma = corrida.ok ? validarForma(tipo, corrida.valor, generada.pieza.vista) : null
    if (corrida.ok && forma?.ok) {
      const propuesta: PropuestaDePieza = { nombre, descripcion: generada.pieza.descripcion, codigo: generada.pieza.codigo, vista: generada.pieza.vista, ...(activa ? { clave: activa.clave } : {}) }
      return registrarCambio({
        negocioId,
        duenoId,
        tipo,
        pedido,
        resumen: `${nombre}: ${generada.pieza.descripcion}`,
        propuesta,
        anterior: activa ? { piezaId: activa.id, version: activa.version, codigo: activa.codigo } : null,
        vistaPrevia: { tipo, vista: generada.pieza.vista, resultado: recortar(forma.valor), ...(Array.isArray(forma.valor) ? { totalFilas: forma.valor.length } : {}), ms: corrida.ms, intentos },
        medida,
        inicio,
      })
    }
    intentoFallido = { codigo: generada.pieza.codigo, error: corrida.ok ? (forma && !forma.ok ? forma.error : 'Resultado inválido') : corrida.error }
  }

  const propuesta: PropuestaDePieza = {
    nombre,
    descripcion: ultima?.descripcion ?? '',
    codigo: ultima?.codigo ?? '',
    vista: ultima?.vista ?? null,
    ...(activa ? { clave: activa.clave } : {}),
  }
  return registrarCambio({
    negocioId,
    duenoId,
    tipo,
    pedido,
    resumen: `${nombre}: no se pudo generar`,
    estado: 'descartado',
    propuesta,
    vistaPrevia: { tipo, error: intentoFallido?.error ?? 'No se pudo generar la pieza', intentos },
    medida,
    inicio,
  })
}

// --- Aplicar y revertir -----------------------------------------------------------------------------

/** Aplica un Cambio propuesto. Solo el Negocio dueño del Cambio puede hacerlo. */
export async function aplicarCambio(negocioId: string, cambioId: string) {
  // Se reclama primero, para que dos clics seguidos no apliquen el mismo Cambio dos veces.
  const [cambio] = await db
    .update(esquema.cambios)
    .set({ estado: 'aplicado', aplicado: new Date() })
    .where(and(eq(esquema.cambios.id, cambioId), eq(esquema.cambios.negocioId, negocioId), eq(esquema.cambios.estado, 'propuesto')))
    .returning()
  if (!cambio) throw new Error('No encontré ese Cambio propuesto en este Negocio')

  try {
    await aplicarPieza(cambio)
    const [aplicado] = await db
      .update(esquema.cambios)
      // Desde que el Dueño hizo el pedido: lo que tardó la propuesta más lo que pasó hasta que dijo que sí.
      .set({ msHastaAplicado: (cambio.msHastaPropuesta ?? 0) + (Date.now() - cambio.creado.getTime()) })
      .where(eq(esquema.cambios.id, cambio.id))
      .returning()
    return aplicado
  } catch (e) {
    await db.update(esquema.cambios).set({ estado: 'propuesto', aplicado: null }).where(eq(esquema.cambios.id, cambio.id))
    throw e
  }
}

async function aplicarPieza(cambio: Cambio) {
  if (cambio.tipo !== 'seccion' && cambio.tipo !== 'indicador') throw new Error('Un Cambio de regla o conocimiento ya no se aplica por aquí')
  const p = cambio.propuesta as PropuestaDePieza
  if (!p.codigo) throw new Error('El Cambio no trae código')
  const [previa] = p.clave
    ? await db
        .select()
        .from(esquema.piezas)
        .where(and(eq(esquema.piezas.negocioId, cambio.negocioId), eq(esquema.piezas.clave, p.clave), eq(esquema.piezas.activa, true)))
    : []
  const nueva = db.insert(esquema.piezas).values({
    negocioId: cambio.negocioId,
    tipo: cambio.tipo,
    clave: p.clave ?? randomUUID(),
    version: (previa?.version ?? 0) + 1,
    nombre: p.nombre,
    descripcion: p.descripcion,
    codigo: p.codigo,
    vista: p.vista,
    cambioId: cambio.id,
  })
  if (!previa) return void (await nueva)
  await db.batch([nueva, db.update(esquema.piezas).set({ activa: false }).where(eq(esquema.piezas.id, previa.id))])
}

/** Vuelve a la versión anterior de la pieza que dejó el Cambio. */
export async function revertirCambio(negocioId: string, cambioId: string) {
  const [cambio] = await db
    .update(esquema.cambios)
    .set({ estado: 'revertido' })
    .where(and(eq(esquema.cambios.id, cambioId), eq(esquema.cambios.negocioId, negocioId), eq(esquema.cambios.estado, 'aplicado')))
    .returning()
  if (!cambio) throw new Error('No encontré ese Cambio aplicado en este Negocio')

  try {
    await revertirVersiones(cambio)
    return cambio
  } catch (e) {
    await db.update(esquema.cambios).set({ estado: 'aplicado' }).where(eq(esquema.cambios.id, cambio.id))
    throw e
  }
}

/** Desactiva la versión que dejó el Cambio y reactiva la anterior de la misma `clave`. */
async function revertirVersiones(cambio: Cambio) {
  const t = esquema.piezas
  const creadas = await db.select().from(t).where(and(eq(t.negocioId, cambio.negocioId), eq(t.cambioId, cambio.id)))
  for (const creada of creadas) {
    await db.update(t).set({ activa: false }).where(eq(t.id, creada.id))
    // Si otro Cambio ya la reemplazó, no hay nada que reactivar.
    if (!creada.activa) continue
    await db
      .update(t)
      .set({ activa: true })
      .where(and(eq(t.negocioId, cambio.negocioId), eq(t.clave, creada.clave), eq(t.version, creada.version - 1)))
  }
}

// --- Lectura ----------------------------------------------------------------------------------------

/** Corre cada pieza activa, aislada, sobre los datos del Negocio, para pintar el Panel. */
export async function piezasActivas(negocioId: NegocioId): Promise<PiezaConResultado[]> {
  const piezas = await db
    .select()
    .from(esquema.piezas)
    .where(and(eq(esquema.piezas.negocioId, negocioId), eq(esquema.piezas.activa, true)))
    .orderBy(esquema.piezas.creado)
  if (!piezas.length) return []
  const datos = await datosDelNegocio(negocioId)
  return Promise.all(
    piezas.map(async (pieza) => {
      const corrida = await correrAislado(pieza.codigo, pieza.tipo === 'indicador' ? 'calcular' : 'consultar', datos)
      if (!corrida.ok) return { pieza, resultado: corrida }
      // Los datos cambian: una pieza que ya no devuelve la forma esperada no llega al Panel.
      const forma = validarForma(pieza.tipo, corrida.valor, pieza.vista)
      return { pieza, resultado: forma.ok ? { ok: true as const, valor: forma.valor, ms: corrida.ms } : { ok: false as const, error: forma.error, ms: corrida.ms } }
    }),
  )
}
