/**
 * El único generador de Secciones e Indicadores: escribe la consulta en SQL acotado. Ve el catálogo y lo que pidió el
 * Dueño, nunca filas. Cada intento se valida y se corre sobre los datos reales en solo lectura; el siguiente recibe
 * el SQL anterior y `explicar(error)`.
 */
import { generateText, NoObjectGeneratedError, Output, type LanguageModelUsage } from 'ai'
import { z } from 'zod'
import { costoUsd } from '@/lib/modelo'
import { modeloEstructurado } from '@/negocio/dueno-modelo'
import { registrarTurno } from '@/negocio/medir'
import type { MotivoDeFaltante } from '../capacidades'
import { NOMBRES_DE_FUENTE, textoParaElRedactor, VENTANA_POR_DEFECTO, VERSION_DEL_CATALOGO } from '../consultas/catalogo'
import { ejecutar, formaDelResultado, hayConexionDeConsultas } from '../consultas/ejecutar'
import type { ConsultaGuardada, ConsultaValidada, ErrorDeConsulta, FormaDeSalida, Supuesto, TipoDeSalida, Unidad } from '../consultas/tipos'
import { esErrorDeConsulta, explicar, validarConsulta } from '../consultas/validar'
import type { EstadoDelNegocio } from '../estado'
import type { Gasto } from './index'

export const INTENTOS_DE_REDACTAR = 3

/** Plano y estricto: todos los campos van siempre (4 niveles de JSON Schema). */
export const SALIDA_DEL_REDACTOR = z.object({
  decision: z.enum(['consulta', 'no_se_puede']).describe('consulta si el catálogo alcanza; no_se_puede si falta un dato'),
  sql: z.string().describe('Un solo SELECT de Postgres sobre las fuentes, sin punto y coma. Vacío si no_se_puede'),
  enPalabras: z.string().describe('Qué cuenta, en una frase para el Dueño, con la ventana de tiempo'),
  ventana: z.enum(['no_aplica', 'la_que_pidio', 'por_defecto']).describe('por_defecto si usaste la ventana por defecto porque el Dueño no dijo desde cuándo'),
  supuestos: z.array(z.string()).describe('Lo que elegiste porque el pedido no lo decía, aparte de la ventana. Vacío si nada'),
  unidad: z.enum(['cantidad', 'dinero', 'porcentaje']),
  nombreDeLaUnidad: z.string().describe('"pedidos", "clientes"… Vacío si es dinero o porcentaje'),
  titulos: z.array(z.object({ columna: z.string(), titulo: z.string() })).describe('Solo en una lista: el título en español de cada columna'),
  faltaEn: z.enum([...NOMBRES_DE_FUENTE, 'ninguna']).describe('Si no_se_puede, la fuente a la que le falta el dato'),
  falta: z.string().describe('Si no_se_puede, qué dato falta. Vacío si hay consulta'),
})
export type SalidaDelRedactor = z.output<typeof SALIDA_DEL_REDACTOR>

export type PedidoDeConsulta<S extends TipoDeSalida> = {
  readonly nombre: string
  readonly queQuiereVer: string
  readonly salida: S
  /** La que hoy tiene la Sección o el Indicador que se cambia. */
  readonly anterior: ConsultaGuardada | null
}

export type ConsultaRedactada<S extends TipoDeSalida> =
  | { readonly tipo: 'lista'; readonly consulta: ConsultaGuardada<S>; readonly validada: ConsultaValidada; readonly gasto: Gasto }
  | { readonly tipo: 'faltante'; readonly motivo: Extract<MotivoDeFaltante, { tipo: 'no_se_puede' | 'sin_converger' }>; readonly gasto: Gasto }
  /** La conexión falta o la base no atendió: no es culpa del pedido, no se reintenta y no deja una Capacidad faltante. */
  | { readonly tipo: 'sin_configurar'; readonly gasto: Gasto }

/** Un intento del modelo. `cortada`: la respuesta no llegó entera (`finish_reason: length`) o no tenía la forma. */
export type MotorDelRedactor = (prompt: string) => Promise<{ readonly salida: SalidaDelRedactor | 'cortada'; readonly uso: Pick<LanguageModelUsage, 'inputTokens' | 'outputTokens'> }>

export const MOTOR_DEL_REDACTOR: MotorDelRedactor = async (prompt) => {
  try {
    const r = await generateText({ model: modeloEstructurado, reasoning: 'low', output: Output.object({ schema: SALIDA_DEL_REDACTOR }), prompt })
    return { salida: r.finishReason === 'length' ? 'cortada' : r.output, uso: r.totalUsage }
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) return { salida: 'cortada', uso: e.usage ?? { inputTokens: 0, outputTokens: 0 } }
    throw e
  }
}

const FORMA_EN_PALABRAS = {
  numero: 'una sola fila con una sola columna llamada valor (un número)',
  serie: 'dos columnas: etiqueta (texto: el día, la semana o el producto) y valor (un número), una fila por punto',
  filas: 'las columnas que el Dueño quiere ver; en titulos, el título en español de cada una',
} as const satisfies Record<TipoDeSalida, string>

const REGLAS = `Reglas de la consulta:
- Un solo SELECT de Postgres (puede empezar con WITH, sin RECURSIVE). Sin punto y coma.
- Toda columna calculada lleva AS. Los nombres de columna van en minúscula, con letras sin tilde, números y _. No llames q a ninguna.
- Lee solo las fuentes de arriba, por su nombre y sin esquema, y solo sus campos. Ya vienen filtradas al Negocio: no filtres por Negocio.
- Las fechas ya están en la zona del Negocio: usa dia_local, mes_local, hora_local y hoy.hoy_local. No uses zonas horarias, AT TIME ZONE, now() ni current_date.
- Para "las últimas N horas" usa creado > hoy.ahora - interval 'N hours'. No le sumes ni restes horas a otra columna.
- Para "ventas", "confirmados" o "pedidos que cuentan" usa cuenta_como_venta y las medidas del catálogo tal cual.
- Si el pedido necesita algo que una fuente dice que NO trae, o que no está en el catálogo, no lo aproximes: responde decision = no_se_puede, faltaEn y falta.`

function prompt<S extends TipoDeSalida>(pedido: PedidoDeConsulta<S>, intento: { readonly sql: string; readonly error: ErrorDeConsulta | 'cortada' } | null): string {
  return [
    `Escribes la consulta SQL de ${pedido.salida === 'filas' ? 'una Sección (una lista)' : 'un Indicador'} para el Panel de un Negocio. Solo ves el catálogo; no ves filas.`,
    textoParaElRedactor(),
    REGLAS,
    `Forma de la salida: ${FORMA_EN_PALABRAS[pedido.salida]}.`,
    `Nombre en el Panel: ${pedido.nombre}\nLo que pidió el Dueño: ${pedido.queQuiereVer}`,
    ...(pedido.anterior ? [`Hoy la consulta es esta y el Dueño quiere cambiarla:\n${pedido.anterior.sql}`] : []),
    ...(intento ? [`Tu intento anterior no sirvió. Corrígelo y entrega la consulta completa.\nConsulta anterior:\n${intento.sql}\nPor qué: ${intento.error === 'cortada' ? 'tu respuesta se cortó; responde más corto' : explicar(intento.error)}`] : []),
  ].join('\n\n')
}

const unidadDe = (s: SalidaDelRedactor): Unidad => (s.unidad === 'cantidad' ? { tipo: 'cantidad', nombre: s.nombreDeLaUnidad.trim() } : { tipo: s.unidad })

function salidaDe<S extends TipoDeSalida>(salida: S, s: SalidaDelRedactor, v: ConsultaValidada): Extract<FormaDeSalida, { tipo: S }> {
  const forma: FormaDeSalida =
    salida === 'filas' ? { tipo: 'filas', columnas: v.columnas.map((columna) => ({ columna, titulo: s.titulos.find((t) => t.columna === columna)?.titulo.trim() || columna })) } : { tipo: salida as 'numero' | 'serie', unidad: unidadDe(s) }
  return forma as Extract<FormaDeSalida, { tipo: S }>
}

/**
 * Hasta tres intentos. Uno cortado cuenta como fallido. Con `ventana: por_defecto`, el código pone primero
 * `VENTANA_POR_DEFECTO.supuesto`. Cada llamada queda como turno del `generador` para la medición.
 */
export async function redactarConsulta<S extends TipoDeSalida>(estado: EstadoDelNegocio, pedido: PedidoDeConsulta<S>, motor: MotorDelRedactor = MOTOR_DEL_REDACTOR): Promise<ConsultaRedactada<S>> {
  let gasto: Gasto = { llamadas: 0, usd: 0, ms: 0 }
  if (!hayConexionDeConsultas()) return { tipo: 'sin_configurar', gasto }
  let intento: { readonly sql: string; readonly error: ErrorDeConsulta | 'cortada' } | null = null
  let ultimoSql = ''
  let ultimoError: ErrorDeConsulta = { tipo: 'sintaxis', mensaje: 'El redactor no respondió' }
  for (let i = 0; i < INTENTOS_DE_REDACTAR; i++) {
    const inicio = Date.now()
    const { salida: s, uso } = await motor(prompt(pedido, intento))
    const ms = Date.now() - inicio
    gasto = { llamadas: gasto.llamadas + 1, usd: gasto.usd + costoUsd(uso.inputTokens ?? 0, uso.outputTokens ?? 0), ms: gasto.ms + ms }
    await registrarTurno('generador', estado.identidad.id, uso, ms).catch((e) => console.warn('[redactar] no se pudo registrar el turno', e))
    if (s === 'cortada') {
      ultimoError = { tipo: 'sintaxis', mensaje: 'La respuesta se cortó o no tenía la forma pedida' }
      intento = { sql: ultimoSql, error: 'cortada' }
      continue
    }
    if (s.decision === 'no_se_puede') return { tipo: 'faltante', motivo: { tipo: 'no_se_puede', fuente: s.faltaEn, falta: s.falta.trim() || pedido.queQuiereVer }, gasto }
    const validada = await validarConsulta(s.sql, pedido.salida)
    const corrida = esErrorDeConsulta(validada) ? null : await ejecutar(estado, validada)
    if (corrida?.tipo === 'sin_configurar' || corrida?.tipo === 'no_disponible') return { tipo: 'sin_configurar', gasto }
    const error = esErrorDeConsulta(validada) ? validada : corrida?.tipo === 'error' ? corrida.error : corrida?.tipo === 'filas' ? formaDelResultado(pedido.salida, corrida) : null
    ultimoSql = s.sql
    if (error || esErrorDeConsulta(validada)) {
      ultimoError = error ?? ultimoError
      intento = { sql: s.sql, error: ultimoError }
      continue
    }
    const supuestos = [...(s.ventana === 'por_defecto' ? [VENTANA_POR_DEFECTO.supuesto] : []), ...s.supuestos.map((x) => x.trim()).filter(Boolean)] as Supuesto[]
    const consulta = { sql: validada.sql, enPalabras: s.enPalabras.trim(), supuestos, catalogo: VERSION_DEL_CATALOGO, usa: validada.usa, salida: salidaDe(pedido.salida, s, validada) } as unknown as ConsultaGuardada<S>
    return { tipo: 'lista', consulta, validada, gasto }
  }
  return { tipo: 'faltante', motivo: { tipo: 'sin_converger', ultimoError }, gasto }
}
