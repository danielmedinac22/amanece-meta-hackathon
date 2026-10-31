import { sql } from 'drizzle-orm'
import { boolean, check, integer, jsonb, pgTable, real, text, timestamp, uuid, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Acto, VistaPreviaGuardada } from '../nucleo/cambios'
import type { ClaseDeMensaje, MotivoDeSilencio } from '../nucleo/salida/compuerta'

const id = () => uuid('id').primaryKey().defaultRandom()
const creado = () => timestamp('creado', { withTimezone: true }).notNull().defaultNow()
const negocioId = () =>
  uuid('negocio_id')
    .notNull()
    .references(() => negocios.id, { onDelete: 'cascade' })

/** Una pregunta frecuente con su respuesta, parte del conocimiento del Negocio. */
export type PreguntaFrecuente = { pregunta: string; respuesta: string }

/** Lo que el Agente de clientes sabe del Negocio, aparte del catálogo. */
export type Conocimiento = {
  descripcion: string
  ciudad: string
  horario: string
  envios: string
  pagos: string
  tono: string
  preguntas: PreguntaFrecuente[]
}

export const CONOCIMIENTO_VACIO: Conocimiento = {
  descripcion: '',
  ciudad: '',
  horario: '',
  envios: '',
  pagos: '',
  tono: '',
  preguntas: [],
}

export const negocios = pgTable(
  'negocios',
  {
    id: id(),
    nombre: text('nombre').notNull(),
    rubro: text('rubro').notNull().default(''),
    /** Código corto del link `wa.me` que lleva a un Cliente a este Negocio. */
    codigo: text('codigo').notNull(),
    conocimiento: jsonb('conocimiento').$type<Conocimiento>().notNull().default(CONOCIMIENTO_VACIO),
    /** `armando` mientras el Dueño lo arma; `listo` cuando el Agente de clientes ya atiende. */
    estado: text('estado', { enum: ['armando', 'listo'] }).notNull().default('armando'),
    creado: creado(),
  },
  (t) => [uniqueIndex('negocios_codigo').on(t.codigo)],
)

export const duenos = pgTable(
  'duenos',
  {
    id: id(),
    negocioId: negocioId(),
    /** Id del usuario en Neon Auth. */
    usuarioId: text('usuario_id').notNull(),
    nombre: text('nombre').notNull().default(''),
    email: text('email').notNull().default(''),
    /** Su WhatsApp, solo dígitos: un mensaje desde aquí va a su Hilo. */
    telefono: text('telefono'),
    creado: creado(),
  },
  (t) => [uniqueIndex('duenos_usuario').on(t.usuarioId), uniqueIndex('duenos_telefono').on(t.telefono).where(sql`${t.telefono} is not null`)],
)

export const productos = pgTable(
  'productos',
  {
    id: id(),
    negocioId: negocioId(),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion').notNull().default(''),
    /** En pesos colombianos, sin decimales. */
    precio: integer('precio').notNull(),
    activo: boolean('activo').notNull().default(true),
    creado: creado(),
  },
  (t) => [index('productos_negocio').on(t.negocioId)],
)

export const clientes = pgTable(
  'clientes',
  {
    id: id(),
    negocioId: negocioId(),
    telefono: text('telefono').notNull(),
    nombre: text('nombre').notNull().default(''),
    /** El último mensaje que escribió el Cliente: abre la ventana de 24 horas de WhatsApp. */
    ultimoMensajeEntrante: timestamp('ultimo_mensaje_entrante', { withTimezone: true }),
    creado: creado(),
  },
  (t) => [uniqueIndex('clientes_negocio_telefono').on(t.negocioId, t.telefono)],
)

/** La conversación de un Cliente con el Agente de clientes de un Negocio. */
export const mensajesCliente = pgTable(
  'mensajes_cliente',
  {
    id: id(),
    negocioId: negocioId(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    rol: text('rol', { enum: ['cliente', 'agente'] }).notNull(),
    texto: text('texto').notNull(),
    /** Id del mensaje en WhatsApp, para no procesar dos veces el mismo. */
    wamid: text('wamid'),
    creado: creado(),
  },
  (t) => [index('mensajes_cliente_cliente').on(t.clienteId, t.creado), uniqueIndex('mensajes_cliente_wamid').on(t.wamid)],
)

export type ItemDePedido = { productoId: string; nombre: string; cantidad: number; precio: number }

export const ESTADOS_DE_PEDIDO = ['pendiente', 'confirmado', 'enviado', 'entregado', 'novedad', 'cancelado'] as const

export const pedidos = pgTable(
  'pedidos',
  {
    id: id(),
    negocioId: negocioId(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(),
    items: jsonb('items').$type<ItemDePedido[]>().notNull(),
    total: integer('total').notNull(),
    ciudad: text('ciudad').notNull().default(''),
    direccion: text('direccion').notNull().default(''),
    estado: text('estado', { enum: ESTADOS_DE_PEDIDO }).notNull().default('pendiente'),
    creado: creado(),
  },
  (t) => [index('pedidos_negocio').on(t.negocioId, t.creado), uniqueIndex('pedidos_negocio_numero').on(t.negocioId, t.numero)],
)

/** Algo que el Agente de clientes no resuelve solo y le trae al Dueño. */
export const casos = pgTable(
  'casos',
  {
    id: id(),
    negocioId: negocioId(),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    pedidoId: uuid('pedido_id').references(() => pedidos.id, { onDelete: 'set null' }),
    titulo: text('titulo').notNull(),
    detalle: text('detalle').notNull().default(''),
    /** Lo que el Agente del dueño propone: la respuesta al Cliente y lo que hay que hacer. */
    propuesta: text('propuesta').notNull().default(''),
    estado: text('estado', { enum: ['abierto', 'esperando_dueno', 'resuelto'] })
      .notNull()
      .default('abierto'),
    resolucion: text('resolucion').notNull().default(''),
    creado: creado(),
    resuelto: timestamp('resuelto', { withTimezone: true }),
  },
  (t) => [index('casos_negocio').on(t.negocioId, t.creado)],
)

export const TIPOS_DE_CAMBIO = ['regla', 'conocimiento', 'seccion', 'indicador'] as const
export type TipoDeCambio = (typeof TIPOS_DE_CAMBIO)[number]

/** Algo que el Dueño le pidió a su Agente del dueño y queda funcionando en su Negocio. */
export const cambios = pgTable(
  'cambios',
  {
    id: id(),
    negocioId: negocioId(),
    duenoId: uuid('dueno_id').references(() => duenos.id, { onDelete: 'set null' }),
    tipo: text('tipo', { enum: TIPOS_DE_CAMBIO }).notNull(),
    /** Lo que pidió el Dueño, en sus palabras. */
    pedido: text('pedido').notNull(),
    resumen: text('resumen').notNull().default(''),
    estado: text('estado', { enum: ['propuesto', 'aplicado', 'descartado', 'revertido'] })
      .notNull()
      .default('propuesto'),
    /** Lo que el Cambio deja: el texto de la regla, el conocimiento nuevo o el código de la pieza. */
    propuesta: jsonb('propuesta').$type<Record<string, unknown>>().notNull(),
    /** Lo que había antes, para revertir. */
    anterior: jsonb('anterior').$type<Record<string, unknown> | null>(),
    /** Lo que el Dueño vio antes de aplicar: el resultado de la pieza o la respuesta simulada. */
    vistaPrevia: jsonb('vista_previa').$type<unknown>(),
    tokensEntrada: integer('tokens_entrada').notNull().default(0),
    tokensSalida: integer('tokens_salida').notNull().default(0),
    costoUsd: real('costo_usd').notNull().default(0),
    msHastaPropuesta: integer('ms_hasta_propuesta'),
    msHastaAplicado: integer('ms_hasta_aplicado'),
    creado: creado(),
    aplicado: timestamp('aplicado', { withTimezone: true }),
    /**
     * Puente hasta el corte del 31-oct: la propuesta que aplica este Cambio. Una reversión no tiene Cambio propio:
     * lo encuentra por la propuesta que revierte. Solo lo escribe y lo lee `src/nucleo/cambios/puente.ts`.
     */
    propuestaId: uuid('propuesta_id').references((): AnyPgColumn => propuestas.id, { onDelete: 'set null' }),
  },
  (t) => [index('cambios_negocio').on(t.negocioId, t.creado), uniqueIndex('cambios_propuesta').on(t.propuestaId).where(sql`${t.propuestaId} is not null`)],
)

/** Vacía hasta que existan los Elementos (30-oct): la columna ya tiene su forma para no migrar filas ese día. */
export type EscrituraDeHoy = { readonly elementos: readonly never[]; readonly filas: readonly never[] }

export const ESTADOS_DE_PROPUESTA = ['espera_al_dueno', 'aplicada', 'descartada', 'capacidad_faltante'] as const

/**
 * Lo que espera el botón del Dueño: un Cambio, su reversión o la respuesta a un Caso. "vencida" y "revertida" no
 * se guardan: se derivan (`vence` en espera; otra aplicada con `revierte = id`). Solo escribe `src/nucleo/cambios`.
 */
export const propuestas = pgTable(
  'propuestas',
  {
    id: id(),
    negocioId: negocioId(),
    palabrasDelDueno: text('palabras_del_dueno').notNull(),
    /** `null`: la propuso el núcleo, como la respuesta que trae el aviso de un Caso. */
    pedidoPor: uuid('pedido_por').references(() => duenos.id, { onDelete: 'set null' }),
    origen: text('origen', { enum: ['hilo', 'panel'] }).notNull().default('hilo'),
    escritura: jsonb('escritura').$type<EscrituraDeHoy>().notNull().default({ elementos: [], filas: [] }),
    actos: jsonb('actos').$type<readonly Acto[]>().notNull().default([]),
    huella: text('huella').notNull(),
    estado: text('estado', { enum: ESTADOS_DE_PROPUESTA }).notNull().default('espera_al_dueno'),
    vence: timestamp('vence', { withTimezone: true }).notNull(),
    vistaPrevia: jsonb('vista_previa').$type<VistaPreviaGuardada>().notNull(),
    /** En una aplicada, `null` quiere decir que la aplicó la política, sin botón. */
    aprobadoPor: uuid('aprobado_por').references(() => duenos.id, { onDelete: 'set null' }),
    version: integer('version'),
    revierte: uuid('revierte').references((): AnyPgColumn => propuestas.id, { onDelete: 'set null' }),
    creado: creado(),
  },
  (t) => [
    index('propuestas_negocio').on(t.negocioId, t.creado),
    index('propuestas_pendientes').on(t.negocioId, t.vence).where(sql`${t.estado} = 'espera_al_dueno'`),
    /** Con una sola reversión aplicada por propuesta, "revertida" se deriva sin ambigüedad. */
    uniqueIndex('propuestas_una_reversion').on(t.revierte).where(sql`${t.estado} = 'aplicada'`),
    check('propuestas_aprobada', sql`${t.aprobadoPor} is null or ${t.estado} = 'aplicada'`),
  ],
)

/** Una regla del Negocio. Cada versión es una fila; solo una versión por regla está activa. */
export const reglas = pgTable(
  'reglas',
  {
    id: id(),
    negocioId: negocioId(),
    /** Todas las versiones de una misma regla comparten `clave`. */
    clave: uuid('clave').notNull(),
    version: integer('version').notNull().default(1),
    texto: text('texto').notNull(),
    activa: boolean('activa').notNull().default(true),
    cambioId: uuid('cambio_id').references(() => cambios.id, { onDelete: 'set null' }),
    creado: creado(),
  },
  (t) => [index('reglas_negocio').on(t.negocioId, t.activa)],
)

/** Cómo se pinta una Sección: tabla o tarjetas, con sus columnas. */
export type Vista = { tipo: 'tabla' | 'tarjetas'; columnas: { clave: string; titulo: string }[] }

/** Una Sección o un Indicador: código generado que corre aislado sobre los datos de un solo Negocio. */
export const piezas = pgTable(
  'piezas',
  {
    id: id(),
    negocioId: negocioId(),
    tipo: text('tipo', { enum: ['seccion', 'indicador'] }).notNull(),
    clave: uuid('clave').notNull(),
    version: integer('version').notNull().default(1),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion').notNull().default(''),
    codigo: text('codigo').notNull(),
    vista: jsonb('vista').$type<Vista | null>(),
    activa: boolean('activa').notNull().default(true),
    cambioId: uuid('cambio_id').references(() => cambios.id, { onDelete: 'set null' }),
    creado: creado(),
  },
  (t) => [index('piezas_negocio').on(t.negocioId, t.activa)],
)

/** El Hilo de un Dueño con su Agente del dueño. Cada Dueño tiene el suyo. */
export const mensajesDueno = pgTable(
  'mensajes_dueno',
  {
    id: id(),
    negocioId: negocioId(),
    duenoId: uuid('dueno_id')
      .notNull()
      .references(() => duenos.id, { onDelete: 'cascade' }),
    rol: text('rol', { enum: ['dueno', 'agente'] }).notNull(),
    /** El mensaje completo del SDK de Vercel AI (`UIMessage`), con sus partes y herramientas. */
    mensaje: jsonb('mensaje').$type<unknown>().notNull(),
    creado: creado(),
  },
  (t) => [index('mensajes_dueno_dueno').on(t.duenoId, t.creado)],
)

/** Algo que un Dueño pidió y Amanece todavía no sabe hacer. */
export const capacidadesFaltantes = pgTable('capacidades_faltantes', {
  id: id(),
  negocioId: negocioId(),
  pedido: text('pedido').notNull(),
  motivo: text('motivo').notNull().default(''),
  creado: creado(),
})

/** Un turno de un agente, para medir tokens, costo y latencia. */
export const turnos = pgTable(
  'turnos',
  {
    id: id(),
    negocioId: uuid('negocio_id').references(() => negocios.id, { onDelete: 'cascade' }),
    agente: text('agente', { enum: ['clientes', 'dueno', 'generador'] }).notNull(),
    modelo: text('modelo').notNull(),
    tokensEntrada: integer('tokens_entrada').notNull(),
    tokensSalida: integer('tokens_salida').notNull(),
    costoUsd: real('costo_usd').notNull(),
    ms: integer('ms').notNull(),
    creado: creado(),
  },
  (t) => [index('turnos_creado').on(t.creado)],
)

/** Con qué Negocio está hablando un teléfono en el número compartido de Amanece. */
export const sesionesWhatsapp = pgTable('sesiones_whatsapp', {
  telefono: text('telefono').primaryKey(),
  negocioId: negocioId(),
  actualizado: timestamp('actualizado', { withTimezone: true }).notNull().defaultNow(),
})

/** Cada mensaje que entró al número de Amanece, una vez: el INSERT es el reclamo de `recibirMensaje`. */
export const mensajesEntrantes = pgTable(
  'mensajes_entrantes',
  {
    wamid: text('wamid').primaryKey(),
    telefono: text('telefono').notNull(),
    /** El timestamp de Meta: `max(enviado_en)` de un teléfono sin Cliente es su ventana de 24 horas. */
    enviadoEn: timestamp('enviado_en', { withTimezone: true }).notNull(),
    boton: text('boton'),
    recibido: timestamp('recibido', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mensajes_entrantes_telefono').on(t.telefono, t.enviadoEn)],
)

/**
 * Todo lo que pasó por `despachar`, con el veredicto de la compuerta, haya salido o no. Al observar, una fila
 * `no_sale` con estado `enviado` o `simulado` es un mensaje que la compuerta habría frenado.
 */
export const mensajesSalientes = pgTable(
  'mensajes_salientes',
  {
    id: id(),
    clave: text('clave').notNull(),
    negocioId: uuid('negocio_id').references(() => negocios.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }),
    casoId: uuid('caso_id').references(() => casos.id, { onDelete: 'set null' }),
    /** Null solo si el Cliente del destinatario no existe: no hubo a quién mandar. */
    telefono: text('telefono'),
    clase: text('clase').$type<ClaseDeMensaje>().notNull(),
    enRespuestaA: text('en_respuesta_a'),
    veredicto: text('veredicto', { enum: ['sale', 'no_sale'] }).notNull(),
    motivo: text('motivo').$type<MotivoDeSilencio>(),
    estado: text('estado', { enum: ['por_enviar', 'enviado', 'simulado', 'no_salio'] }).notNull(),
    wamid: text('wamid'),
    error: text('error'),
    creado: creado(),
    actualizado: timestamp('actualizado', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('mensajes_salientes_clave').on(t.clave),
    /** Una respuesta por mensaje aunque dos instancias atiendan el mismo reintento de Kapso. */
    uniqueIndex('mensajes_salientes_una_respuesta').on(t.enRespuestaA).where(sql`${t.veredicto} = 'sale'`),
    index('mensajes_salientes_negocio').on(t.negocioId, t.creado),
    index('mensajes_salientes_telefono').on(t.telefono, t.creado),
    check('mensajes_salientes_motivo', sql`(${t.veredicto} = 'sale') = (${t.motivo} is null)`),
  ],
)
