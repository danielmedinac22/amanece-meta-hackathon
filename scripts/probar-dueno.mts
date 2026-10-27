/**
 * Prueba el lado del Dueño contra la base real y el modelo real, sin mandar nada por WhatsApp:
 * Cambios (indicador, sección, regla, conocimiento), aislamiento, aviso de un Caso y conversaciones
 * con el Agente del dueño. Usa el Negocio sembrado Café Ladera; si no existe, crea PRUEBA-DUENO.
 * Todo lo que crea lo borra al final.
 *
 *   pnpm tsx scripts/probar-dueno.mts [cambios] [aislamiento] [casos] [agente]
 *
 * Sin argumentos corre todo.
 */
import { config } from 'dotenv'
import { and, eq, gte, inArray, like } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })
// Por si algo llegara a llamar a `enviarAlCliente`: con esto solo escribe en el log.
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { correrAislado } = await import('../src/lib/aislado')
const cambios = await import('../src/negocio/cambios')
const { altaDeDueno } = await import('../src/negocio/alta')
const { datosDelNegocio } = await import('../src/negocio/datos')
const { leerHilo } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo } = await import('../src/negocio/dueno-chat')
const { crearAgenteDelDueno } = await import('../src/agentes/dueno')
const { traerCasoAlDueno } = await import('../src/agentes/avisos')

const inicioDeLaPrueba = new Date()
const seccionesPedidas = process.argv.slice(2)
const quiero = (nombre: string) => seccionesPedidas.length === 0 || seccionesPedidas.includes(nombre)

const titulo = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
const json = (v: unknown) => JSON.stringify(v, null, 2)
const medida = (c: { tokensEntrada: number; tokensSalida: number; costoUsd: number; msHastaPropuesta: number | null; msHastaAplicado: number | null }) =>
  `tokens ${c.tokensEntrada} entrada / ${c.tokensSalida} salida, costo US$${c.costoUsd.toFixed(6)}, propuesta ${c.msHastaPropuesta} ms, aplicado ${c.msHastaAplicado ?? '-'} ms`

// --- Preparación ------------------------------------------------------------------------------------

const creadosCambios: string[] = []
const creadosNegocios: string[] = []
const creadosDuenos: string[] = []
const creadosCasos: string[] = []
const creadosClientes: string[] = []
let productoDePrueba: string | null = null

async function negocioDePrueba() {
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  if (ladera) return ladera
  console.log('No hay Café Ladera sembrado: creo PRUEBA-DUENO.')
  const [negocio] = await db
    .insert(esquema.negocios)
    .values({ nombre: 'Negocio de prueba', codigo: 'PRUEBA-DUENO', estado: 'listo', conocimiento: { descripcion: 'Café', ciudad: 'Manizales', horario: 'Lunes a sábado 8 a 6', envios: 'Todo el país', pagos: 'Transferencia', tono: 'Cercano', preguntas: [] } })
    .returning()
  creadosNegocios.push(negocio.id)
  const [producto] = await db.insert(esquema.productos).values({ negocioId: negocio.id, nombre: 'Café 500 g', precio: 38000 }).returning()
  const [cliente] = await db.insert(esquema.clientes).values({ negocioId: negocio.id, telefono: '570000000001', nombre: 'Cliente de prueba' }).returning()
  const estados = ['confirmado', 'entregado', 'novedad', 'pendiente', 'cancelado', 'enviado'] as const
  await db.insert(esquema.pedidos).values(
    Array.from({ length: 30 }, (_, i) => ({
      negocioId: negocio.id,
      clienteId: cliente.id,
      numero: i + 1,
      items: [{ productoId: producto.id, nombre: producto.nombre, cantidad: 1 + (i % 3), precio: producto.precio }],
      total: producto.precio * (1 + (i % 3)),
      ciudad: i % 4 === 0 ? 'Bogotá' : 'Manizales',
      estado: estados[i % estados.length],
      creado: new Date(Date.now() - (i % 14) * 86400000 - i * 3600000),
    })),
  )
  return negocio
}

async function limpiar() {
  titulo('Limpieza')
  // Lo que el Agente del dueño propuso o aplicó en las conversaciones también se deshace.
  if (creadosDuenos.length) {
    const delAgente = await db.select().from(esquema.cambios).where(inArray(esquema.cambios.duenoId, creadosDuenos))
    for (const c of delAgente) {
      if (c.estado === 'aplicado') await cambios.revertirCambio(c.negocioId, c.id).catch(() => undefined)
      if (!creadosCambios.includes(c.id)) creadosCambios.push(c.id)
    }
  }
  if (creadosCambios.length) {
    await db.delete(esquema.piezas).where(inArray(esquema.piezas.cambioId, creadosCambios))
    await db.delete(esquema.reglas).where(inArray(esquema.reglas.cambioId, creadosCambios))
    await db.delete(esquema.cambios).where(inArray(esquema.cambios.id, creadosCambios))
  }
  if (productoDePrueba) await db.delete(esquema.productos).where(eq(esquema.productos.id, productoDePrueba))
  if (creadosCasos.length) await db.delete(esquema.casos).where(inArray(esquema.casos.id, creadosCasos))
  if (creadosClientes.length) await db.delete(esquema.clientes).where(inArray(esquema.clientes.id, creadosClientes))
  if (creadosDuenos.length) await db.delete(esquema.duenos).where(inArray(esquema.duenos.id, creadosDuenos))
  if (creadosNegocios.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creadosNegocios))
  // Los turnos del generador y del Agente del dueño de esta corrida son de prueba: no van a la medición real.
  const borrados = await db
    .delete(esquema.turnos)
    .where(and(inArray(esquema.turnos.agente, ['generador', 'dueno']), gte(esquema.turnos.creado, inicioDeLaPrueba)))
    .returning({ id: esquema.turnos.id })
  console.log(`Borrado lo que creó la prueba (y ${borrados.length} turnos de prueba).`)
}

function textoDe(m: { parts: { type: string; text?: string }[] }) {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
}
function herramientasDe(m: { parts: { type: string }[] }) {
  return m.parts.filter((p) => p.type.startsWith('tool-')).map((p) => p.type.replace('tool-', ''))
}

/** Un turno completo contra el Hilo: manda el mensaje, espera la respuesta y la imprime. */
async function turno(negocioId: string, duenoId: string, texto: string) {
  const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocioId))
  const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, duenoId))
  const mensaje = mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })!
  const inicio = Date.now()
  const respuesta = await responderEnElHilo({ negocio, dueno, mensaje })
  await respuesta.text() // lee el stream hasta el final: ahí se guarda la respuesta
  await new Promise((r) => setTimeout(r, 400))
  const hilo = await leerHilo(duenoId)
  const ultimo = hilo.at(-1)!
  console.log(`\nDueño: ${texto}`)
  console.log(`Agente (${Date.now() - inicio} ms, herramientas: ${herramientasDe(ultimo).join(', ') || 'ninguna'}):\n${textoDe(ultimo as never)}`)
  return ultimo
}

// --- Programa ---------------------------------------------------------------------------------------

try {
  const negocio = await negocioDePrueba()
  console.log(`Negocio: ${negocio.nombre} (${negocio.codigo})`)
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: negocio.id, usuarioId: `prueba-dueno-${Date.now()}`, nombre: 'Dueño de prueba' }).returning()
  creadosDuenos.push(dueno.id)

  if (quiero('cambios')) {
    titulo('1. Indicador: pedidos confirmados por día en los últimos 14 días')
    const indicador = await cambios.proponerPieza(negocio.id, dueno.id, 'Quiero ver los pedidos confirmados por día en los últimos 14 días', 'indicador', 'Pedidos confirmados por día')
    creadosCambios.push(indicador.id)
    const pi = indicador.propuesta as { codigo: string; descripcion: string }
    console.log(`estado: ${indicador.estado}\n${pi.descripcion}\n--- código ---\n${pi.codigo}\n--- resultado aislado ---\n${json(indicador.vistaPrevia)}\n${medida(indicador)}`)

    titulo('2. Sección: pedidos con novedad')
    const seccion = await cambios.proponerPieza(negocio.id, dueno.id, 'Quiero una lista de los pedidos con novedad', 'seccion', 'Pedidos con novedad')
    creadosCambios.push(seccion.id)
    const ps = seccion.propuesta as { codigo: string; descripcion: string; vista: unknown }
    console.log(`estado: ${seccion.estado}\n${ps.descripcion}\n--- código ---\n${ps.codigo}\n--- vista ---\n${json(ps.vista)}\n--- resultado aislado ---\n${json(seccion.vistaPrevia)}\n${medida(seccion)}`)

    titulo('3. Aplicar, ver en el Panel y revertir')
    for (const c of [indicador, seccion]) if (c.estado === 'propuesto') await cambios.aplicarCambio(negocio.id, c.id)
    const activas = await cambios.piezasActivas(negocio.id)
    console.log(`Piezas activas tras aplicar: ${activas.map((a) => `${a.pieza.nombre} v${a.pieza.version} (${a.resultado.ok ? `ok ${a.resultado.ms} ms` : a.resultado.error})`).join(' | ')}`)
    const [aplicadoI] = await db.select().from(esquema.cambios).where(eq(esquema.cambios.id, indicador.id))
    const [aplicadoS] = await db.select().from(esquema.cambios).where(eq(esquema.cambios.id, seccion.id))
    console.log(`Indicador: ${medida(aplicadoI)}\nSección:   ${medida(aplicadoS)}`)

    if (indicador.estado === 'propuesto') {
      console.log('\nNueva versión del mismo indicador (últimos 7 días):')
      const v2 = await cambios.proponerPieza(negocio.id, dueno.id, 'Mejor solo los últimos 7 días', 'indicador', 'Pedidos confirmados por día')
      creadosCambios.push(v2.id)
      console.log(`estado: ${v2.estado}, ${medida(v2)}`)
      if (v2.estado === 'propuesto') {
        await cambios.aplicarCambio(negocio.id, v2.id)
        const filas = await db.select().from(esquema.piezas).where(eq(esquema.piezas.negocioId, negocio.id))
        console.log('Versiones:', filas.filter((f) => f.cambioId && creadosCambios.includes(f.cambioId)).map((f) => `${f.nombre} v${f.version} activa=${f.activa}`).join(' | '))
        await cambios.revertirCambio(negocio.id, v2.id)
        const tras = (await db.select().from(esquema.piezas).where(eq(esquema.piezas.negocioId, negocio.id))).filter((f) => f.cambioId && creadosCambios.includes(f.cambioId))
        console.log('Tras revertir la v2:', tras.map((f) => `${f.nombre} v${f.version} activa=${f.activa}`).join(' | '))
      }
    }
    for (const c of [indicador, seccion]) if (c.estado === 'propuesto') await cambios.revertirCambio(negocio.id, c.id)
    console.log(`Piezas activas tras revertir: ${(await cambios.piezasActivas(negocio.id)).length}`)

    titulo('3b. Reintento: el primer código falla y el error vuelve al generador')
    const { generarPieza } = await import('../src/agentes/generador')
    const intentosVistos: ({ codigo: string; error: string } | undefined)[] = []
    const malos = ['function calcular(datos) { return { valor: datos.pedidos.filtrar(function (p) { return p.estado === "novedad" }).length } }', 'function calcular(datos) { return { total: 3 } }']
    const reintento = await cambios.proponerPieza(negocio.id, dueno.id, 'Cuántos pedidos tienen novedad', 'indicador', 'Novedades (prueba de reintento)', async (entrada) => {
      intentosVistos.push(entrada.intentoFallido)
      if (intentosVistos.length <= malos.length) return { pieza: { descripcion: 'malo a propósito', codigo: malos[intentosVistos.length - 1], vista: null }, medida: { entrada: 0, salida: 0, costo: 0, ms: 0 } }
      return generarPieza(entrada)
    })
    creadosCambios.push(reintento.id)
    console.log(`estado: ${reintento.estado}; intentos: ${intentosVistos.length}`)
    intentosVistos.forEach((v, i) => console.log(`  intento ${i + 1} recibió: ${v ? v.error.slice(0, 160) : '(sin error previo)'}`))
    console.log(`resultado: ${JSON.stringify((reintento.vistaPrevia as { resultado?: unknown }).resultado)}`)

    titulo('4. Regla: envíos fuera de Manizales')
    const regla = await cambios.proponerRegla(
      negocio.id,
      dueno.id,
      'Si preguntan por envíos fuera de Manizales, no prometas fecha de entrega y abre un Caso',
      'Si un Cliente pregunta por envíos a una ciudad distinta de Manizales, no prometas fecha de entrega y abre un Caso para que el Dueño responda.',
      '¿Cuánto demora un envío a Cali? ¿Me llega para el viernes?',
    )
    creadosCambios.push(regla.id)
    console.log(`${json(regla.vistaPrevia)}\n${medida(regla)}`)
    await cambios.aplicarCambio(negocio.id, regla.id)
    console.log('Reglas activas tras aplicar:', (await cambios.reglasActivas(negocio.id)).map((r) => `v${r.version}: ${r.texto.slice(0, 60)}`))
    await cambios.revertirCambio(negocio.id, regla.id)
    console.log('Reglas activas tras revertir:', (await cambios.reglasActivas(negocio.id)).length)

    titulo('5. Conocimiento: horario y un producto nuevo')
    const antes = (await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id)))[0].conocimiento.horario
    const conocimiento = await cambios.proponerConocimiento(
      negocio.id,
      dueno.id,
      'Ahora abrimos también los domingos y vendemos un café de prueba',
      { horario: `${antes} y domingos de 9 a 1` },
      { agregar: [{ nombre: 'Café de prueba 250 g', precio: 21000 }] },
    )
    creadosCambios.push(conocimiento.id)
    console.log(`${json(conocimiento.vistaPrevia)}\n${medida(conocimiento)}`)
    await cambios.aplicarCambio(negocio.id, conocimiento.id)
    const [aplicado] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
    const nuevos = await db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, negocio.id), like(esquema.productos.nombre, 'Café de prueba%')))
    productoDePrueba = nuevos[0]?.id ?? null
    console.log(`Horario aplicado: "${aplicado.conocimiento.horario}"; productos de prueba activos: ${nuevos.filter((p) => p.activo).length}`)
    await cambios.revertirCambio(negocio.id, conocimiento.id)
    const [revertido] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
    const tras = await db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, negocio.id), like(esquema.productos.nombre, 'Café de prueba%')))
    console.log(`Tras revertir: horario "${revertido.conocimiento.horario}" (igual que antes: ${revertido.conocimiento.horario === antes}); productos de prueba activos: ${tras.filter((p) => p.activo).length}`)
  }

  if (quiero('aislamiento')) {
    titulo('6. Aislamiento')
    const datos = await datosDelNegocio(negocio.id)
    const [otro] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, negocio.codigo === 'TRIGO' ? 'LADERA' : 'TRIGO'))
    const otroNegocio = otro ?? null
    const marcas = otroNegocio
      ? (await db.select({ nombre: esquema.clientes.nombre }).from(esquema.clientes).where(eq(esquema.clientes.negocioId, otroNegocio.id))).map((c) => c.nombre).filter(Boolean)
      : []
    const intentos: [string, string][] = [
      ['leer datos.otros', 'function consultar(datos){ return [{ otros: String(datos.otros), negocios: String(datos.negocios), keys: Object.keys(datos).join(",") }] }'],
      ['fetch', 'function consultar(datos){ return [{ fetch: typeof fetch, xhr: typeof XMLHttpRequest, websocket: typeof WebSocket }] }'],
      ['process / require / import', 'function consultar(datos){ return [{ process: typeof process, require: typeof require, importa: typeof globalThis.import }] }'],
      ['llamar a fetch', 'function consultar(datos){ return fetch("https://example.com").then ? [] : [] }'],
      ['volcar todos los datos', 'function consultar(datos){ return [{ todo: JSON.stringify(datos) }] }'],
      ['bucle infinito', 'function consultar(datos){ while(true){} }'],
    ]
    for (const [nombre, codigo] of intentos) {
      const r = await correrAislado(codigo, 'consultar', datos)
      let salida = r.ok ? JSON.stringify(r.valor).slice(0, 220) : `ERROR: ${r.error}`
      if (nombre === 'volcar todos los datos' && r.ok) {
        const volcado = JSON.stringify(r.valor)
        const filtradas = marcas.filter((m) => volcado.includes(m))
        salida = `volcado de ${volcado.length} caracteres; clientes de ${otroNegocio?.nombre ?? 'otro Negocio'} dentro: ${filtradas.length} de ${marcas.length}; teléfonos completos: ${/\b57\d{9}\b/.test(volcado) ? 'SÍ (mal)' : 'no, enmascarados'}`
      }
      console.log(`- ${nombre}: ${salida}`)
    }
    if (otroNegocio) {
      // Un Cambio propuesto en este Negocio no se puede aplicar desde otro.
      const propuesto = await cambios.proponerConocimiento(negocio.id, dueno.id, 'prueba de aislamiento', { tono: 'prueba' })
      creadosCambios.push(propuesto.id)
      const intento = await cambios.aplicarCambio(otroNegocio.id, propuesto.id).then(
        () => 'SE APLICÓ (mal)',
        (e: Error) => `rechazado: ${e.message}`,
      )
      console.log(`- aplicar un Cambio de ${negocio.nombre} desde ${otroNegocio.nombre}: ${intento}`)
      const [sigue] = await db.select({ estado: esquema.cambios.estado }).from(esquema.cambios).where(eq(esquema.cambios.id, propuesto.id))
      console.log(`  estado del Cambio después: ${sigue.estado}`)
    }
  }

  if (quiero('casos')) {
    titulo('7. Aviso de un Caso al Hilo del Dueño y resolver_caso (envío simulado)')
    const [cliente] = await db
      .insert(esquema.clientes)
      .values({ negocioId: negocio.id, telefono: '570000000099', nombre: 'Cliente de Prueba', ultimoMensajeEntrante: new Date() })
      .returning()
    creadosClientes.push(cliente.id)
    await db.insert(esquema.mensajesCliente).values([
      { negocioId: negocio.id, clienteId: cliente.id, rol: 'cliente', texto: 'Hola, quiero 2 bolsas de café para Cali, ¿me llegan el viernes?' },
      { negocioId: negocio.id, clienteId: cliente.id, rol: 'agente', texto: 'Con gusto. Déjame confirmar con el equipo la fecha de envío a Cali y te cuento.' },
    ])
    const [caso] = await db
      .insert(esquema.casos)
      .values({ negocioId: negocio.id, clienteId: cliente.id, titulo: 'Envío a Cali para el viernes', detalle: 'El Cliente pide la fecha de entrega en Cali y quiere recibirlo el viernes.' })
      .returning()
    creadosCasos.push(caso.id)
    const inicio = Date.now()
    await traerCasoAlDueno(caso.id)
    console.log(`traerCasoAlDueno: ${Date.now() - inicio} ms`)
    const [conPropuesta] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
    console.log(`Caso: estado=${conPropuesta.estado}\npropuesta guardada:\n${conPropuesta.propuesta}`)
    const hilo = await leerHilo(dueno.id)
    const aviso = hilo.at(-1)!
    console.log(`\nMensaje en el Hilo del Dueño (${hilo.length} en total):\n${textoDe(aviso as never)}\npartes: ${aviso.parts.map((p) => p.type).join(', ')}`)

    const { tools } = crearAgenteDelDueno({ negocio, dueno })
    const resolver = tools.resolver_caso as { execute: (i: unknown, o: unknown) => Promise<unknown> }
    const r = await resolver.execute({ casoId: caso.id, respuestaAlCliente: 'Hola, te confirmo que el envío a Cali sale mañana y llega en 3 días hábiles.', resolucion: 'Se confirmó la fecha', elDuenoAprobo: true }, { toolCallId: 'x', messages: [] })
    console.log('\nresolver_caso (con ENVIO_SIMULADO=1, no sale nada):', JSON.stringify(r))
    const [resuelto] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
    console.log(`Caso tras resolver: estado=${resuelto.estado}`)
    // Una tool de otro Negocio no encuentra el Caso.
    if (negocio.codigo !== 'TRIGO') {
      const [trigo] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
      if (trigo) {
        const [duenoAjeno] = [{ ...dueno, negocioId: trigo.id }]
        const ajeno = crearAgenteDelDueno({ negocio: trigo, dueno: duenoAjeno }).tools.resolver_caso as { execute: (i: unknown, o: unknown) => Promise<unknown> }
        console.log('resolver_caso desde otro Negocio:', JSON.stringify(await ajeno.execute({ casoId: caso.id, respuestaAlCliente: 'x', resolucion: 'x', elDuenoAprobo: true }, { toolCallId: 'x', messages: [] })))
      }
    }
  }

  if (quiero('agente')) {
    titulo('8. Agente del dueño, Negocio abierto: de la petición a aplicar')
    await turno(negocio.id, dueno.id, 'Quiero ver cuántos pedidos tengo con novedad, en una lista.')
    const propuestos = await db.select().from(esquema.cambios).where(and(eq(esquema.cambios.negocioId, negocio.id), eq(esquema.cambios.estado, 'propuesto')))
    creadosCambios.push(...propuestos.map((c) => c.id))
    await turno(negocio.id, dueno.id, 'Sí, aplícalo.')
    const aplicados = await db.select().from(esquema.cambios).where(and(eq(esquema.cambios.negocioId, negocio.id), eq(esquema.cambios.duenoId, dueno.id)))
    creadosCambios.push(...aplicados.map((c) => c.id).filter((id) => !creadosCambios.includes(id)))
    console.log(`\nCambios de esta conversación: ${aplicados.map((c) => `${c.tipo}/${c.estado}`).join(', ')}`)
    await turno(negocio.id, dueno.id, '¿Me puedes mandar una factura electrónica a cada cliente?')
    const faltantes = await db.select().from(esquema.capacidadesFaltantes).where(eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    console.log(`Capacidades faltantes registradas: ${faltantes.length}`)
    await db.delete(esquema.capacidadesFaltantes).where(and(eq(esquema.capacidadesFaltantes.negocioId, negocio.id), like(esquema.capacidadesFaltantes.pedido, '%factura%')))

    titulo('9. Agente del dueño, Negocio nuevo (modo armando): alta + entrevista')
    const { negocio: nuevo, dueno: duenoNuevo } = await altaDeDueno({ id: `prueba-alta-${Date.now()}`, name: 'Marta', email: 'marta@example.com' })
    creadosNegocios.push(nuevo.id)
    console.log(`Alta: Negocio "${nuevo.nombre}" código ${nuevo.codigo} estado ${nuevo.estado}; Hilo inicial: ${(await leerHilo(duenoNuevo.id)).length} mensaje`)
    const guion = [
      'Hola, mi negocio se llama Dulces de la Abuela, vendemos arequipe y brevas caladas, en Popayán.',
      'El arequipe de 500 g vale 18000 y las brevas caladas de 400 g valen 25000. Enviamos a todo el país con Servientrega, entre 3 y 5 días y el envío cuesta 12000. Pagan por transferencia o Nequi.',
      'Atendemos de lunes a sábado de 8 a 6. Hablamos con mucho cariño y cercanía, de tú.',
      'Sí, está bien así, ábrelo.',
    ]
    for (const texto of guion) {
      await turno(nuevo.id, duenoNuevo.id, texto)
      const [actual] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, nuevo.id))
      if (actual.estado === 'listo') break
    }
    // Ya abierto, el mismo Hilo sigue con las herramientas del modo `listo` (y los mensajes del modo `armando` en su historia).
    await turno(nuevo.id, duenoNuevo.id, 'Sube el precio del arequipe de 500 g a 19000.')
    await turno(nuevo.id, duenoNuevo.id, 'Sí, aplícalo.')
    const [arequipe] = await db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, nuevo.id), like(esquema.productos.nombre, '%requipe%')))
    console.log(`Precio del arequipe tras el Cambio: ${arequipe?.precio}`)
    const [final] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, nuevo.id))
    const productos = await db.select().from(esquema.productos).where(eq(esquema.productos.negocioId, nuevo.id))
    console.log(`\nNegocio tras la entrevista: "${final.nombre}", estado ${final.estado}, rubro "${final.rubro}", ciudad "${final.conocimiento.ciudad}", ${productos.length} productos`)
  }

  const turnos = await db.select().from(esquema.turnos).where(eq(esquema.turnos.negocioId, negocio.id))
  const porAgente = Object.groupBy(turnos, (t) => t.agente)
  console.log('\nTurnos registrados en el Negocio de prueba:', Object.entries(porAgente).map(([a, t]) => `${a}: ${t!.length}`).join(', '))
} finally {
  await limpiar()
}
