/**
 * Brazo de respaldo (c2): entrada declarada y validada por el núcleo, más JavaScript en QuickJS sobre las filas
 * cargadas. Reusa el generador actual (`src/agentes/generador.ts`) y le agrega el paso de declarar la entrada.
 */
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { neon } from '@neondatabase/serverless'
import { modelo } from '@/lib/modelo'
import { FORMA_TEXTO } from './peticiones'
import type { Forma } from './validar'

export const CONTRATO_V1 = {
  productos: ['id', 'nombre', 'precio', 'activo'],
  clientes: ['id', 'nombre', 'telefonoEnmascarado', 'creado'],
  pedidos: ['id', 'numero', 'clienteId', 'items', 'total', 'ciudad', 'estado', 'creado'],
  casos: ['id', 'titulo', 'estado', 'clienteId', 'pedidoId', 'creado', 'resuelto'],
  mensajes: ['clienteId', 'rol', 'creado'],
} as const
export type Tabla = keyof typeof CONTRATO_V1
const TABLAS = Object.keys(CONTRATO_V1) as [Tabla, ...Tabla[]]
export const TECHO_DE_FILAS = 20_000
export const TECHO_DE_VENTANA = 365

export const FORMA_DE_LOS_DATOS = `datos = {
  hoy: string ISO, zonaHoraria: "America/Bogota",
  negocio: { nombre, rubro, ciudad },
  tablas: {  // solo las que declaraste, solo los campos que declaraste
    productos: [{ id, nombre, precio (COP entero), activo }],
    clientes: [{ id, nombre, telefonoEnmascarado, creado (ISO UTC) }],
    pedidos: [{ id, numero, clienteId, items: [{ productoId, nombre, cantidad, precio }], total (COP), ciudad, estado: "pendiente"|"confirmado"|"enviado"|"entregado"|"novedad"|"cancelado", creado (ISO UTC) }],
    casos: [{ id, titulo, estado: "abierto"|"esperando_dueno"|"resuelto", clienteId, pedidoId, creado (ISO UTC), resuelto (ISO UTC|null) }],
    mensajes: [{ clienteId, rol: "cliente"|"agente", creado (ISO UTC) }]
  },
  resumen: { ventanaDias, filasLeidas: { tabla: n }, completa: true }
}`

export const DEFINICIONES_TEXTO = `Definiciones del Negocio:
- Un pedido cuenta como venta si está confirmado, enviado, entregado o con novedad. Los pendientes y cancelados no. Cuando el Dueño habla de pedidos "confirmados", de "ventas", de lo "vendido" o de lo que un Cliente "compró", cuenta solo esos.
- "Últimos N días" son los N días calendario que terminan hoy, hoy incluido: el día del pedido (en hora de Bogotá) es mayor que el día de hoy menos N.
- Una conversación son los mensajes de un Cliente en un mismo día (hora de Bogotá). El tiempo de primera respuesta es el tiempo entre el primer mensaje del Cliente ese día y la primera respuesta del agente después de ese mensaje. Solo cuentan las conversaciones donde el agente respondió.
- El dinero está en pesos colombianos (COP) enteros.`

export const esquemaEntrada = z.object({
  decision: z.enum(['entrada', 'no_se_puede']).describe('entrada si el contrato alcanza; no_se_puede si falta un dato'),
  ventana_dias: z.number().int().describe('Cuántos días hacia atrás desde hoy, de 1 a 365'),
  tablas: z.array(z.object({ tabla: z.enum(TABLAS), campos: z.array(z.string()), techo: z.number().int().describe('Máximo de filas, hasta 20000') })),
  definicion: z.string().describe('Una frase que dice qué cuenta la pieza y con qué ventana'),
  motivo: z.enum(['ninguno', 'campo_inexistente', 'no_se_puede']),
  falta: z.string().describe('Si no_se_puede, qué dato falta. Vacío si hay entrada'),
})
export type SalidaEntrada = z.infer<typeof esquemaEntrada>

export function promptEntrada(texto: string, forma: Forma, fallo?: { entrada: unknown; error: string }) {
  const contrato = Object.entries(CONTRATO_V1).map(([t, c]) => `- ${t}: ${c.join(', ')}`).join('\n')
  const partes = [
    `Antes de escribir código, declaras qué datos necesita un Indicador o una Sección del Panel de un Negocio de venta contra entrega. El núcleo valida tu declaración, carga esas filas y recién ahí escribirás el código.`,
    `Contrato de datos v1 (lo único que puedes pedir):\n${contrato}`,
    DEFINICIONES_TEXTO,
    `Reglas de la declaración:
- ventana_dias es obligatoria: cuántos días hacia atrás desde hoy se leen (1 a 365). Aplica a pedidos, casos y mensajes. Clientes y productos se leen completos.
- Pide solo los campos que el código necesita.
- techo es el máximo de filas por tabla (hasta ${TECHO_DE_FILAS}). Si la ventana trae más filas que el techo, la declaración se rechaza, así que elige la ventana más corta que responda la pregunta bien (para todo el historial, 365).
- Si el pedido necesita un dato que el contrato no trae, no lo aproximes: decision = "no_se_puede", motivo = "campo_inexistente" y en "falta" di qué dato falta.
- Forma de la salida: ${FORMA_TEXTO[forma.tipo]}.`,
    `Lo que pidió el Dueño: ${texto}`,
  ]
  if (fallo) partes.push(`Tu declaración anterior falló. Corrígela.\nDeclaración anterior:\n${JSON.stringify(fallo.entrada)}\nError:\n${fallo.error}`)
  return partes.join('\n\n')
}

export async function declararEntrada(texto: string, forma: Forma, fallo?: { entrada: unknown; error: string }) {
  const r = await generateText({ model: modelo, reasoning: 'low', output: Output.object({ schema: esquemaEntrada }), prompt: promptEntrada(texto, forma, fallo) })
  return { salida: r.output, uso: r.totalUsage }
}

export function validarEntrada(e: SalidaEntrada): string | null {
  if (e.ventana_dias < 1 || e.ventana_dias > TECHO_DE_VENTANA) return `ventana_dias debe estar entre 1 y ${TECHO_DE_VENTANA}`
  if (!e.tablas.length) return 'no declaraste ninguna tabla'
  for (const t of e.tablas) {
    const malos = t.campos.filter((c) => !(CONTRATO_V1[t.tabla] as readonly string[]).includes(c))
    if (malos.length) return `campo_inexistente: ${t.tabla}.${malos.join(', ')} no está en el contrato. Campos de ${t.tabla}: ${CONTRATO_V1[t.tabla].join(', ')}`
    if (!t.campos.length) return `la tabla ${t.tabla} no tiene campos`
    if (t.techo < 1 || t.techo > TECHO_DE_FILAS) return `techo de ${t.tabla} debe estar entre 1 y ${TECHO_DE_FILAS}`
  }
  return null
}

const L = (c: string) => `(${c} AT TIME ZONE 'America/Bogota')::date`
const HOY = `(now() AT TIME ZONE 'America/Bogota')::date`
const SQL_TABLA: Record<Tabla, { desde: string; ventana: string | null; campos: Record<string, string> }> = {
  productos: { desde: 'productos', ventana: null, campos: { id: 'id', nombre: 'nombre', precio: 'precio', activo: 'activo' } },
  clientes: { desde: 'clientes', ventana: null, campos: { id: 'id', nombre: 'nombre', telefonoEnmascarado: `'***' || right(telefono, 4)`, creado: 'creado' } },
  pedidos: { desde: 'pedidos', ventana: 'creado', campos: { id: 'id', numero: 'numero', clienteId: 'cliente_id', items: 'items', total: 'total', ciudad: 'ciudad', estado: 'estado', creado: 'creado' } },
  casos: { desde: 'casos', ventana: 'creado', campos: { id: 'id', titulo: 'titulo', estado: 'estado', clienteId: 'cliente_id', pedidoId: 'pedido_id', creado: 'creado', resuelto: 'resuelto' } },
  mensajes: { desde: 'mensajes_cliente', ventana: 'creado', campos: { clienteId: 'cliente_id', rol: 'rol', creado: 'creado' } },
}

export type Entrada = { hoy: string; zonaHoraria: string; negocio: { nombre: string; rubro: string; ciudad: string }; tablas: Record<string, Record<string, unknown>[]>; resumen: { ventanaDias: number; filasLeidas: Record<string, number>; completa: boolean } }

/** Carga lo declarado, sin recortar en silencio: si la ventana trae más filas que el techo, devuelve el error. */
export async function cargarEntrada(url: string, negocioId: string, e: SalidaEntrada): Promise<{ ok: true; entrada: Entrada; ms: number } | { ok: false; error: string }> {
  const q = neon(url)
  const t0 = performance.now()
  const [n] = await q.query(`SELECT nombre, rubro, conocimiento->>'ciudad' AS ciudad FROM negocios WHERE id = $1`, [negocioId])
  const tablas: Entrada['tablas'] = {}
  const leidas: Record<string, number> = {}
  const consultas = e.tablas.map((t) => {
    const def = SQL_TABLA[t.tabla]
    const ventana = def.ventana ? ` AND ${L(def.ventana)} > ${HOY} - ${e.ventana_dias}` : ''
    return { t, ventana, def }
  })
  const conteos = await Promise.all(consultas.map(({ def, ventana }) => q.query(`SELECT count(*)::int AS n FROM ${def.desde} WHERE negocio_id = $1${ventana}`, [negocioId])))
  for (let i = 0; i < consultas.length; i++) {
    const { t } = consultas[i]
    if (conteos[i][0].n > t.techo) return { ok: false, error: `datos_insuficientes: ${t.tabla} tiene ${conteos[i][0].n} filas en ${e.ventana_dias} días y tu techo es ${t.techo}. Acorta la ventana, sube el techo (máximo ${TECHO_DE_FILAS}) o pide menos tablas.` }
  }
  const filas = await Promise.all(
    consultas.map(({ t, def, ventana }) => {
      const cols = t.campos.map((c) => `${def.campos[c]} AS "${c}"`).join(', ')
      return q.query(`SELECT ${cols} FROM ${def.desde} WHERE negocio_id = $1${ventana}`, [negocioId])
    }),
  )
  consultas.forEach(({ t }, i) => {
    tablas[t.tabla] = (filas[i] as Record<string, unknown>[]).map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])))
    leidas[t.tabla] = tablas[t.tabla].length
  })
  return { ok: true, ms: performance.now() - t0, entrada: { hoy: new Date().toISOString(), zonaHoraria: 'America/Bogota', negocio: { nombre: n.nombre, rubro: n.rubro, ciudad: n.ciudad ?? '' }, tablas, resumen: { ventanaDias: e.ventana_dias, filasLeidas: leidas, completa: true } } }
}

const esquemaIndicador = z.object({
  descripcion: z.string().describe('Una frase en español que dice qué mide el indicador'),
  codigo: z.string().describe('El código JavaScript con `function calcular(datos) { ... }`'),
})
const esquemaSeccion = z.object({
  descripcion: z.string().describe('Una frase en español que dice qué muestra la sección'),
  codigo: z.string().describe('El código JavaScript con `function consultar(datos) { ... }`'),
  vista: z.object({ tipo: z.enum(['tabla', 'tarjetas']), columnas: z.array(z.object({ clave: z.string(), titulo: z.string().describe('Título de la columna, en español') })).min(1) }),
})

const REGLAS_DEL_CODIGO = `Reglas del código:
- JavaScript ES2020 plano. Sin imports, sin require, sin async/await ni Promises, sin fetch ni red, sin archivos.
- La función recibe \`datos\`, que son solo los del Negocio, y no puede leer nada más. Usa únicamente \`datos\`.
- Puedes definir funciones auxiliares fuera de la función principal. No redeclares \`datos\` a nivel superior.
- Para "hoy" usa \`datos.hoy\`; no uses \`new Date()\` sin argumentos.
- Las fechas de \`datos\` son texto ISO en UTC. Para agrupar por día usa la hora de Bogotá (UTC-5, sin horario de verano):
  const dia = (iso) => new Date(Date.parse(iso) - 5 * 3600 * 1000).toISOString().slice(0, 10)
  Para recorrer días hacia atrás desde hoy: dia(new Date(Date.parse(datos.hoy) - n * 86400000).toISOString()).
- El dinero está en pesos colombianos enteros.
- Los estados de un pedido son exactamente: pendiente, confirmado, enviado, entregado, novedad, cancelado.
- Un pedido avanza así: pendiente, confirmado, enviado, entregado. "novedad" es un problema en el envío y "cancelado" lo corta. Si el Dueño habla de pedidos "confirmados" sin más, cuenta los que ya pasaron la confirmación (confirmado, enviado, entregado y novedad) y dilo en la nota.`

const FORMA_INDICADOR = `Escribe \`function calcular(datos) { ... }\` que devuelve un objeto con esta forma:
{ valor: number | string, unidad?: string, serie?: [{ etiqueta: string, valor: number }], nota?: string }
- \`valor\` es la cifra principal (o un texto corto). \`unidad\` es opcional ("pedidos", "COP").
- \`serie\` solo si el pedido pide una evolución (por día, por producto...). Va en orden cronológico y, si es "por día" en los últimos N días, incluye los días sin datos con valor 0. La etiqueta del día es "YYYY-MM-DD".
- \`nota\` es opcional: una frase sobre cómo se calculó.`

const FORMA_SECCION = `Escribe \`function consultar(datos) { ... }\` que devuelve un arreglo de objetos planos, una fila por objeto.
- Los valores de cada fila son string, number, boolean o null: nada de objetos ni arreglos anidados.
- Máximo 200 filas, las más recientes primero cuando haya fechas. Las fechas, como texto legible "YYYY-MM-DD HH:mm" en hora de Bogotá.
- Aparte entregas \`vista\`: { tipo: "tabla" | "tarjetas", columnas: [{ clave, titulo }] }. Cada \`clave\` debe existir en las filas; los títulos van en español.`

export const tipoDePieza = (f: Forma) => (f.tipo === 'filas' ? 'seccion' : 'indicador') as 'seccion' | 'indicador'

export function promptCodigo(texto: string, forma: Forma, e: SalidaEntrada, entrada: Entrada, intento?: { codigo: string; error: string }) {
  const tipo = tipoDePieza(forma)
  const funcion = tipo === 'indicador' ? 'calcular' : 'consultar'
  const muestra = { negocio: entrada.negocio, resumen: entrada.resumen, tablas: Object.fromEntries(Object.entries(entrada.tablas).map(([t, f]) => [t, f.slice(0, 4)])) }
  const partes = [
    `Escribes el código de ${tipo === 'indicador' ? 'un Indicador' : 'una Sección'} para el Panel de un Negocio. El código corre aislado y solo ve los datos de este Negocio.`,
    REGLAS_DEL_CODIGO,
    DEFINICIONES_TEXTO,
    tipo === 'indicador' ? FORMA_INDICADOR : FORMA_SECCION,
    `Forma de la salida que pidió el Dueño: ${FORMA_TEXTO[forma.tipo]}.${forma.tipo === 'serie' ? ' Entrega la serie en `serie` con { etiqueta, valor }.' : forma.tipo === 'numero' ? ' Entrega la cifra en `valor` y no uses `serie`.' : ''}`,
    `La forma de \`datos\`:\n${FORMA_DE_LOS_DATOS}`,
    `Unas filas reales para que veas los valores:\n${JSON.stringify(muestra, null, 1)}`,
    `Lo que declaraste: ${e.definicion}\nLo que pidió el Dueño: ${texto}`,
  ]
  if (intento) partes.push(`Tu intento anterior falló. Corrígelo y entrega el código completo, con \`function ${funcion}(datos)\`.\nCódigo anterior:\n${intento.codigo}\nError al correrlo:\n${intento.error}`)
  return partes.join('\n\n')
}

const limpiar = (c: string) => c.trim().replace(/^```(?:javascript|js)?\s*\n/i, '').replace(/\n```\s*$/, '').trim()

export async function generarCodigo(texto: string, forma: Forma, e: SalidaEntrada, entrada: Entrada, intento?: { codigo: string; error: string }) {
  const tipo = tipoDePieza(forma)
  const r = await generateText({ model: modelo, reasoning: 'low', output: Output.object({ schema: tipo === 'indicador' ? esquemaIndicador : esquemaSeccion }), prompt: promptCodigo(texto, forma, e, entrada, intento) })
  return { codigo: limpiar(r.output.codigo), descripcion: r.output.descripcion, uso: r.totalUsage }
}

/** Convierte lo que devuelve la pieza en filas comparables, o explica por qué la forma no sirve. */
export function aFilas(valor: unknown, forma: Forma): { ok: true; filas: Record<string, unknown>[] } | { ok: false; error: string } {
  const plano = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
  if (forma.tipo === 'filas') {
    if (!Array.isArray(valor)) return { ok: false, error: 'consultar debe devolver un arreglo de objetos' }
    if (valor.length > 200) return { ok: false, error: 'más de 200 filas' }
    for (const f of valor) if (!f || typeof f !== 'object' || Array.isArray(f) || !Object.values(f).every(plano)) return { ok: false, error: 'cada fila debe ser un objeto plano' }
    return { ok: true, filas: valor as Record<string, unknown>[] }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return { ok: false, error: 'calcular debe devolver un objeto { valor, serie? }' }
  const v = valor as { valor?: unknown; serie?: { etiqueta?: unknown; valor?: unknown }[] }
  if (forma.tipo === 'numero') {
    if (typeof v.valor !== 'number' && typeof v.valor !== 'string') return { ok: false, error: '`valor` debe ser número o texto' }
    return { ok: true, filas: [{ valor: v.valor }] }
  }
  if (!Array.isArray(v.serie) || !v.serie.every((p) => p && 'etiqueta' in p && typeof p.valor === 'number')) return { ok: false, error: 'la forma serie pide `serie: [{ etiqueta, valor }]` con valor numérico' }
  return { ok: true, filas: v.serie.map((p) => ({ etiqueta: p.etiqueta, valor: p.valor })) }
}
