/**
 * La frontera: todo lo que un Cambio puede dejar en un Negocio. Lo que no tiene tipo aquí no se puede cambiar.
 * Agregar un tipo, una condición o un efecto no compila hasta llenar su fila en las tablas de abajo.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { COLUMNAS, esFuente, VERSION_DEL_CATALOGO } from '../consultas/catalogo'
import type { ConsultaGuardada } from '../consultas/tipos'
import type { CasoId, ClienteId, Marca } from '../identidad'
import { PROMESAS, type MotivoDeRevision } from '../salida/revisar'

/** Identidad estable de un Elemento entre versiones: `regla:<uuid>`, `dato:horario`, `voz`… */
export type Clave = Marca<string, 'Clave'>
/** Contador del Negocio. Cada escritura lo sube en uno, en la misma transacción. */
export type VersionDelNegocio = Marca<number, 'VersionDelNegocio'>
/** Entero en pesos colombianos. */
export type Monto = Marca<number, 'Monto'>
export type HoraLocal = Marca<string, 'HoraLocal'>

export const comoClave = (s: string) => s as Clave
export const comoVersion = (n: number) => n as VersionDelNegocio
export const comoMonto = (n: number) => n as Monto

export const CAMPOS_DE_CONOCIMIENTO = ['descripcion', 'ciudad', 'horario', 'envios', 'pagos'] as const
export type CampoDeConocimiento = (typeof CAMPOS_DE_CONOCIMIENTO)[number]

export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
export type DiaDeLaSemana = (typeof DIAS)[number]
export type FranjaSemanal = { readonly [D in DiaDeLaSemana]: { readonly desde: HoraLocal; readonly hasta: HoraLocal } | null }

export type BorradorDePedido = {
  readonly items: readonly { readonly producto: Clave; readonly cantidad: number }[]
  readonly ciudad: string
}

/** Un caso que el Dueño aprobó. Se compara por acciones, no por texto. */
export type Escenario = {
  readonly mensajeDelCliente: string
  readonly momento: { readonly dia: DiaDeLaSemana; readonly hora: HoraLocal } | null
  readonly pedido: BorradorDePedido | null
  readonly esperado: { readonly hace: readonly AccionDeEscenario[]; readonly noHace: readonly AccionDeEscenario[] }
}

/** Las acciones del Agente de clientes, como las nombran los escenarios. `clientes/acciones.ts` comprueba que son las del puerto. */
export const ACCIONES_DE_ESCENARIO = ['buscar_productos', 'crear_pedido', 'confirmar_pedido', 'consultar_pedido', 'abrir_caso'] as const
export type AccionDeEscenario = (typeof ACCIONES_DE_ESCENARIO)[number]

export type CondicionDePedido =
  | { readonly tipo: 'ciudad_fuera_de'; readonly ciudades: readonly [string, ...string[]] }
  | { readonly tipo: 'total_desde'; readonly monto: Monto }
  | { readonly tipo: 'incluye'; readonly producto: Clave }

export type Cuando =
  | { readonly tipo: 'siempre' }
  | { readonly tipo: 'tema'; readonly tema: string }
  | { readonly tipo: 'fuera_de_horario'; readonly abierto: FranjaSemanal; readonly festivosCerrado: boolean }
  | { readonly tipo: 'pedido'; readonly condicion: CondicionDePedido }

export type PuntoDeCumplimiento = 'entrada' | 'herramienta' | 'salida'
const ORDEN_DEL_PUNTO = { entrada: 0, herramienta: 1, salida: 2 } as const satisfies Record<PuntoDeCumplimiento, number>

export const CUANDO = {
  siempre: { evalua: 'codigo', seSabeEn: 'entrada' },
  tema: { evalua: 'activar', seSabeEn: 'entrada' },
  fuera_de_horario: { evalua: 'codigo', seSabeEn: 'entrada' },
  pedido: { evalua: 'codigo', seSabeEn: 'herramienta' },
} as const satisfies Record<Cuando['tipo'], { readonly evalua: 'codigo' | 'activar'; readonly seSabeEn: PuntoDeCumplimiento }>

export type QueNoPrometer = keyof typeof PROMESAS

export type Efecto =
  | { readonly tipo: 'pasar_al_dueno'; readonly avisoAlCliente: string }
  | { readonly tipo: 'pedir_dato'; readonly campo: Clave }
  | { readonly tipo: 'no_vender'; readonly explicacionAlCliente: string }
  | { readonly tipo: 'abrir_caso'; readonly titulo: string }
  | { readonly tipo: 'no_prometer'; readonly que: QueNoPrometer }
  | { readonly tipo: 'no_decir'; readonly frases: readonly [string, ...string[]] }

export const DONDE_SE_CUMPLE = {
  pasar_al_dueno: 'entrada',
  pedir_dato: 'herramienta',
  no_vender: 'herramienta',
  abrir_caso: 'salida',
  no_prometer: 'salida',
  no_decir: 'salida',
} as const satisfies Record<Efecto['tipo'], PuntoDeCumplimiento>

/**
 * Lo que el núcleo hace cumplir en este despliegue. `Cuando` y `Efecto` ya son las listas finales; una regla con
 * algo en `no` no se escribe: `traducir` la deja como Capacidad faltante y `escribir` la rechaza.
 */
export const SE_CUMPLE_HOY = {
  cuando: { siempre: 'si', tema: 'no', fuera_de_horario: 'no', pedido: 'si' },
  efecto: { pasar_al_dueno: 'si', abrir_caso: 'si', no_prometer: 'si', no_decir: 'si', pedir_dato: 'no', no_vender: 'no' },
} as const satisfies {
  readonly cuando: Record<Cuando['tipo'], 'si' | 'no'>
  readonly efecto: Record<Efecto['tipo'], 'si' | 'no'>
}

export const LARGO_DEL_ESTILO = 300

/** Con `siempre`, pasarle la conversación al Dueño o abrirle un Caso pasaría en cada mensaje, hasta en un "hola". */
const ESPERAN_UNA_CONDICION: readonly Efecto['tipo'][] = ['pasar_al_dueno', 'abrir_caso']

export type Elemento =
  | {
      readonly tipo: 'regla'
      readonly nombre: string
      readonly cuando: Cuando
      readonly efectos: readonly [Efecto, ...Efecto[]]
      readonly escenarios: { readonly activan: readonly [Escenario, ...Escenario[]]; readonly noActivan: readonly Escenario[] }
    }
  | { readonly tipo: 'voz'; readonly nombreDelAgente: string | null; readonly trato: 'tu' | 'usted'; readonly emojisPorMensaje: 0 | 1 | 2 | 3; readonly estilo: string }
  | { readonly tipo: 'dato'; readonly campo: CampoDeConocimiento; readonly valor: string }
  | { readonly tipo: 'pregunta'; readonly pregunta: string; readonly respuesta: string }
  /** Clave `producto:<id>`: el id es el `productoId` de `pedidos.items`. */
  | { readonly tipo: 'producto'; readonly nombre: string; readonly descripcion: string; readonly precio: Monto; readonly activo: boolean }
  /** Una lista en el Panel. Solo la ve el Dueño. */
  | { readonly tipo: 'seccion'; readonly nombre: string; readonly queQuiereVer: string; readonly consulta: ConsultaGuardada<'filas'> }
  /** Un número o una serie en el Panel. Solo lo ve el Dueño. */
  | { readonly tipo: 'indicador'; readonly nombre: string; readonly queQuiereVer: string; readonly consulta: ConsultaGuardada<'numero' | 'serie'> }

export type TipoDeElemento = Elemento['tipo']
export type ElementoDe<T extends TipoDeElemento> = Extract<Elemento, { tipo: T }>
/** Lo que solo produce `redactarConsulta`: el Agente del dueño no escribe SQL. */
type SoloDelRedactor = 'consulta'
export type EntradaDe<T extends TipoDeElemento> = Omit<ElementoDe<T>, 'tipo' | SoloDelRedactor>

export type Alcance = 'clientes' | 'panel'
/**
 * `cotizar` sale hasta que un tipo lo use: `precio` (semanas 3-4) vuelve con `cotizar` sobre los últimos pedidos. Un
 * `producto` que cambia de precio se describe: no recalcula pedidos guardados. `panel` corre la consulta sobre los
 * datos reales en solo lectura.
 */
export type ProfundidadDeVistaPrevia = 'describir' | 'panel' | 'conversaciones'

export const VISTA_PREVIA = {
  regla: 'conversaciones',
  voz: 'conversaciones',
  dato: 'describir',
  pregunta: 'describir',
  producto: 'describir',
  seccion: 'panel',
  indicador: 'panel',
} as const satisfies Record<TipoDeElemento, ProfundidadDeVistaPrevia>

export type Problema =
  | { readonly tipo: 'referencia_rota'; readonly clave: string }
  | { readonly tipo: 'referencia_huerfana'; readonly quitada: Clave; readonly usadaPor: Clave }
  | { readonly tipo: 'valor_invalido'; readonly campo: string; readonly porQue: string }
  | { readonly tipo: 'norma'; readonly campo: string; readonly motivo: MotivoDeRevision }
  | { readonly tipo: 'fuera_de_ventana'; readonly cliente: ClienteId }
  | { readonly tipo: 'caso_resuelto'; readonly caso: CasoId }
  | { readonly tipo: 'solo_mientras_se_arma' }
  /** Cabe en lo aplicado, pero lo que los Clientes tienen todavía depende de eso. */
  | { readonly tipo: 'rompe_lo_publicado'; readonly problema: Problema }
  /** La tarjeta prometió que solo salía de la vista previa, y mientras esperaba alguien publicó: ahora les llegaría a los Clientes. */
  | { readonly tipo: 'ya_se_publico' }
  /** Revertir dejaría huérfano algo vigente. Una reversión va sola: no se puede quitar junto con lo que la usa. */
  | { readonly tipo: 'la_usa_algo_vigente'; readonly quitada: Clave; readonly usadaPor: Clave }

/** Lo que `validar` necesita del Negocio: los vigentes, con lo propuesto encima si es un borrador. */
export type Vigentes = {
  vigentes<T extends TipoDeElemento>(tipo: T): readonly { readonly clave: Clave; readonly elemento: ElementoDe<T> }[]
}

export type DefinicionDeElemento<T extends TipoDeElemento> = {
  readonly contrato: number
  readonly entrada: z.ZodType<EntradaDe<T>>
  readonly alcance: Alcance
  claveFija(e: ElementoDe<T>): Clave | null
  referencias(e: ElementoDe<T>): readonly Clave[]
  textos(e: ElementoDe<T>): readonly { readonly campo: string; readonly texto: string }[]
  /** Determinista, sin modelo. Corre al proponer y otra vez al aprobar. `clave` es la del propio Elemento. */
  validar(e: ElementoDe<T>, clave: Clave, estado: Vigentes): readonly Problema[]
  describir(antes: ElementoDe<T> | null, despues: ElementoDe<T> | null, estado: Vigentes): string
}

export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`

/** "Trátalos de usted" da usted; "nunca de usted" o "sin usted", tú. */
export function tratoDelTono(tono: string): 'tu' | 'usted' {
  const t = normalizar(tono)
  return /\busted\b/.test(t) && !/\b(no|nunca|jamas|sin|ni)\b(\s\S+){0,3}\s(de\s)?usted\b/.test(t) ? 'usted' : 'tu'
}

export function claveNueva(tipo: TipoDeElemento): Clave {
  return comoClave(`${tipo}:${randomUUID()}`)
}

const PREFIJO_DE_PRODUCTO = 'producto:'

export const claveDeProducto = {
  deId: (id: string): Clave => comoClave(`${PREFIJO_DE_PRODUCTO}${id}`),
  aId: (c: Clave): string => {
    if (!c.startsWith(PREFIJO_DE_PRODUCTO)) throw new Error(`${c} no es la clave de un producto`)
    return c.slice(PREFIJO_DE_PRODUCTO.length)
  },
}

/** Pura. Vacío si la regla se cumple entera hoy. */
export function sinCumplidorHoy(r: ElementoDe<'regla'>): readonly (Cuando['tipo'] | Efecto['tipo'])[] {
  const faltan: (Cuando['tipo'] | Efecto['tipo'])[] = []
  if (SE_CUMPLE_HOY.cuando[r.cuando.tipo] === 'no') faltan.push(r.cuando.tipo)
  for (const e of r.efectos) if (SE_CUMPLE_HOY.efecto[e.tipo] === 'no' && !faltan.includes(e.tipo)) faltan.push(e.tipo)
  return faltan
}

// ══ Esquemas ═══════════════════════════════════════════════════════════════════════════════════

const noVacia = <S extends z.ZodType>(s: S) =>
  z
    .array(s)
    .min(1)
    .transform((a) => a as unknown as readonly [z.output<S>, ...z.output<S>[]])

const texto = (describe: string) => z.string().describe(describe)
const hora = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .transform((h) => h as HoraLocal)
const claveEsquema = z.string().transform(comoClave)
const montoEsquema = z.number().int().positive().transform(comoMonto)


const borradorDePedido = z.object({
  items: z.array(z.object({ producto: claveEsquema, cantidad: z.number().int().min(1) })),
  ciudad: z.string(),
})

const escenario = z.object({
  mensajeDelCliente: texto('Un mensaje realista de un Cliente'),
  momento: z
    .object({ dia: z.enum(DIAS), hora })
    .nullish()
    .transform((m) => m ?? null),
  pedido: borradorDePedido.nullish().transform((p) => p ?? null),
  esperado: z.object({
    hace: z.array(z.enum(ACCIONES_DE_ESCENARIO)).describe('Lo que el agente de clientes debe hacer en ese caso, por ejemplo abrir_caso'),
    noHace: z.array(z.enum(ACCIONES_DE_ESCENARIO)).describe('Lo que no debe hacer, por ejemplo crear_pedido'),
  }),
})

/**
 * Lo que escribe el Agente del dueño: Muse Spark no acepta un JSON Schema de más de 10 niveles, así que el escenario
 * llega plano y sin `momento` ni `pedido`, que solo sirven a condiciones que hoy no tienen cumplidor.
 */
const escenarioDeEntrada = z
  .object({
    mensajeDelCliente: texto('Un mensaje realista de un Cliente'),
    hace: z.array(z.enum(ACCIONES_DE_ESCENARIO)).describe('Lo que el agente de clientes debe hacer en ese caso, por ejemplo abrir_caso'),
    noHace: z.array(z.enum(ACCIONES_DE_ESCENARIO)).describe('Lo que no debe hacer, por ejemplo crear_pedido'),
  })
  .transform(({ mensajeDelCliente, hace, noHace }): z.output<typeof escenario> => ({ mensajeDelCliente, momento: null, pedido: null, esperado: { hace, noHace } }))

const franja = z.object({ desde: hora, hasta: hora }).nullable()

const cuando = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('siempre') }).describe('Vale en toda conversación'),
  z.object({ tipo: z.literal('tema'), tema: texto('De qué habla el Cliente, en palabras') }).describe('Solo cuando el Cliente habla de un tema'),
  z
    .object({
      tipo: z.literal('fuera_de_horario'),
      abierto: z.object(Object.fromEntries(DIAS.map((d) => [d, franja])) as { [D in DiaDeLaSemana]: typeof franja }),
      festivosCerrado: z.boolean(),
    })
    .describe('Cuando el Cliente escribe fuera del horario'),
  z
    .object({
      tipo: z.literal('pedido'),
      condicion: z.discriminatedUnion('tipo', [
        z.object({ tipo: z.literal('ciudad_fuera_de'), ciudades: noVacia(z.string()) }),
        z.object({ tipo: z.literal('total_desde'), monto: montoEsquema }),
        z.object({ tipo: z.literal('incluye'), producto: claveEsquema }),
      ]),
    })
    .describe('Cuando el pedido cumple una condición'),
])

const efecto = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('pasar_al_dueno'), avisoAlCliente: texto('Lo que se le dice al Cliente mientras el Dueño lo atiende') }).describe('Antes de responder, pasarle la conversación al Dueño'),
  z.object({ tipo: z.literal('pedir_dato'), campo: claveEsquema }).describe('Pedir un dato al tomar el pedido'),
  z.object({ tipo: z.literal('no_vender'), explicacionAlCliente: z.string() }).describe('No tomar el pedido'),
  z.object({ tipo: z.literal('abrir_caso'), titulo: texto('El título del Caso para el Dueño') }).describe('Abrirle un Caso al Dueño, además de responder'),
  z.object({ tipo: z.literal('no_prometer'), que: z.enum(['plazo', 'descuento', 'disponibilidad']) }).describe('No prometer plazos de entrega, descuentos o disponibilidad'),
  z.object({ tipo: z.literal('no_decir'), frases: noVacia(z.string()) }).describe('No decir estas frases'),
])

const regla = (e: typeof escenario | typeof escenarioDeEntrada) =>
  z.object({
    nombre: texto('Un nombre corto para la regla'),
    cuando,
    efectos: noVacia(efecto),
    escenarios: z.object({ activan: noVacia(e).describe('Al menos un mensaje en el que la regla aplica'), noActivan: z.array(e) }),
  })

const unidad = z.discriminatedUnion('tipo', [z.object({ tipo: z.literal('cantidad'), nombre: z.string() }), z.object({ tipo: z.literal('dinero') }), z.object({ tipo: z.literal('porcentaje') })])

/** Lo guardado de una consulta. No lo ve ningún modelo: lo lee `leerAplicado` del jsonb y lo revisa `escribir`. */
function consultaGuardada<S extends 'filas' | 'numero' | 'serie'>(salida: z.ZodType<ConsultaGuardada<S>['salida']>) {
  return z
    .object({ sql: z.string(), enPalabras: z.string(), supuestos: z.array(z.string()), catalogo: z.number().int(), usa: z.array(z.string()), salida })
    .transform((c) => c as unknown as ConsultaGuardada<S>)
}

const ENTRADAS_DEL_PANEL = {
  seccion: z.object({
    nombre: texto('Un nombre corto para el Panel, por ejemplo "Pedidos con novedad"'),
    queQuiereVer: texto('Lo que quiere ver el Dueño, en sus palabras'),
  }),
  indicador: z.object({
    nombre: texto('Un nombre corto para el Panel, por ejemplo "Confirmados por día"'),
    queQuiereVer: texto('Lo que quiere medir el Dueño, en sus palabras'),
  }),
} as const

const ESQUEMAS_GUARDADOS_DEL_PANEL = [
  ENTRADAS_DEL_PANEL.seccion.extend({
    tipo: z.literal('seccion'),
    consulta: consultaGuardada<'filas'>(z.object({ tipo: z.literal('filas'), columnas: z.array(z.object({ columna: z.string(), titulo: z.string() })) })),
  }),
  ENTRADAS_DEL_PANEL.indicador.extend({
    tipo: z.literal('indicador'),
    consulta: consultaGuardada<'numero' | 'serie'>(z.discriminatedUnion('tipo', [z.object({ tipo: z.literal('numero'), unidad }), z.object({ tipo: z.literal('serie'), unidad })])),
  }),
] as const

const ENTRADAS = {
  ...ENTRADAS_DEL_PANEL,
  regla: regla(escenarioDeEntrada),
  voz: z.object({
    nombreDelAgente: z
      .string()
      .nullish()
      .transform((n) => n ?? null),
    trato: z.enum(['tu', 'usted']),
    emojisPorMensaje: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    estilo: texto(`Cómo le habla a los Clientes, hasta ${LARGO_DEL_ESTILO} caracteres`),
  }),
  dato: z.object({ campo: z.enum(CAMPOS_DE_CONOCIMIENTO), valor: z.string() }),
  pregunta: z.object({ pregunta: z.string(), respuesta: z.string() }),
  producto: z.object({
    nombre: z.string(),
    descripcion: z
      .string()
      .nullish()
      .transform((d) => d ?? ''),
    precio: montoEsquema.describe('En pesos colombianos, entero'),
    activo: z
      .boolean()
      .nullish()
      .transform((a) => a ?? true),
  }),
} as const

/** Un Elemento completo: lo usan `escribir` antes de guardar y `leerAplicado` al leer el jsonb. */
export const ESQUEMA_DE_ELEMENTO = z.discriminatedUnion('tipo', [
  regla(escenario).extend({ tipo: z.literal('regla') }),
  ENTRADAS.voz.extend({ tipo: z.literal('voz') }),
  ENTRADAS.dato.extend({ tipo: z.literal('dato') }),
  ENTRADAS.pregunta.extend({ tipo: z.literal('pregunta') }),
  ENTRADAS.producto.extend({ tipo: z.literal('producto') }),
  ...ESQUEMAS_GUARDADOS_DEL_PANEL,
])

// ══ Definiciones ═══════════════════════════════════════════════════════════════════════════════

const invalido = (campo: string, porQue: string): Problema => ({ tipo: 'valor_invalido', campo, porQue })

const QUE_NO_PROMETER_EN_PALABRAS = { plazo: 'fechas ni plazos de entrega', descuento: 'descuentos', disponibilidad: 'disponibilidad' } as const satisfies Record<QueNoPrometer, string>

function cuandoEnPalabras(c: Cuando, estado: Vigentes): string {
  switch (c.tipo) {
    case 'siempre':
      return 'siempre'
    case 'tema':
      return `cuando el Cliente habla de ${c.tema}`
    case 'fuera_de_horario':
      return 'fuera del horario de atención'
    case 'pedido':
      return condicionEnPalabras(c.condicion, estado)
  }
}

const productoEnPalabras = (clave: Clave, estado: Vigentes) => estado.vigentes('producto').find((v) => v.clave === clave)?.elemento.nombre ?? 'un producto que ya no está en el catálogo'

/** `incluye` nombra el producto: el Dueño no conoce las claves. */
export function condicionEnPalabras(c: CondicionDePedido, estado: Vigentes): string {
  switch (c.tipo) {
    case 'ciudad_fuera_de':
      return `cuando el pedido es para fuera de ${c.ciudades.join(', ')}`
    case 'total_desde':
      return `cuando el pedido suma ${pesos(c.monto)} o más`
    case 'incluye':
      return `cuando el pedido incluye ${productoEnPalabras(c.producto, estado)}`
  }
}

/** Lo que una condición de pedido necesita saber: el borrador y el total que calculó `cotizar`, o un pedido guardado. */
export type PedidoParaReglas = { readonly borrador: BorradorDePedido; readonly total: Monto }

/** Pura. La ciudad como se compara: el primer tramo, antes de una coma, un guion o un paréntesis, normalizado. «Manizales, Caldas» es «manizales». */
export const ciudadDe = (texto: string) => normalizar(texto.split(/[,(\-–—]/)[0])

/**
 * Pura. La única evaluación de una `CondicionDePedido`. La ciudad se compara por igualdad con `ciudadDe`: «Calima» no
 * está en Cali. Una ciudad vacía no está fuera de ninguna: `crear_pedido` no la deja pasar.
 */
export function seCumpleLaCondicion(c: CondicionDePedido, p: PedidoParaReglas): boolean {
  switch (c.tipo) {
    case 'ciudad_fuera_de': {
      const ciudad = ciudadDe(p.borrador.ciudad)
      return ciudad !== '' && !c.ciudades.some((x) => ciudadDe(x) === ciudad)
    }
    case 'total_desde':
      return p.total >= c.monto
    case 'incluye':
      return p.borrador.items.some((i) => i.producto === c.producto)
  }
}

function efectoEnPalabras(e: Efecto): string {
  switch (e.tipo) {
    case 'pasar_al_dueno':
      return `te pasa la conversación y le dice al Cliente «${e.avisoAlCliente}»`
    case 'abrir_caso':
      return `te abre un Caso «${e.titulo}»`
    case 'no_prometer':
      return `no promete ${QUE_NO_PROMETER_EN_PALABRAS[e.que]}`
    case 'no_decir':
      return `no dice ${e.frases.map((f) => `«${f}»`).join(', ')}`
    case 'pedir_dato':
      return 'pide un dato al tomar el pedido'
    case 'no_vender':
      return 'no toma el pedido'
  }
}

export function reglaEnPalabras(r: ElementoDe<'regla'>, estado: Vigentes): string {
  return `${r.nombre}: ${cuandoEnPalabras(r.cuando, estado)}, tu agente de clientes ${r.efectos.map(efectoEnPalabras).join(' y ')}`
}

const vozEnPalabras = (v: ElementoDe<'voz'>) => `${v.estilo} (trata de ${v.trato}, hasta ${v.emojisPorMensaje} emoji por mensaje)`

export const ETIQUETA_DEL_DATO = { descripcion: 'Descripción', ciudad: 'Ciudad', horario: 'Horario', envios: 'Envíos', pagos: 'Pagos' } as const satisfies Record<CampoDeConocimiento, string>

const NUEVO_DEL_DATO = { descripcion: 'nueva', ciudad: 'nueva', horario: 'nuevo', envios: 'nuevos', pagos: 'nuevos' } as const satisfies Record<CampoDeConocimiento, string>

function cambio<T>(antes: T | null, despues: T | null, enPalabras: (x: T) => string, etiqueta: string, nuevo = 'nuevo'): string {
  if (antes && despues) return `${etiqueta}: «${enPalabras(antes)}» → «${enPalabras(despues)}»`
  if (despues) return `${etiqueta} ${nuevo}: «${enPalabras(despues)}»`
  if (antes) return `Quitar ${etiqueta.toLowerCase()}: «${enPalabras(antes)}»`
  return etiqueta
}

const ordenDelPunto = (p: PuntoDeCumplimiento) => ORDEN_DEL_PUNTO[p]

/** El esquema con que el Agente del dueño pone un Elemento de un tipo: los campos del tipo y `reemplaza`. */
export const ENTRADA_PARA_PONER = ENTRADAS

type DelPanel = ElementoDe<'seccion' | 'indicador'>

/**
 * Determinista y sin base, como toda `validar`: no reparsea el SQL (eso lo hace el Panel al pintarlo). Revisa el
 * nombre, la versión del catálogo y que cada campo que usa siga en el catálogo.
 */
function validarDelPanel(e: DelPanel, clave: Clave, estado: Vigentes): readonly Problema[] {
  const problemas: Problema[] = []
  if (!e.nombre.trim()) problemas.push(invalido('nombre', 'Necesita un nombre para el Panel'))
  const otros: readonly { readonly clave: Clave; readonly elemento: DelPanel }[] = [...estado.vigentes('seccion'), ...estado.vigentes('indicador')]
  if (otros.some((v) => v.clave !== clave && normalizar(v.elemento.nombre) === normalizar(e.nombre))) problemas.push(invalido('nombre', 'Ya hay algo en el Panel con ese nombre: para cambiarlo, usa reemplaza con su clave'))
  if (e.consulta.catalogo !== VERSION_DEL_CATALOGO) problemas.push(invalido('consulta', 'La consulta es de otro catálogo: pídela de nuevo'))
  for (const u of e.consulta.usa) {
    const [fuente, campo] = u.split('.')
    if (!esFuente(fuente) || !COLUMNAS[fuente].includes(campo)) problemas.push({ tipo: 'referencia_rota', clave: u })
  }
  return problemas
}

const delPanel = (etiqueta: string, nuevo: string) => (antes: DelPanel | null, despues: DelPanel | null) =>
  despues ? `${etiqueta} ${antes ? '' : `${nuevo} `}«${despues.nombre}»: ${despues.consulta.enPalabras}` : `Quitar ${etiqueta.toLowerCase()} «${antes?.nombre ?? ''}»`

export const DEFINICIONES: { readonly [T in TipoDeElemento]: DefinicionDeElemento<T> } = {
  regla: {
    contrato: 1,
    entrada: ENTRADAS.regla,
    alcance: 'clientes',
    claveFija: () => null,
    referencias: (r) => [
      ...(r.cuando.tipo === 'pedido' && r.cuando.condicion.tipo === 'incluye' ? [r.cuando.condicion.producto] : []),
      ...r.efectos.flatMap((e) => (e.tipo === 'pedir_dato' ? [e.campo] : [])),
    ],
    textos: (r) =>
      r.efectos.flatMap((e) =>
        e.tipo === 'pasar_al_dueno' ? [{ campo: 'avisoAlCliente', texto: e.avisoAlCliente }] : e.tipo === 'no_vender' ? [{ campo: 'explicacionAlCliente', texto: e.explicacionAlCliente }] : [],
      ),
    validar: (r, clave, estado) => {
      const problemas: Problema[] = []
      if (!r.nombre.trim()) problemas.push(invalido('nombre', 'La regla necesita un nombre'))
      if (estado.vigentes('regla').some((v) => v.clave !== clave && normalizar(v.elemento.nombre) === normalizar(r.nombre))) {
        problemas.push(invalido('nombre', 'Ya hay una regla con ese nombre: para cambiarla, usa reemplaza con su clave'))
      }
      if (r.cuando.tipo === 'tema' && r.escenarios.noActivan.length === 0) problemas.push(invalido('escenarios', 'Una regla de tema necesita un mensaje en el que no se active'))
      if (r.cuando.tipo === 'siempre' && r.efectos.some((e) => ESPERAN_UNA_CONDICION.includes(e.tipo))) {
        problemas.push(
          invalido(
            'efectos',
            'Una regla que vale siempre solo puede no prometer (plazos, descuentos o disponibilidad) o no decir frases: pasarle la conversación al Dueño o abrirle un Caso pasaría en cada mensaje. Para abrir un Caso, ponle una condición de pedido (ciudad_fuera_de, total_desde o incluye)',
          ),
        )
      }
      for (const e of r.efectos) {
        if (ordenDelPunto(DONDE_SE_CUMPLE[e.tipo]) < ordenDelPunto(CUANDO[r.cuando.tipo].seSabeEn)) {
          problemas.push(invalido('efectos', `${e.tipo} se cumple antes de que se sepa si la regla aplica`))
        }
      }
      return problemas
    },
    describir: (antes, despues, estado) => cambio(antes, despues, (r) => reglaEnPalabras(r, estado), 'Regla', 'nueva'),
  },
  voz: {
    contrato: 1,
    entrada: ENTRADAS.voz,
    alcance: 'clientes',
    claveFija: () => comoClave('voz'),
    referencias: () => [],
    textos: (v) => [{ campo: 'estilo', texto: v.estilo }, ...(v.nombreDelAgente ? [{ campo: 'nombreDelAgente', texto: v.nombreDelAgente }] : [])],
    validar: (v) => (v.estilo.length > LARGO_DEL_ESTILO ? [invalido('estilo', `El estilo no puede pasar de ${LARGO_DEL_ESTILO} caracteres`)] : []),
    describir: (antes, despues) => cambio(antes, despues, vozEnPalabras, 'Cómo habla tu agente'),
  },
  dato: {
    contrato: 1,
    entrada: ENTRADAS.dato,
    alcance: 'clientes',
    claveFija: (d) => comoClave(`dato:${d.campo}`),
    referencias: () => [],
    textos: (d) => [{ campo: d.campo, texto: d.valor }],
    validar: (d) => (d.valor.trim() ? [] : [invalido(d.campo, 'El dato no puede quedar vacío: para borrarlo, quítalo')]),
    describir: (antes, despues) => {
      const campo = (despues ?? antes)?.campo ?? 'descripcion'
      return cambio(antes, despues, (d) => d.valor, ETIQUETA_DEL_DATO[campo], NUEVO_DEL_DATO[campo])
    },
  },
  pregunta: {
    contrato: 1,
    entrada: ENTRADAS.pregunta,
    alcance: 'clientes',
    claveFija: () => null,
    referencias: () => [],
    textos: (p) => [{ campo: 'respuesta', texto: p.respuesta }],
    validar: (p, clave, estado) => {
      if (!p.pregunta.trim() || !p.respuesta.trim()) return [invalido('pregunta', 'La pregunta y la respuesta no pueden quedar vacías')]
      const repetida = estado.vigentes('pregunta').find((v) => v.clave !== clave && normalizar(v.elemento.pregunta) === normalizar(p.pregunta))
      return repetida ? [invalido('pregunta', `Esa pregunta ya existe: para cambiarla, usa reemplaza con la clave ${repetida.clave}`)] : []
    },
    describir: (antes, despues) => cambio(antes, despues, (p) => `${p.pregunta} ${p.respuesta}`, 'Pregunta frecuente', 'nueva'),
  },
  producto: {
    contrato: 1,
    entrada: ENTRADAS.producto,
    alcance: 'clientes',
    claveFija: () => null,
    referencias: () => [],
    textos: (p) => [
      { campo: 'nombre', texto: p.nombre },
      { campo: 'descripcion', texto: p.descripcion },
    ],
    validar: (p, clave, estado) => {
      const problemas: Problema[] = []
      if (!p.nombre.trim()) problemas.push(invalido('nombre', 'El producto necesita un nombre'))
      if (!Number.isInteger(p.precio) || p.precio <= 0) problemas.push(invalido('precio', 'El precio es un entero mayor que cero, en pesos'))
      const repetido = p.activo && estado.vigentes('producto').find((v) => v.clave !== clave && v.elemento.activo && normalizar(v.elemento.nombre) === normalizar(p.nombre))
      if (repetido) problemas.push(invalido('nombre', `Ya hay un producto activo con ese nombre: para cambiarlo, usa reemplaza con la clave ${repetido.clave}`))
      return problemas
    },
    describir: (antes, despues) => {
      const nombre = (despues ?? antes)?.nombre ?? ''
      if (antes && despues) {
        const partes = [
          ...(antes.nombre !== despues.nombre ? [`nombre «${antes.nombre}» → «${despues.nombre}»`] : []),
          ...(antes.precio !== despues.precio ? [`precio ${pesos(antes.precio)} → ${pesos(despues.precio)}`] : []),
          ...(antes.descripcion !== despues.descripcion ? ['descripción nueva'] : []),
          ...(antes.activo !== despues.activo ? [despues.activo ? 'se vuelve a vender' : 'deja de venderse'] : []),
        ]
        return `Producto ${nombre}: ${partes.join(', ') || 'sin cambios'}`
      }
      if (despues) return `Producto nuevo: ${despues.nombre}, ${pesos(despues.precio)}`
      return `Quitar el producto ${nombre}`
    },
  },
  seccion: {
    contrato: 1,
    entrada: ENTRADAS.seccion,
    alcance: 'panel',
    claveFija: () => null,
    referencias: () => [],
    /** Nada de una Sección llega a un Cliente: no pasa por `revisarTextoDelDueno` ni por `nombresAjenos`. */
    textos: () => [],
    validar: validarDelPanel,
    describir: delPanel('Sección', 'nueva'),
  },
  indicador: {
    contrato: 1,
    entrada: ENTRADAS.indicador,
    alcance: 'panel',
    claveFija: () => null,
    referencias: () => [],
    textos: () => [],
    validar: validarDelPanel,
    describir: delPanel('Indicador', 'nuevo'),
  },
}

/** Una fila de `DEFINICIONES` vista sobre la unión: para quien recorre Elementos de cualquier tipo. */
export function definicionDe(tipo: TipoDeElemento): DefinicionDeElemento<TipoDeElemento> {
  return DEFINICIONES[tipo]
}

/** Lo que vale ahora, sin "nuevo": para contarle al Dueño qué dejó otro. */
export function describirVigente(e: Elemento, estado: Vigentes): string {
  switch (e.tipo) {
    case 'regla':
      return `Regla ${reglaEnPalabras(e, estado)}`
    case 'voz':
      return `Cómo habla tu agente: «${vozEnPalabras(e)}»`
    case 'dato':
      return `${ETIQUETA_DEL_DATO[e.campo]}: «${e.valor}»`
    case 'pregunta':
      return `Pregunta frecuente: «${e.pregunta} ${e.respuesta}»`
    case 'producto':
      return `Producto ${e.nombre}, ${pesos(e.precio)}${e.activo ? '' : ', que no se vende'}`
    case 'seccion':
      return `Sección «${e.nombre}»: ${e.consulta.enPalabras}`
    case 'indicador':
      return `Indicador «${e.nombre}»: ${e.consulta.enPalabras}`
  }
}

/** Pura. `validarEscritura` hace cumplir que toda clave empiece por su tipo. Una lápida no trae Elemento, y esto sí sirve. */
export function alcanceDeLaClave(clave: Clave): Alcance {
  const tipo = clave.split(':')[0]
  return tipo in DEFINICIONES ? definicionDe(tipo as TipoDeElemento).alcance : 'clientes'
}

export function describirCambio(antes: Elemento | null, despues: Elemento | null, estado: Vigentes): string {
  const tipo = (despues ?? antes)?.tipo
  return tipo ? definicionDe(tipo).describir(antes, despues, estado) : ''
}

type Es<A extends true> = A
type _FilaNoEsElemento = Es<'fila' extends TipoDeElemento ? false : true>
type _LlaveNoEsElemento = Es<'llave' extends TipoDeElemento ? false : true>
type _SinGuia = Es<'guia' extends Efecto['tipo'] ? false : true>
type _ReglaConEscenarioQueActiva = Es<[] extends ElementoDe<'regla'>['escenarios']['activan'] ? false : true>
type VaAlModelo = { [K in keyof typeof CUANDO]: (typeof CUANDO)[K]['evalua'] extends 'activar' ? K : never }[keyof typeof CUANDO]
type _SoloTemaVaAlModelo = Es<[VaAlModelo] extends ['tema'] ? (['tema'] extends [VaAlModelo] ? true : false) : false>
type _DatoSoloSeDescribe = Es<(typeof VISTA_PREVIA)['dato'] extends 'describir' ? true : false>
type _EsquemaDaElementos = Es<[z.output<typeof ESQUEMA_DE_ELEMENTO>] extends [Elemento] ? true : false>
/** El Agente del dueño no escribe SQL: lo que pone de una Sección o un Indicador no trae la consulta. */
type _PanelSinConsultaEnLaEntrada = Es<'consulta' extends keyof EntradaDe<'seccion'> | keyof EntradaDe<'indicador'> ? false : true>
/** Una consulta guardada no se arma a mano: es una marca. */
type _ConsultaConMarca = Es<{ sql: string } extends ElementoDe<'indicador'>['consulta'] ? false : true>
/** Lo del Panel solo lo ve el Dueño. */
type _PanelConAlcancePanel = Es<(typeof VISTA_PREVIA)['seccion' | 'indicador'] extends 'panel' ? true : false>
type Apagados<T> = { [K in keyof T]: T[K] extends 'no' ? K : never }[keyof T]
type Atrasados = Apagados<(typeof SE_CUMPLE_HOY)['cuando']> | Apagados<(typeof SE_CUMPLE_HOY)['efecto']>
type DelPlanB = 'tema' | 'fuera_de_horario' | 'pedir_dato' | 'no_vender'
/** Encender uno de estos exige su compilador en `clientes/reglas.ts` y tocar esta línea. */
type _AtrasadosSonLosDelPlanB = Es<[Atrasados] extends [DelPlanB] ? ([DelPlanB] extends [Atrasados] ? true : false) : false>
export type ComprobacionesDeElementos = [
  _FilaNoEsElemento,
  _LlaveNoEsElemento,
  _SinGuia,
  _ReglaConEscenarioQueActiva,
  _SoloTemaVaAlModelo,
  _DatoSoloSeDescribe,
  _EsquemaDaElementos,
  _AtrasadosSonLosDelPlanB,
  _PanelSinConsultaEnLaEntrada,
  _ConsultaConMarca,
  _PanelConAlcancePanel,
]
