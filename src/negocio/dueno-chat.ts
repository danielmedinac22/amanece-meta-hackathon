import { convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, generateId, isStepCount, streamText, toUIMessageStream, type LanguageModel, type ToolSet, type UIMessage } from 'ai'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { crearAgenteDelDueno, parteDeDatosParaElModelo, type PuertosDelDueno } from '@/agentes/dueno'
import { modelo } from '@/lib/modelo'
import { guardarEnElHilo, leerHilo, mensajeDelDuenoEnTexto } from '@/negocio/dueno-hilo'
import { adjuntosDelMensaje, PARTE_DE_ARCHIVO, type Adjunto } from '@/nucleo/archivos'
import { comoPropuesta, SIN_SABER, type EnvioDeRespuesta } from '@/nucleo/caso-palabras'
import { historial, type EstadoDePropuesta, type TarjetaDeAprobacion } from '@/nucleo/cambios'
import { enviosDeCasos } from '@/nucleo/casos'
import { propuestasSelladas } from '@/nucleo/estado'
import type { Elemento } from '@/nucleo/estado/elementos'
import type { ContextoDelDueno } from '@/nucleo/identidad'
import { registrarTurno } from '@/negocio/medir'
import { tarjetaDeLaParte } from '@/negocio/partes-del-hilo'

/** Cuántos mensajes del Hilo ve el modelo en cada turno. */
const MENSAJES_QUE_VE_EL_MODELO = 40

const textoDe = (crudo: unknown) => {
  const m = crudo as { parts?: { type?: string; text?: unknown }[]; content?: unknown } | null
  return typeof m?.content === 'string'
    ? m.content
    : (m?.parts ?? [])
        .filter((p) => p?.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n')
}

/** Los ids de archivo que dice traer el mensaje del navegador. Es lo único que se le cree de esas partes. */
export function idsDeArchivos(crudo: unknown): readonly unknown[] {
  const m = crudo as { parts?: { type?: string; data?: { id?: unknown } }[] } | null
  return (m?.parts ?? []).filter((p) => p?.type === PARTE_DE_ARCHIVO).map((p) => p.data?.id)
}

/** Del mensaje que manda el navegador solo se toma el texto: las demás partes no se le creen. Los `adjuntos` los armó el servidor desde sus filas, y con ellos el texto puede faltar. */
export function mensajeDelDueno(crudo: unknown, adjuntos: readonly Adjunto[] = []): UIMessage | null {
  const mensaje = mensajeDelDuenoEnTexto(textoDe(crudo))
  const partes = adjuntos.map((data) => ({ type: PARTE_DE_ARCHIVO, data }) as const)
  if (mensaje) return { ...mensaje, parts: [...mensaje.parts, ...partes] }
  return partes.length ? { id: generateId(), role: 'user', parts: partes } : null
}

/**
 * Un paso que no le pregunta nada al modelo: llama una herramienta y ya. Muse Spark solo acepta `tool_choice: auto` (medido: 400
 * con cualquier otro), y que un archivo adjunto se lea no se le deja a su criterio, porque sin leerlo diría cosas que no vio.
 */
function pasoQueLlama(toolName: string, input: object): Exclude<LanguageModel, string> {
  const sinTokens = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } }
  return {
    specificationVersion: 'v4',
    provider: 'amanece',
    modelId: 'paso-fijo',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('pasoQueLlama solo corre en streamText')),
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] })
          c.enqueue({ type: 'tool-call', toolCallId: generateId(), toolName, input: JSON.stringify(input) })
          c.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: sinTokens })
          c.close()
        },
      }),
    }),
  }
}

/** El Hilo como lo ve el modelo: cada salida de herramienta pasa por el `toModelOutput` de su definición, también la de otro modo. */
export function mensajesParaElModelo(hilo: UIMessage[], agente: { readonly todas: ToolSet }) {
  return convertToModelMessages(hilo, { tools: agente.todas, convertDataPart: parteDeDatosParaElModelo, ignoreIncompleteToolCalls: true })
}

/**
 * Un turno del Hilo: guarda el mensaje del Dueño, corre al Agente del dueño con hasta 8 pasos y guarda
 * su respuesta al terminar. El turno queda medido con `registrarTurno`.
 */
export async function responderEnElHilo({
  ctx,
  negocio,
  dueno,
  mensaje,
  puertos,
}: {
  ctx: ContextoDelDueno
  negocio: typeof esquema.negocios.$inferSelect
  dueno: typeof esquema.duenos.$inferSelect
  mensaje: UIMessage
  /** Solo los `probar` los cambian: la página de guion con el modelo real. */
  puertos?: PuertosDelDueno
}) {
  const agente = crearAgenteDelDueno(ctx, { negocio, dueno }, puertos)
  await guardarEnElHilo(negocio.id, dueno.id, 'dueno', mensaje)
  const historial = await leerHilo(dueno.id, MENSAJES_QUE_VE_EL_MODELO)

  const adjuntos = adjuntosDelMensaje(mensaje)
  const pregunta = mensaje.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ').trim().slice(0, 300)

  const inicio = Date.now()
  const resultado = streamText({
    model: modelo,
    instructions: agente.system,
    messages: await mensajesParaElModelo(historial, agente),
    tools: agente.tools,
    stopWhen: isStepCount(8),
    prepareStep: ({ stepNumber, steps }) => {
      if (stepNumber === 0 && adjuntos.length) return { model: pasoQueLlama('leer_archivo', { archivos: adjuntos.map((a) => a.id), ...(pregunta ? { pregunta } : {}) }) }
      return steps.some((s) => s.toolCalls.some((c) => c.toolName === 'leer_archivo')) ? { activeTools: agente.soloLeen } : {}
    },
    onEnd: async ({ totalUsage }) => {
      await registrarTurno('dueno', negocio.id, totalUsage, Date.now() - inicio).catch((e) => console.warn('No se pudo registrar el turno del Agente del dueño', e))
    },
  })
  // Que el turno termine y se guarde aunque el navegador se desconecte.
  resultado.consumeStream()

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: resultado.stream,
      originalMessages: historial,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
      onError: (e) => {
        console.error('[dueno] error en el turno', e)
        return 'Tuve un problema para responderte. ¿Me lo repites en un momento?'
      },
      onEnd: async ({ responseMessage }) => {
        if (responseMessage.parts.length) await guardarEnElHilo(negocio.id, dueno.id, 'agente', responseMessage)
      },
    }),
  })
}

/** Lo que pinta una tarjeta guardada en el Hilo. Lo arma el servidor; la tarjeta no consulta nada por su cuenta. */
export type EstadoDeTarjeta = {
  readonly estado: EstadoDePropuesta
  readonly accion: TarjetaDeAprobacion['accion']
  /** El nombre del Dueño que tocó el botón; null si la aplicó la política o no se aplicó. */
  readonly aprobadaPor: string | null
  readonly asunto: AsuntoDeTarjeta | null
  /** Que lo aplicado ya les llegó a los Clientes. Mientras se arma no hay Clientes: ahí nunca. */
  readonly publicada: boolean
}

/** De qué trata la tarjeta, con la estructura que las `lineas` de texto no traen. */
export type AsuntoDeTarjeta =
  | {
      readonly tipo: 'caso'
      readonly titulo: string
      readonly pedido: number | null
      readonly cliente: string | null
      /** Lo último que escribió el Cliente antes de abrirse el Caso. */
      readonly escribio: string | null
      readonly respuesta: string
      readonly reglas: readonly string[]
      /** Lo que se le pidió con el borrador del agente. Si el Dueño dictó otra respuesta, puede que ya no aplique: no sale. */
      readonly porTuLado: string | null
      readonly envio: EnvioDeRespuesta | null
    }
  /** `que` es null si cambia algo que ya existía o mezcla varios tipos. `clave` es null si toca más de una cosa. */
  | { readonly tipo: 'elemento'; readonly que: Elemento['tipo'] | null; readonly clave: string | null }

/**
 * El Hilo y el estado vivo de cada tarjeta que trae. Las filas del Hilo no se editan: lo guardado es la tarjeta
 * estática y su estado se lee aquí, al pintar el Panel y en cada consulta del Hilo.
 */
export async function leerHiloConTarjetas(ctx: ContextoDelDueno): Promise<{ mensajes: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }> {
  const mensajes = await leerHilo(ctx.dueno)
  return { mensajes, tarjetas: await estadosDeTarjetas(ctx, tarjetasDe(mensajes).map((t) => t.propuesta)) }
}

/** La única lectura del estado de una tarjeta: la del Hilo y la de Casos dicen lo mismo porque salen de aquí. */
export async function estadosDeTarjetas(ctx: ContextoDelDueno, propuestas: readonly string[]): Promise<Record<string, EstadoDeTarjeta>> {
  const entradas = await historial(ctx, { propuestas })
  const ids = [...new Set(entradas.map((e) => e.aprobadoPor).filter((id) => id !== null))]
  const duenos = ids.length ? await db.select({ id: esquema.duenos.id, nombre: esquema.duenos.nombre }).from(esquema.duenos).where(and(eq(esquema.duenos.negocioId, ctx.negocio), inArray(esquema.duenos.id, ids))) : []
  const [asuntos, selladas] = await Promise.all([asuntosDe(ctx, entradas.map((e) => e.propuesta)), propuestasSelladas(ctx.negocio, entradas.filter((e) => e.estado === 'aplicada').map((e) => e.propuesta))])
  return Object.fromEntries(
    entradas.map((e) => [e.propuesta, { estado: e.estado, accion: e.accion, aprobadaPor: e.aprobadoPor ? duenos.find((d) => d.id === e.aprobadoPor)?.nombre || 'un Dueño' : null, asunto: asuntos.get(e.propuesta) ?? null, publicada: e.estado === 'aplicada' && selladas.has(e.propuesta) } satisfies EstadoDeTarjeta]),
  )
}

/** Una lectura por sondeo y no una por tarjeta, porque el Hilo la repite cada pocos segundos. Las propuestas ya vienen del Negocio de `ctx`. */
async function asuntosDe(ctx: ContextoDelDueno, propuestas: readonly string[]): Promise<ReadonlyMap<string, AsuntoDeTarjeta>> {
  if (!propuestas.length) return new Map()
  const { propuestas: p, casos: c, clientes, pedidos, mensajesCliente: m } = esquema
  const filas = await db.select({ id: p.id, estado: p.estado, actos: p.actos, escritura: p.escritura, revierte: p.revierte }).from(p).where(and(eq(p.negocioId, ctx.negocio), inArray(p.id, [...propuestas])))
  const idsDeCasos = filas.flatMap((f) => f.actos.map((a) => a.caso))
  const aplicados = filas.filter((f) => f.estado === 'aplicada').flatMap((f) => f.actos.map((a) => a.caso))
  const leerCasos = () =>
    db
      .selectDistinctOn([c.id], { id: c.id, titulo: c.titulo, pedido: pedidos.numero, cliente: clientes.nombre, escribio: m.texto, reglas: c.reglas, propuesta: c.propuesta, porTuLado: c.porTuLado })
      .from(c)
      .leftJoin(clientes, and(eq(clientes.id, c.clienteId), eq(clientes.negocioId, c.negocioId)))
      .leftJoin(pedidos, and(eq(pedidos.id, c.pedidoId), eq(pedidos.negocioId, c.negocioId)))
      .leftJoin(m, and(eq(m.clienteId, c.clienteId), eq(m.negocioId, c.negocioId), eq(m.rol, 'cliente'), lte(m.creado, c.creado)))
      .where(and(eq(c.negocioId, ctx.negocio), inArray(c.id, idsDeCasos)))
      .orderBy(c.id, desc(m.creado))
  const [casos, envios] = await Promise.all([idsDeCasos.length ? leerCasos() : [], enviosDeCasos(ctx.negocio, aplicados)])
  return new Map(
    filas.map((f): [string, AsuntoDeTarjeta] => {
      const [acto] = f.actos
      if (!acto) {
        const tipos = new Set(f.escritura.elementos.map((e) => (e.base === 'nueva' ? e.despues?.tipo : undefined)))
        const [unico, ...mas] = f.escritura.elementos
        return [f.id, { tipo: 'elemento', que: !f.revierte && tipos.size === 1 ? ([...tipos][0] ?? null) : null, clave: unico && !mas.length ? unico.clave : null }]
      }
      const caso = casos.find((x) => x.id === acto.caso)
      return [f.id, { tipo: 'caso', titulo: caso?.titulo ?? 'Un Caso', pedido: caso?.pedido ?? null, cliente: caso?.cliente || null, escribio: caso?.escribio || null, respuesta: acto.texto, reglas: caso?.reglas ?? [], porTuLado: caso?.propuesta === comoPropuesta(acto.texto) ? caso.porTuLado || null : null, envio: f.estado === 'aplicada' ? (envios.get(acto.caso) ?? SIN_SABER) : null }]
    }),
  )
}

export function tarjetasDe(mensajes: readonly UIMessage[]): TarjetaDeAprobacion[] {
  return mensajes.flatMap((m) => m.parts.flatMap((p) => tarjetaDeLaParte(p) ?? []))
}
