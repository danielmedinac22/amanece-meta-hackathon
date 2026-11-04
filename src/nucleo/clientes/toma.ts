import { and, eq } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { MOTIVO_EN_PALABRAS } from '../caso-palabras'
import { marcar, type ContextoDelDueno, type ClienteId } from '../identidad'
import { despachar, fueRechazado, intencion } from '../salida'
import { leerAtencion, soltarLaDeUnCliente, tomarFila } from '../salida/atencion'
import { fueraDeVentana } from '../salida/compuerta'
import { atenderLoDebido } from './atender'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LARGO_DE_UN_MENSAJE = 4000

export type ResultadoDeTomar = { readonly tipo: 'tomada' } | { readonly tipo: 'la_tiene'; readonly quien: string } | { readonly tipo: 'no_existe' }
export type ResultadoDeDevolver = { readonly tipo: 'devuelta' } | { readonly tipo: 'no_existe' }
export type ResultadoDeEscribir =
  | { readonly tipo: 'salio' }
  | { readonly tipo: 'no_salio'; readonly porQue: string }
  /** Se le acabó el tiempo o la devolvieron. Nada salió. */
  | { readonly tipo: 'ya_no_la_tienes' }
  /** Kapso lo rechazó: no salió, y con otro `intento` se puede reintentar. */
  | { readonly tipo: 'no_la_tomo' }
  /** Pudo salir: una excepción puede llegar después de que Kapso aceptó, o sigue en camino. Reintentar con otro `intento` serían dos mensajes. */
  | { readonly tipo: 'sin_saber' }
  | { readonly tipo: 'no_existe' }

const delNegocio = async (ctx: ContextoDelDueno, cliente: string): Promise<ClienteId | null> => {
  if (!UUID.test(cliente)) return null
  const [fila] = await db.select({ id: esquema.clientes.id }).from(esquema.clientes).where(and(eq(esquema.clientes.id, cliente), eq(esquema.clientes.negocioId, ctx.negocio)))
  return fila ? marcar.cliente(fila.id) : null
}

/** Idempotente: si ya es tuya, no sube la vez ni alarga el tiempo. */
export async function tomar(ctx: ContextoDelDueno, cliente: string): Promise<ResultadoDeTomar> {
  const id = await delNegocio(ctx, cliente)
  if (!id) return { tipo: 'no_existe' }
  if (await tomarFila(ctx.negocio, id, ctx.dueno)) return { tipo: 'tomada' }
  const a = await leerAtencion(ctx.negocio, id)
  if (!a) return { tipo: 'no_existe' }
  return a.tiene === ctx.dueno ? { tipo: 'tomada' } : { tipo: 'la_tiene', quien: a.quien ?? '' }
}

/** Cualquier Dueño del Negocio. Otro clic no hace nada. `despues` corre el turno de lo debido sin hacer esperar a la pantalla. */
export async function devolver(ctx: ContextoDelDueno, cliente: string, vez: number, despues: (trabajo: () => Promise<void>) => void): Promise<ResultadoDeDevolver> {
  const id = await delNegocio(ctx, cliente)
  if (!id) return { tipo: 'no_existe' }
  const soltada = await soltarLaDeUnCliente(ctx.negocio, id, vez)
  if (soltada?.debe) despues(() => atenderLoDebido(soltada))
  return { tipo: 'devuelta' }
}

export async function escribirAlCliente(ctx: ContextoDelDueno, e: { readonly cliente: string; readonly vez: number; readonly texto: string; readonly intento: string; readonly visto: string | null }): Promise<ResultadoDeEscribir> {
  const texto = e.texto.trim()
  const id = await delNegocio(ctx, e.cliente)
  if (!id || !UUID.test(e.intento) || !Number.isInteger(e.vez)) return { tipo: 'no_existe' }
  if (!texto || texto.length > LARGO_DE_UN_MENSAJE) return { tipo: 'no_salio', porQue: `el mensaje tiene que tener texto, y no más de ${LARGO_DE_UN_MENSAJE} caracteres.` }
  const r = await despachar(
    intencion.delDueno({
      destinatario: { tipo: 'cliente', negocio: ctx.negocio, cliente: id },
      dueno: ctx.dueno,
      vez: marcar.vez(e.vez),
      texto,
      visto: e.visto ? marcar.wamid(e.visto) : null,
      intento: e.intento,
    }),
  )
  switch (r.tipo) {
    case 'enviado':
    case 'simulado':
      return { tipo: 'salio' }
    case 'por_enviar':
      return fueRechazado(r.error) ? { tipo: 'no_la_tomo' } : { tipo: 'sin_saber' }
    case 'no_salio':
      return r.motivo === 'no_le_toca' ? { tipo: 'ya_no_la_tienes' } : { tipo: 'no_salio', porQue: MOTIVO_EN_PALABRAS[r.motivo] }
  }
}

/** Lo que el pie de una conversación pinta. `quedaMs` lo calcula la base: la pantalla cuenta desde que monta. */
export type Atencion =
  | { readonly tipo: 'agente'; readonly vez: number; readonly ventana: boolean; readonly espera: boolean }
  | { readonly tipo: 'tuya'; readonly vez: number; readonly ventana: boolean; readonly quedaMs: number; readonly sinContestar: string | null; readonly agenteTerminando: boolean }
  | { readonly tipo: 'de_otro'; readonly vez: number; readonly quien: string; readonly quedaMs: number }

export async function atencionDe(ctx: Pick<ContextoDelDueno, 'negocio' | 'dueno'>, cliente: string): Promise<Atencion> {
  const a = await leerAtencion(ctx.negocio, cliente)
  if (!a) return { tipo: 'agente', vez: 0, ventana: false, espera: false }
  const ventana = !fueraDeVentana(a.ultimoEntrante ? marcar.instante(a.ultimoEntrante) : null, marcar.instante(new Date()))
  if (!a.tiene) return { tipo: 'agente', vez: a.vez, ventana, espera: a.sinContestar !== null && a.esperaDeVerdad === true }
  if (a.tiene !== ctx.dueno) return { tipo: 'de_otro', vez: a.vez, quien: a.quien ?? 'Otro Dueño', quedaMs: a.quedaMs }
  return { tipo: 'tuya', vez: a.vez, ventana, quedaMs: a.quedaMs, sinContestar: a.sinContestar, agenteTerminando: a.agenteTerminando }
}
