import { convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, generateId, isStepCount, streamText, toUIMessageStream, type UIMessage } from 'ai'
import type { esquema } from '@/db'
import { crearAgenteDelDueno, parteDeDatosParaElModelo } from '@/agentes/dueno'
import { modelo } from '@/lib/modelo'
import { guardarEnElHilo, leerHilo } from '@/negocio/dueno-hilo'
import { registrarTurno } from '@/negocio/medir'

/** Cuántos mensajes del Hilo ve el modelo en cada turno. */
const MENSAJES_QUE_VE_EL_MODELO = 40
const LARGO_MAXIMO = 4000

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
  const limpio = texto.trim().slice(0, LARGO_MAXIMO)
  if (!limpio) return null
  return { id: generateId(), role: 'user', parts: [{ type: 'text', text: limpio }] }
}

/**
 * Un turno del Hilo: guarda el mensaje del Dueño, corre al Agente del dueño con hasta 8 pasos y guarda
 * su respuesta al terminar. El turno queda medido con `registrarTurno`.
 */
export async function responderEnElHilo({
  negocio,
  dueno,
  mensaje,
}: {
  negocio: typeof esquema.negocios.$inferSelect
  dueno: typeof esquema.duenos.$inferSelect
  mensaje: UIMessage
}) {
  const { system, tools } = crearAgenteDelDueno({ negocio, dueno })
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
