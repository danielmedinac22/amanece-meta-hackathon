import { and, count, eq, max, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { marcar, type CasoId, type DuenoId, type VezDeToma, type Wamid } from '../identidad'
import { QUIEN_LA_TIENE, reclamarConCerca, saldarConMensajeDelDueno } from './atencion'
import {
  decidir,
  hablaDe,
  MODO_DE_LA_COMPUERTA,
  seCumple,
  type AlCliente,
  type AlTelefono,
  type DatosDeIntencion,
  type DelAgente,
  type HechosDeEnvio,
  type IntencionDeEnvio,
  type IntencionEnsayada,
  type MotivoDeSilencio,
  type Veredicto,
} from './compuerta'
import { enviarPorKapso, numeroListo, type EnvioPorKapso } from './kapso'

export type { AlCliente, DelAgente, Destinatario, IntencionDeEnvio, IntencionEnsayada, MotivoDeSilencio } from './compuerta'
export { fueRechazado } from './kapso'

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
  respuesta: (a: { readonly destinatario: AlCliente; readonly texto: string; readonly enRespuestaA: Wamid; readonly habla: DelAgente }) =>
    conMarca({ clase: 'respuesta', ...a, clave: `respuesta:${a.enRespuestaA}` }),

  /** `vez` distingue un intento de otro: con la misma `vez`, otro clic no duplica. */
  resolucionDeCaso: (a: { readonly destinatario: AlCliente; readonly texto: string; readonly caso: CasoId | null; readonly vez: string }) =>
    conMarca({ clase: 'resolucion_de_caso', destinatario: a.destinatario, texto: a.texto, caso: a.caso, clave: `caso:${a.caso ?? 'sin_caso'}:${a.vez}` }),

  /** Un aviso a un Cliente lleva la vez del turno, porque también se calla si otro tomó la conversación. */
  aviso: (a: { readonly aviso: AvisoDelNucleo; readonly enRespuestaA: Wamid } & ({ readonly destinatario: AlCliente; readonly habla: DelAgente } | { readonly destinatario: AlTelefono })) =>
    conMarca({
      clase: 'aviso_del_nucleo',
      ...('habla' in a ? { destinatario: a.destinatario, habla: a.habla } : { destinatario: a.destinatario }),
      enRespuestaA: a.enRespuestaA,
      texto: textoDelAviso(a.aviso),
      clave: `aviso:${a.aviso.cual}:${a.enRespuestaA}`,
    }),

  /** `intento` lo genera la pantalla: con el mismo, otro clic no duplica. */
  delDueno: (a: { readonly destinatario: AlCliente; readonly dueno: DuenoId; readonly vez: VezDeToma; readonly texto: string; readonly visto: Wamid | null; readonly intento: string }) =>
    conMarca({ clase: 'del_dueno', destinatario: a.destinatario, texto: a.texto, visto: a.visto, habla: { tipo: 'dueno', vez: a.vez, dueno: a.dueno }, clave: `dueno:${a.destinatario.cliente}:${a.intento}` }),
} as const

/** Misma forma que `intencion.respuesta`, otra marca: la usa el turno en modo ensayo y `despachar` no la acepta. */
export const ensayo = {
  respuesta: (a: { readonly destinatario: AlCliente; readonly texto: string; readonly enRespuestaA: Wamid; readonly habla: DelAgente }) =>
    ({ clase: 'respuesta', ...a, clave: `ensayo:${a.enRespuestaA}` }) as DatosDeIntencion as IntencionEnsayada,
} as const

export type ResultadoDeEnvio =
  | { readonly tipo: 'enviado'; readonly wamid: Wamid | null }
  | { readonly tipo: 'simulado' }
  | { readonly tipo: 'no_salio'; readonly motivo: MotivoDeSilencio }
  /** Kapso falló. La fila queda `por_enviar`, con su error. */
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
      // Sin reintento: Meta no tiene llave de idempotencia, y un reintento ciego puede mandar dos veces.
      const envio = await enviarPorKapso(reclamo.telefono, i.texto)
      await registrarEnvio(reclamo.id, i, hechos.cliente, envio)
      if (envio.tipo !== 'fallo') return envio
      console.error('[salida] Kapso no tomó el mensaje', i.clave, envio.error)
      return { tipo: 'por_enviar', error: envio.error }
    }
  }
}

const enRespuestaADe = (i: DatosDeIntencion): Wamid | null => ('enRespuestaA' in i ? i.enRespuestaA : null)

/** Un solo lote: `neon-http` no tiene transacciones interactivas. `telefono` es `null` solo si el Cliente no existe. */
async function leerHechos(i: IntencionDeEnvio, ahora: Date): Promise<{ readonly hechos: HechosDeEnvio; readonly telefono: string | null }> {
  const { negocio } = i.destinatario
  const cliente = i.destinatario.tipo === 'cliente' ? i.destinatario.cliente : null
  const telefonoDado = i.destinatario.tipo === 'telefono' ? i.destinatario.telefono : null
  const enRespuestaA = enRespuestaADe(i)

  const [negocios, clientes, entrantes, respuestas] = await db.batch([
    db.select({ modo: esquema.negocios.modo }).from(esquema.negocios).where(negocio ? eq(esquema.negocios.id, negocio) : sql`false`),
    db
      .select({ negocio: esquema.clientes.negocioId, telefono: esquema.clientes.telefono, ultimo: esquema.clientes.ultimoMensajeEntrante, vez: esquema.clientes.vecesTomada, tiene: QUIEN_LA_TIENE })
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
      negocio: n ? { modo: n.modo ?? 'armando', emergencia: emergencia.delNegocio } : null,
      cliente: c ? { negocio: marcar.negocio(c.negocio), vez: marcar.vez(c.vez), tiene: c.tiene ? marcar.dueno(c.tiene) : null } : null,
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

/** Pura. Sin teléfono no hay a quién mandar, en ningún modo. */
function destinoDe(v: Veredicto, i: DatosDeIntencion, telefono: string | null): Destino {
  if (telefono === null) {
    const motivo = v.tipo === 'no_sale' ? v.motivo : 'destinatario_de_otro_negocio'
    return { veredicto: { tipo: 'no_sale', motivo }, sale: false, motivo }
  }
  if (v.tipo === 'no_sale' && seCumple(v, i, MODO_DE_LA_COMPUERTA)) return { veredicto: v, sale: false, motivo: v.motivo }
  return { veredicto: v, sale: true, telefono }
}

type Reclamo =
  | { readonly tipo: 'ya_estaba'; readonly resultado: ResultadoDeEnvio }
  | { readonly tipo: 'frenado'; readonly motivo: MotivoDeSilencio }
  | { readonly tipo: 'a_kapso'; readonly id: string; readonly telefono: string }

/**
 * El INSERT es el reclamo. Si no entra, chocó con `clave` (el mismo intento: se devuelve lo guardado), con la cerca (lo
 * dice `decidir` al releer: una vez vieja no revive y una toma vencida no se extiende) o con el índice parcial (otra
 * instancia ya respondió ese mensaje entre la lectura y el INSERT). Entonces va una segunda y última vez, con ese motivo.
 */
async function reclamar(i: IntencionDeEnvio, hechos: HechosDeEnvio, telefono: string | null, v: Veredicto): Promise<Reclamo> {
  const primero = await intentarReclamo(i, hechos, telefono, v)
  if (primero) return primero
  const otraVez = hablaDe(i) ? decidir(i, (await leerHechos(i, new Date())).hechos) : null
  const motivo = otraVez?.tipo === 'no_sale' && otraVez.motivo === 'no_le_toca' ? otraVez.motivo : 'una_respuesta_por_mensaje'
  const segundo = await intentarReclamo(i, hechos, telefono, { tipo: 'no_sale', motivo })
  if (segundo) return segundo
  throw new Error(`[salida] ${i.clave} no entró ni quedó guardada`)
}

/** `null`: no entró y no hay fila con su clave, así que chocó con el índice parcial. */
async function intentarReclamo(i: IntencionDeEnvio, hechos: HechosDeEnvio, telefono: string | null, v: Veredicto): Promise<Reclamo | null> {
  const destino = destinoDe(v, i, telefono)
  const habla = hablaDe(i)
  // Una fila frenada por la toma no puede ocupar la clave: bloquearía al turno que sí debe contestar ese mensaje.
  const clave = !destino.sale && destino.motivo === 'no_le_toca' && habla ? `${i.clave}:frenada:${habla.vez}` : i.clave
  const clienteId = i.destinatario.tipo === 'cliente' && hechos.cliente ? i.destinatario.cliente : null
  const enRespuestaA = enRespuestaADe(i)
  const motivo = destino.veredicto.tipo === 'no_sale' ? destino.veredicto.motivo : null
  const [fila] =
    destino.sale && habla && clienteId
      ? [await reclamarConCerca({ clave, negocioId: i.destinatario.negocio, clienteId, telefono: destino.telefono, clase: i.clase, enRespuestaA, veredicto: destino.veredicto.tipo, motivo }, habla)].flatMap((f) => (f ? [f] : []))
      : await db
          .insert(esquema.mensajesSalientes)
          .values({
            clave,
            negocioId: i.destinatario.negocio,
            clienteId,
            casoId: i.clase === 'resolucion_de_caso' ? i.caso : null,
            telefono,
            clase: i.clase,
            enRespuestaA,
            veredicto: destino.veredicto.tipo,
            motivo,
            estado: destino.sale ? 'por_enviar' : 'no_salio',
          })
          .onConflictDoNothing()
          .returning({ id: esquema.mensajesSalientes.id })
  if (fila) return destino.sale ? { tipo: 'a_kapso', id: fila.id, telefono: destino.telefono } : { tipo: 'frenado', motivo: destino.motivo }

  const [guardada] = await db
    .select({ estado: esquema.mensajesSalientes.estado, wamid: esquema.mensajesSalientes.wamid, motivo: esquema.mensajesSalientes.motivo, error: esquema.mensajesSalientes.error })
    .from(esquema.mensajesSalientes)
    .where(eq(esquema.mensajesSalientes.clave, clave))
  return guardada ? { tipo: 'ya_estaba', resultado: resultadoGuardado(guardada) } : null
}

/** El error de una fila `por_enviar` que otro intento reclamó y todavía está enviando. */
const EN_CURSO = 'en curso'

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
      return { tipo: 'por_enviar', error: f.error ?? EN_CURSO }
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
  const fila = db.insert(esquema.mensajesCliente).values({
    negocioId: cliente.negocio,
    clienteId: d.cliente,
    rol: i.clase === 'del_dueno' ? 'dueno' : 'agente',
    texto: i.texto,
    wamid: envio.tipo === 'enviado' ? envio.wamid : null,
  })
  await (i.clase === 'del_dueno' ? db.batch([estado, fila, saldarConMensajeDelDueno(d.cliente, i.visto)]) : db.batch([estado, fila]))
}
