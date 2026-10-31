import { convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from 'ai'
import { and, eq, inArray } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { crearAgenteDelDueno, parteDeDatosParaElModelo, type SalidaDeProponer } from '@/agentes/dueno'
import { modelo } from '@/lib/modelo'
import { guardarEnElHilo, leerHilo, mensajeDelDuenoEnTexto } from '@/negocio/dueno-hilo'
import { historial, type EstadoDePropuesta, type TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { ContextoDelDueno } from '@/nucleo/identidad'
import { registrarTurno } from '@/negocio/medir'

/** Cuántos mensajes del Hilo ve el modelo en cada turno. */
const MENSAJES_QUE_VE_EL_MODELO = 40

/** Del mensaje que manda el navegador solo se toma el texto: las demás partes no se le creen. */
export function mensajeDelDueno(crudo: unknown): UIMessage | null {
  const m = crudo as { parts?: { type?: string; text?: unknown }[]; content?: unknown } | null
  const texto =
    typeof m?.content === 'string'
      ? m.content
      : (m?.parts ?? [])
          .filter((p) => p?.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text as string)
          .join('\n')
  return mensajeDelDuenoEnTexto(texto)
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
}: {
  ctx: ContextoDelDueno
  negocio: typeof esquema.negocios.$inferSelect
  dueno: typeof esquema.duenos.$inferSelect
  mensaje: UIMessage
}) {
  const { system, tools } = crearAgenteDelDueno(ctx, { negocio, dueno })
  await guardarEnElHilo(negocio.id, dueno.id, 'dueno', mensaje)
  const historial = await leerHilo(dueno.id, MENSAJES_QUE_VE_EL_MODELO)

  const inicio = Date.now()
  const resultado = streamText({
    model: modelo,
    instructions: system,
    messages: await convertToModelMessages(historial, { tools, convertDataPart: parteDeDatosParaElModelo, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: isStepCount(8),
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
  readonly accion: 'aplicar' | 'enviar'
  /** El nombre del Dueño que tocó el botón; null si la aplicó la política o no se aplicó. */
  readonly aprobadaPor: string | null
}

/**
 * El Hilo y el estado vivo de cada tarjeta que trae. Las filas del Hilo no se editan: lo guardado es la tarjeta
 * estática y su estado se lee aquí, al pintar el Panel y en cada consulta del Hilo.
 */
export async function leerHiloConTarjetas(ctx: ContextoDelDueno): Promise<{ mensajes: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }> {
  const mensajes = await leerHilo(ctx.dueno)
  const entradas = await historial(ctx, { propuestas: tarjetasDe(mensajes).map((t) => t.propuesta) })
  const ids = [...new Set(entradas.map((e) => e.aprobadoPor).filter((id) => id !== null))]
  const duenos = ids.length ? await db.select({ id: esquema.duenos.id, nombre: esquema.duenos.nombre }).from(esquema.duenos).where(and(eq(esquema.duenos.negocioId, ctx.negocio), inArray(esquema.duenos.id, ids))) : []
  const tarjetas = Object.fromEntries(
    entradas.map((e) => [e.propuesta, { estado: e.estado, accion: e.accion, aprobadaPor: e.aprobadoPor ? duenos.find((d) => d.id === e.aprobadoPor)?.nombre || 'un Dueño' : null } satisfies EstadoDeTarjeta]),
  )
  return { mensajes, tarjetas }
}

/** Las dos partes que traen una tarjeta, las mismas que pinta `hilo.tsx`: la salida de `tool-proponer` y `data-tarjeta` (el aviso de un Caso). */
export function tarjetasDe(mensajes: readonly UIMessage[]): TarjetaDeAprobacion[] {
  return mensajes.flatMap((m) =>
    m.parts.flatMap((p) => {
      if (p.type === 'data-tarjeta') return [p.data as TarjetaDeAprobacion]
      const t = p.type === 'tool-proponer' && p.state === 'output-available' ? (p.output as SalidaDeProponer).tarjeta : null
      return t ? [t] : []
    }),
  )
}
