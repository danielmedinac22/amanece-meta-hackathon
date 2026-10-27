import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { esperarTrabajosEnSegundoPlano, responderComoAgenteDeClientes } from '@/agentes/clientes'
import { enviarTexto, type MensajeEntrante } from '@/lib/kapso'

const VENTANA_MS = 24 * 60 * 60 * 1000
const HISTORIAL = 20

const SIN_NEGOCIO = '¿Con qué negocio quieres hablar? Escribe su código.'
const NEGOCIO_ARMANDO = 'Este negocio todavía no está listo para atender por aquí. Vuelve a escribirnos en un rato.'
const FALLA_TECNICA = 'Tuve un problema técnico y no pude responderte. ¿Me escribes de nuevo en un momento?'

/** Error de `enviarAlCliente`: `fuera_de_ventana` es la regla de las 24 horas de WhatsApp. */
export class ErrorDeEnvio extends Error {
  constructor(
    public codigo: 'fuera_de_ventana' | 'sin_cliente',
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeEnvio'
  }
}

/**
 * Único punto donde sale un texto hacia WhatsApp. Con `ENVIO_SIMULADO=1` no sale nada: solo se escribe
 * en el log, para probar el flujo completo sin tocar el número de Amanece.
 */
async function mandar(telefono: string, texto: string) {
  if (process.env.ENVIO_SIMULADO === '1') {
    console.log(`[envío simulado a ${telefono}] ${texto}`)
    return null
  }
  return enviarTexto(telefono, texto)
}

/**
 * Le escribe a un Cliente desde el número de Amanece y guarda el mensaje. Es la única puerta de salida
 * hacia un Cliente: rechaza si su último mensaje tiene más de 24 horas.
 */
export async function enviarAlCliente(clienteId: string, texto: string) {
  const [cliente] = await db.select().from(esquema.clientes).where(eq(esquema.clientes.id, clienteId))
  if (!cliente) throw new ErrorDeEnvio('sin_cliente', 'El Cliente no existe')

  const ultimo = cliente.ultimoMensajeEntrante?.getTime() ?? 0
  if (Date.now() - ultimo > VENTANA_MS) {
    throw new ErrorDeEnvio('fuera_de_ventana', 'Han pasado más de 24 horas desde el último mensaje del Cliente')
  }

  const wamid = await mandar(cliente.telefono, texto)
  await db.insert(esquema.mensajesCliente).values({
    negocioId: cliente.negocioId,
    clienteId: cliente.id,
    rol: 'agente',
    texto,
    wamid,
  })
  return { wamid }
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Los mensajes que ya vimos, para los casos en que no hay dónde guardarlos (aún no hay Negocio). */
const recientes = new Set<string>()

function recordar(wamid: string) {
  recientes.add(wamid)
  if (recientes.size > 500) recientes.delete(recientes.values().next().value!)
}

/**
 * Todo lo que pasa cuando un Cliente escribe: dedupe, a qué Negocio habla, su ficha, el Agente de
 * clientes y la respuesta. Si algo falla antes de responder, el Cliente recibe una disculpa.
 */
export async function recibirMensaje(m: MensajeEntrante) {
  // 1. Dedupe: Kapso reintenta, y el mismo wamid no se procesa dos veces.
  if (recientes.has(m.wamid)) return
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
    recordar(m.wamid)
    await mandar(m.telefono, negocio ? NEGOCIO_ARMANDO : SIN_NEGOCIO)
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
    await enviarAlCliente(cliente.id, respuesta.texto)
  } catch (error) {
    console.error('[whatsapp] no se pudo responder', error)
    await enviarAlCliente(cliente.id, FALLA_TECNICA).catch((e) => console.error('[whatsapp] tampoco la disculpa', e))
  } finally {
    // Lo que dejó el turno (por ejemplo, traer un Caso al Dueño) termina después de responderle al Cliente.
    await esperarTrabajosEnSegundoPlano()
  }
}
