import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { esperarTrabajosEnSegundoPlano, responderComoAgenteDeClientes } from '@/agentes/clientes'
import type { MensajeEntrante } from '../entrada'
import { marcar, modoDelNegocio, type NegocioId } from '../identidad'
import { despachar, intencion, type AlCliente } from '../salida'

const HISTORIAL = 20

/** El turno de un Cliente, ya repartido. Nunca lanza por el turno: el Cliente recibe el aviso `falla_tecnica`. */
export async function atenderMensaje(m: MensajeEntrante, negocio: NegocioId): Promise<void> {
  const [fila] = await db.select({ estado: esquema.negocios.estado }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio))
  switch (modoDelNegocio(fila.estado)) {
    case 'en_sombra':
      return
    case 'armando':
      await despachar(intencion.aviso({ destinatario: { tipo: 'telefono', telefono: m.telefono, negocio }, aviso: { cual: 'negocio_armando' }, enRespuestaA: m.wamid }))
      return
    case 'atendiendo':
      break
  }

  const enviadoEn = new Date(m.enviadoEn)
  const [cliente] = await db
    .insert(esquema.clientes)
    .values({ negocioId: negocio, telefono: m.telefono, nombre: m.nombre, ultimoMensajeEntrante: enviadoEn })
    .onConflictDoUpdate({
      target: [esquema.clientes.negocioId, esquema.clientes.telefono],
      set: {
        // Meta puede entregar fuera de orden: un mensaje viejo no achica la ventana.
        ultimoMensajeEntrante: sql`greatest(${esquema.clientes.ultimoMensajeEntrante}, excluded.ultimo_mensaje_entrante)`,
        nombre: sql`case when ${esquema.clientes.nombre} = '' then ${m.nombre} else ${esquema.clientes.nombre} end`,
      },
    })
    .returning({ id: esquema.clientes.id })

  // Cubre un wamid que ya se atendió antes de que existiera el reclamo en `mensajes_entrantes`.
  const [guardado] = await db
    .insert(esquema.mensajesCliente)
    .values({ negocioId: negocio, clienteId: cliente.id, rol: 'cliente', texto: m.texto, wamid: m.wamid })
    .onConflictDoNothing({ target: esquema.mensajesCliente.wamid })
    .returning({ id: esquema.mensajesCliente.id })
  if (!guardado) return

  const destinatario: AlCliente = { tipo: 'cliente', negocio, cliente: marcar.cliente(cliente.id) }
  try {
    const anteriores = await db
      .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto })
      .from(esquema.mensajesCliente)
      .where(and(eq(esquema.mensajesCliente.clienteId, cliente.id), ne(esquema.mensajesCliente.id, guardado.id)))
      .orderBy(desc(esquema.mensajesCliente.creado))
      .limit(HISTORIAL)
    const respuesta = await responderComoAgenteDeClientes({ negocioId: negocio, clienteId: cliente.id, historial: anteriores.reverse(), texto: m.texto, modo: 'real' })
    const salida = await despachar(intencion.respuesta({ destinatario, texto: respuesta.texto, enRespuestaA: m.wamid }))
    if (salida.tipo === 'por_enviar') throw new Error(`Kapso no tomó la respuesta: ${salida.error}`)
    if (salida.tipo === 'no_salio') console.error('[atender] la respuesta no salió', m.wamid, salida.motivo)
  } catch (error) {
    console.error('[atender] no se pudo responder', error)
    await despachar(intencion.aviso({ destinatario, aviso: { cual: 'falla_tecnica' }, enRespuestaA: m.wamid })).catch((e) => console.error('[atender] tampoco el aviso', e))
  } finally {
    // Lo que dejó el turno (traer un Caso al Dueño) termina después de responderle al Cliente.
    await esperarTrabajosEnSegundoPlano()
  }
}
