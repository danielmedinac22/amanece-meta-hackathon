import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { traerCasoAlDueno } from '@/agentes/avisos'
import { registrarTurno } from '@/negocio/medir'
import type { MensajeEntrante } from '../entrada'
import { leerEstado, NegocioInexistente, otrosNegocios, type EstadoVigente } from '../estado'
import { claveDeProducto, comoMonto } from '../estado/elementos'
import { marcar, type CasoId, type NegocioId } from '../identidad'
import { despachar, intencion, type AlCliente } from '../salida'
import { entornoReal, turno, type ClienteDelTurno } from './turno'

const HISTORIAL = 20
const PEDIDO_ABIERTO: ReadonlySet<string> = new Set(['pendiente', 'confirmado', 'enviado'] satisfies (typeof esquema.ESTADOS_DE_PEDIDO)[number][])

/** El único que junta `turno` y `despachar`. Nunca lanza por el turno: el Cliente recibe el aviso `falla_tecnica`. */
export async function atenderMensaje(m: MensajeEntrante, negocio: NegocioId): Promise<void> {
  let estado: EstadoVigente
  try {
    estado = await leerEstado(negocio)
  } catch (e) {
    if (e instanceof NegocioInexistente) return void console.error('[atender] el Negocio ya no está', negocio, m.wamid)
    console.error('[atender] no pude leer el Negocio', negocio, e)
    await despachar(intencion.aviso({ destinatario: { tipo: 'telefono', telefono: m.telefono, negocio }, aviso: { cual: 'falla_tecnica' }, enRespuestaA: m.wamid }))
    return
  }
  switch (estado.identidad.modo) {
    case 'en_sombra':
      return
    case 'armando':
      await despachar(intencion.aviso({ destinatario: { tipo: 'telefono', telefono: m.telefono, negocio }, aviso: { cual: 'negocio_armando' }, enRespuestaA: m.wamid }))
      return
    case 'atendiendo':
      break
  }
  if (estado.version === 0) {
    // Abierto y sin un solo Elemento: se desplegó antes de correr a-elementos. Atenderlo sería vender sin catálogo.
    console.error('[atender] Negocio atendiendo sin Elementos: falta correr scripts/a-elementos.mts', negocio, estado.identidad.codigo, m.wamid)
    await despachar(intencion.aviso({ destinatario: { tipo: 'telefono', telefono: m.telefono, negocio }, aviso: { cual: 'falla_tecnica' }, enRespuestaA: m.wamid }))
    return
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
    .returning({ id: esquema.clientes.id, nombre: esquema.clientes.nombre, telefono: esquema.clientes.telefono })

  // Cubre un wamid que ya se atendió antes de que existiera el reclamo en `mensajes_entrantes`.
  const [guardado] = await db
    .insert(esquema.mensajesCliente)
    .values({ negocioId: negocio, clienteId: cliente.id, rol: 'cliente', texto: m.texto, wamid: m.wamid })
    .onConflictDoNothing({ target: esquema.mensajesCliente.wamid })
    .returning({ id: esquema.mensajesCliente.id })
  if (!guardado) return

  const destinatario: AlCliente = { tipo: 'cliente', negocio, cliente: marcar.cliente(cliente.id) }
  let casos: readonly CasoId[] = []
  try {
    const [anteriores, pedidos] = await db.batch([
      db
        .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto })
        .from(esquema.mensajesCliente)
        .where(and(eq(esquema.mensajesCliente.clienteId, cliente.id), ne(esquema.mensajesCliente.id, guardado.id)))
        .orderBy(desc(esquema.mensajesCliente.creado))
        .limit(HISTORIAL),
      db
        .select()
        .from(esquema.pedidos)
        .where(and(eq(esquema.pedidos.negocioId, negocio), eq(esquema.pedidos.clienteId, cliente.id)))
        .orderBy(desc(esquema.pedidos.creado))
        .limit(5),
    ])
    const delTurno: ClienteDelTurno = {
      id: destinatario.cliente,
      nombre: cliente.nombre,
      telefono: cliente.telefono,
      pedidos: pedidos.map((p) => ({
        numero: p.numero,
        total: comoMonto(p.total),
        estado: p.estado,
        resumen: `${p.items.map((i) => `${i.cantidad} x ${i.nombre}`).join(', ')}; ${p.ciudad}, ${p.direccion}`,
        paraReglas: PEDIDO_ABIERTO.has(p.estado) ? { borrador: { items: p.items.map((i) => ({ producto: claveDeProducto.deId(i.productoId), cantidad: i.cantidad })), ciudad: p.ciudad }, total: comoMonto(p.total) } : null,
      })),
    }
    const conversacion = { cliente: delTurno, historial: anteriores.reverse(), mensaje: { texto: m.texto, wamid: m.wamid, enviadoEn: marcar.instante(enviadoEn) } }
    const t = await turno(estado, conversacion, entornoReal(estado, delTurno.id, await otrosNegocios(estado)))
    casos = t.casosAbiertos
    // Para medir cuánto frena el núcleo: solo ids y códigos, nunca texto ni teléfono.
    console.info(
      '[atender] turno',
      JSON.stringify({
        wamid: m.wamid,
        negocio,
        corregido: t.corregido,
        revision: t.revision.tipo === 'corregir' ? t.revision.motivos : [],
        violaciones: t.violaciones.map((v) => v.efecto),
        reglas: t.reglasActivas,
      }),
    )
    const salida = await despachar(t.intencion)
    if (salida.tipo === 'por_enviar') throw new Error(`Kapso no tomó la respuesta: ${salida.error}`)
    if (salida.tipo === 'no_salio') console.error('[atender] la respuesta no salió', m.wamid, salida.motivo)
    await registrarTurno('clientes', negocio, { inputTokens: t.gasto.entrada, outputTokens: t.gasto.salida }, t.gasto.ms).catch((e) => console.error('[atender] no se pudo registrar el turno', e))
  } catch (error) {
    console.error('[atender] no se pudo responder', error)
    await despachar(intencion.aviso({ destinatario, aviso: { cual: 'falla_tecnica' }, enRespuestaA: m.wamid })).catch((e) => console.error('[atender] tampoco el aviso', e))
  }
  // Después de responderle al Cliente: lo que el Agente del dueño tarda en armar no frena la respuesta.
  for (const caso of casos) await traerCasoAlDueno(negocio, caso).catch((e) => console.error('[atender] no pude traer el Caso al Dueño', caso, e))
}
