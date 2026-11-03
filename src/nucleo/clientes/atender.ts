import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { traerCasoAlDueno } from '@/agentes/avisos'
import { guardarEnElHilo, mensajeDelAgente } from '@/negocio/dueno-hilo'
import { registrarTurno } from '@/negocio/medir'
import type { MensajeEntrante } from '../entrada'
import { leerPublicado, NegocioInexistente, otrosNegocios, type EstadoPublicado } from '../estado'
import { marcar, type CasoId, type ClienteId, type NegocioId } from '../identidad'
import { nombreDelCliente } from '../listas-palabras'
import { despachar, intencion, type AlCliente, type DelAgente } from '../salida'
import { alEntrar, alNacer, quienLaTiene, soltarLasVencidas, type Soltada } from '../salida/atencion'
import { fueraDeVentana } from '../salida/compuerta'
import { entornoReal, pedidoDelCliente, turno, type ClienteDelTurno, type Conversacion, type Motores } from './turno'

const HISTORIAL = 20

/** El único que junta `turno` y `despachar`. Nunca lanza por el turno: el Cliente recibe el aviso `falla_tecnica`. */
export async function atenderMensaje(m: MensajeEntrante, negocio: NegocioId, motores?: Motores): Promise<void> {
  let estado: EstadoPublicado
  try {
    estado = await leerPublicado(negocio)
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
    .values({ negocioId: negocio, telefono: m.telefono, nombre: m.nombre, ultimoMensajeEntrante: enviadoEn, ...alNacer(m.wamid) })
    .onConflictDoUpdate({
      target: [esquema.clientes.negocioId, esquema.clientes.telefono],
      set: {
        // Meta puede entregar fuera de orden: un mensaje viejo no achica la ventana.
        ultimoMensajeEntrante: sql`greatest(${esquema.clientes.ultimoMensajeEntrante}, excluded.ultimo_mensaje_entrante)`,
        nombre: sql`case when ${esquema.clientes.nombre} = '' then ${m.nombre} else ${esquema.clientes.nombre} end`,
        ...alEntrar(m.wamid),
      },
    })
    .returning({ id: esquema.clientes.id, nombre: esquema.clientes.nombre, telefono: esquema.clientes.telefono, vez: esquema.clientes.vecesTomada, tiene: esquema.clientes.tomadaPor })

  // Cubre un wamid que ya se atendió antes de que existiera el reclamo en `mensajes_entrantes`.
  const [guardado] = await db
    .insert(esquema.mensajesCliente)
    .values({ negocioId: negocio, clienteId: cliente.id, rol: 'cliente', texto: m.texto, wamid: m.wamid })
    .onConflictDoNothing({ target: esquema.mensajesCliente.wamid })
    .returning({ id: esquema.mensajesCliente.id })
  if (!guardado) return

  if (cliente.tiene) await avisarAlQueLaTiene(negocio, cliente.tiene, marcar.cliente(cliente.id), mensajeDeLaToma())
  else
    await correrTurno(
      estado,
      { id: marcar.cliente(cliente.id), nombre: cliente.nombre, telefono: cliente.telefono },
      { texto: m.texto, wamid: m.wamid, enviadoEn: marcar.instante(enviadoEn) },
      guardado.id,
      { tipo: 'agente', vez: marcar.vez(cliente.vez), debida: false },
      motores,
    )
  // Otro Cliente del Negocio le presta el reloj a una toma vencida: no hay cron.
  await soltarVencidas(negocio, 1, motores).catch((e) => console.error('[atender] no pude soltar las tomas vencidas', negocio, e))
}

type ClienteDelMensaje = { readonly id: ClienteId; readonly nombre: string; readonly telefono: string }

/** `nadie`: el Cliente se quedó sin respuesta y el Dueño no lo sabe. Con esto, quien sí sabe a quién contarle se lo cuenta. */
type Desenlace = 'atendido' | 'nadie'

/** Un solo camino para el turno del webhook y el de lo debido. Nunca lanza por el turno: el Cliente recibe `falla_tecnica`, salvo que ya no le toque al agente. */
async function correrTurno(estado: EstadoPublicado, cliente: ClienteDelMensaje, mensaje: Conversacion['mensaje'], sinContar: string, habla: DelAgente, motores?: Motores): Promise<Desenlace> {
  const negocio = estado.identidad.id
  const destinatario: AlCliente = { tipo: 'cliente', negocio, cliente: cliente.id }
  const avisar = async (texto: string) => {
    const tiene = await quienLaTiene(cliente.id)
    if (tiene) await avisarAlQueLaTiene(negocio, tiene, cliente.id, texto)
  }
  let casos: readonly CasoId[] = []
  let entorno: ReturnType<typeof entornoReal> | null = null
  let kapsoFallo = false
  let desenlace: Desenlace = 'atendido'
  try {
    const [anteriores, pedidos] = await db.batch([
      db
        .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto })
        .from(esquema.mensajesCliente)
        .where(and(eq(esquema.mensajesCliente.clienteId, cliente.id), ne(esquema.mensajesCliente.id, sinContar)))
        .orderBy(desc(esquema.mensajesCliente.creado))
        .limit(HISTORIAL),
      db
        .select()
        .from(esquema.pedidos)
        .where(and(eq(esquema.pedidos.negocioId, negocio), eq(esquema.pedidos.clienteId, cliente.id)))
        .orderBy(desc(esquema.pedidos.creado))
        .limit(5),
    ])
    const delTurno: ClienteDelTurno = { ...cliente, pedidos: pedidos.map(pedidoDelCliente) }
    const conversacion = { cliente: delTurno, historial: anteriores.reverse(), mensaje }
    entorno = entornoReal(estado, cliente.id, await otrosNegocios(estado), habla)
    const t = await turno(estado, conversacion, entorno, motores)
    casos = t.casosAbiertos
    // Para medir cuánto frena el núcleo: solo ids y códigos, nunca texto ni teléfono.
    console.info(
      '[atender] turno',
      JSON.stringify({
        wamid: mensaje.wamid,
        negocio,
        corregido: t.corregido,
        revision: t.revision.tipo === 'corregir' ? t.revision.motivos : [],
        violaciones: t.violaciones.map((v) => v.efecto),
        reglas: t.reglasActivas,
      }),
    )
    const salida = await despachar(t.intencion)
    if (salida.tipo === 'por_enviar') {
      kapsoFallo = true
      throw new Error(`Kapso no tomó la respuesta: ${salida.error}`)
    }
    if (salida.tipo === 'no_salio' && salida.motivo === 'no_le_toca') await avisar(mensajeDeLaToma(entorno.hizoAlgo()))
    // En lo debido, este motivo dice que ya se encargó otro: el Cliente volvió a escribir o el Dueño le contestó.
    else if (salida.tipo === 'no_salio' && !(habla.debida && salida.motivo === 'una_respuesta_por_mensaje')) {
      console.error('[atender] la respuesta no salió', mensaje.wamid, salida.motivo)
      desenlace = 'nadie'
    }
    await registrarTurno('clientes', negocio, { inputTokens: t.gasto.entrada, outputTokens: t.gasto.salida }, t.gasto.ms).catch((e) => console.error('[atender] no se pudo registrar el turno', e))
  } catch (error) {
    console.error('[atender] no se pudo responder', error)
    // Sin `debida`: esa marca haría cumplir `una_respuesta_por_mensaje`, y con el reclamo ya hecho no saldría nunca.
    const aviso = await despachar(intencion.aviso({ destinatario, habla: { ...habla, debida: false }, aviso: { cual: 'falla_tecnica' }, enRespuestaA: mensaje.wamid })).catch((e) => void console.error('[atender] tampoco el aviso', e))
    if (aviso?.tipo === 'no_salio' && aviso.motivo === 'no_le_toca') {
      // No se reintenta lo que Kapso no tomó: una excepción puede llegar después de que aceptó, y serían dos respuestas.
      await avisar(kapsoFallo ? 'WhatsApp no tomó la respuesta de tu agente a un Cliente de la conversación que tienes tomada. Escríbele tú.' : mensajeDeLaToma(entorno?.hizoAlgo() ?? false)).catch((e) => console.error('[atender] no pude avisarle al Dueño', e))
    } else if (aviso?.tipo !== 'simulado' && aviso?.tipo !== 'enviado') desenlace = 'nadie'
  }
  // Después de responderle al Cliente: lo que el Agente del dueño tarda en armar no frena la respuesta.
  for (const caso of casos) await traerCasoAlDueno(negocio, caso).catch((e) => console.error('[atender] no pude traer el Caso al Dueño', caso, e))
  return desenlace
}

/** Texto fijo: lo que escribe el Cliente, y su nombre, no entran a lo que lee el modelo. */
const mensajeDeLaToma = (hizoAlgo = false) =>
  [
    'Un Cliente te escribió en la conversación que tienes tomada. Tu agente no le contesta. Si la conversación vuelve a él sin que le respondas, le contesta cuando abras el Panel o cuando escriba de nuevo.',
    hizoAlgo ? 'Antes de que la tomaras, tu agente alcanzó a hacer algo por este Cliente. Revisa Pedidos y Casos.' : '',
  ]
    .filter(Boolean)
    .join(' ')

/** Solo a quien la tiene: es el único que puede responder. `parteDeDatosParaElModelo` no conoce `data-toma`, así que el modelo no ve el nombre. */
async function avisarAlQueLaTiene(negocio: NegocioId, dueno: string, cliente: ClienteId, texto: string): Promise<void> {
  const [c] = await db.select({ nombre: esquema.clientes.nombre, telefono: esquema.clientes.telefono }).from(esquema.clientes).where(eq(esquema.clientes.id, cliente))
  await guardarEnElHilo(negocio, dueno, 'agente', mensajeDelAgente(texto, [{ type: 'data-toma', data: { cliente, nombre: c ? nombreDelCliente(c.nombre, c.telefono) : '' } }]))
}

/**
 * Cobra lo que dejó sin contestar una toma que ya se soltó. Aquí no llega nadie más: solo quien ganó `soltar`, así que si
 * no se puede, nadie más lo va a intentar y quien la tenía tiene que saberlo.
 */
export async function atenderLoDebido(s: Soltada, motores?: Motores): Promise<void> {
  if (!s.debe) return
  const contar = (texto: string) => (s.laTenia ? avisarAlQueLaTiene(s.negocio, s.laTenia, s.cliente, texto) : Promise.resolve())
  const SIN_RESPUESTA = 'Tu conversación volvió a tu agente, pero no pudo contestarle a un Cliente. Escríbele tú, o tu agente le contesta cuando vuelva a escribir.'
  if (fueraDeVentana(s.ultimoEntrante ? marcar.instante(s.ultimoEntrante) : null, marcar.instante(new Date()))) {
    return contar('Tu conversación volvió a tu agente y un Cliente quedó sin respuesta. Ya pasaron 24 horas: WhatsApp no deja escribirle hasta que vuelva a escribir.')
  }
  try {
    const estado = await leerPublicado(s.negocio)
    if (estado.identidad.modo !== 'atendiendo' || estado.version === 0) return await contar(SIN_RESPUESTA)
    const [[cliente], [mensaje]] = await db.batch([
      db.select({ nombre: esquema.clientes.nombre, telefono: esquema.clientes.telefono }).from(esquema.clientes).where(and(eq(esquema.clientes.id, s.cliente), eq(esquema.clientes.negocioId, s.negocio))),
      db.select({ id: esquema.mensajesCliente.id, texto: esquema.mensajesCliente.texto, creado: esquema.mensajesCliente.creado }).from(esquema.mensajesCliente).where(and(eq(esquema.mensajesCliente.wamid, s.debe), eq(esquema.mensajesCliente.clienteId, s.cliente))),
    ])
    if (!cliente || !mensaje) return await contar(SIN_RESPUESTA)
    const desenlace = await correrTurno(estado, { id: s.cliente, ...cliente }, { texto: mensaje.texto, wamid: s.debe, enviadoEn: marcar.instante(mensaje.creado) }, mensaje.id, { tipo: 'agente', vez: s.vez, debida: true }, motores)
    if (desenlace === 'nadie') await contar(SIN_RESPUESTA)
  } catch (e) {
    console.error('[atender] no pude cobrar la deuda', s.cliente, e)
    await contar(SIN_RESPUESTA)
  }
}

/** Nada programado existe: la deuda de una toma vencida la cobra el sondeo del Hilo u otro mensaje del Negocio. */
export async function soltarVencidas(negocio: NegocioId, limite: number, motores?: Motores): Promise<void> {
  const sueltas = await soltarLasVencidas(negocio, limite)
  await Promise.allSettled(sueltas.map((s) => atenderLoDebido(s, motores).catch((e) => console.error('[atender] no pude cobrar la deuda', s.cliente, e))))
}
