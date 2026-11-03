/**
 * La única definición de lo que una consulta puede leer. De `FUENTES` salen el texto del redactor, el prólogo del
 * lote, las columnas que acepta el validador y los GRANT por columna de `drizzle/0004_consultas.sql`.
 * `probar-consultas` compara esta tabla con la base en los dos sentidos.
 */
import { ESTADOS_DE_PEDIDO, type EstadoDePedido } from '@/db/esquema'
import type { NombreDeFuente, Supuesto, TipoDeCampo, VersionDelCatalogo } from './tipos'

export const VERSION_DEL_CATALOGO = 1 as VersionDelCatalogo

/** M2: 6 de 7 errores fueron una ventana de 30 días que nadie pidió. Si el redactor la usa, el código la dice. */
export const VENTANA_POR_DEFECTO = { dias: 30, supuesto: 'Conté los últimos 30 días, porque no dijiste desde cuándo.' as Supuesto } as const

/** Definido una vez. Entra al SQL de las CTE como literales de esta lista, nunca como texto del modelo. */
export const CUENTA_COMO_VENTA = ['confirmado', 'enviado', 'entregado', 'novedad'] as const satisfies readonly EstadoDePedido[]

/** Las tablas que lee una CTE. Lo que no está aquí no tiene GRANT. `productos` no lee tabla: llega como parámetro. */
export type TablaLeida = 'pedidos' | 'clientes' | 'casos' | 'mensajes_cliente'

export type Campo = { readonly tipo: TipoDeCampo; readonly descripcion: string }
export type Medida = { readonly nombre: string; readonly sql: string; readonly enPalabras: string }

export type DefinicionDeFuente = {
  readonly descripcion: string
  /** Las columnas de salida de la CTE, en orden. `probar-consultas` corre `SELECT * FROM <fuente> LIMIT 0` y compara. */
  readonly campos: Readonly<Record<string, Campo>>
  /** Agregados con nombre que el redactor copia tal cual. No son columnas. */
  readonly medidas: readonly Medida[]
  /** Lo que la fuente no trae. Con esto el redactor declina (12 de 12 en M2). */
  readonly noTrae: readonly string[]
  /** Las columnas físicas que lee la CTE: de aquí salen los GRANT. */
  readonly lee: { readonly [T in TablaLeida]?: readonly string[] }
  /** `$1` el Negocio (uuid), `$2` su zona (texto), `$3` sus productos (jsonb de `leerEstado`). Lee `public.<tabla>` con `WHERE negocio_id = $1`. */
  readonly cte: string
}

const VENTA = CUENTA_COMO_VENTA.map((e) => `'${e}'`).join(', ')
const local = (col: string) => `(${col} AT TIME ZONE $2::text)`

export const FUENTES = {
  hoy: {
    descripcion: 'Una sola fila con hoy y ahora, en la zona del Negocio.',
    campos: {
      hoy_local: { tipo: 'fecha', descripcion: 'La fecha de hoy en la zona del Negocio' },
      ahora: { tipo: 'instante', descripcion: "Este momento. Para las últimas 24 horas: creado > hoy.ahora - interval '24 hours'" },
    },
    medidas: [],
    noTrae: [],
    lee: {},
    cte: `SELECT ${local('now()')}::date AS hoy_local, now() AS ahora`,
  },
  pedidos: {
    descripcion: 'Un pedido por fila, con su estado actual (no guarda el historial de estados).',
    campos: {
      id: { tipo: 'id', descripcion: 'El pedido' },
      numero: { tipo: 'entero', descripcion: 'El número que ve el Dueño' },
      cliente_id: { tipo: 'id', descripcion: 'clientes.id' },
      ciudad: { tipo: 'texto', descripcion: 'Ciudad de entrega' },
      estado: { tipo: 'texto', descripcion: ESTADOS_DE_PEDIDO.join(', ') },
      total: { tipo: 'entero', descripcion: 'Total en pesos colombianos' },
      creado: { tipo: 'instante', descripcion: 'Cuándo se creó' },
      dia_local: { tipo: 'fecha', descripcion: 'Día de creado, en la zona del Negocio' },
      mes_local: { tipo: 'fecha', descripcion: 'Primer día del mes de creado, en la zona del Negocio' },
      hora_local: { tipo: 'entero', descripcion: 'Hora de 0 a 23 de creado, en la zona del Negocio' },
      cuenta_como_venta: { tipo: 'si_no', descripcion: `Definición fija: estado ${CUENTA_COMO_VENTA.join(', ')}` },
    },
    medidas: [
      { nombre: 'ventas', sql: 'sum(total) FILTER (WHERE cuenta_como_venta)', enPalabras: 'lo vendido en pesos: confirmados, enviados, entregados y con novedad' },
      { nombre: 'pedidos_confirmados', sql: 'count(*) FILTER (WHERE cuenta_como_venta)', enPalabras: 'pedidos que cuentan como venta' },
      { nombre: 'ticket_promedio', sql: 'round(avg(total) FILTER (WHERE cuenta_como_venta))', enPalabras: 'el valor medio de un pedido que cuenta como venta' },
    ],
    noTrae: ['cuándo se confirmó, se envió o se entregó', 'costo de envío, método de pago, dirección y teléfono'],
    lee: { pedidos: ['negocio_id', 'id', 'numero', 'cliente_id', 'ciudad', 'estado', 'total', 'creado'] },
    cte: `SELECT p.id, p.numero, p.cliente_id, p.ciudad, p.estado, p.total, p.creado,
    ${local('p.creado')}::date AS dia_local,
    date_trunc('month', ${local('p.creado')})::date AS mes_local,
    extract(hour FROM ${local('p.creado')})::int AS hora_local,
    (p.estado IN (${VENTA})) AS cuenta_como_venta
  FROM public.pedidos p WHERE p.negocio_id = $1::uuid`,
  },
  lineas_de_pedido: {
    descripcion: 'Una fila por producto de cada pedido. Para "el producto más vendido" o unidades por producto.',
    campos: {
      pedido_id: { tipo: 'id', descripcion: 'pedidos.id' },
      cliente_id: { tipo: 'id', descripcion: 'clientes.id' },
      producto_id: { tipo: 'id', descripcion: 'productos.id' },
      producto: { tipo: 'texto', descripcion: 'Nombre del producto cuando se pidió' },
      cantidad: { tipo: 'entero', descripcion: 'Unidades' },
      precio_unitario: { tipo: 'entero', descripcion: 'Precio por unidad cuando se pidió, en pesos' },
      subtotal: { tipo: 'entero', descripcion: 'cantidad por precio_unitario' },
      dia_local: { tipo: 'fecha', descripcion: 'Día del pedido, en la zona del Negocio' },
      cuenta_como_venta: { tipo: 'si_no', descripcion: 'La del pedido' },
    },
    medidas: [{ nombre: 'unidades_vendidas', sql: 'sum(cantidad) FILTER (WHERE cuenta_como_venta)', enPalabras: 'unidades en pedidos que cuentan como venta' }],
    noTrae: ['el costo de cada producto ni el margen'],
    lee: { pedidos: ['negocio_id', 'id', 'cliente_id', 'items', 'estado', 'creado'] },
    cte: `SELECT p.id AS pedido_id, p.cliente_id, i.item->>'productoId' AS producto_id, i.item->>'nombre' AS producto,
    (i.item->>'cantidad')::int AS cantidad, (i.item->>'precio')::int AS precio_unitario,
    (i.item->>'cantidad')::int * (i.item->>'precio')::int AS subtotal,
    ${local('p.creado')}::date AS dia_local,
    (p.estado IN (${VENTA})) AS cuenta_como_venta
  FROM public.pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.items) AS i(item) WHERE p.negocio_id = $1::uuid`,
  },
  productos: {
    descripcion: 'El catálogo vigente del Negocio.',
    campos: {
      id: { tipo: 'id', descripcion: 'El producto; es lineas_de_pedido.producto_id' },
      nombre: { tipo: 'texto', descripcion: 'Nombre' },
      precio: { tipo: 'entero', descripcion: 'Precio de hoy, en pesos' },
      activo: { tipo: 'si_no', descripcion: 'Si se vende hoy' },
    },
    medidas: [],
    noTrae: ['costo de compra, margen e inventario'],
    lee: {},
    cte: `SELECT x.id, x.nombre, x.precio, x.activo FROM jsonb_to_recordset($3::jsonb) AS x(id text, nombre text, precio int, activo boolean)`,
  },
  clientes: {
    descripcion: 'Quienes le escriben o le compran al Negocio.',
    campos: {
      id: { tipo: 'id', descripcion: 'El Cliente' },
      nombre: { tipo: 'texto', descripcion: 'Nombre (puede venir vacío)' },
      creado: { tipo: 'instante', descripcion: 'Cuándo escribió por primera vez' },
      dia_local: { tipo: 'fecha', descripcion: 'Día de creado, en la zona del Negocio' },
      mes_local: { tipo: 'fecha', descripcion: 'Primer día del mes de creado, en la zona del Negocio' },
      ultimo_mensaje: { tipo: 'instante', descripcion: 'Su último mensaje; null si nunca escribió' },
    },
    medidas: [],
    noTrae: ['teléfono, correo y dirección', 'ciudad (está en cada pedido)'],
    lee: { clientes: ['negocio_id', 'id', 'nombre', 'creado', 'ultimo_mensaje_entrante'] },
    cte: `SELECT c.id, c.nombre, c.creado, ${local('c.creado')}::date AS dia_local,
    date_trunc('month', ${local('c.creado')})::date AS mes_local, c.ultimo_mensaje_entrante AS ultimo_mensaje
  FROM public.clientes c WHERE c.negocio_id = $1::uuid`,
  },
  casos: {
    descripcion: 'Lo que el Agente de clientes le trajo al Dueño.',
    campos: {
      id: { tipo: 'id', descripcion: 'El Caso' },
      cliente_id: { tipo: 'id', descripcion: 'clientes.id, o null' },
      pedido_id: { tipo: 'id', descripcion: 'pedidos.id, o null' },
      titulo: { tipo: 'texto', descripcion: 'Título corto' },
      estado: { tipo: 'texto', descripcion: 'abierto, esperando_dueno o resuelto' },
      abierto: { tipo: 'si_no', descripcion: 'Definición fija: estado distinto de resuelto' },
      creado: { tipo: 'instante', descripcion: 'Cuándo se abrió' },
      resuelto: { tipo: 'instante', descripcion: 'Cuándo se resolvió; null si sigue abierto' },
      dia_local: { tipo: 'fecha', descripcion: 'Día de apertura, en la zona del Negocio' },
    },
    medidas: [],
    noTrae: ['el detalle, la propuesta ni la resolución en texto'],
    lee: { casos: ['negocio_id', 'id', 'cliente_id', 'pedido_id', 'titulo', 'estado', 'creado', 'resuelto'] },
    cte: `SELECT k.id, k.cliente_id, k.pedido_id, k.titulo, k.estado, (k.estado <> 'resuelto') AS abierto, k.creado, k.resuelto,
    ${local('k.creado')}::date AS dia_local
  FROM public.casos k WHERE k.negocio_id = $1::uuid`,
  },
  conversaciones: {
    descripcion: 'Una fila por Cliente y día local: sus mensajes con el Agente de clientes. Sin texto.',
    campos: {
      cliente_id: { tipo: 'id', descripcion: 'clientes.id' },
      dia_local: { tipo: 'fecha', descripcion: 'Día, en la zona del Negocio' },
      inicio: { tipo: 'instante', descripcion: 'Primer mensaje del Cliente ese día' },
      mensajes_cliente: { tipo: 'entero', descripcion: 'Mensajes del Cliente ese día' },
      mensajes_agente: { tipo: 'entero', descripcion: 'Respuestas del Agente ese día' },
      segundos_primera_respuesta: { tipo: 'numero', descripcion: 'Segundos hasta la primera respuesta; null si no respondió' },
    },
    medidas: [{ nombre: 'primera_respuesta_mediana', sql: 'percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos_primera_respuesta)', enPalabras: 'la mediana de segundos hasta la primera respuesta' }],
    noTrae: ['el texto de los mensajes'],
    lee: { mensajes_cliente: ['negocio_id', 'cliente_id', 'rol', 'creado'] },
    cte: `SELECT x.cliente_id, x.dia_local, x.inicio,
    count(*) FILTER (WHERE x.rol = 'cliente')::int AS mensajes_cliente,
    count(*) FILTER (WHERE x.rol = 'agente')::int AS mensajes_agente,
    extract(epoch FROM min(x.creado) FILTER (WHERE x.rol = 'agente' AND x.creado >= x.inicio) - x.inicio) AS segundos_primera_respuesta
  FROM (
    SELECT m.cliente_id, m.rol, m.creado, ${local('m.creado')}::date AS dia_local,
      min(m.creado) FILTER (WHERE m.rol = 'cliente') OVER (PARTITION BY m.cliente_id, ${local('m.creado')}::date) AS inicio
    FROM public.mensajes_cliente m WHERE m.negocio_id = $1::uuid
  ) x WHERE x.inicio IS NOT NULL GROUP BY x.cliente_id, x.dia_local, x.inicio`,
  },
} as const satisfies Record<NombreDeFuente, DefinicionDeFuente>

export const NOMBRES_DE_FUENTE = Object.keys(FUENTES) as [NombreDeFuente, ...NombreDeFuente[]]

export const esFuente = (nombre: string): nombre is NombreDeFuente => Object.hasOwn(FUENTES, nombre)

/** Lo que acepta el validador. Derivado: agregar un campo a `FUENTES` lo deja leer, y `probar-consultas` exige su GRANT. */
export const COLUMNAS: { readonly [F in NombreDeFuente]: readonly string[] } = Object.fromEntries(NOMBRES_DE_FUENTE.map((f) => [f, Object.keys(FUENTES[f].campos)])) as never

/** Los GRANT por columna, derivados. `scripts/grants-de-consultas.mts` los imprime para la migración; la prueba los compara con la base. */
export function grantsDeConsultas(): ReadonlyMap<TablaLeida, ReadonlySet<string>> {
  const porTabla = new Map<TablaLeida, Set<string>>()
  for (const f of NOMBRES_DE_FUENTE) {
    const lee: DefinicionDeFuente['lee'] = FUENTES[f].lee
    for (const [tabla, columnas] of Object.entries(lee) as [TablaLeida, readonly string[]][]) for (const c of columnas) porTabla.set(tabla, (porTabla.get(tabla) ?? new Set()).add(c))
  }
  return porTabla
}

/** Una CTE por fuente, en el orden de `FUENTES`. Postgres no evalúa las que la consulta no nombra. */
export function prologo(): string {
  return NOMBRES_DE_FUENTE.map((f) => `${f} AS (\n  ${FUENTES[f].cte}\n)`).join(',\n')
}

/** Lo único que ve el redactor del Negocio: fuentes, campos, medidas, lo que no traen y la ventana por defecto. Nunca filas. */
export function textoParaElRedactor(): string {
  const fuente = (f: NombreDeFuente) => {
    const d: DefinicionDeFuente = FUENTES[f]
    const campos = Object.entries(d.campos).map(([n, c]) => `    - ${n} (${c.tipo}): ${c.descripcion}`)
    const medidas = d.medidas.map((m) => `    - ${m.nombre} = ${m.sql}: ${m.enPalabras}`)
    return [`- ${f}: ${d.descripcion}`, '  Campos:', ...campos, ...(medidas.length ? ['  Medidas:', ...medidas] : []), ...(d.noTrae.length ? [`  NO trae: ${d.noTrae.join('; ')}.`] : [])].join('\n')
  }
  return [
    'Fuentes (las únicas; ya vienen filtradas al Negocio y con las fechas en su zona):',
    ...NOMBRES_DE_FUENTE.map(fuente),
    `Si el Dueño no dice desde cuándo y hace falta una ventana, usa dia_local > hoy.hoy_local - ${VENTANA_POR_DEFECTO.dias} y responde ventana = "por_defecto".`,
  ].join('\n')
}
