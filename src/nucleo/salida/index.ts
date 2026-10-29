import { and, count, eq, max, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { marcar, modoDelNegocio, type CasoId, type Wamid } from '../identidad'
import {
  decidir,
  MODO_DE_LA_COMPUERTA,
  seCumple,
  type AlCliente,
  type DatosDeIntencion,
  type Destinatario,
  type HechosDeEnvio,
  type IntencionDeEnvio,
  type MotivoDeSilencio,
  type Veredicto,
} from './compuerta'
import { enviarPorKapso, numeroListo, type EnvioPorKapso } from './kapso'

export type { AlCliente, Destinatario, IntencionDeEnvio, MotivoDeSilencio } from './compuerta'

/** Un aviso no lleva texto libre: ni el modelo ni el Dueño escriben uno. */
export type AvisoDelNucleo =
  | { readonly cual: 'sin_negocio' }
  | { readonly cual: 'otro_negocio'; readonly actual: string; readonly nuevo: string }
  | { readonly cual: 'negocio_armando' }
  | { readonly cual: 'falla_tecnica' }

function textoDelAviso(a: AvisoDelNucleo): string {
  switch (a.cual) {
    case 'sin_negocio':
      return '¿Con qué negocio quieres hablar? Abre el link que te compartió, o escribe su código entre paréntesis al comienzo del mensaje, así: (CODIGO).'
    case 'otro_negocio':
      return `Estabas hablando con ${a.actual}. ¿Quieres hablar con ${a.nuevo}? Por ahora sigues con ${a.actual}.`
    case 'negocio_armando':
      return 'Este negocio todavía no está listo para atender por aquí. Vuelve a escribirnos en un rato.'
    case 'falla_tecnica':
      return 'Tuve un problema técnico y no pude responderte. ¿Me escribes de nuevo en un momento?'
  }
}

const conMarca = (d: DatosDeIntencion) => d as IntencionDeEnvio

/** La única forma de tener una `IntencionDeEnvio`. Cada constructor arma la clave: quien llama nunca la escribe. */
export const intencion = {
  respuesta: (a: { readonly destinatario: AlCliente; readonly texto: string; readonly enRespuestaA: Wamid }) =>
    conMarca({ clase: 'respuesta', ...a, clave: `respuesta:${a.enRespuestaA}` }),

  /** `vez` distingue un intento de otro: con la misma `vez`, otro clic no duplica. */
  resolucionDeCaso: (a: { readonly destinatario: AlCliente; readonly texto: string; readonly caso: CasoId | null; readonly vez: string }) =>
    conMarca({ clase: 'resolucion_de_caso', destinatario: a.destinatario, texto: a.texto, caso: a.caso, clave: `caso:${a.caso ?? 'sin_caso'}:${a.vez}` }),

  aviso: (a: { readonly destinatario: Destinatario; readonly aviso: AvisoDelNucleo; readonly enRespuestaA: Wamid }) =>
    conMarca({
      clase: 'aviso_del_nucleo',
      destinatario: a.destinatario,
      enRespuestaA: a.enRespuestaA,
      texto: textoDelAviso(a.aviso),
      clave: `aviso:${a.aviso.cual}:${a.enRespuestaA}`,
    }),
} as const

export type ResultadoDeEnvio =
  | { readonly tipo: 'enviado'; readonly wamid: Wamid | null }
  | { readonly tipo: 'simulado' }
  | { readonly tipo: 'no_salio'; readonly motivo: MotivoDeSilencio }
  /** Kapso falló dos veces. La fila queda `por_enviar`. */
  | { readonly tipo: 'por_enviar'; readonly error: string }

/**
 * La única salida hacia WhatsApp. Toda llamada deja una fila en `mensajes_salientes` con el veredicto, salga o
 * no, y lo que sale hacia un Cliente deja su fila `agente` en `mensajes_cliente`. Nunca lanza por Kapso.
 */
export async function despachar(i: IntencionDeEnvio): Promise<ResultadoDeEnvio> {
  const { hechos, telefono } = await leerHechos(i, new Date())
  const reclamo = await reclamar(i, hechos, telefono, decidir(i, hechos))
  switch (reclamo.tipo) {
    case 'ya_estaba':
      return reclamo.resultado
    case 'frenado':
      return { tipo: 'no_salio', motivo: reclamo.motivo }
    case 'a_kapso': {
      let envio = await enviarPorKapso(reclamo.telefono, i.texto)
      if (envio.tipo === 'fallo') envio = await enviarPorKapso(reclamo.telefono, i.texto)
      await registrarEnvio(reclamo.id, i, hechos.cliente, envio)
      return envio.tipo === 'fallo' ? { tipo: 'por_enviar', error: envio.error } : envio
    }
  }
}

/** Un solo lote: `neon-http` no tiene transacciones interactivas. `telefono` es `null` solo si el Cliente no existe. */
async function leerHechos(i: IntencionDeEnvio, ahora: Date): Promise<{ readonly hechos: HechosDeEnvio; readonly telefono: string | null }> {
  const { negocio } = i.destinatario
  const cliente = i.destinatario.tipo === 'cliente' ? i.destinatario.cliente : null
  const telefonoDado = i.destinatario.tipo === 'telefono' ? i.destinatario.telefono : null
  const enRespuestaA = i.clase === 'resolucion_de_caso' ? null : i.enRespuestaA

  const [negocios, clientes, entrantes, respuestas] = await db.batch([
    db.select({ estado: esquema.negocios.estado }).from(esquema.negocios).where(negocio ? eq(esquema.negocios.id, negocio) : sql`false`),
    db
      .select({ negocio: esquema.clientes.negocioId, telefono: esquema.clientes.telefono, ultimo: esquema.clientes.ultimoMensajeEntrante })
      .from(esquema.clientes)
      .where(cliente ? eq(esquema.clientes.id, cliente) : sql`false`),
    db
      .select({ ultimo: max(esquema.mensajesEntrantes.enviadoEn) })
      .from(esquema.mensajesEntrantes)
      .where(telefonoDado ? eq(esquema.mensajesEntrantes.telefono, telefonoDado) : sql`false`),
    db
      .select({ n: count() })
      .from(esquema.mensajesSalientes)
      .where(enRespuestaA ? and(eq(esquema.mensajesSalientes.enRespuestaA, enRespuestaA), eq(esquema.mensajesSalientes.veredicto, 'sale')) : sql`false`),
  ])
  const [n] = negocios
  const [c] = clientes
  const ultimo = cliente ? c?.ultimo : entrantes[0]?.ultimo
  const emergencia = emergenciaDe(process.env.SALIDA_EN_EMERGENCIA, negocio)
  return {
    hechos: {
      ahora: marcar.instante(ahora),
      emergenciaGlobal: emergencia.global,
      numeroPermitido: numeroListo(),
      negocio: n ? { modo: modoDelNegocio(n.estado), emergencia: emergencia.delNegocio } : null,
      cliente: c ? { negocio: marcar.negocio(c.negocio) } : null,
      ultimoEntrante: ultimo ? marcar.instante(ultimo) : null,
      respuestasAlMismoMensaje: respuestas[0]?.n ?? 0,
    },
    telefono: telefonoDado ?? c?.telefono ?? null,
  }
}

/** `SALIDA_EN_EMERGENCIA`: vacía, `*` (todo) o ids de Negocio separados por coma. Moverla es un redeploy. */
export function emergenciaDe(valor: string | undefined, negocio: string | null): { readonly global: boolean; readonly delNegocio: boolean } {
  const lista = (valor ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return { global: lista.includes('*'), delNegocio: negocio !== null && lista.includes(negocio) }
}

type Destino = { readonly veredicto: Veredicto } & (
  | { readonly sale: true; readonly telefono: string }
  | { readonly sale: false; readonly motivo: MotivoDeSilencio }
)

/** Pura. Sin teléfono no hay a quién mandar; con teléfono, al observar todo sale. */
function destinoDe(v: Veredicto, telefono: string | null): Destino {
  if (telefono === null) {
    const motivo = v.tipo === 'no_sale' ? v.motivo : 'destinatario_de_otro_negocio'
    return { veredicto: { tipo: 'no_sale', motivo }, sale: false, motivo }
  }
  if (v.tipo === 'no_sale' && seCumple(v, MODO_DE_LA_COMPUERTA)) return { veredicto: v, sale: false, motivo: v.motivo }
  return { veredicto: v, sale: true, telefono }
}

type Reclamo =
  | { readonly tipo: 'ya_estaba'; readonly resultado: ResultadoDeEnvio }
  | { readonly tipo: 'frenado'; readonly motivo: MotivoDeSilencio }
  | { readonly tipo: 'a_kapso'; readonly id: string; readonly telefono: string }

/**
 * El INSERT es el reclamo. Si no entra, chocó con `clave` (el mismo intento: se devuelve lo guardado) o con el
 * índice parcial (otra instancia ya respondió ese mensaje entre la lectura y el INSERT: va otra vez como
 * `una_respuesta_por_mensaje`, que no choca con ese índice).
 */
async function reclamar(i: IntencionDeEnvio, hechos: HechosDeEnvio, telefono: string | null, v: Veredicto): Promise<Reclamo> {
  const destino = destinoDe(v, telefono)
  const [fila] = await db
    .insert(esquema.mensajesSalientes)
    .values({
      clave: i.clave,
      negocioId: i.destinatario.negocio,
      clienteId: i.destinatario.tipo === 'cliente' && hechos.cliente ? i.destinatario.cliente : null,
      casoId: i.clase === 'resolucion_de_caso' ? i.caso : null,
      telefono,
      clase: i.clase,
      enRespuestaA: i.clase === 'resolucion_de_caso' ? null : i.enRespuestaA,
      veredicto: destino.veredicto.tipo,
      motivo: destino.veredicto.tipo === 'no_sale' ? destino.veredicto.motivo : null,
      estado: destino.sale ? 'por_enviar' : 'no_salio',
    })
    .onConflictDoNothing()
    .returning({ id: esquema.mensajesSalientes.id })
  if (fila) return destino.sale ? { tipo: 'a_kapso', id: fila.id, telefono: destino.telefono } : { tipo: 'frenado', motivo: destino.motivo }

  const [guardada] = await db
    .select({ estado: esquema.mensajesSalientes.estado, wamid: esquema.mensajesSalientes.wamid, motivo: esquema.mensajesSalientes.motivo, error: esquema.mensajesSalientes.error })
    .from(esquema.mensajesSalientes)
    .where(eq(esquema.mensajesSalientes.clave, i.clave))
  if (guardada) return { tipo: 'ya_estaba', resultado: resultadoGuardado(guardada) }
  return reclamar(i, hechos, telefono, { tipo: 'no_sale', motivo: 'una_respuesta_por_mensaje' })
}

function resultadoGuardado(f: {
  readonly estado: 'por_enviar' | 'enviado' | 'simulado' | 'no_salio'
  readonly wamid: string | null
  readonly motivo: MotivoDeSilencio | null
  readonly error: string | null
}): ResultadoDeEnvio {
  switch (f.estado) {
    case 'enviado':
      return { tipo: 'enviado', wamid: f.wamid ? marcar.wamid(f.wamid) : null }
    case 'simulado':
      return { tipo: 'simulado' }
    case 'no_salio':
      // `no_salio` solo se escribe con un veredicto `no_sale`, y el CHECK de la tabla le exige motivo.
      return { tipo: 'no_salio', motivo: f.motivo! }
    case 'por_enviar':
      return { tipo: 'por_enviar', error: f.error ?? 'en curso' }
  }
}

/** La fila `agente` va al Negocio del Cliente leído, no al del destinatario: es la conversación de ese Cliente. */
async function registrarEnvio(id: string, i: IntencionDeEnvio, cliente: HechosDeEnvio['cliente'], envio: EnvioPorKapso): Promise<void> {
  const estado = db
    .update(esquema.mensajesSalientes)
    .set({
      estado: envio.tipo === 'fallo' ? 'por_enviar' : envio.tipo,
      wamid: envio.tipo === 'enviado' ? envio.wamid : null,
      error: envio.tipo === 'fallo' ? envio.error : null,
      actualizado: new Date(),
    })
    .where(eq(esquema.mensajesSalientes.id, id))
  const d = i.destinatario
  if (envio.tipo === 'fallo' || d.tipo !== 'cliente' || !cliente) {
    await estado
    return
  }
  await db.batch([
    estado,
    db.insert(esquema.mensajesCliente).values({
      negocioId: cliente.negocio,
      clienteId: d.cliente,
      rol: 'agente',
      texto: i.texto,
      wamid: envio.tipo === 'enviado' ? envio.wamid : null,
    }),
  ])
}
