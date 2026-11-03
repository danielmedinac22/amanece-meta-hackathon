/**
 * Lo que leen Casos y Conversaciones, contra Neon real, con `ENVIO_SIMULADO=1` y sin modelo. Decidir un Caso por las
 * rutas del núcleo y leer los dos lugares: la Sección y el Hilo dicen lo mismo. Dos Negocios desechables con los mismos
 * nombres: nada del otro se cuela. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-casos.mts
 */
import { config } from 'dotenv'
import { eq, inArray, sql } from 'drizzle-orm'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()

const { db, esquema } = await import('../src/db')
const { marcar } = await import('../src/nucleo/identidad')
const { aprobar, descartar, proponerRespuestaAlCaso } = await import('../src/nucleo/cambios')
const { comoPropuesta, envioParaElModelo, loQueSeSabe, noSalioEnPalabras, porQueNoSalio, porTuRegla } = await import('../src/nucleo/caso-palabras')
const { enviosDeCasos, enviosDeResueltos, envioDe } = await import('../src/nucleo/casos')
const { puertoDeLaBase } = await import('../src/nucleo/clientes/acciones')
const { columnasDeLaPropuesta } = await import('../src/agentes/avisos')
const { crearAgenteDelDueno } = await import('../src/agentes/dueno')
const { leerPublicado } = await import('../src/nucleo/estado')
const { despachar, intencion } = await import('../src/nucleo/salida')
const { MODO_DE_LA_COMPUERTA } = await import('../src/nucleo/salida/compuerta')
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
  afirmar('Enviar con la tarjeta de la Sección sale una sola vez, simulado', enviada.tipo === 'aplicado' && enviada.envio?.tipo === 'salio' && envios.length === enviosAntes + 1, enviada)
  const despues = await casosDe(A.ctx, ZONA)
  const hilo = await leerHiloConTarjetas(A.ctx)
  afirmar('Enviar lo saca de Espera tu decisión y lo pone en Resueltos con la respuesta', !casoDe(despues, paraEnviar.id) && despues.resueltos[0]?.id === paraEnviar.id && despues.resueltos[0].resolucion === `Te la repongo sin costo (${marca}).` && despues.resueltos[0].envio?.tipo === 'salio', despues.resueltos)
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
  afirmar('Resueltos dice que no salió, y solo de ese', conFallo.resueltos.find((c) => c.id === noSalio.id)?.envio?.tipo === 'no_salio' && conFallo.resueltos.find((c) => c.id === paraEnviar.id)?.envio?.tipo === 'salio', conFallo.resueltos)

  console.log('\nLo que pasó de verdad con el envío')
  const F = await negocioNuevo('F')
  const clienteDeF = async (nombre: string, i: number) => clienteNuevo(F.negocio.id, nombre, 10 + i)
  const conTarjeta = async (cliente: { id: string }, titulo: string) => {
    const caso = await casoNuevo(F.negocio.id, cliente.id, titulo)
    const t = await traerAlHilo(F.negocio.id, F.dueno.id, caso.id, `Respuesta de ${titulo} (${marca})`)
    return { caso, t }
  }
  const alRecargar = async (caso: string, propuesta: string) => {
    const asunto = (await leerHiloConTarjetas(F.ctx)).tarjetas[propuesta]?.asunto
    return { hilo: asunto?.tipo === 'caso' ? asunto.envio?.tipo : undefined, seccion: (await casosDe(F.ctx, ZONA)).resueltos.find((c) => c.id === caso)?.envio?.tipo, completo: asunto }
  }
  const lineasDelHilo = async (propuesta: string) => (await db.select({ mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, F.dueno.id))).map((m) => JSON.stringify(m.mensaje)).filter((m) => m.includes(propuesta) && m.includes('data-aprobacion'))
  const fantasma = marcar.cliente('00000000-0000-4000-8000-00000000fa11')

  const sale = await clienteDeF('Sale Bien', 1)
  const bien = await conTarjeta(sale, 'Sale bien')
  const clicBien = await aprobar(F.ctx, bien.t.propuesta, bien.t.huella)
  const recargaBien = await alRecargar(bien.caso.id, bien.t.propuesta)
  afirmar('Salió: el clic y la recarga dicen salio', clicBien.tipo === 'aplicado' && clicBien.envio?.tipo === 'salio' && recargaBien.hilo === 'salio' && recargaBien.seccion === 'salio', { clicBien, recargaBien })

  const frenada = await clienteDeF('Sin Telefono', 2)
  const sinTelefono = await conTarjeta(frenada, 'No hay a quién')
  await despachar(intencion.resolucionDeCaso({ destinatario: { tipo: 'cliente', negocio: F.ctx.negocio, cliente: fantasma }, texto: 'Sin a quién', caso: marcar.caso(sinTelefono.caso.id), vez: sinTelefono.t.huella }))
  const enviosAntesDelFrenado = envios.length
  const clicFrenado = await aprobar(F.ctx, sinTelefono.t.propuesta, sinTelefono.t.huella)
  const recargaFrenada = await alRecargar(sinTelefono.caso.id, sinTelefono.t.propuesta)
  afirmar('Frenado por la salida: nada salió, y el clic, la recarga y la línea lo dicen', clicFrenado.tipo === 'aplicado' && clicFrenado.envio?.tipo === 'no_salio' && recargaFrenada.hilo === 'no_salio' && recargaFrenada.seccion === 'no_salio' && envios.length === enviosAntesDelFrenado && clicFrenado.resumen.includes('no salió'), { clicFrenado, recargaFrenada })

  const sembrarLoQueDejaKapsoAlFallar = async (cliente: { id: string; telefono: string }, caso: string, huella: string, error: string | null) => {
    const { clave } = intencion.resolucionDeCaso({ destinatario: { tipo: 'cliente', negocio: F.ctx.negocio, cliente: marcar.cliente(cliente.id) }, texto: '', caso: marcar.caso(caso), vez: huella })
    await db.insert(esquema.mensajesSalientes).values({ clave, negocioId: F.negocio.id, clienteId: cliente.id, casoId: caso, telefono: cliente.telefono, clase: 'resolucion_de_caso', veredicto: 'sale', estado: 'por_enviar', error })
  }

  const caida = await clienteDeF('Kapso Caido', 3)
  const noTomo = await conTarjeta(caida, 'WhatsApp no la tomó')
  await sembrarLoQueDejaKapsoAlFallar(caida, noTomo.caso.id, noTomo.t.huella, 'Kapso respondió 500: caído')
  const enviosAntesDeLaCaida = envios.length
  const clicCaido = await aprobar(F.ctx, noTomo.t.propuesta, noTomo.t.huella)
  const recargaCaida = await alRecargar(noTomo.caso.id, noTomo.t.propuesta)
  afirmar('WhatsApp no la tomó: nada salió, y el clic y la línea del Hilo lo dicen', clicCaido.tipo === 'aplicado' && clicCaido.envio?.tipo === 'no_la_tomo' && clicCaido.resumen.includes('no la tomó') && envios.length === enviosAntesDeLaCaida && (await lineasDelHilo(noTomo.t.propuesta)).length === 1, clicCaido)
  afirmar('WhatsApp no la tomó: después de recargar no dice Enviada, ni en el Hilo ni en la Sección', recargaCaida.hilo === 'no_la_tomo' && recargaCaida.seccion === 'no_la_tomo', recargaCaida)
  const otraVezCaido = await aprobar(F.ctx, noTomo.t.propuesta, noTomo.t.huella)
  afirmar('WhatsApp no la tomó: otro clic no la reenvía ni cambia lo que dice', otraVezCaido.tipo === 'aplicado' && otraVezCaido.envio?.tipo === 'no_la_tomo' && envios.length === enviosAntesDeLaCaida, otraVezCaido)

  const colgada = await clienteDeF('Sin Desenlace', 4)
  const enCurso = await conTarjeta(colgada, 'Sin desenlace')
  await sembrarLoQueDejaKapsoAlFallar(colgada, enCurso.caso.id, enCurso.t.huella, null)
  const clicColgado = await aprobar(F.ctx, enCurso.t.propuesta, enCurso.t.huella)
  const recargaColgada = await alRecargar(enCurso.caso.id, enCurso.t.propuesta)
  afirmar('Reclamada y sin desenlace: no se sabe, nunca salio', clicColgado.tipo === 'aplicado' && clicColgado.envio?.tipo === 'sin_saber' && recargaColgada.hilo === 'sin_saber' && recargaColgada.seccion === 'sin_saber', { clicColgado, recargaColgada })

  const murioAntesDeEnviar = async (caso: string, propuesta: string) => {
    await db.update(esquema.propuestas).set({ estado: 'aplicada', aprobadoPor: F.dueno.id }).where(eq(esquema.propuestas.id, propuesta))
    await db.update(esquema.casos).set({ estado: 'resuelto', resolucion: 'x', resuelto: new Date() }).where(eq(esquema.casos.id, caso))
  }
  const murio = await clienteDeF('Sin Fila', 5)
  const sinFila = await conTarjeta(murio, 'Sin fila')
  await murioAntesDeEnviar(sinFila.caso.id, sinFila.t.propuesta)
  const recargaSinFila = await alRecargar(sinFila.caso.id, sinFila.t.propuesta)
  afirmar('Sin fila: al recargar no se sabe, en el Hilo y en la Sección', recargaSinFila.hilo === 'sin_saber' && recargaSinFila.seccion === 'sin_saber', recargaSinFila)
  const rescate = await aprobar(F.ctx, sinFila.t.propuesta, sinFila.t.huella)
  const recargaRescate = await alRecargar(sinFila.caso.id, sinFila.t.propuesta)
  afirmar('Sin fila: otro clic en una tarjeta abierta la despacha y todo pasa a salio', rescate.tipo === 'aplicado' && rescate.envio?.tipo === 'salio' && recargaRescate.hilo === 'salio' && recargaRescate.seccion === 'salio', { rescate, recargaRescate })

  const tarde = await clienteDeF('Ventana Cerrada', 6)
  const cerrada = await conTarjeta(tarde, 'Ventana cerrada')
  await murioAntesDeEnviar(cerrada.caso.id, cerrada.t.propuesta)
  await db.update(esquema.clientes).set({ ultimoMensajeEntrante: hace(25 * 60 * MINUTO) }).where(eq(esquema.clientes.id, tarde.id))
  const enviosAntesDeLaVentana = envios.length
  const clicCerrada = await aprobar(F.ctx, cerrada.t.propuesta, cerrada.t.huella)
  afirmar('Sin fila y con la ventana cerrada: no se despacha, y dice que no sabe, una sola línea en el Hilo', clicCerrada.tipo === 'aplicado' && clicCerrada.envio?.tipo === 'sin_saber' && envios.length === enviosAntesDeLaVentana && (await lineasDelHilo(cerrada.t.propuesta)).length === 1, clicCerrada)

  const ausente = await clienteDeF('Se Fue', 7)
  const sinCliente = await conTarjeta(ausente, 'Se fue el Cliente')
  await murioAntesDeEnviar(sinCliente.caso.id, sinCliente.t.propuesta)
  await db.update(esquema.casos).set({ clienteId: null }).where(eq(esquema.casos.id, sinCliente.caso.id))
  const clicSinCliente = await aprobar(F.ctx, sinCliente.t.propuesta, sinCliente.t.huella)
  afirmar('Sin fila y sin Cliente: el clic no dice que salió', clicSinCliente.tipo === 'aplicado' && clicSinCliente.envio?.tipo === 'sin_saber', clicSinCliente)

  const observada = await clienteDeF('Observada', 8)
  const conEmergencia = await conTarjeta(observada, 'Con emergencia')
  process.env.SALIDA_EN_EMERGENCIA = F.negocio.id
  const clicObservado = await aprobar(F.ctx, conEmergencia.t.propuesta, conEmergencia.t.huella).finally(() => delete process.env.SALIDA_EN_EMERGENCIA)
  const [filaObservada] = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.casoId, conEmergencia.caso.id))
  const esperado = MODO_DE_LA_COMPUERTA === 'observa' ? 'salio' : 'no_salio'
  afirmar('La verdad es lo que pasó y no el veredicto: la emergencia queda anotada y la tarjeta dice lo que hizo la salida', filaObservada?.veredicto === 'no_sale' && filaObservada.motivo === 'emergencia' && clicObservado.tipo === 'aplicado' && clicObservado.envio?.tipo === esperado && (await alRecargar(conEmergencia.caso.id, conEmergencia.t.propuesta)).hilo === esperado, { filaObservada, clicObservado })

  afirmar('Un envío de un Caso no se ve desde otro Negocio', (await enviosDeCasos(B.ctx.negocio, [noTomo.caso.id])).size === 0 && (await enviosDeResueltos(B.ctx.negocio, [noTomo.caso.id, sinFila.caso.id])).size === 0)
  const agente = crearAgenteDelDueno(F.ctx, { negocio: F.negocio, dueno: F.dueno })
  const herramienta = (nombre: string, entrada: object) => agente.todas[nombre].execute!(entrada, { toolCallId: 'probar', messages: [], context: {} }) as Promise<{ id: string; envio: string | null }[]>
  const paraElModelo = envioParaElModelo({ tipo: 'no_la_tomo' })
  afirmar('El modelo lee lo que pasó: en listar_casos', (await herramienta('listar_casos', { estado: 'resuelto' })).find((c) => c.id === noTomo.caso.id)?.envio === paraElModelo, paraElModelo)
  afirmar('El modelo lee lo que pasó: en listar_propuestas', (await herramienta('listar_propuestas', {})).find((p) => p.id === noTomo.t.propuesta)?.envio === paraElModelo, paraElModelo)
  afirmar('Solo salio se lee como salio', envioDe({ estado: 'enviado', motivo: null, error: null }).tipo === 'salio' && envioDe({ estado: 'simulado', motivo: 'emergencia', error: null }).tipo === 'salio' && envioDe({ estado: 'por_enviar', motivo: null, error: null }).tipo === 'sin_saber')
  afirmar('No la tomó solo si Kapso la rechazó: una excepción pudo llegar después de que aceptó', envioDe({ estado: 'por_enviar', motivo: 'emergencia', error: 'Kapso respondió 400: número inválido' }).tipo === 'no_la_tomo' && envioDe({ estado: 'por_enviar', motivo: null, error: 'Falta KAPSO_PHONE_NUMBER_ID' }).tipo === 'no_la_tomo' && envioDe({ estado: 'por_enviar', motivo: null, error: 'TypeError: fetch failed' }).tipo === 'sin_saber')
  const SALIO = { tipo: 'salio' } as const
  const NO_SE = { tipo: 'sin_saber' } as const
  afirmar('Lo que ya se sabe le gana a sin_saber, en cualquier orden', loQueSeSabe(NO_SE, SALIO) === SALIO && loQueSeSabe(SALIO, NO_SE) === SALIO && loQueSeSabe(null, NO_SE) === NO_SE && loQueSeSabe(NO_SE, null) === NO_SE && loQueSeSabe(null, null) === null)
  const frases = [{ tipo: 'no_la_tomo' }, { tipo: 'sin_saber' }, { tipo: 'no_salio', motivo: 'fuera_de_ventana' }] as const
  afirmar('Ninguna frase de un envío que no salió dice Enviada ni que le respondió', frases.every((f) => !/enviada|respondi/i.test(`${porQueNoSalio(f)} ${noSalioEnPalabras(f)}`)), frases.map(noSalioEnPalabras))

  console.log('\nLa regla y lo que le toca al Dueño')
  afirmar('Por tu regla: minúscula al empezar, nombres intactos después, sin punto doble', porTuRegla(['   ']) === null && porTuRegla(['Envío a Manizales.']) === 'Por tu regla: envío a Manizales.' && porTuRegla(['IVA incluido']) === 'Por tu regla: IVA incluido.' && porTuRegla(['Uno', 'Dos']) === 'Por tus reglas: uno y dos.' && porTuRegla([]) === null, [porTuRegla(['Envío a Manizales.']), porTuRegla(['Uno', 'Dos'])])
  const columnas = columnasDeLaPropuesta({ respuestaAlCliente: 'Te la repongo', queHacer: '  Separar una bolsa  ' })
  afirmar('Por tu lado va en su columna y no pegado a la respuesta', columnas.propuesta === 'Responderle: "Te la repongo"' && columnas.porTuLado === 'Separar una bolsa', columnas)
  afirmar('Sin borrador no hay nada que guardar', columnasDeLaPropuesta(null).propuesta === '' && columnasDeLaPropuesta(null).porTuLado === '')

  const delPuerto = await clienteDeF('Con Regla', 9)
  const puerto = puertoDeLaBase(await leerPublicado(F.ctx.negocio), marcar.cliente(delPuerto.id))
  const conRegla = await puerto.abrir_caso({ titulo: `Pedido fuera (${marca})`, detalle: 'uno', pedido: null, reusar: true, reglas: ['Regla uno'] })
  await puerto.abrir_caso({ titulo: `Pedido fuera (${marca})`, detalle: 'dos', pedido: null, reusar: true, reglas: ['Regla dos', 'Regla uno'] })
  const [reusado] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, conRegla.caso!))
  afirmar('Reusar suma la regla nueva sin repetir y conserva el orden', reusado.reglas.join() === 'Regla uno,Regla dos', reusado.reglas)
  await db.update(esquema.casos).set({ estado: 'esperando_dueno', propuesta: comoPropuesta(`Ya te confirmo (${marca}).`), porTuLado: 'Revisar la dirección' }).where(eq(esquema.casos.id, reusado.id))
  const tConRegla = await traerAlHilo(F.negocio.id, F.dueno.id, reusado.id, `Ya te confirmo (${marca}).`)
  const deLaTarjeta = (await leerHiloConTarjetas(F.ctx)).tarjetas[tConRegla.propuesta]?.asunto
  afirmar('La tarjeta trae la regla y lo que le toca al Dueño, y todavía ningún envío', deLaTarjeta?.tipo === 'caso' && deLaTarjeta.reglas.length === 2 && deLaTarjeta.porTuLado === 'Revisar la dirección' && deLaTarjeta.envio === null, deLaTarjeta)

  const viejoInsertado = await db.execute(sql`insert into casos (negocio_id, cliente_id, titulo, propuesta, estado) values (${F.negocio.id}, ${delPuerto.id}, ${`Caso viejo ${marca}`}, ${'Responderle: "Hola"\nPor tu lado: revisar algo'}, 'esperando_dueno') returning id`)
  const idViejo = (viejoInsertado.rows[0] as { id: string }).id
  const tVieja = await traerAlHilo(F.negocio.id, F.dueno.id, idViejo, `Hola (${marca}).`)
  const deLaVieja = (await leerHiloConTarjetas(F.ctx)).tarjetas[tVieja.propuesta]?.asunto
  const viejoEnLaSeccion = (await casosDe(F.ctx, ZONA)).esperan.find((c) => c.id === idViejo)
  afirmar('Un Caso viejo no trae regla ni lado, y no se adivinan del texto pegado', deLaVieja?.tipo === 'caso' && deLaVieja.reglas.length === 0 && deLaVieja.porTuLado === null && viejoEnLaSeccion?.reglas.length === 0 && viejoEnLaSeccion.porTuLado === null, { deLaVieja, viejoEnLaSeccion })
  const [resueltoViejo] = await db.insert(esquema.casos).values({ negocioId: F.negocio.id, titulo: 'Resuelto antes de esta salida', resolucion: 'Listo', estado: 'resuelto', resuelto: new Date() }).returning()
  afirmar('Un Caso resuelto antes de esta salida no avisa nada, porque no se sabe', (await casosDe(F.ctx, ZONA)).resueltos.find((c) => c.id === resueltoViejo.id)?.envio === null)

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
