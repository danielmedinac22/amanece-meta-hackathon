import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { guardarEnElHilo, mensajeDelDuenoEnTexto } from '@/negocio/dueno-hilo'
import { atenderMensaje } from './clientes/atender'
import { contextoDelTelefonoDelDueno, marcar, NUMERO_DE_AMANECE, type ContextoDelDueno, type Instante, type NegocioId, type Wamid } from './identidad'
import { despachar, intencion } from './salida'

/** Firma de Kapso: HMAC-SHA256 del cuerpo crudo, en hex, en `X-Webhook-Signature` (a veces con `sha256=`). */
export function firmaValida(cuerpo: string, firma: string | null, secreto = process.env.KAPSO_WEBHOOK_SECRET ?? ''): boolean {
  if (!firma || !secreto) return false
  const recibida = Buffer.from(firma.trim().replace(/^sha256=/, ''), 'utf8')
  const esperada = Buffer.from(createHmac('sha256', secreto).update(cuerpo).digest('hex'), 'utf8')
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

export type MensajeEntrante = {
  readonly wamid: Wamid
  readonly telefono: string
  readonly nombre: string
  readonly texto: string
  /** El timestamp de Meta, no la hora de llegada: abre la ventana de 24 h. */
  readonly enviadoEn: Instante
  /** El id de un botón interactivo, o el `payload` del botón de una plantilla. */
  readonly boton: string | null
}

type CuerpoDeKapso = {
  readonly data?: CuerpoDeKapso
  readonly phone_number_id?: unknown
  readonly conversation?: { readonly contact_name?: unknown; readonly kapso?: { readonly contact_name?: unknown } }
  readonly message?: {
    readonly id?: unknown
    readonly from?: unknown
    readonly type?: unknown
    readonly timestamp?: unknown
    readonly text?: { readonly body?: unknown }
    readonly button?: { readonly text?: unknown; readonly payload?: unknown }
    readonly interactive?: {
      readonly button_reply?: { readonly id?: unknown; readonly title?: unknown }
      readonly list_reply?: { readonly id?: unknown; readonly title?: unknown }
    }
    readonly kapso?: { readonly status?: unknown; readonly transcript?: { readonly text?: unknown }; readonly content?: unknown }
  }
}

/** `null` si el cuerpo no es un mensaje de texto al número de Amanece: un recibo de entrega, otro número, media sin texto. */
export function leerMensajeEntrante(cuerpo: unknown, recibidoEn: Date = new Date()): MensajeEntrante | null {
  const crudo = cuerpo as CuerpoDeKapso | null
  const raiz = crudo?.data && !crudo.message ? crudo.data : crudo
  const mensaje = raiz?.message
  if (!raiz || !mensaje?.id || !mensaje.from) return null
  if (raiz.phone_number_id && raiz.phone_number_id !== NUMERO_DE_AMANECE.id) return null
  if (mensaje.kapso?.status && mensaje.kapso.status !== 'received') return null

  const texto =
    mensaje.type === 'text'
      ? mensaje.text?.body
      : mensaje.type === 'button'
        ? mensaje.button?.text
        : mensaje.type === 'interactive'
          ? (mensaje.interactive?.button_reply?.title ?? mensaje.interactive?.list_reply?.title)
          : (mensaje.kapso?.transcript?.text ?? mensaje.kapso?.content)
  if (!texto || typeof texto !== 'string') return null

  const boton = mensaje.interactive?.button_reply?.id ?? mensaje.interactive?.list_reply?.id ?? mensaje.button?.payload ?? null
  const nombre = raiz.conversation?.contact_name ?? raiz.conversation?.kapso?.contact_name
  const segundos = Number(mensaje.timestamp)
  return {
    wamid: marcar.wamid(String(mensaje.id)),
    telefono: String(mensaje.from).replace(/\D/g, ''),
    nombre: typeof nombre === 'string' ? nombre : '',
    texto: texto.trim(),
    enviadoEn: marcar.instante(Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : recibidoEn),
    boton: typeof boton === 'string' ? boton : null,
  }
}

/** La ficha del link `wa.me`: `(CODIGO)` al inicio del texto. Nada más del texto enruta. */
export const FICHA_DE_ENRUTAMIENTO = /^\(([A-Z0-9]{3,12})\)/

export function linkDeWhatsapp(nombre: string, codigo: string): string {
  return `https://wa.me/${NUMERO_DE_AMANECE.telefono}?text=${encodeURIComponent(`(${codigo}) Hola ${nombre}`)}`
}

export type NegocioDelReparto = { readonly id: NegocioId; readonly nombre: string }

export type Reparto =
  | { readonly tipo: 'dueno'; readonly ctx: ContextoDelDueno; readonly boton: string | null }
  | { readonly tipo: 'cliente'; readonly negocio: NegocioId }
  | { readonly tipo: 'preguntar'; readonly por: 'sin_negocio' }
  /** Un segundo código: se le pregunta y sigue con `actual` (decisión 9). */
  | { readonly tipo: 'preguntar'; readonly por: 'otro_negocio'; readonly actual: NegocioDelReparto; readonly nuevo: NegocioDelReparto }

export type HechosDelReparto = {
  readonly dueno: ContextoDelDueno | null
  /** `null` sin ficha, o con el código de un Negocio que no existe. */
  readonly ficha: NegocioDelReparto | null
  /** El Negocio del último link de este teléfono (`sesiones_whatsapp`). */
  readonly actual: NegocioDelReparto | null
}

/** Pura. `sesion` es el Negocio que queda en `sesiones_whatsapp`, o `null` si no cambia. */
export function elegirReparto(h: HechosDelReparto, boton: string | null): { readonly reparto: Reparto; readonly sesion: NegocioId | null } {
  if (h.dueno && (!h.ficha || h.ficha.id === h.dueno.negocio)) return { reparto: { tipo: 'dueno', ctx: h.dueno, boton }, sesion: null }
  if (h.ficha && !h.actual) return { reparto: { tipo: 'cliente', negocio: h.ficha.id }, sesion: h.ficha.id }
  if (h.ficha && h.actual && h.ficha.id !== h.actual.id) return { reparto: { tipo: 'preguntar', por: 'otro_negocio', actual: h.actual, nuevo: h.ficha }, sesion: null }
  if (h.actual) return { reparto: { tipo: 'cliente', negocio: h.actual.id }, sesion: null }
  return { reparto: { tipo: 'preguntar', por: 'sin_negocio' }, sesion: null }
}

export async function repartir(m: MensajeEntrante): Promise<Reparto> {
  const codigo = FICHA_DE_ENRUTAMIENTO.exec(m.texto)?.[1] ?? null
  const negocio = { id: esquema.negocios.id, nombre: esquema.negocios.nombre }
  const [dueno, [fichas, sesiones]] = await Promise.all([
    contextoDelTelefonoDelDueno(m.telefono),
    db.batch([
      db.select(negocio).from(esquema.negocios).where(codigo ? eq(esquema.negocios.codigo, codigo) : sql`false`),
      db
        .select(negocio)
        .from(esquema.sesionesWhatsapp)
        .innerJoin(esquema.negocios, eq(esquema.negocios.id, esquema.sesionesWhatsapp.negocioId))
        .where(eq(esquema.sesionesWhatsapp.telefono, m.telefono)),
    ]),
  ])
  const delReparto = (n: { id: string; nombre: string } | undefined): NegocioDelReparto | null => (n ? { id: marcar.negocio(n.id), nombre: n.nombre } : null)
  const { reparto, sesion } = elegirReparto({ dueno, ficha: delReparto(fichas[0]), actual: delReparto(sesiones[0]) }, m.boton)
  if (sesion) {
    await db
      .insert(esquema.sesionesWhatsapp)
      .values({ telefono: m.telefono, negocioId: sesion })
      .onConflictDoUpdate({ target: esquema.sesionesWhatsapp.telefono, set: { negocioId: sesion, actualizado: new Date() } })
  }
  return reparto
}

/**
 * El webhook. El INSERT en `mensajes_entrantes` es el reclamo: un `wamid` repetido no se atiende dos veces,
 * venga de un Cliente, de un Dueño o de un teléfono sin Negocio. No lanza por lo que le pase al Cliente.
 */
export async function recibirMensaje(m: MensajeEntrante): Promise<void> {
  const [reclamo] = await db
    .insert(esquema.mensajesEntrantes)
    .values({ wamid: m.wamid, telefono: m.telefono, enviadoEn: new Date(m.enviadoEn), boton: m.boton })
    .onConflictDoNothing()
    .returning({ wamid: esquema.mensajesEntrantes.wamid })
  if (!reclamo) return

  const r = await repartir(m)
  switch (r.tipo) {
    case 'dueno':
      await guardarEnElHilo(r.ctx.negocio, r.ctx.dueno, 'dueno', mensajeDelDuenoEnTexto(m.texto))
      return
    case 'cliente':
      await atenderMensaje(m, r.negocio)
      return
    case 'preguntar':
      await despachar(
        intencion.aviso({
          destinatario: { tipo: 'telefono', telefono: m.telefono, negocio: r.por === 'otro_negocio' ? r.actual.id : null },
          aviso: r.por === 'otro_negocio' ? { cual: 'otro_negocio', actual: r.actual.nombre, nuevo: r.nuevo.nombre } : { cual: 'sin_negocio' },
          enRespuestaA: m.wamid,
        }),
      )
      return
  }
}
