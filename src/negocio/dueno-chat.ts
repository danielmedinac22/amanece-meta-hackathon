import { convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type ToolSet, type UIMessage } from 'ai'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { crearAgenteDelDueno, parteDeDatosParaElModelo, type PuertosDelDueno } from '@/agentes/dueno'
import { modelo } from '@/lib/modelo'
import { guardarEnElHilo, leerHilo, mensajeDelDuenoEnTexto } from '@/negocio/dueno-hilo'
import { historial, type EstadoDePropuesta, type TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { Elemento } from '@/nucleo/estado/elementos'
import type { ContextoDelDueno } from '@/nucleo/identidad'
import { registrarTurno } from '@/negocio/medir'
import { tarjetaDeLaParte } from '@/negocio/partes-del-hilo'

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

  const inicio = Date.now()
  const resultado = streamText({
    model: modelo,
    instructions: agente.system,
    messages: await mensajesParaElModelo(historial, agente),
    tools: agente.tools,
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
  readonly accion: TarjetaDeAprobacion['accion']
  /** El nombre del Dueño que tocó el botón; null si la aplicó la política o no se aplicó. */
  readonly aprobadaPor: string | null
  readonly asunto: AsuntoDeTarjeta | null
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
    }
  /** `que` es null si cambia algo que ya existía o mezcla varios tipos. */
  | { readonly tipo: 'elemento'; readonly que: Elemento['tipo'] | null }

/**
 * El Hilo y el estado vivo de cada tarjeta que trae. Las filas del Hilo no se editan: lo guardado es la tarjeta
 * estática y su estado se lee aquí, al pintar el Panel y en cada consulta del Hilo.
 */
export async function leerHiloConTarjetas(ctx: ContextoDelDueno): Promise<{ mensajes: UIMessage[]; tarjetas: Record<string, EstadoDeTarjeta> }> {
  const mensajes = await leerHilo(ctx.dueno)
  const entradas = await historial(ctx, { propuestas: tarjetasDe(mensajes).map((t) => t.propuesta) })
  const ids = [...new Set(entradas.map((e) => e.aprobadoPor).filter((id) => id !== null))]
  const duenos = ids.length ? await db.select({ id: esquema.duenos.id, nombre: esquema.duenos.nombre }).from(esquema.duenos).where(and(eq(esquema.duenos.negocioId, ctx.negocio), inArray(esquema.duenos.id, ids))) : []
  const asuntos = await asuntosDe(ctx, entradas.map((e) => e.propuesta))
  const tarjetas = Object.fromEntries(
    entradas.map((e) => [e.propuesta, { estado: e.estado, accion: e.accion, aprobadaPor: e.aprobadoPor ? duenos.find((d) => d.id === e.aprobadoPor)?.nombre || 'un Dueño' : null, asunto: asuntos.get(e.propuesta) ?? null } satisfies EstadoDeTarjeta]),
  )
  return { mensajes, tarjetas }
}

/** Una sola lectura por sondeo, porque el Hilo la repite cada pocos segundos. Las propuestas ya vienen del Negocio de `ctx`. */
async function asuntosDe(ctx: ContextoDelDueno, propuestas: readonly string[]): Promise<ReadonlyMap<string, AsuntoDeTarjeta>> {
  if (!propuestas.length) return new Map()
  const { propuestas: p, casos: c, clientes, pedidos, mensajesCliente: m } = esquema
  const filas = await db.select({ id: p.id, actos: p.actos, escritura: p.escritura, revierte: p.revierte }).from(p).where(and(eq(p.negocioId, ctx.negocio), inArray(p.id, [...propuestas])))
  const idsDeCasos = filas.flatMap((f) => f.actos.map((a) => a.caso))
  const casos = idsDeCasos.length
    ? await db
        .selectDistinctOn([c.id], { id: c.id, titulo: c.titulo, pedido: pedidos.numero, cliente: clientes.nombre, escribio: m.texto })
        .from(c)
        .leftJoin(clientes, and(eq(clientes.id, c.clienteId), eq(clientes.negocioId, c.negocioId)))
        .leftJoin(pedidos, and(eq(pedidos.id, c.pedidoId), eq(pedidos.negocioId, c.negocioId)))
        .leftJoin(m, and(eq(m.clienteId, c.clienteId), eq(m.negocioId, c.negocioId), eq(m.rol, 'cliente'), lte(m.creado, c.creado)))
        .where(and(eq(c.negocioId, ctx.negocio), inArray(c.id, idsDeCasos)))
        .orderBy(c.id, desc(m.creado))
    : []
  return new Map(
    filas.map((f): [string, AsuntoDeTarjeta] => {
      const [acto] = f.actos
      if (!acto) {
        const tipos = new Set(f.escritura.elementos.map((e) => (e.base === 'nueva' ? e.despues?.tipo : undefined)))
        return [f.id, { tipo: 'elemento', que: !f.revierte && tipos.size === 1 ? ([...tipos][0] ?? null) : null }]
      }
      const caso = casos.find((x) => x.id === acto.caso)
      return [f.id, { tipo: 'caso', titulo: caso?.titulo ?? 'Un Caso', pedido: caso?.pedido ?? null, cliente: caso?.cliente || null, escribio: caso?.escribio || null, respuesta: acto.texto }]
    }),
  )
}

export function tarjetasDe(mensajes: readonly UIMessage[]): TarjetaDeAprobacion[] {
  return mensajes.flatMap((m) => m.parts.flatMap((p) => tarjetaDeLaParte(p) ?? []))
}
