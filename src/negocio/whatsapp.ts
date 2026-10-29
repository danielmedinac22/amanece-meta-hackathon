import { randomUUID } from 'node:crypto'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { esperarTrabajosEnSegundoPlano, responderComoAgenteDeClientes } from '@/agentes/clientes'
import { type MensajeEntrante } from '@/lib/kapso'
import { marcar } from '@/nucleo/identidad'
import { despachar, intencion } from '@/nucleo/salida'
import { VENTANA_MS } from '@/nucleo/salida/compuerta'

const HISTORIAL = 20

/** `no_salio`: otra regla de la compuerta frenó el mensaje, cuando haga cumplir. */
export class ErrorDeEnvio extends Error {
  constructor(
    public codigo: 'fuera_de_ventana' | 'sin_cliente' | 'no_salio',
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeEnvio'
  }
}

/**
 * La respuesta del Dueño a un Caso (`resolver_caso`), hasta la demo. Revisa la ventana por su cuenta antes de
 * despachar para que, mientras la compuerta observa, `resolver_caso` siga recibiendo `fuera_de_ventana` y no
 * salga nada, como antes.
 */
export async function enviarAlCliente(clienteId: string, texto: string): Promise<{ wamid: string | null }> {
  const [cliente] = await db
    .select({ negocioId: esquema.clientes.negocioId, ultimo: esquema.clientes.ultimoMensajeEntrante })
    .from(esquema.clientes)
    .where(eq(esquema.clientes.id, clienteId))
  if (!cliente) throw new ErrorDeEnvio('sin_cliente', 'El Cliente no existe')
  if (Date.now() - (cliente.ultimo?.getTime() ?? 0) > VENTANA_MS) {
    throw new ErrorDeEnvio('fuera_de_ventana', 'Han pasado más de 24 horas desde el último mensaje del Cliente')
  }

  const r = await despachar(
    intencion.resolucionDeCaso({
      destinatario: { tipo: 'cliente', negocio: marcar.negocio(cliente.negocioId), cliente: marcar.cliente(clienteId) },
      texto,
      caso: null,
      vez: randomUUID(),
    }),
  )
  switch (r.tipo) {
    case 'enviado':
      return { wamid: r.wamid }
    case 'simulado':
      return { wamid: null }
    case 'no_salio':
      if (r.motivo === 'fuera_de_ventana') throw new ErrorDeEnvio('fuera_de_ventana', 'Han pasado más de 24 horas desde el último mensaje del Cliente')
      throw new ErrorDeEnvio('no_salio', `La compuerta no lo dejó salir: ${r.motivo}`)
    case 'por_enviar':
      throw new Error(`Kapso no tomó el mensaje: ${r.error}`)
  }
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Todo lo que pasa cuando un Cliente escribe: dedupe, a qué Negocio habla, su ficha, el Agente de
 * clientes y la respuesta. Si algo falla antes de responder, el Cliente recibe una disculpa.
 */
export async function recibirMensaje(m: MensajeEntrante) {
  // 1. Dedupe: Kapso reintenta, y el mismo wamid no se procesa dos veces.
  const wamid = marcar.wamid(m.wamid)
  const [repetido] = await db
    .select({ id: esquema.mensajesCliente.id })
    .from(esquema.mensajesCliente)
    .where(eq(esquema.mensajesCliente.wamid, m.wamid))
  if (repetido) return

  // 2. A qué Negocio le habla: por el código en el texto, o por la sesión que ya tenía.
  const negocios = await db.select().from(esquema.negocios)
  const porCodigo = negocios
    .filter((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(n.codigo)}($|[^\\p{L}\\p{N}])`, 'iu').test(m.texto))
    .sort((a, b) => b.codigo.length - a.codigo.length)[0]

  let negocio: (typeof negocios)[number] | undefined = porCodigo
  if (porCodigo) {
    await db
      .insert(esquema.sesionesWhatsapp)
      .values({ telefono: m.telefono, negocioId: porCodigo.id })
      .onConflictDoUpdate({
        target: esquema.sesionesWhatsapp.telefono,
        set: { negocioId: porCodigo.id, actualizado: new Date() },
      })
  } else {
    const [sesion] = await db.select().from(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, m.telefono))
    negocio = negocios.find((n) => n.id === sesion?.negocioId)
  }

  if (!negocio || negocio.estado === 'armando') {
    await despachar(
      intencion.aviso({
        destinatario: { tipo: 'telefono', telefono: m.telefono, negocio: negocio ? marcar.negocio(negocio.id) : null },
        aviso: { cual: negocio ? 'negocio_armando' : 'sin_negocio' },
        enRespuestaA: wamid,
      }),
    )
    return
  }

  // 3. La ficha del Cliente en este Negocio; su mensaje abre la ventana de 24 horas.
  const [cliente] = await db
    .insert(esquema.clientes)
    .values({ negocioId: negocio.id, telefono: m.telefono, nombre: m.nombre, ultimoMensajeEntrante: new Date() })
    .onConflictDoUpdate({
      target: [esquema.clientes.negocioId, esquema.clientes.telefono],
      set: {
        ultimoMensajeEntrante: new Date(),
        nombre: sql`case when ${esquema.clientes.nombre} = '' then ${m.nombre} else ${esquema.clientes.nombre} end`,
      },
    })
    .returning()

  // 4. Guarda el mensaje; si el wamid ya estaba, otro proceso lo está atendiendo.
  const [guardado] = await db
    .insert(esquema.mensajesCliente)
    .values({ negocioId: negocio.id, clienteId: cliente.id, rol: 'cliente', texto: m.texto, wamid: m.wamid })
    .onConflictDoNothing({ target: esquema.mensajesCliente.wamid })
    .returning({ id: esquema.mensajesCliente.id })
  if (!guardado) return

  const destinatario = { tipo: 'cliente', negocio: marcar.negocio(negocio.id), cliente: marcar.cliente(cliente.id) } as const
  try {
    // 5. Los últimos mensajes, sin el de ahora, que va aparte como `texto`.
    const anteriores = await db
      .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto })
      .from(esquema.mensajesCliente)
      .where(and(eq(esquema.mensajesCliente.clienteId, cliente.id), ne(esquema.mensajesCliente.id, guardado.id)))
      .orderBy(desc(esquema.mensajesCliente.creado))
      .limit(HISTORIAL)

    // 6. El Agente de clientes.
    const respuesta = await responderComoAgenteDeClientes({
      negocioId: negocio.id,
      clienteId: cliente.id,
      historial: anteriores.reverse(),
      texto: m.texto,
      modo: 'real',
    })

    // 7 y 8. Sale por la puerta única, que también guarda el mensaje.
    await despachar(intencion.respuesta({ destinatario, texto: respuesta.texto, enRespuestaA: wamid }))
  } catch (error) {
    console.error('[whatsapp] no se pudo responder', error)
    await despachar(intencion.aviso({ destinatario, aviso: { cual: 'falla_tecnica' }, enRespuestaA: wamid })).catch((e) => console.error('[whatsapp] tampoco la disculpa', e))
  } finally {
    // Lo que dejó el turno (por ejemplo, traer un Caso al Dueño) termina después de responderle al Cliente.
    await esperarTrabajosEnSegundoPlano()
  }
}
