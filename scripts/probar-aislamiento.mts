/**
 * Aislamiento, prueba permanente de `pnpm probar`. Un mismo teléfono P es Dueño de Café Ladera y Cliente de
 * Panadería Trigo y Leña, y cada mensaje cae solo donde debe. Llama al modelo una vez, en el turno de P como
 * Cliente de TRIGO. Lo que la corrida crea se borra al final.
 *
 *   pnpm tsx scripts/probar-aislamiento.mts
 */
import { config } from 'dotenv'
import { and, eq, gte, inArray, like, sql } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { afirmar, capturarEnvios, capturarErrores, eventoDeKapso, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()

const { db, esquema } = await import('../src/db')
const { leerMensajeEntrante, recibirMensaje } = await import('../src/nucleo/entrada')

const inicio = new Date()
const marca = String(Date.now()).slice(-8)
const P = `5730${marca}`
const prefijo = `wamid.AISLAMIENTO.${marca}.`
const entrante = (n: string, texto: string) => leerMensajeEntrante(eventoDeKapso({ wamid: `${prefijo}${n}`, telefono: P, texto, nombre: 'Dueña de Ladera' }))!
let duenoId: string | undefined
let trigoId: string | undefined

async function huellaDeLosDemas(negocio: string): Promise<string> {
  const { rows } = await db.execute(sql`select
    (select count(*) from clientes where negocio_id = ${negocio} and telefono <> ${P}) as clientes,
    (select count(*) from mensajes_cliente m join clientes c on c.id = m.cliente_id where m.negocio_id = ${negocio} and c.telefono <> ${P}) as mensajes,
    (select count(*) from pedidos p join clientes c on c.id = p.cliente_id where p.negocio_id = ${negocio} and c.telefono <> ${P}) as pedidos,
    (select count(*) from casos k left join clientes c on c.id = k.cliente_id where k.negocio_id = ${negocio} and c.telefono is distinct from ${P}) as casos,
    (select count(*) from mensajes_salientes where negocio_id = ${negocio} and telefono is distinct from ${P}) as salientes,
    (select count(*) from sesiones_whatsapp where negocio_id = ${negocio} and telefono <> ${P}) as sesiones,
    (select count(*) from mensajes_dueno where negocio_id = ${negocio}) as hilos`)
  return JSON.stringify(rows[0])
}

async function limpiar() {
  const fichas = (await db.select({ id: esquema.clientes.id }).from(esquema.clientes).where(and(eq(esquema.clientes.telefono, P), gte(esquema.clientes.creado, inicio)))).map((c) => c.id)
  if (fichas.length) {
    // Un Caso no se va con su Cliente (set null): se borra antes, con su aviso en los Hilos del Negocio.
    const casos = (await db.select({ id: esquema.casos.id }).from(esquema.casos).where(inArray(esquema.casos.clienteId, fichas))).map((c) => c.id)
    if (casos.length) {
      const hilo = await db.select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(gte(esquema.mensajesDueno.creado, inicio))
      const avisos = hilo.filter((m) => casos.some((id) => JSON.stringify(m.mensaje).includes(id))).map((m) => m.id)
      if (avisos.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, avisos))
      await db.delete(esquema.casos).where(inArray(esquema.casos.id, casos))
    }
    await db.delete(esquema.clientes).where(inArray(esquema.clientes.id, fichas))
  }
  if (duenoId) await db.delete(esquema.duenos).where(eq(esquema.duenos.id, duenoId))
  if (trigoId) await db.delete(esquema.turnos).where(and(eq(esquema.turnos.negocioId, trigoId), eq(esquema.turnos.agente, 'clientes'), gte(esquema.turnos.creado, inicio)))
  await db.delete(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, P))
  await db.delete(esquema.mensajesSalientes).where(and(eq(esquema.mensajesSalientes.telefono, P), gte(esquema.mensajesSalientes.creado, inicio)))
  await db.delete(esquema.mensajesEntrantes).where(like(esquema.mensajesEntrantes.wamid, `${prefijo}%`))
}

try {
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  const [trigo] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
  if (!ladera || !trigo) throw new Error('Falta sembrar LADERA y TRIGO: pnpm tsx scripts/sembrar.mts')
  trigoId = trigo.id
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: ladera.id, usuarioId: `prueba-aislamiento-${marca}`, nombre: 'Dueña de prueba', telefono: P }).returning()
  duenoId = dueno.id

  const hilo = () => db.select().from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, dueno.id))
  const fichaEn = async (negocio: string) => (await db.select().from(esquema.clientes).where(and(eq(esquema.clientes.negocioId, negocio), eq(esquema.clientes.telefono, P))))[0]
  const sesionDeP = async () => (await db.select().from(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, P)))[0]?.negocioId ?? null
  const enviosAP = (desde: number) => envios.slice(desde).filter((e) => e.telefono === P)
  const textoDe = (m: unknown) => ((m as UIMessage).parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('')
  const antesDeTrigo = await huellaDeLosDemas(trigo.id)

  console.log('\n=== 1. P con la ficha de TRIGO es Cliente de TRIGO ===')
  let desde = envios.length
  const m1 = entrante('1', '(TRIGO) Hola, ¿tienen pan de masa madre?')
  await recibirMensaje(m1)
  const enTrigo = await fichaEn(trigo.id)
  const mensajesEnTrigo = enTrigo ? await db.select().from(esquema.mensajesCliente).where(eq(esquema.mensajesCliente.clienteId, enTrigo.id)) : []
  afirmar('1 Cliente de TRIGO: P tiene ficha en TRIGO y su mensaje quedó ahí', enTrigo !== undefined && mensajesEnTrigo.some((m) => m.wamid === m1.wamid && m.rol === 'cliente' && m.negocioId === trigo.id), mensajesEnTrigo)
  afirmar('1 Cliente de TRIGO: salió un solo envío a P y quedó como fila agente en TRIGO', enviosAP(desde).length === 1 && mensajesEnTrigo.some((m) => m.rol === 'agente' && m.texto === enviosAP(desde)[0]?.texto), enviosAP(desde))
  const [salida1] = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, m1.wamid))
  afirmar('1 Cliente de TRIGO: la fila de salida es de TRIGO y de su Cliente', salida1?.negocioId === trigo.id && salida1.clienteId === enTrigo?.id && salida1.veredicto === 'sale', salida1)
  afirmar('1 Cliente de TRIGO: P no tiene ficha de Cliente en LADERA', (await fichaEn(ladera.id)) === undefined)
  afirmar('1 Cliente de TRIGO: el Hilo del Dueño de LADERA sigue vacío', (await hilo()).length === 0)
  afirmar('1 Cliente de TRIGO: la sesión de P quedó en TRIGO', (await sesionDeP()) === trigo.id)

  console.log('\n=== 2. El mismo teléfono sin ficha es el Dueño de LADERA ===')
  const mensajesEnTrigoAntes = mensajesEnTrigo.length
  desde = envios.length
  const m2 = entrante('2', '¿Cómo van los pedidos de hoy?')
  await recibirMensaje(m2)
  const hilo2 = await hilo()
  afirmar('2 Dueño de LADERA: su Hilo tiene un mensaje, del Dueño, con ese texto', hilo2.length === 1 && hilo2[0].rol === 'dueno' && textoDe(hilo2[0].mensaje) === m2.texto && hilo2[0].negocioId === ladera.id, hilo2)
  afirmar('2 Dueño de LADERA: TRIGO no tiene ningún mensaje nuevo de P', enTrigo !== undefined && (await db.$count(esquema.mensajesCliente, eq(esquema.mensajesCliente.clienteId, enTrigo.id))) === mensajesEnTrigoAntes)
  afirmar('2 Dueño de LADERA: P sigue sin ficha de Cliente en LADERA', (await fichaEn(ladera.id)) === undefined)
  afirmar('2 Dueño de LADERA: no sale nada por WhatsApp ni queda fila de salida', enviosAP(desde).length === 0 && (await db.$count(esquema.mensajesSalientes, eq(esquema.mensajesSalientes.enRespuestaA, m2.wamid))) === 0, enviosAP(desde))
  afirmar('2 Dueño de LADERA: la sesión de P sigue en TRIGO', (await sesionDeP()) === trigo.id)

  console.log('\n=== 3. Con la ficha de su propio Negocio sigue siendo el Dueño ===')
  desde = envios.length
  await recibirMensaje(entrante('3', '(LADERA) hola'))
  afirmar('3 ficha propia: el Hilo tiene otro mensaje del Dueño y P sigue sin ficha en LADERA', (await hilo()).length === 2 && (await fichaEn(ladera.id)) === undefined)
  afirmar('3 ficha propia: no sale nada por WhatsApp', enviosAP(desde).length === 0, enviosAP(desde))

  console.log('\n=== 4. Un reintento de Kapso de un mensaje del Dueño ===')
  desde = envios.length
  await recibirMensaje(entrante('2', '¿Cómo van los pedidos de hoy?'))
  afirmar('4 repetido del Dueño: el Hilo no cambia y no sale nada', (await hilo()).length === 2 && enviosAP(desde).length === 0)
  afirmar('4 repetido del Dueño: queda una sola fila en mensajes_entrantes con ese wamid', (await db.$count(esquema.mensajesEntrantes, eq(esquema.mensajesEntrantes.wamid, m2.wamid))) === 1)

  console.log('\n=== 5. TRIGO, menos lo de P, no se movió ===')
  const despuesDeTrigo = await huellaDeLosDemas(trigo.id)
  afirmar('5 TRIGO intacto: clientes, mensajes, pedidos, Casos, salidas, sesiones e Hilos de los demás', despuesDeTrigo === antesDeTrigo, { antesDeTrigo, despuesDeTrigo })
} catch (e) {
  afirmar('probar-aislamiento terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-aislamiento borró lo que creó', false, e))
  afirmar('probar-aislamiento no registró errores', errores.length === 0, errores)
  terminar()
}
