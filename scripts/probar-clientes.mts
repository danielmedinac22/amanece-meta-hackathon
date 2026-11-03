/**
 * Prueba del Agente de clientes contra Café Ladera, sin mandar nada por WhatsApp:
 *  1. el turno en modo ensayo, con el puerto en memoria y tres mensajes seguidos;
 *  2. `recibirMensaje` de punta a punta con el envío simulado (ENVIO_SIMULADO=1, que se pone aquí), entrando por
 *     `leerMensajeEntrante` con un evento de Kapso como el del webhook;
 *  3. con `--pedido`, también un pedido y un Caso de verdad en la base;
 *  4. con una regla de siempre `no_prometer: plazo` aprobada con el botón, lo que sale no promete plazos.
 *
 * Cada caso se afirma contra lo que quedó en la base o lo que se habría enviado, nunca contra el texto del
 * modelo, y el script sale con 1 si alguno falla. Lo que la corrida creó se borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-clientes.mts [--pedido]
 */
import { config } from 'dotenv'
import { and, asc, desc, eq, gt, gte, inArray, like, ne, sql } from 'drizzle-orm'
import { afirmar, capturarEnvios, capturarErrores, eventoDeKapso, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
// Antes de cargar nada: en esta prueba no sale ni un mensaje.
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()
const infos: string[] = []
const imprimirInfo = console.info
console.info = (...args: unknown[]) => {
  imprimirInfo(...args)
  infos.push(args.map(String).join(' '))
}

const { db, esquema } = await import('../src/db')
const { turno, entornoDeEnsayo } = await import('../src/nucleo/clientes/turno')
const { puertoDeLaBase } = await import('../src/nucleo/clientes/acciones')
const { cotizar } = await import('../src/nucleo/precios/cotizar')
const { leerAplicado, leerPublicado, valorDelDato } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
const { proponer, aprobar, leerLoPendiente, publicar } = await import('../src/nucleo/cambios')
const { actorDelBoton } = await import('../src/nucleo/acciones')
const { marcar } = await import('../src/nucleo/identidad')
const { leerMensajeEntrante, recibirMensaje } = await import('../src/nucleo/entrada')
const { MODELO_ID } = await import('../src/lib/modelo')

const inicio = new Date()
const telefono = '573000000001'
const telefonoVencido = `570${String(Date.now()).slice(-9)}`
const telefonoSinSesion = '573000000999'
const base = `wamid.PRUEBA.${Date.now()}`
const entrante = (m: Parameters<typeof eventoDeKapso>[0]) => leerMensajeEntrante(eventoDeKapso(m))!
let laderaId: string | undefined
let camilaId: string | undefined
let ultimoMensajeDeCamila: Date | null = null
let sesionPrevia: typeof esquema.sesionesWhatsapp.$inferSelect | undefined
let sesionLeida = false
let versionDeLadera: number | null = null
let duenoDePrueba: string | null = null

const filasDeLadera = async (negocioId: string) => ({
  clientes: await db.$count(esquema.clientes, eq(esquema.clientes.negocioId, negocioId)),
  pedidos: await db.$count(esquema.pedidos, eq(esquema.pedidos.negocioId, negocioId)),
  casos: await db.$count(esquema.casos, eq(esquema.casos.negocioId, negocioId)),
  mensajes: await db.$count(esquema.mensajesCliente, eq(esquema.mensajesCliente.negocioId, negocioId)),
  turnos: await db.$count(esquema.turnos, eq(esquema.turnos.negocioId, negocioId)),
})

/** Borra lo que creó esta corrida. Camila es dato sembrado: se queda. Su sesión vuelve a como estaba. */
async function limpiar() {
  if (!laderaId || !camilaId) return
  const propuestas = await db.delete(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, laderaId), gte(esquema.propuestas.creado, inicio))).returning({ id: esquema.propuestas.id })
  const lineas = propuestas.length ? (await db.select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.negocioId, laderaId))).filter((m) => propuestas.some((p) => JSON.stringify(m.mensaje).includes(p.id))) : []
  if (lineas.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, lineas.map((m) => m.id)))
  if (versionDeLadera !== null) {
    await db.delete(esquema.elementos).where(and(eq(esquema.elementos.negocioId, laderaId), gt(esquema.elementos.version, versionDeLadera)))
    await db.update(esquema.negocios).set({ version: versionDeLadera }).where(eq(esquema.negocios.id, laderaId))
  }
  if (duenoDePrueba) await db.delete(esquema.duenos).where(eq(esquema.duenos.id, duenoDePrueba))
  const casos = await db
    .select({ id: esquema.casos.id })
    .from(esquema.casos)
    .where(and(eq(esquema.casos.clienteId, camilaId), gte(esquema.casos.creado, inicio)))
  const idsDeCasos = casos.map((c) => c.id)
  // Cada Caso trae un aviso al Hilo de los Dueños del Negocio; el id del Caso viaja dentro del mensaje.
  const hilo = await db
    .select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje })
    .from(esquema.mensajesDueno)
    .where(and(eq(esquema.mensajesDueno.negocioId, laderaId), gte(esquema.mensajesDueno.creado, inicio)))
  const avisos = hilo.filter((m) => idsDeCasos.some((id) => JSON.stringify(m.mensaje).includes(id))).map((m) => m.id)
  if (avisos.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, avisos))
  // El aviso también deja la respuesta del Caso en una propuesta, que no se va con el Caso.
  for (const id of idsDeCasos) {
    await db.delete(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, laderaId), sql`${esquema.propuestas.actos} @> ${JSON.stringify([{ caso: id }])}::jsonb`))
  }
  if (idsDeCasos.length) await db.delete(esquema.casos).where(inArray(esquema.casos.id, idsDeCasos))
  await db.delete(esquema.pedidos).where(and(eq(esquema.pedidos.clienteId, camilaId), gte(esquema.pedidos.creado, inicio)))
  await db.delete(esquema.mensajesCliente).where(and(eq(esquema.mensajesCliente.clienteId, camilaId), gte(esquema.mensajesCliente.creado, inicio)))
  await db.delete(esquema.mensajesSalientes).where(and(inArray(esquema.mensajesSalientes.telefono, [telefono, telefonoSinSesion]), gte(esquema.mensajesSalientes.creado, inicio)))
  await db.delete(esquema.mensajesEntrantes).where(like(esquema.mensajesEntrantes.wamid, `${base}%`))
  await db.delete(esquema.turnos).where(and(eq(esquema.turnos.negocioId, laderaId), inArray(esquema.turnos.agente, ['clientes', 'dueno']), gte(esquema.turnos.creado, inicio)))
  // Al borrar al Cliente de la ventana vencida se van también sus mensajes.
  await db.delete(esquema.clientes).where(and(eq(esquema.clientes.negocioId, laderaId), eq(esquema.clientes.telefono, telefonoVencido)))
  await db.update(esquema.clientes).set({ ultimoMensajeEntrante: ultimoMensajeDeCamila }).where(eq(esquema.clientes.id, camilaId))
  if (!sesionLeida) return
  if (sesionPrevia) await db.insert(esquema.sesionesWhatsapp).values(sesionPrevia).onConflictDoUpdate({ target: esquema.sesionesWhatsapp.telefono, set: sesionPrevia })
  else await db.delete(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, telefono))
}

try {
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  if (!ladera) throw new Error('Falta sembrar: pnpm tsx scripts/sembrar.mts')
  laderaId = ladera.id
  versionDeLadera = ladera.version
  const [camila] = await db.select().from(esquema.clientes).where(and(eq(esquema.clientes.negocioId, ladera.id), eq(esquema.clientes.telefono, telefono)))
  if (!camila) throw new Error('Falta sembrar a Camila Rojas: pnpm tsx scripts/sembrar.mts')
  camilaId = camila.id
  ultimoMensajeDeCamila = camila.ultimoMensajeEntrante
  sesionPrevia = (await db.select().from(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, telefono)))[0]
  sesionLeida = true

  console.log(`\n=== 1. Agente de clientes en ensayo (${MODELO_ID}) ===`)
  const antes = await filasDeLadera(ladera.id)
  const estado = await leerAplicado(marcar.negocio(ladera.id))
  const deEnsayo = { id: marcar.cliente(camila.id), nombre: 'Camila', telefono: null, pedidos: [] }
  const ensayo = entornoDeEnsayo(estado, deEnsayo)
  const historial: { rol: 'cliente' | 'agente'; texto: string }[] = []
  const mensajes = [
    '¿Qué café tienen y cuánto cuesta?',
    'Quiero 2 bolsas del tueste medio en grano. Es para Medellín, Calle 10 # 40-20, casa 3',
    '¿Envían a Pasto y cuándo llega?',
  ]
  for (const [i, texto] of mensajes.entries()) {
    const r = await turno(estado, { cliente: deEnsayo, historial: [...historial], mensaje: { texto, wamid: marcar.wamid(`${base}.ensayo.${i}`), enviadoEn: marcar.instante(new Date()) } }, ensayo)
    console.log(`\nCliente: ${texto}`)
    console.log(`Agente:  ${r.texto}`)
    console.log(`  acciones: [${r.acciones.map((a) => a.nombre).join(', ')}] · corregido ${r.corregido} · ${r.gasto.ms} ms · tokens ${r.gasto.entrada}/${r.gasto.salida}`)
    afirmar(`ensayo: el mensaje ${i + 1} tiene respuesta`, r.texto.trim().length > 0, r.texto)
    historial.push({ rol: 'cliente', texto }, { rol: 'agente', texto: r.texto })
  }
  const despues = await filasDeLadera(ladera.id)
  afirmar('ensayo: no escribe clientes, pedidos, Casos, mensajes ni turnos en la base', JSON.stringify(despues) === JSON.stringify(antes), { antes, despues })

  console.log('\n=== 2. recibirMensaje de punta a punta (envío simulado) ===')
  const enviosA = (tel: string, desde: number) => envios.slice(desde).filter((e) => e.telefono === tel)
  const mensajesDeCamila = () =>
    db
      .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto, wamid: esquema.mensajesCliente.wamid, creado: esquema.mensajesCliente.creado })
      .from(esquema.mensajesCliente)
      .where(eq(esquema.mensajesCliente.clienteId, camila.id))
      .orderBy(asc(esquema.mensajesCliente.creado))
  const sesionDeCamila = async () => (await db.select().from(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, telefono)))[0]

  async function afirmarTurno(caso: string, wamid: string, desde: number) {
    const sesion = await sesionDeCamila()
    afirmar(`${caso}: la sesión de Camila apunta a LADERA`, sesion?.negocioId === ladera.id, sesion)
    const guardados = await mensajesDeCamila()
    const entrante = guardados.find((m) => m.wamid === wamid)
    afirmar(`${caso}: el mensaje del Cliente quedó guardado`, entrante?.rol === 'cliente', entrante)
    const respuesta = entrante && guardados.find((m) => m.rol === 'agente' && m.creado > entrante.creado)
    afirmar(`${caso}: la respuesta del agente quedó guardada después`, respuesta !== undefined, guardados.slice(-4))
    const salidos = enviosA(telefono, desde)
    afirmar(`${caso}: salió un solo envío simulado a Camila`, salidos.length === 1, salidos)
    afirmar(`${caso}: lo que salió es lo que quedó guardado`, respuesta !== undefined && salidos[0]?.texto === respuesta.texto, { guardado: respuesta?.texto, salido: salidos[0]?.texto })
  }

  const salidasDe = (wamid: string) => db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, wamid))

  console.log('\n-- Con la ficha del Negocio al inicio, como la pone el link')
  // Con otra sesión, la ficha de LADERA sería un segundo código y se le preguntaría. `limpiar` la restaura.
  await db.delete(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, telefono))
  let desde = envios.length
  const deMeta = new Date(Math.floor(Date.now() / 1000) * 1000)
  await recibirMensaje(entrante({ wamid: `${base}.1`, telefono, nombre: 'Camila Rojas', texto: '(LADERA) Hola Café Ladera', enviadoEn: deMeta }))
  await afirmarTurno('con ficha', `${base}.1`, desde)
  const [ficha] = await db.select({ ultimo: esquema.clientes.ultimoMensajeEntrante }).from(esquema.clientes).where(eq(esquema.clientes.id, camila.id))
  afirmar('con ficha: el último entrante de Camila es el timestamp de Meta', ficha?.ultimo?.getTime() === deMeta.getTime(), { ficha, deMeta })
  const [salida] = await salidasDe(`${base}.1`)
  afirmar(
    'con ficha: la respuesta dejó su fila de salida (respuesta, sale, simulado, de Camila en LADERA)',
    salida?.clase === 'respuesta' && salida.veredicto === 'sale' && salida.estado === 'simulado' && salida.clienteId === camila.id && salida.negocioId === ladera.id,
    salida,
  )

  console.log('\n-- Sin código: usa la sesión')
  desde = envios.length
  await recibirMensaje(entrante({ wamid: `${base}.2`, telefono, nombre: 'Camila Rojas', texto: '¿Tienen café molido para greca?' }))
  await afirmarTurno('sin código', `${base}.2`, desde)

  console.log('\n-- El mismo wamid otra vez: no debe responder')
  desde = envios.length
  await recibirMensaje(entrante({ wamid: `${base}.2`, telefono, nombre: 'Camila Rojas', texto: '¿Tienen café molido para greca?' }))
  afirmar('wamid repetido: no sale ningún envío', envios.length === desde, envios.slice(desde))
  afirmar('wamid repetido: queda una sola fila de salida para ese mensaje', (await salidasDe(`${base}.2`)).length === 1)
  const repetidos = (await mensajesDeCamila()).filter((m) => m.wamid === `${base}.2`)
  afirmar('wamid repetido: queda una sola fila con ese wamid', repetidos.length === 1, repetidos)

  console.log('\n-- Un teléfono sin sesión ni código')
  desde = envios.length
  await recibirMensaje(entrante({ wamid: `${base}.3`, telefono: telefonoSinSesion, texto: 'Hola' }))
  afirmar('sin sesión ni código: sale un solo envío simulado a ese teléfono', enviosA(telefonoSinSesion, desde).length === 1, envios.slice(desde))
  const fichas = await db.select({ id: esquema.clientes.id }).from(esquema.clientes).where(eq(esquema.clientes.telefono, telefonoSinSesion))
  afirmar('sin sesión ni código: no se crea ficha de Cliente', fichas.length === 0, fichas)
  const [aviso] = await salidasDe(`${base}.3`)
  afirmar('sin sesión ni código: el aviso dejó fila (aviso_del_nucleo, sin Negocio ni Cliente, sale)', aviso?.clase === 'aviso_del_nucleo' && aviso.negocioId === null && aviso.clienteId === null && aviso.veredicto === 'sale', aviso)

  console.log('\nÚltimos mensajes guardados de Camila:')
  for (const m of (await mensajesDeCamila()).slice(-6)) console.log(`  [${m.rol}] ${m.texto.slice(0, 90).replace(/\n/g, ' ')}`)

  if (process.argv.includes('--pedido')) {
    console.log('\n=== 3. Pedido y Caso reales en la base (envío simulado) ===')
    const idsDe = <T extends { id: string }>(filas: T[]) => new Set(filas.map((f) => f.id))
    const pedidosPrevios = idsDe(await db.select({ id: esquema.pedidos.id }).from(esquema.pedidos).where(eq(esquema.pedidos.clienteId, camila.id)))
    const casosDeCamila = async () => idsDe(await db.select({ id: esquema.casos.id }).from(esquema.casos).where(eq(esquema.casos.clienteId, camila.id)))
    let casosPrevios = await casosDeCamila()
    const pasos = [
      'Quiero el molino manual, para Bogotá, Carrera 15 # 85-30 apto 402',
      'Sí, confírmalo',
      '¿Cómo va mi último pedido?',
      'Quiero hablar con una persona, por favor',
    ]
    for (const [i, texto] of pasos.entries()) {
      if (i === pasos.length - 1) casosPrevios = await casosDeCamila()
      console.log(`\nCliente: ${texto}`)
      await recibirMensaje(entrante({ wamid: `${base}.p${i}`, telefono, nombre: 'Camila Rojas', texto }))
    }
    const pedidos = await db.select().from(esquema.pedidos).where(eq(esquema.pedidos.clienteId, camila.id)).orderBy(desc(esquema.pedidos.numero))
    console.log('\nPedidos de Camila (los 2 últimos):', pedidos.slice(0, 2).map((p) => ({ numero: p.numero, estado: p.estado, total: p.total, items: p.items.map((x) => `${x.cantidad} x ${x.nombre}`) })))
    const casos = await db.select().from(esquema.casos).where(and(eq(esquema.casos.clienteId, camila.id), ne(esquema.casos.estado, 'resuelto')))
    console.log('Casos sin resolver de Camila:', casos.map((c) => ({ titulo: c.titulo, estado: c.estado, pedidoId: c.pedidoId, propuesta: c.propuesta.slice(0, 120) })))

    const pedidosNuevos = pedidos.filter((p) => !pedidosPrevios.has(p.id))
    const delMolino = pedidosNuevos.find((p) => p.items.some((x) => /molino/i.test(x.nombre)))
    afirmar('pedido: se creó un pedido nuevo de Camila con el molino', delMolino !== undefined, pedidosNuevos)
    const precioDe = (productoId: string) => {
      const v = estado.vigente(el.claveDeProducto.deId(productoId))
      return v?.elemento.tipo === 'producto' ? v.elemento.precio : NaN
    }
    const totalDelCatalogo = delMolino?.items.reduce((suma, x) => suma + precioDe(x.productoId) * x.cantidad, 0)
    afirmar('pedido: los precios y el total salen de los productos Elemento', delMolino !== undefined && delMolino.total === totalDelCatalogo, { delMolino, totalDelCatalogo })
    const casosNuevos = casos.filter((c) => !casosPrevios.has(c.id))
    afirmar('Caso: pedir hablar con una persona deja un Caso sin resolver de Camila', casosNuevos.length > 0, casos)

    console.log('\n=== 3b. El Caso de un pedido guarda su pedido y solo se reusa con ese pedido ===')
    const puerto = puertoDeLaBase(await leerPublicado(marcar.negocio(ladera.id)), marcar.cliente(camila.id))
    const [producto] = estado.vigentes('producto').filter((v) => v.elemento.activo)
    const crear = async (cantidad: number) => {
      const borrador = { items: [{ producto: producto.clave, cantidad }], ciudad: 'Pereira' }
      const cotizacion = cotizar(borrador, estado)
      if ('noCubre' in cotizacion) throw new Error(cotizacion.noCubre)
      const r = await puerto.crear_pedido({ pedido: borrador, direccion: 'Calle 10', cotizacion })
      if ('negado' in r) throw new Error(r.negado)
      return r.numero
    }
    const [uno, dos] = [await crear(7), await crear(8)]
    const titulo = `Pedido fuera de Manizales (prueba ${base})`
    const a = await puerto.abrir_caso({ titulo, detalle: 'primero', pedido: uno, reusar: true })
    const b = await puerto.abrir_caso({ titulo, detalle: 'otra vez', pedido: uno, reusar: true })
    const c = await puerto.abrir_caso({ titulo, detalle: 'otro pedido', pedido: dos, reusar: true })
    const filas = await db.select({ id: esquema.casos.id, pedido: esquema.pedidos.numero, detalle: esquema.casos.detalle }).from(esquema.casos).leftJoin(esquema.pedidos, eq(esquema.pedidos.id, esquema.casos.pedidoId)).where(eq(esquema.casos.titulo, titulo))
    afirmar('3b: el mismo pedido reusa su Caso y otro pedido abre otro, cada uno con su pedido', a.nuevo && !b.nuevo && b.caso === a.caso && c.nuevo && c.caso !== a.caso && filas.length === 2 && filas.find((f) => f.id === a.caso)?.pedido === uno && filas.find((f) => f.id === c.caso)?.pedido === dos, { a, b, c, filas })
  }

  console.log('\n=== 4. Con la regla de no prometer plazos, lo que sale no promete plazos ===')
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: ladera.id, usuarioId: `prueba-clientes-${Date.now()}`, nombre: 'Dueño de prueba' }).returning()
  duenoDePrueba = dueno.id
  const ctx = { negocio: marcar.negocio(ladera.id), dueno: marcar.dueno(dueno.id), medio: 'web' as const }
  const regla = await proponer(ctx, {
    palabrasDelDueno: 'Nunca prometas fechas de entrega',
    origen: 'hilo',
    quiere: [
      {
        tipo: 'poner',
        reemplaza: null,
        elemento: {
          tipo: 'regla',
          nombre: 'Sin fechas de entrega',
          cuando: { tipo: 'siempre' },
          efectos: [{ tipo: 'no_prometer', que: 'plazo' }],
          escenarios: { activan: [{ mensajeDelCliente: '¿Me llega el viernes a Cali?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] },
        },
      },
    ],
  })
  const aplicada = regla.tarjeta ? await aprobar(ctx, regla.tarjeta.propuesta, regla.tarjeta.huella) : null
  afirmar('regla: espera el botón y el botón la aplica', regla.desenlace === 'espera_al_dueno' && aplicada?.tipo === 'aplicado', { regla, aplicada })
  const publicada = await publicar(actorDelBoton(ctx), (await leerLoPendiente(await leerAplicado(marcar.negocio(ladera.id)))).huella)
  afirmar('regla: Publicar la manda a los Clientes', publicada.tipo === 'publicado', publicada)
  desde = envios.length
  await recibirMensaje(entrante({ wamid: `${base}.plazo`, telefono, nombre: 'Camila Rojas', texto: '¿Envían a Pasto? ¿En cuántos días me llega?' }))
  const conRegla = enviosA(telefono, desde)
  console.log(`Agente: ${conRegla[0]?.texto}`)
  // El oráculo no es el detector que se prueba: los rangos de días del dato de envíos sembrado, y cualquier "N días".
  const rangos = [...valorDelDato(await leerAplicado(marcar.negocio(ladera.id)), 'envios').matchAll(/(\d+) a (\d+) días/g)].map((m) => [m[1], m[2]])
  const prometePlazo = (texto: string) => rangos.some(([a, b]) => new RegExp(`\\b${a}\\b\\D{1,12}\\b${b}\\b`).test(texto)) || /\b\d+\s*(d[ií]as|horas)\b/i.test(texto)
  afirmar('regla: sale una respuesta y no cita los plazos del dato de envíos', rangos.length >= 2 && conRegla.length === 1 && !prometePlazo(conRegla[0].texto), { rangos, conRegla })

  const medidas = infos.filter((l) => l.startsWith('[atender] turno'))
  const deLaRegla = medidas.find((l) => l.includes(`${base}.plazo`))
  afirmar('medir: cada turno deja una línea con wamid, corregido y reglas activas, sin texto ni teléfono', deLaRegla !== undefined && /"corregido":"(no|si|respaldo)"/.test(deLaRegla) && /"reglas":\["regla:/.test(deLaRegla) && medidas.every((l) => !l.includes(telefono) && !l.includes('Pasto')), medidas)

  console.log('\n=== 5. Un Caso del núcleo se reusa y suma el mensaje nuevo ===')
  const puerto = puertoDeLaBase(await leerPublicado(marcar.negocio(ladera.id)), marcar.cliente(camila.id))
  const primero = await puerto.abrir_caso({ titulo: `Respuesta frenada por el núcleo (${base})`, detalle: 'Camila escribió: «uno»', pedido: null, reusar: true })
  const segundo = await puerto.abrir_caso({ titulo: `Respuesta frenada por el núcleo (${base})`, detalle: 'Camila escribió: «dos»', pedido: null, reusar: true })
  const [reusado] = primero.caso ? await db.select().from(esquema.casos).where(eq(esquema.casos.id, primero.caso)) : []
  afirmar('reusar: el mismo Caso, con los dos mensajes en el detalle', primero.caso !== null && primero.caso === segundo.caso && reusado?.detalle.includes('«uno»') && reusado.detalle.includes('«dos»'), reusado)

  afirmar('recibirMensaje no registró errores (una disculpa técnica también cuenta)', errores.length === 0, errores)
} catch (e) {
  afirmar('probar-clientes terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-clientes borró lo que creó', false, e))
  terminar()
}
