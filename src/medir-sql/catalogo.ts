/**
 * Catálogo de fuentes para el SQL acotado (throwaway, sección 1 del diseño c1). Cada fuente trae su CTE:
 * lee la tabla real, filtra por `negocio_id = $1`, deja afuera las columnas que no se exponen y deriva
 * las fechas en la zona del Negocio. El generador solo ve `textoDelCatalogo()`, nunca filas.
 */
export const ZONA = 'America/Bogota'

export type Columna = { nombre: string; tipo: string; descripcion: string }
export type Fuente = { nombre: string; descripcion: string; columnas: Columna[]; noTrae: string[]; cte: string }

const FECHAS = (alias: string, campo: string) => `
    (${alias}.${campo} AT TIME ZONE '${ZONA}')::date AS dia_local,
    date_trunc('month', ${alias}.${campo} AT TIME ZONE '${ZONA}')::date AS mes_local`

export const FUENTES: Fuente[] = [
  {
    nombre: 'hoy',
    descripcion: 'Una sola fila con la fecha de hoy en la zona horaria del Negocio.',
    columnas: [{ nombre: 'hoy_local', tipo: 'date', descripcion: 'La fecha de hoy en la zona del Negocio' }],
    noTrae: [],
    cte: `SELECT (now() AT TIME ZONE '${ZONA}')::date AS hoy_local`,
  },
  {
    nombre: 'pedidos',
    descripcion: 'Un pedido por fila. Es el pedido tal como está hoy: guarda su estado actual, no el historial de estados.',
    columnas: [
      { nombre: 'id', tipo: 'uuid', descripcion: 'Identificador del pedido' },
      { nombre: 'numero', tipo: 'int', descripcion: 'Número del pedido que ve el Dueño' },
      { nombre: 'cliente_id', tipo: 'uuid', descripcion: 'Cliente que lo hizo (clientes.id)' },
      { nombre: 'ciudad', tipo: 'text', descripcion: 'Ciudad de entrega' },
      { nombre: 'estado', tipo: 'text', descripcion: 'pendiente, confirmado, enviado, entregado, novedad o cancelado' },
      { nombre: 'total', tipo: 'int', descripcion: 'Total del pedido en pesos colombianos (COP)' },
      { nombre: 'creado', tipo: 'timestamptz', descripcion: 'Cuándo se creó el pedido' },
      { nombre: 'dia_local', tipo: 'date', descripcion: 'Día de creado en la zona del Negocio' },
      { nombre: 'mes_local', tipo: 'date', descripcion: 'Primer día del mes de creado, en la zona del Negocio' },
      { nombre: 'hora_local', tipo: 'int', descripcion: 'Hora (0 a 23) de creado en la zona del Negocio' },
      { nombre: 'cuenta_como_venta', tipo: 'boolean', descripcion: 'Definición fija: true si el pedido está confirmado, enviado, entregado o con novedad' },
    ],
    noTrae: [
      'cuándo se confirmó, se envió o se entregó el pedido (solo guarda cuándo se creó y el estado actual)',
      'costo de envío, método de pago, dirección y teléfono',
    ],
    cte: `SELECT p.id, p.numero, p.cliente_id, p.ciudad, p.estado, p.total, p.creado,${FECHAS('p', 'creado')},
    extract(hour FROM p.creado AT TIME ZONE '${ZONA}')::int AS hora_local,
    (p.estado IN ('confirmado', 'enviado', 'entregado', 'novedad')) AS cuenta_como_venta
  FROM public.pedidos p WHERE p.negocio_id = $1`,
  },
  {
    nombre: 'pedido_items',
    descripcion: 'Una fila por producto de cada pedido. Sirve para contar unidades por producto o ver qué productos van juntos.',
    columnas: [
      { nombre: 'pedido_id', tipo: 'uuid', descripcion: 'Pedido al que pertenece (pedidos.id)' },
      { nombre: 'cliente_id', tipo: 'uuid', descripcion: 'Cliente del pedido' },
      { nombre: 'producto_id', tipo: 'uuid', descripcion: 'Producto (productos.id)' },
      { nombre: 'producto', tipo: 'text', descripcion: 'Nombre del producto cuando se hizo el pedido' },
      { nombre: 'cantidad', tipo: 'int', descripcion: 'Unidades' },
      { nombre: 'precio_unitario', tipo: 'int', descripcion: 'Precio por unidad en COP cuando se hizo el pedido' },
      { nombre: 'subtotal', tipo: 'int', descripcion: 'cantidad por precio_unitario, en COP' },
      { nombre: 'dia_local', tipo: 'date', descripcion: 'Día del pedido en la zona del Negocio' },
      { nombre: 'cuenta_como_venta', tipo: 'boolean', descripcion: 'Igual que pedidos.cuenta_como_venta' },
    ],
    noTrae: ['el costo de cada producto'],
    cte: `SELECT p.id AS pedido_id, p.cliente_id, (i->>'productoId')::uuid AS producto_id, i->>'nombre' AS producto,
    (i->>'cantidad')::int AS cantidad, (i->>'precio')::int AS precio_unitario,
    ((i->>'cantidad')::int * (i->>'precio')::int) AS subtotal,
    (p.creado AT TIME ZONE '${ZONA}')::date AS dia_local,
    (p.estado IN ('confirmado', 'enviado', 'entregado', 'novedad')) AS cuenta_como_venta
  FROM public.pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.items) AS i WHERE p.negocio_id = $1`,
  },
  {
    nombre: 'productos',
    descripcion: 'El catálogo de productos del Negocio.',
    columnas: [
      { nombre: 'id', tipo: 'uuid', descripcion: 'Identificador del producto' },
      { nombre: 'nombre', tipo: 'text', descripcion: 'Nombre' },
      { nombre: 'descripcion', tipo: 'text', descripcion: 'Descripción' },
      { nombre: 'precio', tipo: 'int', descripcion: 'Precio de venta en COP' },
      { nombre: 'activo', tipo: 'boolean', descripcion: 'Si se vende hoy' },
    ],
    noTrae: ['el costo de compra, el margen y el inventario'],
    cte: `SELECT p.id, p.nombre, p.descripcion, p.precio, p.activo FROM public.productos p WHERE p.negocio_id = $1`,
  },
  {
    nombre: 'clientes',
    descripcion: 'Los Clientes del Negocio (quienes le escriben o le compran).',
    columnas: [
      { nombre: 'id', tipo: 'uuid', descripcion: 'Identificador del Cliente' },
      { nombre: 'nombre', tipo: 'text', descripcion: 'Nombre' },
      { nombre: 'creado', tipo: 'timestamptz', descripcion: 'Cuándo entró como Cliente' },
      { nombre: 'dia_local', tipo: 'date', descripcion: 'Día de alta en la zona del Negocio' },
      { nombre: 'mes_local', tipo: 'date', descripcion: 'Primer día del mes de alta, en la zona del Negocio' },
    ],
    noTrae: ['teléfono, correo, dirección y ciudad del Cliente (la ciudad está en cada pedido)'],
    cte: `SELECT c.id, c.nombre, c.creado,${FECHAS('c', 'creado')} FROM public.clientes c WHERE c.negocio_id = $1`,
  },
  {
    nombre: 'casos',
    descripcion: 'Casos: cosas que el Agente de clientes le pasó al Dueño.',
    columnas: [
      { nombre: 'id', tipo: 'uuid', descripcion: 'Identificador del Caso' },
      { nombre: 'cliente_id', tipo: 'uuid', descripcion: 'Cliente (puede ser null)' },
      { nombre: 'pedido_id', tipo: 'uuid', descripcion: 'Pedido relacionado (puede ser null)' },
      { nombre: 'titulo', tipo: 'text', descripcion: 'Título corto' },
      { nombre: 'estado', tipo: 'text', descripcion: 'abierto, esperando_dueno o resuelto' },
      { nombre: 'creado', tipo: 'timestamptz', descripcion: 'Cuándo se abrió' },
      { nombre: 'resuelto', tipo: 'timestamptz', descripcion: 'Cuándo se resolvió; null si sigue abierto' },
      { nombre: 'dia_local', tipo: 'date', descripcion: 'Día de apertura en la zona del Negocio' },
    ],
    noTrae: ['el detalle del Caso, la propuesta ni la resolución en texto'],
    cte: `SELECT k.id, k.cliente_id, k.pedido_id, k.titulo, k.estado, k.creado, k.resuelto, (k.creado AT TIME ZONE '${ZONA}')::date AS dia_local
  FROM public.casos k WHERE k.negocio_id = $1`,
  },
  {
    nombre: 'conversaciones',
    descripcion: 'Una fila por Cliente y día: sus mensajes con el Agente de clientes ese día (en la zona del Negocio). No trae el texto.',
    columnas: [
      { nombre: 'cliente_id', tipo: 'uuid', descripcion: 'Cliente' },
      { nombre: 'dia_local', tipo: 'date', descripcion: 'Día de la conversación en la zona del Negocio' },
      { nombre: 'inicio', tipo: 'timestamptz', descripcion: 'Primer mensaje del Cliente ese día' },
      { nombre: 'mensajes_cliente', tipo: 'int', descripcion: 'Mensajes que escribió el Cliente ese día' },
      { nombre: 'mensajes_agente', tipo: 'int', descripcion: 'Mensajes que respondió el Agente ese día' },
      { nombre: 'segundos_primera_respuesta', tipo: 'numeric', descripcion: 'Segundos entre inicio y la primera respuesta del Agente; null si el Agente no respondió' },
    ],
    noTrae: ['el texto de los mensajes (solo conteos y tiempos)'],
    cte: `SELECT x.cliente_id, x.dia_local, x.inicio,
    count(*) FILTER (WHERE x.rol = 'cliente')::int AS mensajes_cliente,
    count(*) FILTER (WHERE x.rol = 'agente')::int AS mensajes_agente,
    extract(epoch FROM (min(x.creado) FILTER (WHERE x.rol = 'agente' AND x.creado >= x.inicio) - x.inicio)) AS segundos_primera_respuesta
  FROM (
    SELECT m.cliente_id, m.rol, m.creado, (m.creado AT TIME ZONE '${ZONA}')::date AS dia_local,
      min(m.creado) FILTER (WHERE m.rol = 'cliente') OVER (PARTITION BY m.cliente_id, (m.creado AT TIME ZONE '${ZONA}')::date) AS inicio
    FROM public.mensajes_cliente m WHERE m.negocio_id = $1
  ) x WHERE x.inicio IS NOT NULL GROUP BY x.cliente_id, x.dia_local, x.inicio`,
  },
]

export const DEFINICIONES_FIJAS = [
  'cuenta_como_venta: un pedido cuenta como venta si está confirmado, enviado, entregado o con novedad. Los pendientes y cancelados no. Cuando el Dueño habla de pedidos "confirmados", de "ventas", de lo "vendido" o de lo que un Cliente "compró", usa cuenta_como_venta = true.',
  'Fechas: dia_local, mes_local y hora_local ya están en la zona horaria del Negocio. Para "hoy" usa hoy.hoy_local (la fuente hoy). No uses now(), current_date, AT TIME ZONE ni ninguna zona horaria ni desfase.',
  '"Últimos N días" son los N días calendario que terminan hoy, hoy incluido: dia_local > hoy_local - N.',
  'Una conversación es la fila de conversaciones: los mensajes de un Cliente en un mismo dia_local. El tiempo de primera respuesta es segundos_primera_respuesta, y solo cuentan las conversaciones donde el Agente respondió.',
  'El dinero está en pesos colombianos (COP) enteros.',
]

export function textoDelCatalogo(): string {
  const fuentes = FUENTES.map((f) => {
    const cols = f.columnas.map((c) => `    - ${c.nombre} (${c.tipo}): ${c.descripcion}`).join('\n')
    const no = f.noTrae.length ? `\n  NO trae: ${f.noTrae.join('; ')}.` : ''
    return `- ${f.nombre}: ${f.descripcion}\n  Columnas:\n${cols}${no}`
  }).join('\n')
  return `Fuentes (las únicas que puedes leer; ya vienen filtradas al Negocio y con las fechas en su zona horaria):\n${fuentes}\n\nDefiniciones fijas:\n${DEFINICIONES_FIJAS.map((d) => `- ${d}`).join('\n')}`
}

/** Una CTE por fuente. `$1` es el id del Negocio. */
export function prologo(): string {
  return `WITH ${FUENTES.map((f) => `${f.nombre} AS (\n  ${f.cte}\n)`).join(',\n')}`
}

export const COLUMNAS_POR_FUENTE: Record<string, string[]> = Object.fromEntries(FUENTES.map((f) => [f.nombre, f.columnas.map((c) => c.nombre)]))
