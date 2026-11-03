/**
 * El ciclo de vida de una propuesta: lo que espera el botón del Dueño, sea un Cambio, su reversión o la respuesta a
 * un Caso. El Agente del dueño propone; solo el Dueño aprueba. Nadie fuera de esta carpeta abre una transacción
 * (eslint) ni escribe `propuestas` (por convención: el lint no ve escrituras por `@/db`).
 *
 * Una propuesta solo sale de `espera_al_dueno`: a `aplicada` por el reclamo de `aplicarConReclamo`, o a `descartada`
 * por `descartar` o porque otra la reemplaza. `vencida` y `revertida` no se guardan; las deriva `estadoDe`.
 *
 * Una propuesta deja una `Escritura` de Elementos que `aprobar` escribe con `escribir(tx, …)` dentro del mismo
 * reclamo. Una Sección o un Indicador va solo en su propuesta.
 */
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, esquema } from '@/db'
import { conTransaccion, type Transaccion } from '@/db/pool'
import { avisarEnLosHilos } from '@/negocio/dueno-hilo'
import { registrarFaltante, type MotivoDeFaltante } from '../capacidades'
import { leerAplicado, leerPublicado, type Escritura, type EstadoAplicado } from '../estado'
import { alcanceDeLaClave, comoClave, ENTRADA_PARA_PONER, type Clave, type ElementoDe, type Problema, type TipoDeElemento, type VersionDelNegocio } from '../estado/elementos'
import { escribir, type ClaveEnConflicto, type LoRevertido } from '../estado/escribir'
import {
  marcar,
  type CapacidadFaltanteId,
  type CasoId,
  type ClienteId,
  type ContextoDelDueno,
  type DuenoId,
  type Instante,
  type NegocioId,
  type PropuestaId,
} from '../identidad'
import { explicar } from '../consultas/validar'
import { despachar, EN_CURSO, intencion, type MotivoDeSilencio, type ResultadoDeEnvio } from '../salida'
import { fueraDeVentana } from '../salida/compuerta'
import type { Motores } from '../clientes/turno'
import { vistaPreviaDe, type VistaPreviaGuardada } from './ensayar'
import { accionDe, filaNueva, type OrigenDelPedido, type TarjetaDeAprobacion } from './fila'
import { confirmadaEnPalabras, lineasDeLaTarjeta, palabrasDeLaLectura, type Lectura } from './lectura'
import { politicaDeAprobacion, type Alcance } from './politica'
import type { MotorDelRedactor } from './redactar-consulta'
import { LARGO_DE_UNA_RESPUESTA, traducir, type Acto, type QuiereDeElementos, type QuiereDelPanel, type QuierePoner } from './traducir'

export type { Problema } from '../estado/elementos'
export type { MotivoDeFaltante } from '../capacidades'
export type { Acto, QuiereDelPanel, QuierePoner } from './traducir'
export { INTENTOS_DE_REDACTAR, SALIDA_DEL_REDACTOR, type MotorDelRedactor, type SalidaDelRedactor } from './redactar-consulta'
export type { ClaveEnConflicto } from '../estado/escribir'
export { abrirEnElAlta, guardarEnElAlta, type ResultadoDelAlta } from './alta'
export { queFaltaParaAbrir, type Falta } from './politica'
export { VIGENCIA_DE_UNA_PROPUESTA_HORAS, type Huella, type OrigenDelPedido, type TarjetaDeAprobacion } from './fila'
export type { Ensayo, LoQuePaso, Muestra, VistaPreviaDeConversaciones, VistaPreviaGuardada } from './ensayar'
export { leerLoPendiente, publicar, type ItemDeLoPendiente, type LoPendiente, type ResultadoDePublicar } from './publicar'
export { armarLectura, buscarProducto, EXTRACTOR, lecturaPendiente, type Extractor, type Lectura, type LoExtraido } from './lectura'

// ══ Lo que se puede pedir ═══════════════════════════════════════════════════════════════════════

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

/** Planas, como `poner_<tipo>`: el Agente del dueño dice qué quiere ver y el redactor escribe la consulta. */
const ESQUEMAS_DEL_PANEL = [
  ENTRADA_PARA_PONER.seccion
    .extend({ tipo: z.literal('poner_seccion'), reemplaza })
    .transform((x): QuiereDelPanel => ({ tipo: 'panel', que: 'seccion', salida: 'filas', nombre: x.nombre, queQuiereVer: x.queQuiereVer, reemplaza: x.reemplaza }))
    .describe('Una lista en el Panel (por ejemplo pedidos con novedad). Solo la ve el Dueño. Va sola en su propuesta.'),
  ENTRADA_PARA_PONER.indicador
    .extend({ tipo: z.literal('poner_indicador'), forma: z.enum(['numero', 'serie']).describe('numero: una sola cifra; serie: una cifra por día, semana o producto, también para "cuál es el más vendido", porque el nombre va en la etiqueta'), reemplaza })
    .transform((x): QuiereDelPanel => ({ tipo: 'panel', que: 'indicador', salida: x.forma, nombre: x.nombre, queQuiereVer: x.queQuiereVer, reemplaza: x.reemplaza }))
    .describe('Un número o una serie en el Panel (por ejemplo pedidos confirmados por día). Solo lo ve el Dueño. Va solo en su propuesta.'),
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
  .describe('Quitar reglas, datos, preguntas, productos, secciones o indicadores. Para que un producto deje de venderse sin borrarlo, ponlo con activo: false.')

const ESQUEMA_DE_QUIERE = z.union([...ESQUEMAS_DE_PONER, ...ESQUEMAS_DEL_PANEL, esquemaDeQuitar, esquemaDeRevertir, esquemaDeResponderCaso])

export type Quiere = QuiereDeElementos
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

type PedidoEnPalabras<O extends OrigenDelPedido> = { readonly origen: O; readonly palabrasDelDueno: string; readonly quiere: readonly [Quiere, ...Quiere[]] }

/** `lectura` la arma solo `proponerLectura`: el modelo no tiene esquema para ella. */
export type PedidoDelDueno = PedidoEnPalabras<'hilo'> | { readonly origen: 'lectura'; readonly fuente: string; readonly quiere: readonly [QuierePoner, ...QuierePoner[]] }

/** `panel`: el clic del Dueño es la aprobación, así que no puede entrar por `proponer`. Solo lo produce `deshacer`. */
type PedidoConSuClic = PedidoDelDueno | PedidoEnPalabras<'panel'>

// ══ Lo que vuelve ═══════════════════════════════════════════════════════════════════════════════

export type Gasto = { readonly llamadas: number; readonly usd: number; readonly ms: number }

export type VistaPrevia = VistaPreviaGuardada

/** Quien llama no ramifica: lee `resumen` y pinta `tarjeta` si la hay. `desenlace` es para las pruebas. */
export type ResultadoDeProponer = { readonly resumen: string; readonly gasto: Gasto } & (
  | { readonly desenlace: 'espera_al_dueno'; readonly propuesta: PropuestaId; readonly tarjeta: TarjetaDeAprobacion; readonly vistaPrevia: VistaPrevia }
  /** `tarjeta`: la de Deshacer, si es algo del Panel recién aplicado en un Negocio abierto. */
  | { readonly desenlace: 'aplicado'; readonly propuesta: PropuestaId; readonly tarjeta: TarjetaDeAprobacion | null; readonly vistaPrevia: VistaPrevia }
  | { readonly desenlace: 'capacidad_faltante'; readonly tarjeta: null; readonly capacidadFaltante: CapacidadFaltanteId; readonly motivo: MotivoDeFaltante }
  | { readonly desenlace: 'corregir'; readonly tarjeta: null; readonly problemas: readonly Problema[] }
)

export type ResultadoDeAprobar =
  /**
   * También en el doble clic, desde el otro Dueño y en el reintento. `envio` si respondía un Caso. `version`, la del
   * Negocio que dejó la escritura; null si no escribió Elementos (una pieza o una respuesta).
   */
  | { readonly tipo: 'aplicado'; readonly resumen: string; readonly envio: ResultadoDeEnvio | null; readonly version: VersionDelNegocio | null }
  /**
   * Otro cambió alguna de esas claves después de que se propuso: ROLLBACK, y la propuesta queda descartada porque
   * ya nunca podrá aplicarse. `resumen` dice quién tocó qué y cuándo.
   */
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[]; readonly resumen: string }
  | { readonly tipo: 'vencido' }
  /** Ya no cabe en el estado de ahora (`escribir` revalida dentro del reclamo): ROLLBACK, y la propuesta sigue esperando. */
  | { readonly tipo: 'ya_no_cabe'; readonly problemas: readonly Problema[]; readonly resumen: string }
  /** Otro Negocio, otra huella, id mal formado, descartada o inexistente. */
  | { readonly tipo: 'no_existe' }

export type ResultadoDeDeshacer =
  | { readonly tipo: 'deshecho'; readonly resumen: string }
  | { readonly tipo: 'conflicto' | 'ya_no_cabe'; readonly resumen: string }
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
  readonly accion: TarjetaDeAprobacion['accion']
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

/** Un pedido del Dueño desde su Hilo. El Negocio sale de `ctx`, nunca del modelo. `motores` y `redactor` solo los cambian los `probar`. */
export async function proponer(ctx: ContextoDelDueno, pedido: PedidoDelDueno, motores?: Motores, redactor?: MotorDelRedactor): Promise<ResultadoDeProponer> {
  return proponerComo({ negocio: ctx.negocio, pedidoPor: ctx.dueno }, pedido, motores, redactor)
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

/**
 * La tarjeta de lo leído de un enlace: espera el botón aunque el Negocio se esté armando. Pasa por `traducir` ítem por
 * ítem (lo que no cabe o no pasa `revisarTextoDelDueno` se cae y se cuenta) y lo que queda va en una sola propuesta,
 * que descarta la lectura pendiente anterior. Si esa propuesta no se arma, `noSeArmo` dice por qué: lo leído no se
 * vuelve «nada nuevo».
 */
export async function proponerLectura(
  ctx: ContextoDelDueno,
  lectura: Lectura,
): Promise<{ readonly tarjeta: TarjetaDeAprobacion | null; readonly leidos: number; readonly descartados: number; readonly noSeArmo: string | null }> {
  const estado = await leerAplicado(ctx.negocio)
  const quedan: QuierePoner[] = []
  for (const q of lectura.quiere) if (!('tipo' in (await traducir(estado, [q])))) quedan.push(q)
  const descartados = lectura.descartados + lectura.quiere.length - quedan.length
  const [primero, ...resto] = quedan
  if (!primero) return { tarjeta: null, leidos: 0, descartados, noSeArmo: null }
  const r = await proponerComo({ negocio: ctx.negocio, pedidoPor: ctx.dueno }, { origen: 'lectura', fuente: lectura.fuente, quiere: [primero, ...resto] })
  return { tarjeta: r.tarjeta, leidos: quedan.length, descartados, noSeArmo: r.tarjeta ? null : r.resumen }
}

type Quien = { readonly negocio: NegocioId; readonly pedidoPor: DuenoId | null }

type Traducida = {
  readonly alcance: Alcance
  readonly lineas: readonly string[]
  readonly gasto: Gasto
  readonly escritura: Escritura
  readonly revierte: PropuestaId | null
  readonly actos: readonly Acto[]
  /** La versión del Negocio que vio quien propuso: entra en la huella. */
  readonly version: VersionDelNegocio | null
  /** Lo que leyó `traducir`. */
  readonly estado: EstadoAplicado
  /** Las del ensayo: el código las escribe y van arriba de la tarjeta y primero en el resumen. */
  readonly advertencias: readonly string[]
  readonly soloVistaPrevia: readonly Clave[]
}

type SinPropuesta = Extract<ResultadoDeProponer, { desenlace: 'corregir' | 'capacidad_faltante' }>

async function proponerComo(quien: Quien, pedido: PedidoConSuClic, motores?: Motores, redactor?: MotorDelRedactor): Promise<ResultadoDeProponer> {
  if (pedido.origen !== 'lectura' && pedido.quiere.length > MAXIMO_DE_QUIERE) return corregir([{ tipo: 'valor_invalido', campo: 'quiere', porQue: `Hasta ${MAXIMO_DE_QUIERE} cosas por propuesta: lo demás va en otra` }])
  const traducida = await traducirPedido(quien, pedido, redactor)
  if ('desenlace' in traducida) return traducida

  // Lo que frena les llega a los Clientes de una: se ensaya sobre lo que ellos tienen, no sobre la vista previa.
  const frenos = traducida.revierte ? traducida.escritura.elementos.filter((c) => !traducida.soloVistaPrevia.includes(c.clave)) : []
  const ensayo =
    traducida.escritura.elementos.length && pedido.origen === 'hilo'
      ? frenos.length
        ? await vistaPreviaDe(await leerPublicado(quien.negocio), { elementos: frenos, filas: [] }, traducida.lineas, motores)
        : await vistaPreviaDe(traducida.estado, traducida.escritura, traducida.lineas, motores)
      : { guardada: { lineas: traducida.lineas, advertencias: [], conversaciones: null }, gasto: SIN_GASTO }
  const vistaPrevia: VistaPrevia = { ...ensayo.guardada, advertencias: [...traducida.advertencias, ...(ensayo.guardada.advertencias ?? [])], soloVistaPrevia: traducida.soloVistaPrevia }
  const t: Traducida = { ...traducida, lineas: vistaPrevia.lineas, advertencias: vistaPrevia.advertencias ?? [], gasto: sumarGasto(traducida.gasto, ensayo.gasto) }
  const palabrasDelDueno = pedido.origen === 'lectura' ? palabrasDeLaLectura(pedido.fuente) : pedido.palabrasDelDueno
  const { valores, tarjeta } = filaNueva({ negocio: quien.negocio, palabrasDelDueno, pedidoPor: quien.pedidoPor, origen: pedido.origen, escritura: t.escritura, actos: t.actos, revierte: t.revierte, version: t.version, vistaPrevia })
  const id = tarjeta.propuesta
  const huella = tarjeta.huella
  await db.batch([db.insert(esquema.propuestas).values(valores), ...reemplazadas(quien.negocio, id, pedido.origen, t)])

  // Con actos nunca se aplica sin el botón; lo demás lo decide la política con el modo leído dentro del reclamo.
  if (!t.actos.length) {
    try {
      const aprobadoPor = pedido.origen === 'panel' ? quien.pedidoPor : null
      const r = await aplicarConReclamo({ negocio: quien.negocio, propuesta: id, huella, aprobadoPor, sinBoton: { alcance: t.alcance, origen: pedido.origen } })
      if (r.tipo === 'aplicado') {
        if (pedido.origen === 'panel') await dejarElDesenlace(quien.negocio, r)
        const conDeshacer = t.alcance === 'panel' && !t.revierte && r.quedo === 'en_la_vista_previa'
        return { desenlace: 'aplicado', propuesta: id, tarjeta: conDeshacer ? { ...tarjeta, accion: 'deshacer' } : null, vistaPrevia, gasto: t.gasto, resumen: resumenDeLoAplicado(id, t, r.quedo) }
      }
      if (r.tipo === 'conflicto' || r.tipo === 'ya_no_cabe') {
        await descartarSinBoton(id)
        return corregir(r.tipo === 'ya_no_cabe' ? r.problemas : [{ tipo: 'valor_invalido', campo: 'quiere', porQue: `${r.resumen} Mira ver_negocio y propónlo de nuevo si todavía lo quiere` }])
      }
    } catch (e) {
      console.error('[cambios] la política no pudo aplicarla; queda con tarjeta', id, e)
    }
  }
  return { desenlace: 'espera_al_dueno', propuesta: id, tarjeta, vistaPrevia, gasto: t.gasto, resumen: armarResumen(id, t) }
}

const descartarSinBoton = (id: PropuestaId) =>
  db
    .update(esquema.propuestas)
    .set({ estado: 'descartada' })
    .where(and(eq(esquema.propuestas.id, id), eq(esquema.propuestas.estado, 'espera_al_dueno')))

/** Una respuesta pendiente por Caso, una reversión pendiente por propuesta y una lectura por Negocio: la nueva deja descartada a la vieja. */
function reemplazadas(negocio: NegocioId, nueva: PropuestaId, origen: OrigenDelPedido, t: Traducida) {
  const pendientes = and(eq(esquema.propuestas.negocioId, negocio), eq(esquema.propuestas.estado, 'espera_al_dueno'), ne(esquema.propuestas.id, nueva))
  const descartar = (cuales: ReturnType<typeof and>) => db.update(esquema.propuestas).set({ estado: 'descartada' }).where(and(pendientes, cuales))
  const [acto] = t.actos
  if (acto) return [descartar(sql`${esquema.propuestas.actos} @> ${JSON.stringify([{ caso: acto.caso }])}::jsonb`)]
  if (t.revierte) return [descartar(eq(esquema.propuestas.revierte, t.revierte))]
  if (origen === 'lectura') return [descartar(eq(esquema.propuestas.origen, 'lectura'))]
  return []
}

const sumarGasto = (a: Gasto, b: Gasto): Gasto => ({ llamadas: a.llamadas + b.llamadas, usd: a.usd + b.usd, ms: a.ms + b.ms })

async function traducirPedido(quien: Quien, pedido: PedidoConSuClic, redactor?: MotorDelRedactor): Promise<Traducida | SinPropuesta> {
  const estado = await leerAplicado(quien.negocio)
  const t = await traducir(estado, pedido.quiere as readonly QuiereDeElementos[], redactor)
  if (!('tipo' in t)) return { ...t, version: estado.version, estado, ...(pedido.origen === 'lectura' ? { lineas: lineasDeLaTarjeta(estado, t.escritura, pedido.fuente) } : {}) }
  if (t.tipo === 'corregir') return corregir(t.problemas)
  return faltante(quien.negocio, pedido.origen === 'lectura' ? palabrasDeLaLectura(pedido.fuente) : pedido.palabrasDelDueno, t.motivo, t.gasto)
}

async function faltante(negocio: NegocioId, palabras: string, motivo: MotivoDeFaltante, gasto: Gasto): Promise<SinPropuesta> {
  const capacidadFaltante = await registrarFaltante(negocio, palabras, motivo)
  const porQue =
    motivo.tipo === 'sin_converger'
      ? `No lo logré armar (${explicar(motivo.ultimoError).slice(0, 300)}).`
      : motivo.tipo === 'no_se_puede'
        ? `Eso no está en los datos que tengo: ${motivo.falta}.`
        : 'Eso todavía no lo sé hacer cumplir.'
  return { desenlace: 'capacidad_faltante', tarjeta: null, capacidadFaltante, motivo, gasto, resumen: `${porQue} Quedó anotado para el equipo de Amanece; díselo al Dueño sin tecnicismos y sin prometer cuándo.` }
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
    case 'rompe_lo_publicado':
      return 'Tus Clientes todavía tienen algo que depende de esto. Toca Publicar primero y vuelve a revertirlo.'
    case 'la_usa_algo_vigente':
      return 'Algo que sigue vigente usa esto. Deshaz eso primero y vuelve a revertir.'
    case 'ya_se_publico':
      return 'Esto se publicó mientras la tarjeta esperaba. Revertirlo ahora les llega a tus Clientes de una. Pídeme revertirlo otra vez y te muestro lo que cambia.'
  }
}

const avisosDe = (t: Traducida) => (t.advertencias.length ? `Advertencias, cuéntaselas al Dueño:\n${t.advertencias.map((a) => `- ${a}`).join('\n')}\n` : '')
const lineasDe = (t: Traducida) => t.lineas.map((l) => `- ${l}`).join('\n')

const QUEDO_EN_PALABRAS = {
  sin_clientes: 'Ya quedó aplicado',
  en_la_vista_previa: 'Ya está en tu vista previa. Para que quede en tu link falta Publicar',
  con_los_clientes: 'Ya les llegó a tus Clientes de una, sin Publicar',
} as const satisfies Record<Quedo, string>

/** Lo único que ve el modelo, sin la huella. El id va para que pueda descartarla sin listar. */
function resumenDeLoAplicado(id: PropuestaId, t: Traducida, quedo: Quedo | null): string {
  const como = t.revierte && quedo === 'en_la_vista_previa' ? 'Ya salió de tu vista previa: a tus Clientes no les cambia nada' : QUEDO_EN_PALABRAS[quedo ?? 'sin_clientes']
  return `${avisosDe(t)}${como} [Propuesta ${id}]:\n${lineasDe(t)}`
}

function armarResumen(id: PropuestaId, t: Traducida): string {
  const boton = t.actos.length ? 'Enviar' : t.revierte ? 'Revertir' : 'Aplicar'
  const verbo = t.actos.length ? 'envía' : t.revierte ? 'revierte' : 'aplica'
  const despues = t.actos.length || t.revierte ? '' : ' Después de aplicar queda en su vista previa, y a sus Clientes les llega cuando toque Publicar.'
  return `${avisosDe(t)}Quedó lista la tarjeta [Propuesta ${id}]:\n${lineasDe(t)}\nSe ${verbo} solo cuando el Dueño toque ${boton} en la tarjeta.${despues} No digas que ya quedó ni le pidas que te diga que sí.`
}

// ══ Aprobar ═════════════════════════════════════════════════════════════════════════════════════

/**
 * Un acto del Dueño autenticado: la tarjeta en la web. El modelo no tiene cómo llamarlo. `propuesta` y `huella`
 * llegan crudos de HTTP: uno mal formado es `no_existe`, así la ruta no parsea nada. Idempotente.
 */
export async function aprobar(ctx: ContextoDelDueno, propuesta: string, huella: string): Promise<ResultadoDeAprobar> {
  if (!UUID.test(propuesta) || !HUELLA.test(huella)) return { tipo: 'no_existe' }
  const r = await aplicarConReclamo({ negocio: ctx.negocio, propuesta: marcar.propuesta(propuesta), huella, aprobadoPor: ctx.dueno, sinBoton: null })
  if (r.tipo === 'conflicto') await descartarSinBoton(marcar.propuesta(propuesta))
  if (r.tipo === 'sigue_esperando') return { tipo: 'no_existe' }
  if (r.tipo !== 'aplicado') return r
  const desenlace = await dejarElDesenlace(ctx.negocio, r)
  return { tipo: 'aplicado', resumen: desenlace?.texto ?? 'Aplicado.', envio: r.envio, version: versionDe(r.fila) }
}

/** Lo que se le responde a un Cliente, ya revalidado dentro del reclamo. */
type Respuesta = { readonly caso: CasoId; readonly cliente: ClienteId; readonly texto: string }

/** A dónde llegó lo que se aplicó. */
type Quedo = 'sin_clientes' | 'en_la_vista_previa' | 'con_los_clientes'

type Reclamo =
  | { readonly tipo: 'reclamada'; readonly fila: FilaDePropuesta; readonly respuesta: Respuesta | null; readonly quedo: Quedo | null }
  | { readonly tipo: 'sin_reclamo' }
  | { readonly tipo: 'ya_no_cabe'; readonly problemas: readonly Problema[] }
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[] }
  /** La política, releída con el modo de ahora, pide el botón: ROLLBACK y la propuesta espera. */
  | { readonly tipo: 'sigue_esperando' }

/** Lo que la política pasa para aplicar sin el botón. El botón pasa null. */
type SinBoton = { readonly alcance: Alcance; readonly origen: OrigenDelPedido }

/** `avisar`: este clic es el que deja la línea del desenlace en los Hilos. El doble clic no, y tampoco sabe `quedo`. */
type Aplicada = { readonly tipo: 'aplicado'; readonly fila: FilaDePropuesta; readonly envio: ResultadoDeEnvio | null; readonly avisar: boolean; readonly quedo: Quedo | null }

const versionDe = (f: FilaDePropuesta): VersionDelNegocio | null => (f.version === null ? null : (f.version as VersionDelNegocio))

/**
 * La única manera de aplicar una propuesta: la usan el botón y la política. El reclamo va en una transacción de
 * `Pool` que sostiene la fila tomada mientras escribe: un segundo clic espera en el `UPDATE` y, al soltarse,
 * relee. Si `escribir` lanza, hay ROLLBACK y nadie recibió `aplicado` sobre algo que no quedó. Una propuesta sin
 * Elementos ni actos es una pieza del puente de antes del 2-nov: ya no cabe y se pide de nuevo.
 */
async function aplicarConReclamo(a: {
  readonly negocio: NegocioId
  readonly propuesta: PropuestaId
  readonly huella: string
  readonly aprobadoPor: DuenoId | null
  readonly sinBoton: SinBoton | null
}): Promise<Aplicada | Exclude<ResultadoDeAprobar, { tipo: 'aplicado' }> | { readonly tipo: 'sigue_esperando' }> {
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
    if (a.sinBoton) {
      // El modo se relee con la fila del Negocio tomada: si se abrió mientras tanto, ya no se aplica sin el botón.
      const [n] = await tx.select({ modo: esquema.negocios.modo }).from(esquema.negocios).where(eq(esquema.negocios.id, a.negocio)).for('no key update')
      if (politicaDeAprobacion(n?.modo ?? 'armando', a.sinBoton.alcance, a.sinBoton.origen, fila.actos.length > 0) !== 'se_aplica') return deshacer({ tipo: 'sigue_esperando' })
    }
    const [acto] = fila.actos
    if (acto) {
      const r = await cerrarCaso(tx, a.negocio, acto)
      return 'problema' in r ? deshacer({ tipo: 'ya_no_cabe', problemas: [r.problema] }) : { tipo: 'reclamada', fila, respuesta: r, quedo: null }
    }
    if (fila.escritura.elementos.length) {
      const r = await escribir(tx, a.negocio, { tipo: 'propuesta', propuesta: a.propuesta }, fila.escritura, await loRevertidoPor(tx, fila))
      if (r.tipo === 'conflicto') return deshacer(r)
      if (r.tipo === 'invalida') return deshacer({ tipo: 'ya_no_cabe', problemas: r.problemas })
      const [conVersion] = await tx.update(esquema.propuestas).set({ version: r.version }).where(eq(esquema.propuestas.id, a.propuesta)).returning()
      return { tipo: 'reclamada', fila: conVersion, respuesta: null, quedo: r.modo !== 'atendiendo' ? 'sin_clientes' : r.deUna ? 'con_los_clientes' : 'en_la_vista_previa' }
    }
    return deshacer({ tipo: 'ya_no_cabe', problemas: [{ tipo: 'valor_invalido', campo: 'propuesta', porQue: 'Eso se pidió antes del cambio de sistema: pídelo de nuevo' }] })
  })
  switch (reclamo.tipo) {
    case 'sigue_esperando':
      return reclamo
    case 'ya_no_cabe':
      return { ...reclamo, resumen: `No se aplicó. ${reclamo.problemas.map(problemaEnPalabras).join(' ')}` }
    case 'conflicto':
      return { ...reclamo, resumen: await conflictoEnPalabras(a.negocio, reclamo.claves) }
    case 'reclamada':
      // Fuera de la transacción: `despachar` no corre dentro de una. La clave lleva la huella, así que es idempotente.
      return { tipo: 'aplicado', fila: reclamo.fila, envio: reclamo.respuesta ? await despacharDespuesDelCommit(intencionDe(a.negocio, reclamo.respuesta, reclamo.fila.huella)) : null, avisar: true, quedo: reclamo.quedo }
    case 'sin_reclamo':
      return releer(a)
  }
}

async function loRevertidoPor(tx: Transaccion, fila: FilaDePropuesta): Promise<LoRevertido | null> {
  if (!fila.revierte) return null
  const [revertida] = await tx.select({ version: esquema.propuestas.version }).from(esquema.propuestas).where(eq(esquema.propuestas.id, fila.revierte))
  if (revertida?.version == null) throw new Error(`La propuesta ${fila.revierte} que se revierte no dejó versión`)
  return { version: revertida.version as VersionDelNegocio, soloVistaPrevia: fila.vistaPrevia.soloVistaPrevia ?? [] }
}

const QUIEN_ESCRIBIO = { propuesta: 'Otro Dueño', entrevista: 'La entrevista', tablas_viejas: 'La migración' } as const

/** Lo arma el código: quién tocó cada clave, cuándo, y lo que vale ahora. */
async function conflictoEnPalabras(negocio: NegocioId, claves: readonly ClaveEnConflicto[]): Promise<string> {
  const ids = claves.flatMap((c) => (c.dueno ? [c.dueno] : []))
  const nombres = new Map(ids.length ? (await db.select({ id: esquema.duenos.id, nombre: esquema.duenos.nombre }).from(esquema.duenos).where(inArray(esquema.duenos.id, ids))).map((d) => [d.id, d.nombre]) : [])
  const [n] = await db.select({ zona: esquema.negocios.zonaHoraria }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio))
  const lineas = claves.map((c) => {
    if (!c.tocadaPor || !c.cuando) return `${c.clave} ya no existe.`
    const quien = (c.dueno && nombres.get(c.dueno)) || QUIEN_ESCRIBIO[c.tocadaPor.tipo]
    const cuando = new Date(c.cuando).toLocaleString('es-CO', { timeZone: n?.zona ?? 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })
    return `${quien} lo cambió el ${cuando}; ahora vale: ${c.resumen}.`
  })
  return `No se aplicó porque mientras tanto cambió. ${lineas.join(' ')} Pídelo de nuevo si todavía lo quieres.`
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
  if (f.estado === 'aplicada') return { tipo: 'aplicado', fila: f, quedo: null, ...(await reintentarRespuesta(a.negocio, f)) }
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
async function desenlaceEnPalabras(negocio: NegocioId, f: FilaDePropuesta, envio: ResultadoDeEnvio | null, quedo: Quedo | null): Promise<Desenlace> {
  const [quien] = f.aprobadoPor ? await db.select({ nombre: esquema.duenos.nombre }).from(esquema.duenos).where(eq(esquema.duenos.id, f.aprobadoPor)) : []
  const por = quien?.nombre || 'Un Dueño'
  const [acto] = f.actos
  if (f.origen === 'lectura') return { por, texto: confirmadaEnPalabras(por, f.palabrasDelDueno) }
  if (!acto) {
    const linea = f.vistaPrevia.lineas[0] ?? 'el Cambio'
    if (f.revierte) return { por, texto: `${por} revirtió: ${linea}${quedo === 'con_los_clientes' ? '. Les llega de una a los Clientes, sin Publicar' : quedo === 'en_la_vista_previa' ? '. Solo sale de la vista previa' : ''}` }
    return { por, texto: `${por} aplicó: ${linea}${quedo === 'en_la_vista_previa' ? '. Queda en la vista previa hasta que alguien toque Publicar' : ''}` }
  }
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
 * Ya hubo COMMIT: una falla al avisar no convierte lo aplicado en un error para el Dueño. La línea es para el otro Dueño y
 * para el modelo, que solo había visto `resumen`. `data-aprobacion` le da el id sin la huella.
 */
async function dejarElDesenlace(negocio: NegocioId, r: Aplicada): Promise<Desenlace | null> {
  const desenlace = await desenlaceEnPalabras(negocio, r.fila, r.envio, r.quedo).catch((e) => {
    console.error('[aprobar] no pude armar el desenlace', r.fila.id, e)
    return null
  })
  if (desenlace && r.avisar) await avisarEnLosHilos(negocio, desenlace.texto, [{ type: 'data-aprobacion', data: { propuesta: r.fila.id, por: desenlace.por } }]).catch((e) => console.error('[aprobar] no pude avisar en los Hilos', r.fila.id, e))
  return desenlace
}

// ══ Deshacer, descartar e historial ═══════════════════════════════════════════════════════════════════════

/**
 * El botón de la tarjeta de algo del Panel ya aplicado. Solo suelta lo que el modelo no pudo pedir por su cuenta: exige
 * la huella de esa tarjeta, que esté aplicada y que todo sea de alcance Panel. No vence: la apaga que ya esté revertida.
 */
export async function deshacer(ctx: ContextoDelDueno, propuesta: string, huella: string): Promise<ResultadoDeDeshacer> {
  if (!UUID.test(propuesta) || !HUELLA.test(huella)) return { tipo: 'no_existe' }
  const [f] = await db
    .select({ escritura: esquema.propuestas.escritura })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.id, propuesta), eq(esquema.propuestas.negocioId, ctx.negocio), eq(esquema.propuestas.huella, huella), eq(esquema.propuestas.estado, 'aplicada')))
  if (!f || !f.escritura.elementos.length || !f.escritura.elementos.every((c) => alcanceDeLaClave(c.clave) === 'panel')) return { tipo: 'no_existe' }
  const YA = { tipo: 'deshecho', resumen: 'Ya estaba deshecho.' } as const
  // Quien pierde la carrera y todavía no ve revertida recibe el `conflicto`: el botón sigue y el siguiente clic dice `deshecho`.
  const yaDeshecha = async () => (await db.select({ revertida: REVERTIDA }).from(esquema.propuestas).where(eq(esquema.propuestas.id, propuesta)))[0]?.revertida === true
  const r = await proponerComo({ negocio: ctx.negocio, pedidoPor: ctx.dueno }, { origen: 'panel', palabrasDelDueno: 'Deshacer', quiere: [{ tipo: 'revertir', propuesta: marcar.propuesta(propuesta) }] })
  switch (r.desenlace) {
    case 'aplicado':
      return { tipo: 'deshecho', resumen: r.resumen }
    case 'espera_al_dueno':
      // La política no pudo: otro clic reclamó primero o le ganó el índice de una sola reversión.
      await descartarSinBoton(r.propuesta)
      return (await yaDeshecha()) ? YA : { tipo: 'conflicto', resumen: 'No pude deshacerlo. Vuelve a tocar el botón.' }
    case 'corregir': {
      if (await yaDeshecha()) return YA
      return { tipo: r.problemas.some((p) => p.tipo === 'rompe_lo_publicado') ? 'ya_no_cabe' : 'conflicto', resumen: r.problemas.map(problemaEnPalabras).join(' ') }
    }
    case 'capacidad_faltante':
      return { tipo: 'conflicto', resumen: r.resumen }
  }
}

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
    accion: accionDe(f.origen, f.actos, f.revierte),
    cuando: marcar.instante(f.creado),
  }))
}

export type _ProponerNoApruebaSolo = Es<'panel' extends Parameters<typeof proponer>[1]['origen'] ? false : true>
