/**
 * El ciclo de vida de una propuesta: lo que espera el botón del Dueño, sea un Cambio, su reversión o la respuesta a
 * un Caso. El Agente del dueño propone; solo el Dueño aprueba. Nadie fuera de esta carpeta abre una transacción
 * (eslint) ni escribe `propuestas` (por convención: el lint no ve escrituras por `@/db`).
 *
 * Una propuesta solo sale de `espera_al_dueno`: a `aplicada` por el reclamo de `aplicarConReclamo`, o a `descartada`
 * por `descartar` o porque otra la reemplaza. `vencida` y `revertida` no se guardan; las deriva `estadoDe`.
 *
 * Una propuesta deja una `Escritura` de Elementos que `aprobar` escribe con `escribir(tx, …)` dentro del mismo
 * reclamo. Sección e Indicador siguen por `./puente.ts` hasta el 2-nov, solos en su propuesta.
 */
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, esquema } from '@/db'
import { conTransaccion, type Transaccion } from '@/db/pool'
import { guardarEnElHilo, mensajeDelAgente } from '@/negocio/dueno-hilo'
import { registrarFaltante, type MotivoDeFaltante } from '../capacidades'
import { conPropuesta, ESCRITURA_VACIA, leerEstado, type Escritura } from '../estado'
import { comoClave, definicionDe, ENTRADA_PARA_PONER, sinCumplidorHoy, type Clave, type ElementoDe, type Problema, type TipoDeElemento, type VersionDelNegocio } from '../estado/elementos'
import { escribir, type ClaveEnConflicto } from '../estado/escribir'
import {
  marcar,
  type CapacidadFaltanteId,
  type CasoId,
  type ClienteId,
  type ContextoDelDueno,
  type DuenoId,
  type Instante,
  type Marca,
  type NegocioId,
  type PropuestaId,
} from '../identidad'
import { despachar, EN_CURSO, intencion, type MotivoDeSilencio, type ResultadoDeEnvio } from '../salida'
import { fueraDeVentana } from '../salida/compuerta'
import { politicaDeAprobacion, type Alcance } from './politica'
import { ESQUEMAS_DEL_PUENTE, escribirLoViejo, proponerLoViejo, revertirLoViejo, vincular, type QuiereDelPuente } from './puente'
import { LARGO_DE_UNA_RESPUESTA, traducir, type Acto, type QuiereDeElementos, type QuierePoner } from './traducir'

export type { Problema } from '../estado/elementos'
export type { MotivoDeFaltante } from '../capacidades'
export type { Acto, QuierePoner } from './traducir'
export type { ClaveEnConflicto } from '../estado/escribir'
export { abrirEnElAlta, guardarEnElAlta } from './alta'
export { queFaltaParaAbrir } from './politica'

// ══ Lo que se puede pedir ═══════════════════════════════════════════════════════════════════════

export type Huella = Marca<string, 'Huella'>

export const VIGENCIA_DE_UNA_PROPUESTA_HORAS = 24

/** Lo de una propuesta se aplica junto o no se aplica. Una Sección o un Indicador van solos. */
const MAXIMO_DE_QUIERE = 10

const esquemaDeRevertir = z
  .object({
    tipo: z.literal('revertir'),
    propuesta: z.uuid().describe('El id de la propuesta aplicada que se quiere deshacer; sale de listar_propuestas').transform(marcar.propuesta),
  })
  .describe('Deshacer algo que ya se aplicó. Es una propuesta nueva: si llega a los clientes, espera el botón.')

const esquemaDeResponderCaso = z
  .object({
    tipo: z.literal('responder_caso'),
    caso: z.uuid().describe('El id del Caso: aparece como [Caso id] en el aviso, o sale de listar_casos').transform(marcar.caso),
    texto: z.string().min(1).max(LARGO_DE_UNA_RESPUESTA).describe('El mensaje exacto para el Cliente, como lo dictó el Dueño'),
  })
  .describe('La respuesta a un Caso. Le llega al Cliente solo cuando el Dueño toca Enviar en la tarjeta.')

const reemplaza = z
  .string()
  .nullish()
  .transform((c) => (c ? comoClave(c) : null))
  .describe('La clave de lo que cambia (de ver_negocio); vacío si es nuevo. dato y voz no la necesitan: su clave es fija')

/** Una variante plana por tipo (`poner_regla`, `poner_dato`…): un nivel menos de JSON Schema que `elemento` anidado. */
function poner<T extends TipoDeElemento, S extends z.ZodObject>(tipo: T, entrada: S, describe: string) {
  return entrada
    .extend({ tipo: z.literal(`poner_${tipo}`), reemplaza })
    .transform((x): QuierePoner => {
      const { reemplaza: clave, ...resto } = x as { reemplaza: Clave | null }
      return { tipo: 'poner', reemplaza: clave, elemento: { ...resto, tipo } as unknown as ElementoDe<T> }
    })
    .describe(describe)
}

const ESQUEMAS_DE_PONER = [
  poner('regla', ENTRADA_PARA_PONER.regla, 'Una regla sobre cómo actúa el agente de clientes.'),
  poner('voz', ENTRADA_PARA_PONER.voz, 'Cómo habla el agente de clientes: trato, emojis y estilo.'),
  poner('dato', ENTRADA_PARA_PONER.dato, 'Un dato del Negocio: descripción, ciudad, horario, envíos o pagos.'),
  poner('pregunta', ENTRADA_PARA_PONER.pregunta, 'Una pregunta frecuente con su respuesta.'),
  poner('producto', ENTRADA_PARA_PONER.producto, 'Un producto del catálogo. Para dejar de venderlo, ponlo con activo false.'),
] as const

const esquemaDeQuitar = z
  .object({
    tipo: z.literal('quitar'),
    claves: z
      .array(z.string().transform(comoClave))
      .min(1)
      .transform((c) => c as unknown as readonly [ReturnType<typeof comoClave>, ...ReturnType<typeof comoClave>[]])
      .describe('Las claves de ver_negocio de lo que se quita'),
  })
  .describe('Quitar reglas, datos, preguntas o productos. Para que un producto deje de venderse sin borrarlo, ponlo con activo: false.')

const ESQUEMA_DE_QUIERE = z.union([...ESQUEMAS_DE_PONER, esquemaDeQuitar, esquemaDeRevertir, esquemaDeResponderCaso, ...ESQUEMAS_DEL_PUENTE])

export type Quiere = QuiereDeElementos | QuiereDelPuente
type Es<A extends true> = A
export type _ElEsquemaPideQuiere = Es<[z.output<typeof ESQUEMA_DE_QUIERE>] extends [Quiere] ? true : false>

/**
 * El esquema de la herramienta `proponer`. `min(1)` hace cierta la conversión a tupla; el modelo ve el esquema de
 * entrada, así que la conversión no lo toca.
 */
export const ESQUEMA_DEL_PEDIDO = z.object({
  palabrasDelDueno: z.string().describe('Lo que pidió el Dueño, en sus palabras'),
  quiere: z
    .array(ESQUEMA_DE_QUIERE)
    .min(1)
    .max(MAXIMO_DE_QUIERE)
    .transform((q) => q as unknown as readonly [Quiere, ...Quiere[]])
    .describe('Lo que el Dueño pidió: se aplica todo junto o nada'),
})

export type PedidoDelDueno = {
  readonly palabrasDelDueno: string
  readonly quiere: readonly [Quiere, ...Quiere[]]
  /** `panel`: el Dueño editó con su mano; su clic es la aprobación. Hoy nadie lo produce. */
  readonly origen: 'hilo' | 'panel'
}

// ══ Lo que vuelve ═══════════════════════════════════════════════════════════════════════════════

export type Gasto = { readonly llamadas: number; readonly usd: number; readonly ms: number }

export type VistaPrevia = { readonly lineas: readonly string[] }
/** Solo líneas. Las de una regla traen la respuesta ensayada del agente a una pregunta de prueba, nunca texto de un Cliente. */
export type VistaPreviaGuardada = VistaPrevia

/**
 * El botón. En la web, una tarjeta; en la semana 5, el botón de WhatsApp `aprobar:<propuesta>:<huella>`. `accion` es
 * el verbo del botón (desvío de `tipos.ts`): una tarjeta recién llegada en el stream todavía no tiene historial.
 */
export type TarjetaDeAprobacion = {
  readonly propuesta: PropuestaId
  readonly huella: Huella
  readonly vence: Instante
  readonly lineas: readonly string[]
  readonly accion: 'aplicar' | 'enviar'
}

/** Quien llama no ramifica: lee `resumen` y pinta `tarjeta` si la hay. `desenlace` es para las pruebas. */
export type ResultadoDeProponer = { readonly resumen: string; readonly gasto: Gasto } & (
  | { readonly desenlace: 'espera_al_dueno'; readonly propuesta: PropuestaId; readonly tarjeta: TarjetaDeAprobacion; readonly vistaPrevia: VistaPrevia }
  | { readonly desenlace: 'aplicado'; readonly propuesta: PropuestaId; readonly tarjeta: null; readonly vistaPrevia: VistaPrevia }
  | { readonly desenlace: 'capacidad_faltante'; readonly tarjeta: null; readonly capacidadFaltante: CapacidadFaltanteId; readonly motivo: MotivoDeFaltante }
  | { readonly desenlace: 'corregir'; readonly tarjeta: null; readonly problemas: readonly Problema[] }
)

export type ResultadoDeAprobar =
  /**
   * También en el doble clic, desde el otro Dueño y en el reintento. `envio` si respondía un Caso. `version`, la del
   * Negocio que dejó la escritura; null si no escribió Elementos (una pieza o una respuesta).
   */
  | { readonly tipo: 'aplicado'; readonly resumen: string; readonly envio: ResultadoDeEnvio | null; readonly version: VersionDelNegocio | null }
  /** Otro Dueño cambió alguna de esas claves después de que se propuso: ROLLBACK, y la propuesta sigue esperando. */
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[] }
  | { readonly tipo: 'vencido' }
  /** La revalidación falló: ROLLBACK, y la propuesta sigue esperando. */
  | { readonly tipo: 'ya_no_cabe'; readonly problemas: readonly Problema[] }
  /** Otro Negocio, otra huella, id mal formado, descartada o inexistente. */
  | { readonly tipo: 'no_existe' }

type EstadoGuardado = (typeof esquema.ESTADOS_DE_PROPUESTA)[number]
export type EstadoDePropuesta = EstadoGuardado | 'vencida' | 'revertida'

export type EntradaDeHistorial = {
  readonly tipo: 'propuesta'
  readonly propuesta: PropuestaId
  readonly palabrasDelDueno: string
  readonly lineas: readonly string[]
  readonly pedidoPor: DuenoId | null
  readonly aprobadoPor: DuenoId | null
  readonly estado: EstadoDePropuesta
  /** El verbo del botón: lo pinta la tarjeta y lo necesitará el botón de WhatsApp. */
  readonly accion: 'aplicar' | 'enviar'
  readonly cuando: Instante
}

type FilaDePropuesta = typeof esquema.propuestas.$inferSelect

function estadoDe(f: { readonly estado: EstadoGuardado; readonly vence: Date }, revertida: boolean, ahora: Date): EstadoDePropuesta {
  if (f.estado === 'espera_al_dueno' && f.vence <= ahora) return 'vencida'
  if (f.estado === 'aplicada' && revertida) return 'revertida'
  return f.estado
}

/** Escrito a mano y no con `${columna}`: dentro de la subconsulta, una columna sin calificar sería la de `r`. */
const REVERTIDA = sql<boolean>`exists (select 1 from propuestas r where r.revierte = "propuestas"."id" and r.estado = 'aplicada')`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HUELLA = /^[0-9a-f]{64}$/
const SIN_GASTO: Gasto = { llamadas: 0, usd: 0, ms: 0 }
const ahora = () => marcar.instante(new Date())
const instanteDe = (d: Date | null) => (d ? marcar.instante(d) : null)

// ══ Proponer ════════════════════════════════════════════════════════════════════════════════════

/** Un pedido del Dueño desde su Hilo. El Negocio sale de `ctx`, nunca del modelo. */
export async function proponer(ctx: ContextoDelDueno, pedido: PedidoDelDueno): Promise<ResultadoDeProponer> {
  return proponerComo({ negocio: ctx.negocio, pedidoPor: ctx.dueno }, pedido)
}

/**
 * La respuesta que trae el aviso de un Caso: una sola propuesta para todos los Dueños (`pedido_por` null). El
 * Negocio sale de la fila del Caso. No publica nada: el aviso arma su mensaje con la tarjeta que vuelve.
 */
export async function proponerRespuestaAlCaso(caso: string, texto: string): Promise<ResultadoDeProponer> {
  const [fila] = UUID.test(caso) ? await db.select({ negocioId: esquema.casos.negocioId }).from(esquema.casos).where(eq(esquema.casos.id, caso)) : []
  if (!fila) return corregir([{ tipo: 'valor_invalido', campo: 'caso', porQue: 'No encontré ese Caso' }])
  return proponerComo(
    { negocio: marcar.negocio(fila.negocioId), pedidoPor: null },
    { palabrasDelDueno: '', quiere: [{ tipo: 'responder_caso', caso: marcar.caso(caso), texto }], origen: 'hilo' },
  )
}

type Quien = { readonly negocio: NegocioId; readonly pedidoPor: DuenoId | null }

type Traducida = {
  readonly alcance: Alcance
  readonly lineas: readonly string[]
  readonly gasto: Gasto
  readonly escritura: Escritura
  /** La pieza del puente que esta propuesta aplica, hasta el 2-nov. */
  readonly cambio: string | null
  readonly revierte: PropuestaId | null
  readonly actos: readonly Acto[]
  /** La versión del Negocio que vio quien propuso: entra en la huella. */
  readonly version: VersionDelNegocio | null
}

type SinPropuesta = Extract<ResultadoDeProponer, { desenlace: 'corregir' | 'capacidad_faltante' }>

const esDelPuente = (q: Quiere): q is QuiereDelPuente => q.tipo === 'seccion' || q.tipo === 'indicador'

async function proponerComo(quien: Quien, pedido: PedidoDelDueno): Promise<ResultadoDeProponer> {
  if (pedido.quiere.length > MAXIMO_DE_QUIERE) return corregir([{ tipo: 'valor_invalido', campo: 'quiere', porQue: `Hasta ${MAXIMO_DE_QUIERE} cosas por propuesta: lo demás va en otra` }])
  if (pedido.quiere.some(esDelPuente) && pedido.quiere.length > 1) return corregir([{ tipo: 'valor_invalido', campo: 'quiere', porQue: 'Una Sección o un Indicador van solos, en su propia propuesta' }])
  const t = await traducirPedido(quien, pedido)
  if ('desenlace' in t) return t

  const [negocio] = await db.select({ modo: esquema.negocios.modo }).from(esquema.negocios).where(eq(esquema.negocios.id, quien.negocio))
  if (!negocio) throw new Error(`No existe el Negocio ${quien.negocio}`)
  const politica = politicaDeAprobacion(negocio.modo ?? 'armando', t.alcance, pedido.origen, t.actos.length > 0)

  const id = marcar.propuesta(randomUUID())
  const huella = huellaDe({ negocio: quien.negocio, cambio: t.cambio, revierte: t.revierte, actos: t.actos, escritura: t.escritura, version: t.version })
  const vence = new Date(Date.now() + VIGENCIA_DE_UNA_PROPUESTA_HORAS * 3600_000)
  const vistaPrevia: VistaPrevia = { lineas: t.lineas }
  await db.batch([
    db.insert(esquema.propuestas).values({
      id,
      negocioId: quien.negocio,
      palabrasDelDueno: pedido.palabrasDelDueno,
      pedidoPor: quien.pedidoPor,
      origen: pedido.origen,
      escritura: t.escritura,
      actos: t.actos,
      revierte: t.revierte,
      huella,
      vence,
      vistaPrevia,
    }),
    ...reemplazadas(quien.negocio, id, t),
    ...(t.cambio ? [vincular(t.cambio, id)] : []),
  ])

  if (politica === 'se_aplica') {
    try {
      const r = await aplicarConReclamo({ negocio: quien.negocio, propuesta: id, huella, aprobadoPor: null })
      if (r.tipo === 'aplicado') return { desenlace: 'aplicado', propuesta: id, tarjeta: null, vistaPrevia, gasto: t.gasto, resumen: armarResumen('aplicado', id, t) }
    } catch (e) {
      console.error('[cambios] la política no pudo aplicarla; queda con tarjeta', id, e)
    }
  }
  const tarjeta: TarjetaDeAprobacion = { propuesta: id, huella, vence: marcar.instante(vence), lineas: t.lineas, accion: t.actos.length ? 'enviar' : 'aplicar' }
  return { desenlace: 'espera_al_dueno', propuesta: id, tarjeta, vistaPrevia, gasto: t.gasto, resumen: armarResumen('espera_al_dueno', id, t) }
}

/** Una respuesta pendiente por Caso y una reversión pendiente por propuesta: la nueva deja descartada a la vieja. */
function reemplazadas(negocio: NegocioId, nueva: PropuestaId, t: Traducida) {
  const pendientes = and(eq(esquema.propuestas.negocioId, negocio), eq(esquema.propuestas.estado, 'espera_al_dueno'), ne(esquema.propuestas.id, nueva))
  const descartar = (cuales: ReturnType<typeof and>) => db.update(esquema.propuestas).set({ estado: 'descartada' }).where(and(pendientes, cuales))
  const [acto] = t.actos
  if (acto) return [descartar(sql`${esquema.propuestas.actos} @> ${JSON.stringify([{ caso: acto.caso }])}::jsonb`)]
  if (t.revierte) return [descartar(eq(esquema.propuestas.revierte, t.revierte))]
  return []
}

const SIN_PIEZA = { cambio: null, gasto: SIN_GASTO } as const

async function traducirPedido(quien: Quien, pedido: PedidoDelDueno): Promise<Traducida | SinPropuesta> {
  const [q] = pedido.quiere
  if (esDelPuente(q)) return traducirPieza(quien, pedido.palabrasDelDueno, q)
  if (q.tipo === 'revertir' && (await esDelPuenteLaPropuesta(quien.negocio, q.propuesta))) return traducirReversionVieja(quien.negocio, q.propuesta)
  const estado = await leerEstado(quien.negocio)
  const t = await traducir(estado, pedido.quiere as readonly QuiereDeElementos[])
  if (!('tipo' in t)) return { ...t, ...SIN_PIEZA, version: estado.version }
  if (t.tipo === 'corregir') return corregir(t.problemas)
  return faltante(quien.negocio, pedido.palabrasDelDueno, t.motivo, SIN_GASTO)
}

async function faltante(negocio: NegocioId, palabras: string, motivo: MotivoDeFaltante, gasto: Gasto): Promise<SinPropuesta> {
  const capacidadFaltante = await registrarFaltante(negocio, palabras, motivo)
  const porQue = motivo.tipo === 'sin_converger' ? `No lo logré armar (${motivo.ultimoError.slice(0, 300)}).` : 'Eso todavía no lo sé hacer cumplir.'
  return { desenlace: 'capacidad_faltante', tarjeta: null, capacidadFaltante, motivo, gasto, resumen: `${porQue} Quedó anotado para el equipo de Amanece; díselo al Dueño sin tecnicismos y sin prometer cuándo.` }
}

async function traducirPieza(quien: Quien, palabras: string, q: QuiereDelPuente): Promise<Traducida | SinPropuesta> {
  const r = await proponerLoViejo(quien, q)
  if (r.tipo === 'listo') return { alcance: r.alcance, lineas: r.lineas, gasto: r.gasto, escritura: ESCRITURA_VACIA, cambio: r.cambio, revierte: null, actos: [], version: null }
  return faltante(quien.negocio, palabras, { tipo: 'sin_converger', ultimoError: r.ultimoError }, r.gasto)
}

/** Una aplicada sin Elementos ni actos la escribió el puente: una pieza, o una regla o conocimiento de antes del corte. */
async function esDelPuenteLaPropuesta(negocio: NegocioId, propuesta: PropuestaId): Promise<boolean> {
  const [p] = await db
    .select({ escritura: esquema.propuestas.escritura, actos: esquema.propuestas.actos })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.id, propuesta), eq(esquema.propuestas.negocioId, negocio)))
  return p !== undefined && p.escritura.elementos.length === 0 && p.actos.length === 0
}

async function traducirReversionVieja(negocio: NegocioId, propuesta: PropuestaId): Promise<Traducida | SinPropuesta> {
  const [p] = await db
    .select({ estado: esquema.propuestas.estado, revierte: esquema.propuestas.revierte, vistaPrevia: esquema.propuestas.vistaPrevia, revertida: REVERTIDA })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.id, propuesta), eq(esquema.propuestas.negocioId, negocio)))
  const invalida = (porQue: string) => corregir([{ tipo: 'valor_invalido', campo: 'propuesta', porQue }])
  if (!p || p.estado !== 'aplicada') return invalida('Esa propuesta no está aplicada')
  if (p.revertida) return invalida('Eso ya se deshizo')
  if (p.revierte) return invalida('Deshacer una reversión no se puede: para volver a tenerlo, pídelo de nuevo')
  const r = await revertirLoViejo(negocio, { propuesta, lineas: p.vistaPrevia.lineas })
  if (r.tipo === 'corregir') return corregir(r.problemas)
  return { alcance: r.alcance, lineas: r.lineas, gasto: r.gasto, escritura: ESCRITURA_VACIA, cambio: null, revierte: propuesta, actos: [], version: null }
}

function corregir(problemas: readonly Problema[]): SinPropuesta {
  return { desenlace: 'corregir', tarjeta: null, problemas, gasto: SIN_GASTO, resumen: `No lo dejé listo. ${problemas.map(problemaEnPalabras).join(' ')} Explícaselo al Dueño con palabras sencillas.` }
}

export function problemaEnPalabras(p: Problema): string {
  switch (p.tipo) {
    case 'valor_invalido':
      return `${p.porQue}.`
    case 'referencia_rota':
      return `No encontré ${p.clave} en este Negocio: míralo con ver_negocio.`
    case 'referencia_huerfana':
      return `${p.quitada} lo usa ${p.usadaPor}: quítalos juntos o deja los dos.`
    case 'norma':
      return `El texto de ${p.campo} no puede llegar a un Cliente así (${p.motivo}).`
    case 'fuera_de_ventana':
      return 'Pasaron más de 24 horas desde el último mensaje de ese Cliente: WhatsApp no deja escribirle hasta que vuelva a escribir.'
    case 'caso_resuelto':
      return 'Ese Caso ya tiene respuesta.'
    case 'solo_mientras_se_arma':
      return 'Eso solo se hace mientras el Negocio se arma.'
  }
}

/**
 * sha256 del contenido canónico (claves ordenadas). Ata el botón a exactamente lo que se mostró: la fila no se edita
 * después de insertarse. Sin azar: el mismo texto para el mismo Caso da la misma clave de salida y no sale dos veces.
 */
function huellaDe(contenido: {
  readonly negocio: NegocioId
  readonly cambio: string | null
  readonly revierte: PropuestaId | null
  readonly actos: readonly Acto[]
  readonly escritura: Escritura
  readonly version: VersionDelNegocio | null
}): Huella {
  return createHash('sha256').update(canonico(contenido)).digest('hex') as Huella
}

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** Lo único que ve el modelo, sin la huella. El id va para que pueda descartarla sin listar. */
function armarResumen(desenlace: 'espera_al_dueno' | 'aplicado', id: PropuestaId, t: Traducida): string {
  const lineas = t.lineas.map((l) => `- ${l}`).join('\n')
  if (desenlace === 'aplicado') return `Ya quedó aplicado, sin botón porque solo lo ve el Dueño [Propuesta ${id}]:\n${lineas}`
  const boton = t.actos.length ? 'Enviar' : 'Aplicar'
  return `Quedó lista la tarjeta [Propuesta ${id}]:\n${lineas}\nSe ${t.actos.length ? 'envía' : 'aplica'} solo cuando el Dueño toque ${boton} en la tarjeta. No digas que ya quedó ni le pidas que te diga que sí.`
}

// ══ Aprobar ═════════════════════════════════════════════════════════════════════════════════════

/**
 * Un acto del Dueño autenticado: la tarjeta en la web. El modelo no tiene cómo llamarlo. `propuesta` y `huella`
 * llegan crudos de HTTP: uno mal formado es `no_existe`, así la ruta no parsea nada. Idempotente.
 */
export async function aprobar(ctx: ContextoDelDueno, propuesta: string, huella: string): Promise<ResultadoDeAprobar> {
  if (!UUID.test(propuesta) || !HUELLA.test(huella)) return { tipo: 'no_existe' }
  const r = await aplicarConReclamo({ negocio: ctx.negocio, propuesta: marcar.propuesta(propuesta), huella, aprobadoPor: ctx.dueno })
  if (r.tipo !== 'aplicado') return r
  // Ya hubo COMMIT: una falla al avisar no convierte lo aplicado en un error para el Dueño.
  const desenlace = await desenlaceEnPalabras(ctx.negocio, r.fila, r.envio).catch((e) => {
    console.error('[aprobar] no pude armar el desenlace', propuesta, e)
    return null
  })
  if (desenlace && r.avisar) await avisarEnLosHilos(ctx.negocio, r.fila, desenlace).catch((e) => console.error('[aprobar] no pude avisar en los Hilos', propuesta, e))
  return { tipo: 'aplicado', resumen: desenlace?.texto ?? 'Aplicado.', envio: r.envio, version: versionDe(r.fila) }
}

/** Lo que se le responde a un Cliente, ya revalidado dentro del reclamo. */
type Respuesta = { readonly caso: CasoId; readonly cliente: ClienteId; readonly texto: string }

type Reclamo =
  | { readonly tipo: 'reclamada'; readonly fila: FilaDePropuesta; readonly respuesta: Respuesta | null }
  | { readonly tipo: 'sin_reclamo' }
  | { readonly tipo: 'ya_no_cabe'; readonly problemas: readonly Problema[] }
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[] }

/** `avisar`: este clic es el que deja la línea del desenlace en los Hilos. El doble clic no. */
type Aplicada = { readonly tipo: 'aplicado'; readonly fila: FilaDePropuesta; readonly envio: ResultadoDeEnvio | null; readonly avisar: boolean }

const versionDe = (f: FilaDePropuesta): VersionDelNegocio | null => (f.version === null ? null : (f.version as VersionDelNegocio))

/**
 * La única manera de aplicar una propuesta: la usan el botón y la política. El reclamo va en una transacción de
 * `Pool` que sostiene la fila tomada mientras escribe el puente: un segundo clic espera en el `UPDATE` y, al
 * soltarse, relee. Si el puente lanza, hay ROLLBACK y nadie recibió `aplicado` sobre algo que no quedó.
 */
async function aplicarConReclamo(a: {
  readonly negocio: NegocioId
  readonly propuesta: PropuestaId
  readonly huella: string
  readonly aprobadoPor: DuenoId | null
}): Promise<Aplicada | Exclude<ResultadoDeAprobar, { tipo: 'aplicado' }>> {
  const noCabe = await revalidar(a)
  if (noCabe.length) return { tipo: 'ya_no_cabe', problemas: noCabe }
  const reclamo = await conTransaccion<Reclamo>(async (tx, deshacer) => {
    // Un primer clic colgado no deja esperando al segundo para siempre.
    await tx.execute(sql`set local lock_timeout = '10s'`)
    const [fila] = await tx
      .update(esquema.propuestas)
      .set({ estado: 'aplicada', aprobadoPor: a.aprobadoPor })
      .where(
        and(
          eq(esquema.propuestas.id, a.propuesta),
          eq(esquema.propuestas.negocioId, a.negocio),
          eq(esquema.propuestas.huella, a.huella),
          eq(esquema.propuestas.estado, 'espera_al_dueno'),
          gt(esquema.propuestas.vence, sql`now()`),
        ),
      )
      .returning()
    if (!fila) return { tipo: 'sin_reclamo' }
    const [acto] = fila.actos
    if (acto) {
      const r = await cerrarCaso(tx, a.negocio, acto)
      return 'problema' in r ? deshacer({ tipo: 'ya_no_cabe', problemas: [r.problema] }) : { tipo: 'reclamada', fila, respuesta: r }
    }
    if (fila.escritura.elementos.length) {
      const r = await escribir(tx, a.negocio, { tipo: 'propuesta', propuesta: a.propuesta }, fila.escritura)
      if (r.tipo === 'conflicto') return deshacer(r)
      const [conVersion] = await tx.update(esquema.propuestas).set({ version: r.version }).where(eq(esquema.propuestas.id, a.propuesta)).returning()
      return { tipo: 'reclamada', fila: conVersion, respuesta: null }
    }
    const r = await escribirLoViejo(a.negocio, { propuesta: a.propuesta, revierte: fila.revierte ? marcar.propuesta(fila.revierte) : null })
    return r.tipo === 'ya_no_cabe' ? deshacer(r) : { tipo: 'reclamada', fila, respuesta: null }
  })
  switch (reclamo.tipo) {
    case 'ya_no_cabe':
    case 'conflicto':
      return reclamo
    case 'reclamada':
      // Fuera de la transacción: `despachar` no corre dentro de una. La clave lleva la huella, así que es idempotente.
      return { tipo: 'aplicado', fila: reclamo.fila, envio: reclamo.respuesta ? await despacharDespuesDelCommit(intencionDe(a.negocio, reclamo.respuesta, reclamo.fila.huella)) : null, avisar: true }
    case 'sin_reclamo':
      return releer(a)
  }
}

/**
 * Lo que la propuesta deja, otra vez contra el estado de ahora y sin modelo. Solo si todavía espera: un doble clic
 * no se revalida contra lo que él mismo escribió.
 */
async function revalidar(a: { readonly negocio: NegocioId; readonly propuesta: PropuestaId }): Promise<readonly Problema[]> {
  const [p] = await db
    .select({ estado: esquema.propuestas.estado, escritura: esquema.propuestas.escritura })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.id, a.propuesta), eq(esquema.propuestas.negocioId, a.negocio)))
  if (!p || p.estado !== 'espera_al_dueno' || !p.escritura.elementos.length) return []
  const borrador = conPropuesta(await leerEstado(a.negocio), p.escritura)
  return p.escritura.elementos.flatMap((c): Problema[] => {
    if (!c.despues) return []
    const faltan = c.despues.tipo === 'regla' ? sinCumplidorHoy(c.despues) : []
    if (faltan.length) return [{ tipo: 'valor_invalido', campo: 'regla', porQue: `Hoy nada hace cumplir ${faltan.join(', ')}` }]
    return [...definicionDe(c.despues.tipo).validar(c.despues, c.clave, borrador)]
  })
}

/**
 * Dentro del reclamo. El candado de la fila del Caso serializa dos respuestas al mismo Caso. La ventana se frena
 * aquí porque la compuerta observa y un `no_sale` saldría igual.
 */
async function cerrarCaso(tx: Transaccion, negocio: NegocioId, acto: Acto): Promise<Respuesta | { readonly problema: Problema }> {
  const [caso] = await tx
    .update(esquema.casos)
    .set({ estado: 'resuelto', resolucion: acto.texto, resuelto: new Date() })
    .where(and(eq(esquema.casos.id, acto.caso), eq(esquema.casos.negocioId, negocio), ne(esquema.casos.estado, 'resuelto')))
    .returning({ cliente: esquema.casos.clienteId })
  if (!caso) return { problema: { tipo: 'caso_resuelto', caso: acto.caso } }
  const [cliente] = caso.cliente
    ? await tx
        .select({ id: esquema.clientes.id, ultimo: esquema.clientes.ultimoMensajeEntrante })
        .from(esquema.clientes)
        .where(and(eq(esquema.clientes.id, caso.cliente), eq(esquema.clientes.negocioId, negocio)))
    : []
  if (!cliente) return { problema: { tipo: 'valor_invalido', campo: 'cliente', porQue: 'Ese Caso no tiene un Cliente al que escribirle' } }
  const id = marcar.cliente(cliente.id)
  if (fueraDeVentana(instanteDe(cliente.ultimo), ahora())) return { problema: { tipo: 'fuera_de_ventana', cliente: id } }
  return { caso: acto.caso, cliente: id, texto: acto.texto }
}

/** Después del COMMIT, una excepción de `despachar` es un envío que no salió, no un `aprobar` fallido. */
async function despacharDespuesDelCommit(i: ReturnType<typeof intencionDe>): Promise<ResultadoDeEnvio> {
  try {
    return await despachar(i)
  } catch (e) {
    console.error('[aprobar] despachar falló después del COMMIT', i.clave, e)
    return { tipo: 'por_enviar', error: e instanceof Error ? e.message : String(e) }
  }
}

/** La fila que otro clic acaba de reclamar en `despachar` y todavía está enviando: va en camino, no es una falla. */
function enCamino(envio: ResultadoDeEnvio | null): boolean {
  return envio?.tipo === 'por_enviar' && envio.error === EN_CURSO
}

function intencionDe(negocio: NegocioId, r: Respuesta, huella: string) {
  return intencion.resolucionDeCaso({ destinatario: { tipo: 'cliente', negocio, cliente: r.cliente }, texto: r.texto, caso: r.caso, vez: huella })
}

/** Sin reclamo: el doble clic, el otro Dueño o un reintento. Lo que diga la fila manda. */
async function releer(a: { readonly negocio: NegocioId; readonly propuesta: PropuestaId; readonly huella: string }): Promise<Aplicada | Exclude<ResultadoDeAprobar, { tipo: 'aplicado' }>> {
  const [f] = await db
    .select()
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.id, a.propuesta), eq(esquema.propuestas.negocioId, a.negocio)))
  if (!f || f.huella !== a.huella) return { tipo: 'no_existe' }
  if (f.estado === 'aplicada') return { tipo: 'aplicado', fila: f, ...(await reintentarRespuesta(a.negocio, f)) }
  if (f.estado === 'espera_al_dueno' && f.vence <= new Date()) return { tipo: 'vencido' }
  return { tipo: 'no_existe' }
}

/**
 * Si el clic que ganó cayó entre el COMMIT y `despachar`, este clic despacha con la misma clave. Antes vuelve a
 * mirar la ventana, porque la compuerta la dejaría salir: si ya cerró y nada salió, no sale, y como nadie escribió
 * la línea del desenlace, la escribe este clic.
 */
async function reintentarRespuesta(negocio: NegocioId, f: FilaDePropuesta): Promise<{ readonly envio: ResultadoDeEnvio | null; readonly avisar: boolean }> {
  const [acto] = f.actos
  if (!acto) return { envio: null, avisar: false }
  const [cliente] = await db
    .select({ id: esquema.clientes.id, ultimo: esquema.clientes.ultimoMensajeEntrante })
    .from(esquema.casos)
    .innerJoin(esquema.clientes, and(eq(esquema.clientes.id, esquema.casos.clienteId), eq(esquema.clientes.negocioId, esquema.casos.negocioId)))
    .where(and(eq(esquema.casos.id, acto.caso), eq(esquema.casos.negocioId, negocio)))
  if (!cliente) return { envio: null, avisar: false }
  const i = intencionDe(negocio, { caso: acto.caso, cliente: marcar.cliente(cliente.id), texto: acto.texto }, f.huella)
  const yaHayEnvio = (await db.$count(esquema.mensajesSalientes, eq(esquema.mensajesSalientes.clave, i.clave))) > 0
  if (!yaHayEnvio && fueraDeVentana(instanteDe(cliente.ultimo), ahora())) return { envio: { tipo: 'no_salio', motivo: 'fuera_de_ventana' }, avisar: true }
  return { envio: await despacharDespuesDelCommit(i), avisar: false }
}

const MOTIVO_EN_PALABRAS = {
  emergencia: 'los envíos están detenidos por una emergencia.',
  negocio_en_sombra: 'el Negocio está en sombra y no le habla a nadie.',
  numero_no_permitido: 'el número de Amanece no está listo para enviar.',
  destinatario_de_otro_negocio: 'ese Cliente no es de este Negocio.',
  fuera_de_ventana: 'pasaron más de 24 horas desde su último mensaje y WhatsApp no deja escribirle hasta que vuelva a escribir.',
  una_respuesta_por_mensaje: 'ya se le había respondido ese mensaje.',
} as const satisfies Record<MotivoDeSilencio, string>

type Desenlace = { readonly texto: string; readonly por: string }

/** Lo arma el código, nunca el modelo. Nombra a quien aprobó, que en un reintento puede ser el otro Dueño. */
async function desenlaceEnPalabras(negocio: NegocioId, f: FilaDePropuesta, envio: ResultadoDeEnvio | null): Promise<Desenlace> {
  const [quien] = f.aprobadoPor ? await db.select({ nombre: esquema.duenos.nombre }).from(esquema.duenos).where(eq(esquema.duenos.id, f.aprobadoPor)) : []
  const por = quien?.nombre || 'Un Dueño'
  const [acto] = f.actos
  if (!acto) return { por, texto: `${por} aplicó: ${f.vistaPrevia.lineas[0] ?? 'el Cambio'}` }
  const [cliente] = await db
    .select({ nombre: esquema.clientes.nombre })
    .from(esquema.casos)
    .innerJoin(esquema.clientes, eq(esquema.clientes.id, esquema.casos.clienteId))
    .where(and(eq(esquema.casos.id, acto.caso), eq(esquema.casos.negocioId, negocio)))
  const a = cliente?.nombre || 'el Cliente'
  if (enCamino(envio)) return { por, texto: `${por} le respondió a ${a}: «${acto.texto}»` }
  switch (envio?.tipo) {
    case 'por_enviar':
      return { por, texto: `${por} aprobó la respuesta a ${a}, pero WhatsApp no la tomó. Escríbele tú directamente.` }
    case 'no_salio':
      return { por, texto: `${por} aprobó la respuesta a ${a}, pero no salió: ${MOTIVO_EN_PALABRAS[envio.motivo]}` }
    default:
      return { por, texto: `${por} le respondió a ${a}: «${acto.texto}»` }
  }
}

/**
 * Una línea fija en el Hilo de cada Dueño del Negocio: así se entera el otro Dueño y, en el turno siguiente, el
 * modelo, que solo había visto `resumen`. `data-aprobacion` le da al modelo el id sin la huella.
 */
async function avisarEnLosHilos(negocio: NegocioId, f: FilaDePropuesta, d: Desenlace): Promise<void> {
  const duenos = await db.select({ id: esquema.duenos.id }).from(esquema.duenos).where(eq(esquema.duenos.negocioId, negocio)).orderBy(asc(esquema.duenos.creado))
  for (const dueno of duenos) {
    await guardarEnElHilo(negocio, dueno.id, 'agente', mensajeDelAgente(d.texto, [{ type: 'data-aprobacion', data: { propuesta: f.id, por: d.por } }]))
  }
}

// ══ Descartar e historial ═══════════════════════════════════════════════════════════════════════

/** No aplica nada: lo llaman la tarjeta y el modelo. Si `aprobar` tiene la fila tomada, espera su COMMIT y no toca una aplicada. */
export async function descartar(ctx: ContextoDelDueno, propuesta: string): Promise<{ readonly tipo: 'descartada' } | { readonly tipo: 'no_existe' }> {
  if (!UUID.test(propuesta)) return { tipo: 'no_existe' }
  const [f] = await db
    .update(esquema.propuestas)
    .set({ estado: 'descartada' })
    .where(and(eq(esquema.propuestas.id, propuesta), eq(esquema.propuestas.negocioId, ctx.negocio), eq(esquema.propuestas.estado, 'espera_al_dueno')))
    .returning({ id: esquema.propuestas.id })
  return f ? { tipo: 'descartada' } : { tipo: 'no_existe' }
}

/** Las propuestas del Negocio, de todos sus Dueños: las últimas `limite`, o las de las tarjetas de un Hilo. */
export async function historial(ctx: ContextoDelDueno, filtro: { readonly limite: number } | { readonly propuestas: readonly string[] }): Promise<readonly EntradaDeHistorial[]> {
  const delNegocio = eq(esquema.propuestas.negocioId, ctx.negocio)
  const consulta = db.select({ fila: esquema.propuestas, revertida: REVERTIDA }).from(esquema.propuestas)
  const ids = 'propuestas' in filtro ? filtro.propuestas.filter((id) => UUID.test(id)) : []
  const filas =
    'limite' in filtro
      ? await consulta.where(delNegocio).orderBy(desc(esquema.propuestas.creado)).limit(filtro.limite)
      : ids.length
        ? await consulta.where(and(delNegocio, inArray(esquema.propuestas.id, ids)))
        : []
  const cuando = new Date()
  return filas.map(({ fila: f, revertida }) => ({
    tipo: 'propuesta',
    propuesta: marcar.propuesta(f.id),
    palabrasDelDueno: f.palabrasDelDueno,
    lineas: f.vistaPrevia.lineas,
    pedidoPor: f.pedidoPor ? marcar.dueno(f.pedidoPor) : null,
    aprobadoPor: f.aprobadoPor ? marcar.dueno(f.aprobadoPor) : null,
    estado: estadoDe(f, revertida, cuando),
    accion: f.actos.some((acto) => acto.tipo === 'responder_caso') ? 'enviar' : 'aplicar',
    cuando: marcar.instante(f.creado),
  }))
}
