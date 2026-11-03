/**
 * Lo que leen Casos y Conversaciones, contra Neon real, con `ENVIO_SIMULADO=1` y sin modelo. Decidir un Caso por las
 * rutas del núcleo y leer los dos lugares: la Sección y el Hilo dicen lo mismo. Dos Negocios desechables con los mismos
 * nombres: nada del otro se cuela. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-casos.mts
 */
import { config } from 'dotenv'
import { eq, inArray } from 'drizzle-orm'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()

const { db, esquema } = await import('../src/db')
const { marcar } = await import('../src/nucleo/identidad')
const { aprobar, descartar, proponerRespuestaAlCaso } = await import('../src/nucleo/cambios')
const { CUANTOS_MENSAJES, CUANTAS_CONVERSACIONES, leerConversaciones } = await import('../src/nucleo/listas')
const { CUANTOS_CASOS, casosDe } = await import('../src/negocio/casos')
const { leerHiloConTarjetas } = await import('../src/negocio/dueno-chat')
const { guardarEnElHilo, mensajeDelAgente } = await import('../src/negocio/dueno-hilo')

const ZONA = 'America/Bogota'
const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const MINUTO = 60_000
const ahora = Date.now()
const hace = (ms: number) => new Date(ahora - ms)

async function negocioNuevo(sufijo: string) {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Casos ${sufijo}${marca}`, codigo: `CAS${sufijo}${marca}`, rubro: 'café', estado: 'listo' }).returning()
  creados.push(n.id)
  const [d] = await db.insert(esquema.duenos).values({ negocioId: n.id, usuarioId: `probar-casos-${sufijo}-${marca}`, nombre: `Dueño ${sufijo}` }).returning()
  return { negocio: n, dueno: d, ctx: { medio: 'web', negocio: marcar.negocio(n.id), dueno: marcar.dueno(d.id) } as const }
}

async function clienteNuevo(negocioId: string, nombre: string, i: number) {
  const [c] = await db.insert(esquema.clientes).values({ negocioId, nombre, telefono: `57${marca}${i}`, ultimoMensajeEntrante: new Date() }).returning()
  return c
}

const casoNuevo = async (negocioId: string, clienteId: string, titulo: string, atras = 10 * MINUTO) => (await db.insert(esquema.casos).values({ negocioId, clienteId, titulo, detalle: `Detalle de ${titulo}`, estado: 'esperando_dueno', creado: hace(atras) }).returning())[0]

/** Lo que hace el aviso de un Caso: una propuesta sin `pedido_por` y su tarjeta en el Hilo. */
async function traerAlHilo(negocioId: string, duenoId: string, casoId: string, texto: string) {
  const r = await proponerRespuestaAlCaso(casoId, texto)
  if (r.desenlace !== 'espera_al_dueno' || !r.tarjeta) throw new Error(`la respuesta dio ${r.desenlace}`)
  await guardarEnElHilo(negocioId, duenoId, 'agente', mensajeDelAgente('Aviso', [{ type: 'data-tarjeta', data: r.tarjeta }]))
  return r.tarjeta
}

try {
  const A = await negocioNuevo('A')
  const B = await negocioNuevo('B')
  const camila = await clienteNuevo(A.negocio.id, 'Camila Rojas', 1)
  const julian = await clienteNuevo(A.negocio.id, 'Julián Ramírez', 2)
  const sinNombre = await clienteNuevo(A.negocio.id, '', 3)
  const deB = await clienteNuevo(B.negocio.id, 'Camila Rojas', 4)

  console.log('Decidir desde cualquier lado deja lo mismo')
  const paraEnviar = await casoNuevo(A.negocio.id, camila.id, 'La bolsa llegó rota')
  const paraDescartar = await casoNuevo(A.negocio.id, julian.id, 'Pide factura', 20 * MINUTO)
  const sinRespuesta = await casoNuevo(A.negocio.id, sinNombre.id, 'Sin respuesta', 30 * MINUTO)
  const tEnviar = await traerAlHilo(A.negocio.id, A.dueno.id, paraEnviar.id, `Te la repongo sin costo (${marca}).`)
  const tDescartar = await traerAlHilo(A.negocio.id, A.dueno.id, paraDescartar.id, `Ya te confirmo (${marca}).`)

  const antes = await casosDe(A.ctx, ZONA)
  const casoDe = (datos: typeof antes, id: string) => datos.esperan.find((c) => c.id === id)
  afirmar('Espera tu decisión trae los tres, el más reciente primero', antes.esperan.map((c) => c.id).join() === [paraEnviar.id, paraDescartar.id, sinRespuesta.id].join() && antes.cuentaQueEspera === 3, antes.esperan.map((c) => c.titulo))
  const deLaSeccion = casoDe(antes, paraEnviar.id)!.decision
  afirmar('La tarjeta de la Sección es la misma del Hilo: propuesta, huella, vence y líneas', deLaSeccion?.tarjeta.propuesta === tEnviar.propuesta && deLaSeccion.tarjeta.huella === tEnviar.huella && Date.parse(deLaSeccion.tarjeta.vence) === Date.parse(tEnviar.vence) && JSON.stringify(deLaSeccion.tarjeta.lineas) === JSON.stringify(tEnviar.lineas) && deLaSeccion.tarjeta.accion === tEnviar.accion, { deLaSeccion, tEnviar })
  const hiloAntes = await leerHiloConTarjetas(A.ctx)
  afirmar('Antes de decidir, el estado es el mismo en los dos', JSON.stringify(deLaSeccion?.estado) === JSON.stringify(hiloAntes.tarjetas[tEnviar.propuesta]) && deLaSeccion?.estado.estado === 'espera_al_dueno', { seccion: deLaSeccion?.estado, hilo: hiloAntes.tarjetas[tEnviar.propuesta] })
  afirmar('Un Caso sin propuesta espera sin tarjeta y dice de quién es', casoDe(antes, sinRespuesta.id)!.decision === null && casoDe(antes, sinRespuesta.id)!.quien === `+57${marca}3`, casoDe(antes, sinRespuesta.id))

  const enviosAntes = envios.length
  // La huella que usa el botón de la Sección es la que se leyó para la Sección.
  const enviada = await aprobar(A.ctx, deLaSeccion!.tarjeta.propuesta, deLaSeccion!.tarjeta.huella)
  afirmar('Enviar con la tarjeta de la Sección sale una sola vez, simulado', enviada.tipo === 'aplicado' && enviada.envio?.tipo === 'simulado' && envios.length === enviosAntes + 1, enviada)
  const despues = await casosDe(A.ctx, ZONA)
  const hilo = await leerHiloConTarjetas(A.ctx)
  afirmar('Enviar lo saca de Espera tu decisión y lo pone en Resueltos con la respuesta', !casoDe(despues, paraEnviar.id) && despues.resueltos[0]?.id === paraEnviar.id && despues.resueltos[0].resolucion === `Te la repongo sin costo (${marca}).` && !despues.resueltos[0].noSalio, despues.resueltos)
  afirmar('El Hilo dice lo mismo: aplicada y por el mismo Dueño', hilo.tarjetas[tEnviar.propuesta]?.estado === 'aplicada' && hilo.tarjetas[tEnviar.propuesta]?.aprobadaPor === 'Dueño A', hilo.tarjetas[tEnviar.propuesta])
  afirmar('Enviar deja la respuesta en la conversación del Cliente', (await leerConversaciones(A.ctx.negocio, ZONA, camila.id)).detalle?.mensajes.at(-1)?.texto === `Te la repongo sin costo (${marca}).`)

  await descartar(A.ctx, tDescartar.propuesta)
  const conDescarte = await casosDe(A.ctx, ZONA)
  const hiloConDescarte = await leerHiloConTarjetas(A.ctx)
  const descartado = casoDe(conDescarte, paraDescartar.id)?.decision?.estado
  afirmar('Descartar lo deja esperando, con su tarjeta descartada', descartado?.estado === 'descartada', descartado)
  afirmar('El Hilo dice lo mismo', JSON.stringify(descartado) === JSON.stringify(hiloConDescarte.tarjetas[tDescartar.propuesta]), { descartado, hilo: hiloConDescarte.tarjetas[tDescartar.propuesta] })
  const nueva = await traerAlHilo(A.negocio.id, A.dueno.id, paraDescartar.id, `Otra respuesta (${marca}).`)
  const conNueva = casoDe(await casosDe(A.ctx, ZONA), paraDescartar.id)?.decision
  afirmar('Una respuesta nueva reemplaza a la descartada en la Sección', conNueva?.tarjeta.propuesta === nueva.propuesta && conNueva.estado.estado === 'espera_al_dueno', conNueva)

  console.log('\nUna respuesta aprobada que no salió')
  const noSalio = await casoNuevo(A.negocio.id, julian.id, 'No salió')
  await db.update(esquema.casos).set({ estado: 'resuelto', resolucion: 'No llegó', resuelto: new Date() }).where(eq(esquema.casos.id, noSalio.id))
  await db.insert(esquema.mensajesSalientes).values({ clave: `probar-casos-${marca}`, negocioId: A.negocio.id, clienteId: julian.id, casoId: noSalio.id, telefono: julian.telefono, clase: 'resolucion_de_caso', veredicto: 'no_sale', motivo: 'fuera_de_ventana', estado: 'no_salio' })
  const conFallo = await casosDe(A.ctx, ZONA)
  afirmar('Resueltos dice que no salió, y solo de ese', conFallo.resueltos.find((c) => c.id === noSalio.id)?.noSalio === true && conFallo.resueltos.find((c) => c.id === paraEnviar.id)?.noSalio === false, conFallo.resueltos)

  console.log('\nCasos: el aislamiento')
  const casoDeB = await casoNuevo(B.negocio.id, deB.id, 'Intruso de B')
  const tDeB = await traerAlHilo(B.negocio.id, B.dueno.id, casoDeB.id, 'Respuesta de B')
  const deA = await casosDe(A.ctx, ZONA)
  afirmar('Otro Negocio no se cuela en Casos', !JSON.stringify(deA).includes('Intruso de B') && !JSON.stringify(deA).includes(tDeB.propuesta), deA.esperan.map((c) => c.titulo))
  const deOtro = await casosDe(B.ctx, ZONA)
  afirmar('Otro Negocio tiene lo suyo', deOtro.esperan.length === 1 && deOtro.esperan[0].decision?.tarjeta.propuesta === tDeB.propuesta && deOtro.resueltos.length === 0, deOtro)
  // Lo que la base deja hacer aunque nada lo haga: un Caso de A a nombre de un Cliente de B no muestra su nombre.
  const cruzado = await casoNuevo(A.negocio.id, deB.id, 'Cliente ajeno')
  const conCruzado = await casosDe(A.ctx, ZONA)
  afirmar('Un Caso a nombre de un Cliente ajeno no trae ese nombre', casoDe(conCruzado, cruzado.id)?.quien === '', casoDe(conCruzado, cruzado.id))

  console.log('\nCuántos')
  const C = await negocioNuevo('C')
  await db.insert(esquema.casos).values(Array.from({ length: CUANTOS_CASOS + 3 }, (_, i) => ({ negocioId: C.negocio.id, titulo: `Abierto ${i}`, estado: 'abierto' as const, creado: hace(i * MINUTO) })))
  await db.insert(esquema.casos).values(Array.from({ length: CUANTOS_CASOS + 5 }, (_, i) => ({ negocioId: C.negocio.id, titulo: `Cerrado ${i}`, resolucion: 'Listo', estado: 'resuelto' as const, resuelto: hace(i * MINUTO) })))
  const muchos = await casosDe(C.ctx, ZONA)
  afirmar('Con más que el límite, las cuentas son las de verdad y vienen las más recientes', muchos.cuentaQueEspera === CUANTOS_CASOS + 3 && muchos.esperan.length === CUANTOS_CASOS && muchos.esperan[0].titulo === 'Abierto 0' && muchos.cuentaDeResueltos === CUANTOS_CASOS + 5 && muchos.resueltos.length === CUANTOS_CASOS && muchos.resueltos[0].titulo === 'Cerrado 0', { esperan: muchos.cuentaQueEspera, resueltos: muchos.cuentaDeResueltos })

  console.log('\nConversaciones')
  const D = await negocioNuevo('D')
  const paola = await clienteNuevo(D.negocio.id, 'Paola Rojas', 6)
  const santiago = await clienteNuevo(D.negocio.id, 'Santiago Herrera', 7)
  const anonimo = await clienteNuevo(D.negocio.id, '', 8)
  const callada = await clienteNuevo(D.negocio.id, 'Nunca escribió', 9)
  await db.insert(esquema.mensajesCliente).values([
    { negocioId: D.negocio.id, clienteId: paola.id, rol: 'cliente', texto: 'Primero de Paola', creado: hace(50 * MINUTO) },
    { negocioId: D.negocio.id, clienteId: paola.id, rol: 'agente', texto: 'Último de Paola', creado: hace(40 * MINUTO) },
    { negocioId: D.negocio.id, clienteId: santiago.id, rol: 'cliente', texto: 'Último de Santiago', creado: hace(5 * MINUTO) },
    { negocioId: D.negocio.id, clienteId: anonimo.id, rol: 'cliente', texto: 'Hola', creado: hace(90 * MINUTO) },
  ])
  await casoNuevo(D.negocio.id, paola.id, 'Caso de Paola')
  const lista = await leerConversaciones(D.ctx.negocio, ZONA)
  afirmar('La lista va de lo más reciente a lo más antiguo, con la última línea y el tiempo', lista.filas.map((f) => f.ultima).join('|') === 'Último de Santiago|Último de Paola|Hola' && lista.filas[0].hace === 'hace 5 min' && lista.filas[1].hace === 'hace 40 min', lista.filas)
  afirmar('Quien nunca escribió no es una conversación', lista.cuenta === 3 && !lista.filas.some((f) => f.cliente === callada.id), lista.filas)
  afirmar('Sin nombre sale con su teléfono', lista.filas[2].nombre === `+57${marca}8`, lista.filas[2])
  afirmar('Sin elegir, abre la más reciente y no cuenta como elegida', lista.detalle?.cliente === santiago.id && lista.enDetalle === false, lista.detalle)
  const elegida = await leerConversaciones(D.ctx.negocio, ZONA, paola.id)
  afirmar('Elegida, trae sus mensajes en orden, de Cliente y agente', elegida.enDetalle && elegida.detalle?.mensajes.map((m) => `${m.de}:${m.texto}`).join('|') === 'cliente:Primero de Paola|agente:Último de Paola' && elegida.detalle.cuenta === 2, elegida.detalle)
  afirmar('Dice que un Caso espera, y sin Caso no', elegida.detalle?.casoQueEspera === 'Caso de Paola' && lista.detalle?.casoQueEspera === null, elegida.detalle?.casoQueEspera)
  await db.update(esquema.casos).set({ estado: 'resuelto', resuelto: new Date() }).where(eq(esquema.casos.negocioId, D.negocio.id))
  afirmar('Un Caso resuelto ya no espera', (await leerConversaciones(D.ctx.negocio, ZONA, paola.id)).detalle?.casoQueEspera === null)

  console.log('\nConversaciones: el aislamiento')
  await db.insert(esquema.mensajesCliente).values([
    { negocioId: B.negocio.id, clienteId: deB.id, rol: 'cliente', texto: `Secreto de B ${marca}`, creado: hace(MINUTO) },
    // Lo que la base deja hacer aunque nada lo haga: un mensaje de otro Negocio a nombre de un Cliente de D.
    { negocioId: B.negocio.id, clienteId: paola.id, rol: 'cliente', texto: `Cruzado de B ${marca}`, creado: hace(MINUTO) },
    { negocioId: D.negocio.id, clienteId: deB.id, rol: 'cliente', texto: `Cruzado de D ${marca}`, creado: hace(MINUTO) },
  ])
  const lejos = await leerConversaciones(D.ctx.negocio, ZONA, deB.id)
  afirmar('El id de un Cliente de otro Negocio en la URL no abre su conversación', !lejos.enDetalle && lejos.detalle?.cliente === santiago.id && !JSON.stringify(lejos).includes('Secreto de B'), lejos.detalle)
  const conCruce = await leerConversaciones(D.ctx.negocio, ZONA, paola.id)
  afirmar('Un mensaje con el Negocio cruzado no se cuela en el detalle ni en la lista', !JSON.stringify(conCruce).includes('Cruzado de') && conCruce.cuenta === 3, conCruce.filas)
  const deBLista = await leerConversaciones(B.ctx.negocio, ZONA)
  afirmar('Otro Negocio tiene lo suyo', deBLista.filas.length === 1 && deBLista.filas[0].ultima === `Secreto de B ${marca}`, deBLista.filas)
  for (const raro of ['no-es-un-id', "' or 1=1 --", callada.id]) {
    const r = await leerConversaciones(D.ctx.negocio, ZONA, raro)
    afirmar(`Un id que no sirve se ignora: ${raro === callada.id ? 'quien no ha escrito' : raro}`, !r.enDetalle && r.detalle?.cliente === santiago.id, r.detalle)
  }

  console.log('\nConversaciones: cuántas')
  const E = await negocioNuevo('E')
  const varios = await db.insert(esquema.clientes).values(Array.from({ length: CUANTAS_CONVERSACIONES + 2 }, (_, i) => ({ negocioId: E.negocio.id, nombre: `Cliente ${i}`, telefono: `58${marca}${i}` }))).returning()
  await db.insert(esquema.mensajesCliente).values(varios.map((c, i) => ({ negocioId: E.negocio.id, clienteId: c.id, rol: 'cliente' as const, texto: `Mensaje ${c.nombre}`, creado: hace(i * MINUTO) })))
  await db.insert(esquema.mensajesCliente).values(Array.from({ length: CUANTOS_MENSAJES + 1 }, (_, i) => ({ negocioId: E.negocio.id, clienteId: varios[0].id, rol: 'agente' as const, texto: `Viejo ${i}`, creado: hace((i + 1000) * MINUTO) })))
  const largas = await leerConversaciones(E.ctx.negocio, ZONA)
  afirmar('Más conversaciones que el límite: la cuenta de verdad y las más recientes', largas.cuenta === CUANTAS_CONVERSACIONES + 2 && largas.filas.length === CUANTAS_CONVERSACIONES && largas.filas[0].nombre === 'Cliente 0', { cuenta: largas.cuenta, filas: largas.filas.length })
  afirmar('Más mensajes que el límite: la cuenta de verdad y los últimos', largas.detalle?.cuenta === CUANTOS_MENSAJES + 2 && largas.detalle.mensajes.length === CUANTOS_MENSAJES && largas.detalle.mensajes.at(-1)?.texto === 'Mensaje Cliente 0', { cuenta: largas.detalle?.cuenta, mensajes: largas.detalle?.mensajes.length })
  const fuera = await leerConversaciones(E.ctx.negocio, ZONA, varios.at(-1)!.id)
  afirmar('Una conversación fuera del límite de la lista se puede abrir', fuera.enDetalle && fuera.detalle?.cliente === varios.at(-1)!.id, fuera.detalle)
  afirmar('Un Negocio sin mensajes queda vacío', (await leerConversaciones(C.ctx.negocio, ZONA)).detalle === null)
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
}

terminar()
