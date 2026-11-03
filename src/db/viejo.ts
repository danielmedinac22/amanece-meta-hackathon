/**
 * Las tablas de antes de los Elementos. Siguen en la base hasta el 4-nov, sin lector: solo las importa
 * `scripts/a-elementos.mts` (eslint lo prohíbe en src/). `piezas` son las Secciones e Indicadores en JS de antes del
 * 2-nov: `a-elementos --en-seco` se detiene si queda una activa. `drizzle.config.ts` lista este archivo para que `generate`
 * no proponga borrarlas. `negocios.conocimiento` sigue en `esquema.ts` como `conocimientoSinLector`: drizzle-kit
 * no reparte una tabla entre dos archivos.
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { cambios, negocios } from './esquema'

export type PreguntaFrecuente = { pregunta: string; respuesta: string }

export type Conocimiento = {
  descripcion: string
  ciudad: string
  horario: string
  envios: string
  pagos: string
  tono: string
  preguntas: PreguntaFrecuente[]
}

export const CONOCIMIENTO_VACIO: Conocimiento = { descripcion: '', ciudad: '', horario: '', envios: '', pagos: '', tono: '', preguntas: [] }

const negocioId = () =>
  uuid('negocio_id')
    .notNull()
    .references(() => negocios.id, { onDelete: 'cascade' })

export const productos = pgTable(
  'productos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    negocioId: negocioId(),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion').notNull().default(''),
    precio: integer('precio').notNull(),
    activo: boolean('activo').notNull().default(true),
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('productos_negocio').on(t.negocioId)],
)

export const reglas = pgTable(
  'reglas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    negocioId: negocioId(),
    clave: uuid('clave').notNull(),
    version: integer('version').notNull().default(1),
    texto: text('texto').notNull(),
    activa: boolean('activa').notNull().default(true),
    cambioId: uuid('cambio_id').references(() => cambios.id, { onDelete: 'set null' }),
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reglas_negocio').on(t.negocioId, t.activa)],
)

/** Cómo se pinta una Sección: tabla o tarjetas, con sus columnas. */
export type Vista = { tipo: 'tabla' | 'tarjetas'; columnas: { clave: string; titulo: string }[] }

/** Una Sección o un Indicador: código generado que corre aislado sobre los datos de un solo Negocio. */
export const piezas = pgTable(
  'piezas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('piezas_negocio').on(t.negocioId, t.activa)],
)
