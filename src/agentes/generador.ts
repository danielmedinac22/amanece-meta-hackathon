import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { Vista } from '@/db/esquema'
import { datosDelNegocio, FORMA_DE_LOS_DATOS, type DatosDelNegocio } from '@/negocio/datos'
import { medidaDeUso, modeloEstructurado, type Medida } from '@/negocio/dueno-modelo'
import { registrarTurno } from '@/negocio/medir'

/**
 * Escribe el código de una Sección o de un Indicador. No lo ejecuta: eso lo hace `correrAislado` en
 * `cambios.ts`, que también le devuelve el error a este generador si el código falla.
 */
export type PiezaGenerada = { descripcion: string; codigo: string; vista: Vista | null }

export type PedidoDePieza = {
  negocioId: string
  tipo: 'seccion' | 'indicador'
  nombre: string
  /** Lo que pidió el Dueño, en sus palabras. */
  pedido: string
  /** Los datos del Negocio, si quien llama ya los cargó. */
  datos?: DatosDelNegocio
  /** El código de la versión activa, cuando el Cambio modifica una pieza que ya existe. */
  codigoActual?: string
  /** El intento anterior y por qué falló, para que el generador lo corrija. */
  intentoFallido?: { codigo: string; error: string }
}

const esquemaIndicador = z.object({
  descripcion: z.string().describe('Una frase en español que dice qué mide el indicador'),
  codigo: z.string().describe('El código JavaScript con `function calcular(datos) { ... }`'),
})

const esquemaSeccion = z.object({
  descripcion: z.string().describe('Una frase en español que dice qué muestra la sección'),
  codigo: z.string().describe('El código JavaScript con `function consultar(datos) { ... }`'),
  vista: z.object({
    tipo: z.enum(['tabla', 'tarjetas']),
    columnas: z.array(z.object({ clave: z.string(), titulo: z.string().describe('Título de la columna, en español') })).min(1),
  }),
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

/** Unas pocas filas reales, con los teléfonos ya enmascarados por `datosDelNegocio`. */
function muestra(datos: DatosDelNegocio) {
  return {
    negocio: datos.negocio,
    totales: { productos: datos.productos.length, clientes: datos.clientes.length, pedidos: datos.pedidos.length, casos: datos.casos.length, mensajes: datos.mensajes.length },
    productos: datos.productos.slice(0, 4),
    clientes: datos.clientes.slice(0, 3),
    pedidos: datos.pedidos.slice(0, 4),
    casos: datos.casos.slice(0, 3),
    mensajes: datos.mensajes.slice(0, 3),
  }
}

/** A veces el modelo envuelve el código en una cerca de Markdown. */
function limpiarCodigo(codigo: string) {
  return codigo
    .trim()
    .replace(/^```(?:javascript|js)?\s*\n/i, '')
    .replace(/\n```\s*$/, '')
    .trim()
}

export async function generarPieza(entrada: PedidoDePieza): Promise<{ pieza: PiezaGenerada; medida: Medida }> {
  const datos = entrada.datos ?? (await datosDelNegocio(entrada.negocioId))
  const funcion = entrada.tipo === 'indicador' ? 'calcular' : 'consultar'

  const partes = [
    `Escribes el código de ${entrada.tipo === 'indicador' ? 'un Indicador' : 'una Sección'} para el Panel de un Negocio. El código corre aislado y solo ve los datos de este Negocio.`,
    REGLAS_DEL_CODIGO,
    entrada.tipo === 'indicador' ? FORMA_INDICADOR : FORMA_SECCION,
    `La forma de \`datos\`:\n${FORMA_DE_LOS_DATOS}`,
    `Unas filas reales para que veas los valores (los teléfonos van enmascarados):\n${JSON.stringify(muestra(datos), null, 1)}`,
    `Nombre de la pieza: ${entrada.nombre}\nLo que pidió el Dueño: ${entrada.pedido}`,
  ]
  if (entrada.codigoActual) partes.push(`Esta pieza ya existe; el Dueño quiere cambiarla. Parte de este código y modifícalo:\n${entrada.codigoActual}`)
  if (entrada.intentoFallido) {
    partes.push(
      `Tu intento anterior falló. Corrígelo y entrega el código completo, con \`function ${funcion}(datos)\`.\nCódigo anterior:\n${entrada.intentoFallido.codigo}\nError al correrlo:\n${entrada.intentoFallido.error}`,
    )
  }

  const inicio = Date.now()
  const resultado = await generateText({
    model: modeloEstructurado,
    // Muse Spark razona de más para escribir una función corta: con `low` tarda la mitad y el código sale igual de bien.
    reasoning: 'low',
    output: Output.object({ schema: entrada.tipo === 'indicador' ? esquemaIndicador : esquemaSeccion }),
    prompt: partes.join('\n\n'),
  })
  const ms = Date.now() - inicio

  try {
    await registrarTurno('generador', entrada.negocioId, resultado.totalUsage, ms)
  } catch (e) {
    console.warn('No se pudo registrar el turno del generador', e)
  }

  const salida = resultado.output
  const vista = 'vista' in salida ? (salida.vista as Vista) : null
  return {
    pieza: { descripcion: salida.descripcion.trim(), codigo: limpiarCodigo(salida.codigo), vista },
    medida: medidaDeUso(resultado.totalUsage, ms),
  }
}
