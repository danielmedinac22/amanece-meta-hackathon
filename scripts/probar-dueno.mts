/**
 * Prueba el lado del Dueño contra la base real y el modelo real, sin mandar nada por WhatsApp:
 * Cambios (indicador, sección, regla, conocimiento), aislamiento, aviso de un Caso y conversaciones
 * con el Agente del dueño. Usa el Negocio sembrado Café Ladera; si no existe, crea PRUEBA-DUENO.
 * Todo lo que crea lo borra al final, también si falla. Cada caso se afirma contra lo que quedó en la base o
 * lo que se habría enviado, nunca contra el texto del modelo, y el script sale con 1 si alguno falla.
 *
 *   pnpm tsx scripts/probar-dueno.mts [cambios] [aislamiento] [casos] [agente]
 *
 * Sin argumentos corre todo.
 */
import { config } from 'dotenv'
import { convertToModelMessages } from 'ai'
import { and, eq, gte, inArray, like, sql } from 'drizzle-orm'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
// La respuesta a un Caso sale por `despachar`: con esto solo escribe en el log.
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()

const { db, esquema } = await import('../src/db')
const { correrAislado } = await import('../src/lib/aislado')
const cambios = await import('../src/negocio/cambios')
const { altaDeDueno } = await import('../src/negocio/alta')
const { datosDelNegocio } = await import('../src/negocio/datos')
const { leerHilo } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo, tarjetasDe } = await import('../src/negocio/dueno-chat')
const { crearAgenteDelDueno, parteDeDatosParaElModelo } = await import('../src/agentes/dueno')
const { aprobar } = await import('../src/nucleo/cambios')
const { marcar } = await import('../src/nucleo/identidad')
const { traerCasoAlDueno } = await import('../src/agentes/avisos')

const inicioDeLaPrueba = new Date()
/** El `ContextoDelDueno` que acuña la sesión, para un Dueño de prueba. */
const ctxDe = (negocio: string, dueno: string) => ({ negocio: marcar.negocio(negocio), dueno: marcar.dueno(dueno), medio: 'web' as const })
const seccionesPedidas = process.argv.slice(2)
const quiero = (nombre: string) => seccionesPedidas.length === 0 || seccionesPedidas.includes(nombre)

const titulo = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
const json = (v: unknown) => JSON.stringify(v, null, 2)
const vistaPreviaExitosa = (vista: unknown) => {
  const v = vista as { resultado?: unknown; error?: unknown } | null
  return v?.resultado !== undefined && v.error === undefined
}
const medida = (c: { tokensEntrada: number; tokensSalida: number; costoUsd: number; msHastaPropuesta: number | null; msHastaAplicado: number | null }) =>
  `tokens ${c.tokensEntrada} entrada / ${c.tokensSalida} salida, costo US$${c.costoUsd.toFixed(6)}, propuesta ${c.msHastaPropuesta} ms, aplicado ${c.msHastaAplicado ?? '-'} ms`

// --- Preparación ------------------------------------------------------------------------------------

const creadosCambios: string[] = []
const creadosNegocios: string[] = []
const creadosDuenos: string[] = []
const creadosCasos: string[] = []
const creadosClientes: string[] = []
let negocioDeLaPrueba: string | undefined

/** El otro Negocio sembrado, para probar que uno no ve ni toca lo del otro. */
async function negocioAjeno(codigoDelPropio: string) {
  const [ajeno] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, codigoDelPropio === 'TRIGO' ? 'LADERA' : 'TRIGO'))
  return ajeno ?? null
}

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
    for (const c of delAgente) if (!creadosCambios.includes(c.id)) creadosCambios.push(c.id)
  }
  // Un Cambio que no se pudo revertir se queda: su `anterior` es la única copia de lo que había antes.
  const sinRevertir: string[] = []
  if (creadosCambios.length) {
    for (const c of await db.select().from(esquema.cambios).where(inArray(esquema.cambios.id, creadosCambios))) {
      if (c.estado !== 'aplicado') continue
      await cambios.revertirCambio(c.negocioId, c.id).catch((e) => {
        sinRevertir.push(c.id)
        afirmar(`limpieza: revirtió el Cambio ${c.id} (${c.tipo})`, false, e)
      })
    }
    const borrables = creadosCambios.filter((id) => !sinRevertir.includes(id))
    const productosCreados = (await db.select({ anterior: esquema.cambios.anterior }).from(esquema.cambios).where(inArray(esquema.cambios.id, creadosCambios))).flatMap(
      (c) => ((c.anterior as { productosCreados?: string[] } | null)?.productosCreados ?? []),
    )
    if (borrables.length) {
      await db.delete(esquema.piezas).where(inArray(esquema.piezas.cambioId, borrables))
      await db.delete(esquema.reglas).where(inArray(esquema.reglas.cambioId, borrables))
      await db.delete(esquema.cambios).where(inArray(esquema.cambios.id, borrables))
    }
    if (productosCreados.length && !sinRevertir.length) await db.delete(esquema.productos).where(inArray(esquema.productos.id, productosCreados))
  }
  // Las propuestas de esta corrida, también las de la respuesta a un Caso, que no tienen Cambio.
  if (negocioDeLaPrueba) await db.delete(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, negocioDeLaPrueba), gte(esquema.propuestas.creado, inicioDeLaPrueba)))
  if (negocioDeLaPrueba) await db.delete(esquema.capacidadesFaltantes).where(and(eq(esquema.capacidadesFaltantes.negocioId, negocioDeLaPrueba), gte(esquema.capacidadesFaltantes.creado, inicioDeLaPrueba)))
  if (creadosCasos.length && negocioDeLaPrueba) {
    // El aviso de un Caso llega al Hilo de cada Dueño del Negocio, no solo al de la prueba.
    const hilo = await db
      .select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje })
      .from(esquema.mensajesDueno)
      .where(and(eq(esquema.mensajesDueno.negocioId, negocioDeLaPrueba), gte(esquema.mensajesDueno.creado, inicioDeLaPrueba)))
    const avisos = hilo.filter((m) => creadosCasos.some((id) => JSON.stringify(m.mensaje).includes(id))).map((m) => m.id)
    if (avisos.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, avisos))
  }
  if (creadosCasos.length) await db.delete(esquema.casos).where(inArray(esquema.casos.id, creadosCasos))
  if (creadosClientes.length) await db.delete(esquema.clientes).where(inArray(esquema.clientes.id, creadosClientes))
  if (creadosDuenos.length) await db.delete(esquema.duenos).where(inArray(esquema.duenos.id, creadosDuenos))
  if (creadosNegocios.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creadosNegocios))
  // Los turnos del generador y del Agente del dueño de esta corrida son de prueba: no van a la medición real.
  const borrados = negocioDeLaPrueba
    ? await db
        .delete(esquema.turnos)
        .where(and(eq(esquema.turnos.negocioId, negocioDeLaPrueba), inArray(esquema.turnos.agente, ['generador', 'dueno']), gte(esquema.turnos.creado, inicioDeLaPrueba)))
        .returning({ id: esquema.turnos.id })
    : []
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
  const respuesta = await responderEnElHilo({ ctx: ctxDe(negocioId, duenoId), negocio, dueno, mensaje })
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
  negocioDeLaPrueba = negocio.id
  console.log(`Negocio: ${negocio.nombre} (${negocio.codigo})`)
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: negocio.id, usuarioId: `prueba-dueno-${Date.now()}`, nombre: 'Dueño de prueba' }).returning()
  creadosDuenos.push(dueno.id)

  if (quiero('cambios')) {
    titulo('1. Indicador: pedidos confirmados por día en los últimos 14 días')
    const indicador = await cambios.proponerPieza(negocio.id, dueno.id, 'Quiero ver los pedidos confirmados por día en los últimos 14 días', 'indicador', 'Pedidos confirmados por día')
    creadosCambios.push(indicador.id)
    const pi = indicador.propuesta as { codigo: string; descripcion: string }
    console.log(`estado: ${indicador.estado}\n${pi.descripcion}\n--- código ---\n${pi.codigo}\n--- resultado aislado ---\n${json(indicador.vistaPrevia)}\n${medida(indicador)}`)
    afirmar('1 indicador: queda propuesto', indicador.estado === 'propuesto', indicador.vistaPrevia)
    afirmar('1 indicador: la vista previa trae un resultado y ningún error', vistaPreviaExitosa(indicador.vistaPrevia), indicador.vistaPrevia)
    afirmar('1 indicador: midió tokens de entrada y de salida', indicador.tokensEntrada > 0 && indicador.tokensSalida > 0, medida(indicador))

    titulo('2. Sección: pedidos con novedad')
    const seccion = await cambios.proponerPieza(negocio.id, dueno.id, 'Quiero una lista de los pedidos con novedad', 'seccion', 'Pedidos con novedad')
    creadosCambios.push(seccion.id)
    const ps = seccion.propuesta as { codigo: string; descripcion: string; vista: unknown }
    console.log(`estado: ${seccion.estado}\n${ps.descripcion}\n--- código ---\n${ps.codigo}\n--- vista ---\n${json(ps.vista)}\n--- resultado aislado ---\n${json(seccion.vistaPrevia)}\n${medida(seccion)}`)
    afirmar('2 sección: queda propuesta', seccion.estado === 'propuesto', seccion.vistaPrevia)
    afirmar('2 sección: la vista previa trae un resultado y ningún error', vistaPreviaExitosa(seccion.vistaPrevia), seccion.vistaPrevia)
    afirmar('2 sección: midió tokens de entrada y de salida', seccion.tokensEntrada > 0 && seccion.tokensSalida > 0, medida(seccion))

    titulo('3. Aplicar, ver en el Panel y revertir')
    for (const c of [indicador, seccion]) if (c.estado === 'propuesto') await cambios.aplicarCambio(negocio.id, c.id)
    const activas = await cambios.piezasActivas(negocio.id)
    console.log(`Piezas activas tras aplicar: ${activas.map((a) => `${a.pieza.nombre} v${a.pieza.version} (${a.resultado.ok ? `ok ${a.resultado.ms} ms` : a.resultado.error})`).join(' | ')}`)
    const [aplicadoI] = await db.select().from(esquema.cambios).where(eq(esquema.cambios.id, indicador.id))
    const [aplicadoS] = await db.select().from(esquema.cambios).where(eq(esquema.cambios.id, seccion.id))
    console.log(`Indicador: ${medida(aplicadoI)}\nSección:   ${medida(aplicadoS)}`)
    for (const [nombre, c, fila] of [['el indicador', indicador, aplicadoI], ['la sección', seccion, aplicadoS]] as const) {
      afirmar(`3 aplicar: ${nombre} queda aplicado y activo, y corre bien en el Panel`, fila.estado === 'aplicado' && activas.some((a) => a.pieza.cambioId === c.id && a.resultado.ok), { estado: fila.estado, activas: activas.map((a) => ({ cambioId: a.pieza.cambioId, resultado: a.resultado })) })
    }

    if (indicador.estado === 'propuesto') {
      console.log('\nNueva versión del mismo indicador (últimos 7 días):')
      const v2 = await cambios.proponerPieza(negocio.id, dueno.id, 'Mejor solo los últimos 7 días', 'indicador', 'Pedidos confirmados por día')
      creadosCambios.push(v2.id)
      console.log(`estado: ${v2.estado}, ${medida(v2)}`)
      afirmar('3 nueva versión: la v2 del indicador queda propuesta', v2.estado === 'propuesto', v2.vistaPrevia)
      if (v2.estado === 'propuesto') {
        await cambios.aplicarCambio(negocio.id, v2.id)
        const filas = await db.select().from(esquema.piezas).where(eq(esquema.piezas.negocioId, negocio.id))
        console.log('Versiones:', filas.filter((f) => f.cambioId && creadosCambios.includes(f.cambioId)).map((f) => `${f.nombre} v${f.version} activa=${f.activa}`).join(' | '))
        const versionDe = (todas: typeof filas, cambioId: string) => todas.find((f) => f.cambioId === cambioId)
        afirmar('3 nueva versión: al aplicar la v2 es la activa y la v1 no', versionDe(filas, v2.id)?.activa === true && versionDe(filas, v2.id)?.version === 2 && versionDe(filas, indicador.id)?.activa === false, filas.filter((f) => f.cambioId && creadosCambios.includes(f.cambioId)))
        await cambios.revertirCambio(negocio.id, v2.id)
        const tras = (await db.select().from(esquema.piezas).where(eq(esquema.piezas.negocioId, negocio.id))).filter((f) => f.cambioId && creadosCambios.includes(f.cambioId))
        console.log('Tras revertir la v2:', tras.map((f) => `${f.nombre} v${f.version} activa=${f.activa}`).join(' | '))
        afirmar('3 nueva versión: al revertir la v2 vuelve a estar activa la v1', versionDe(tras, v2.id)?.activa === false && versionDe(tras, indicador.id)?.activa === true, tras)
      }
    }
    for (const c of [indicador, seccion]) if (c.estado === 'propuesto') await cambios.revertirCambio(negocio.id, c.id)
    const piezasTras = await cambios.piezasActivas(negocio.id)
    console.log(`Piezas activas tras revertir: ${piezasTras.length}`)
    afirmar('3 revertir: no queda activa ninguna pieza de esta corrida', piezasTras.every((a) => !a.pieza.cambioId || !creadosCambios.includes(a.pieza.cambioId)), piezasTras.map((a) => a.pieza))

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
    afirmar('3b reintento: el generador corrió exactamente 3 veces', intentosVistos.length === 3, intentosVistos.length)
    afirmar('3b reintento: el primer intento no recibió error previo', intentosVistos[0] === undefined, intentosVistos[0])
    afirmar('3b reintento: el 2.º y el 3.º recibieron el código y el error del intento anterior', intentosVistos.slice(1).length === 2 && intentosVistos.slice(1).every((v, i) => v?.codigo === malos[i] && v.error.length > 0), intentosVistos.slice(1))
    afirmar('3b reintento: el Cambio termina propuesto con un resultado', reintento.estado === 'propuesto' && vistaPreviaExitosa(reintento.vistaPrevia), reintento.vistaPrevia)

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
    const simulada = regla.vistaPrevia as { antes?: unknown; despues?: unknown }
    afirmar('4 regla: queda propuesta con la simulación de antes y después', regla.estado === 'propuesto' && typeof simulada.antes === 'string' && simulada.antes.length > 0 && typeof simulada.despues === 'string' && simulada.despues.length > 0, regla.vistaPrevia)
    const reglasAntes = (await cambios.reglasActivas(negocio.id)).length
    await cambios.aplicarCambio(negocio.id, regla.id)
    const reglasConLaNueva = await cambios.reglasActivas(negocio.id)
    console.log('Reglas activas tras aplicar:', reglasConLaNueva.map((r) => `v${r.version}: ${r.texto.slice(0, 60)}`))
    afirmar('4 regla: tras aplicar aparece entre las reglas activas', reglasConLaNueva.length === reglasAntes + 1 && reglasConLaNueva.some((r) => r.cambioId === regla.id), reglasConLaNueva)
    await cambios.revertirCambio(negocio.id, regla.id)
    const reglasTras = await cambios.reglasActivas(negocio.id)
    console.log('Reglas activas tras revertir:', reglasTras.length)
    afirmar('4 regla: tras revertir ya no está y quedan las de antes', reglasTras.length === reglasAntes && reglasTras.every((r) => r.cambioId !== regla.id), reglasTras)

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
    console.log(`Horario aplicado: "${aplicado.conocimiento.horario}"; productos de prueba activos: ${nuevos.filter((p) => p.activo).length}`)
    afirmar('5 conocimiento: tras aplicar el horario es el nuevo', aplicado.conocimiento.horario === `${antes} y domingos de 9 a 1`, aplicado.conocimiento.horario)
    afirmar('5 conocimiento: tras aplicar el producto nuevo está activo con su precio', nuevos.filter((p) => p.activo).length === 1 && nuevos[0].precio === 21000, nuevos)
    await cambios.revertirCambio(negocio.id, conocimiento.id)
    const [revertido] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
    const tras = await db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, negocio.id), like(esquema.productos.nombre, 'Café de prueba%')))
    console.log(`Tras revertir: horario "${revertido.conocimiento.horario}" (igual que antes: ${revertido.conocimiento.horario === antes}); productos de prueba activos: ${tras.filter((p) => p.activo).length}`)
    afirmar('5 conocimiento: tras revertir el horario vuelve al de antes', revertido.conocimiento.horario === antes, revertido.conocimiento.horario)
    afirmar('5 conocimiento: tras revertir no queda activo el producto de prueba', tras.every((p) => !p.activo), tras)
  }

  if (quiero('aislamiento')) {
    titulo('6. Aislamiento')
    const datos = await datosDelNegocio(negocio.id)
    const otroNegocio = await negocioAjeno(negocio.codigo)
    afirmar('6 aislamiento: hay otro Negocio sembrado con Clientes para compararlo', otroNegocio !== null, 'Falta sembrar TRIGO y LADERA: pnpm tsx scripts/sembrar.mts')
    const marcas = otroNegocio ? (await db.select({ id: esquema.clientes.id }).from(esquema.clientes).where(eq(esquema.clientes.negocioId, otroNegocio.id))).map((c) => c.id) : []
    afirmar('6 aislamiento: el otro Negocio tiene Clientes que buscar', marcas.length > 0, otroNegocio?.codigo)
    const intentos: [string, string][] = [
      ['leer datos.otros', 'function consultar(datos){ return [{ otros: String(datos.otros), negocios: String(datos.negocios), keys: Object.keys(datos).join(",") }] }'],
      ['fetch', 'function consultar(datos){ return [{ fetch: typeof fetch, xhr: typeof XMLHttpRequest, websocket: typeof WebSocket }] }'],
      ['process / require / import', 'function consultar(datos){ return [{ process: typeof process, require: typeof require, importa: typeof globalThis.import }] }'],
      ['llamar a fetch', 'function consultar(datos){ return fetch("https://example.com").then ? [] : [] }'],
      ['volcar todos los datos', 'function consultar(datos){ return [{ todo: JSON.stringify(datos) }] }'],
      ['bucle infinito', 'function consultar(datos){ while(true){} }'],
    ]
    const corridas = new Map<string, Awaited<ReturnType<typeof correrAislado>>>()
    for (const [nombre, codigo] of intentos) {
      const r = await correrAislado(codigo, 'consultar', datos)
      corridas.set(nombre, r)
      let salida = r.ok ? JSON.stringify(r.valor).slice(0, 220) : `ERROR: ${r.error}`
      if (nombre === 'volcar todos los datos' && r.ok) {
        const volcado = JSON.stringify(r.valor)
        const filtradas = marcas.filter((m) => volcado.includes(m))
        salida = `volcado de ${volcado.length} caracteres; clientes de ${otroNegocio?.nombre ?? 'otro Negocio'} dentro: ${filtradas.length} de ${marcas.length}; teléfonos completos: ${/\b57\d{10}\b/.test(volcado) ? 'SÍ (mal)' : 'no, enmascarados'}`
      }
      console.log(`- ${nombre}: ${salida}`)
    }
    const fila = (nombre: string) => {
      const r = corridas.get(nombre)
      return r?.ok ? (r.valor as Record<string, string>[])[0] : undefined
    }
    const visto = fila('leer datos.otros')
    afirmar('6 aislamiento: datos no trae otros ni negocios', visto?.otros === 'undefined' && visto?.negocios === 'undefined' && !visto.keys.split(',').some((k) => k === 'otros' || k === 'negocios'), corridas.get('leer datos.otros'))
    const red = fila('fetch')
    afirmar('6 aislamiento: fetch, XMLHttpRequest y WebSocket no existen', red?.fetch === 'undefined' && red?.xhr === 'undefined' && red?.websocket === 'undefined', corridas.get('fetch'))
    const proceso = fila('process / require / import')
    afirmar('6 aislamiento: process y require no existen', proceso?.process === 'undefined' && proceso?.require === 'undefined', corridas.get('process / require / import'))
    afirmar('6 aislamiento: llamar a fetch falla', corridas.get('llamar a fetch')?.ok === false, corridas.get('llamar a fetch'))
    const volcadoCorrido = corridas.get('volcar todos los datos')
    const volcado = volcadoCorrido?.ok ? JSON.stringify(volcadoCorrido.valor) : undefined
    afirmar('6 aislamiento: el volcado no trae ningún Cliente del otro Negocio', volcado !== undefined && !marcas.some((m) => volcado.includes(m)), volcadoCorrido)
    afirmar('6 aislamiento: el volcado no trae ningún teléfono completo', volcado !== undefined && !/\b57\d{10}\b/.test(volcado), volcadoCorrido)
    const bucle = corridas.get('bucle infinito')
    afirmar('6 aislamiento: un bucle infinito se interrumpe con ok:false y en pocos segundos', bucle?.ok === false && bucle.ms < 3000, bucle)
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
      afirmar('6 aislamiento: otro Negocio no puede aplicar el Cambio', intento.startsWith('rechazado'), intento)
      afirmar('6 aislamiento: el Cambio sigue propuesto', sigue.estado === 'propuesto', sigue.estado)
    }
  }

  if (quiero('casos')) {
    titulo('7. Aviso de un Caso al Hilo del Dueño: la respuesta espera el botón (envío simulado)')
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
    const hiloAntes = (await leerHilo(dueno.id)).length
    const inicio = Date.now()
    await traerCasoAlDueno(caso.id)
    console.log(`traerCasoAlDueno: ${Date.now() - inicio} ms`)
    const [conPropuesta] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
    afirmar('7 Caso: tras traerlo al Dueño espera su respuesta con una propuesta', conPropuesta.estado === 'esperando_dueno' && conPropuesta.propuesta.trim().length > 0, conPropuesta)
    const delCaso = await db
      .select()
      .from(esquema.propuestas)
      .where(and(eq(esquema.propuestas.negocioId, negocio.id), sql`${esquema.propuestas.actos} @> ${JSON.stringify([{ caso: caso.id }])}::jsonb`))
    afirmar('7 Caso: una sola propuesta para el Caso, del núcleo y en espera', delCaso.length === 1 && delCaso[0].pedidoPor === null && delCaso[0].estado === 'espera_al_dueno', delCaso)
    const hilo = await leerHilo(dueno.id)
    const aviso = hilo.at(-1)!
    const tarjeta = (aviso.parts.find((p) => p.type === 'data-tarjeta') as { data: { propuesta: string; huella: string } } | undefined)?.data
    console.log(`\nMensaje en el Hilo del Dueño (${hilo.length} en total):\n${textoDe(aviso as never)}\npartes: ${aviso.parts.map((p) => p.type).join(', ')}`)
    afirmar('7 Caso: el Hilo recibió un solo mensaje, con el id del Caso y la tarjeta de esa propuesta', hilo.length === hiloAntes + 1 && aviso.parts.some((p) => p.type === 'data-caso' && (p as { data?: { casoId?: string } }).data?.casoId === caso.id) && tarjeta?.propuesta === delCaso[0]?.id, { antes: hiloAntes, ahora: hilo.length, partes: aviso.parts.map((p) => p.type) })
    const texto = delCaso[0]?.actos[0]?.texto ?? ''
    afirmar('7 Caso: el aviso muestra el mismo texto que saldría', texto.length > 0 && textoDe(aviso as never).includes(texto), texto)
    afirmar('7 Caso: traerlo al Dueño no le escribe al Cliente', envios.every((e) => e.telefono !== cliente.telefono), envios)

    const ajeno = await negocioAjeno(negocio.codigo)
    afirmar('7 Caso: hay otro Negocio sembrado desde el cual intentar aprobarlo', ajeno !== null, 'Falta sembrar TRIGO y LADERA: pnpm tsx scripts/sembrar.mts')
    if (ajeno && tarjeta) {
      const desdeOtro = await aprobar(ctxDe(ajeno.id, dueno.id), tarjeta.propuesta, tarjeta.huella)
      const [intacto] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
      afirmar('7 Caso: aprobar desde otro Negocio no existe, no cambia el Caso ni manda nada', desdeOtro.tipo === 'no_existe' && intacto.estado === 'esperando_dueno' && envios.every((e) => e.telefono !== cliente.telefono), { desdeOtro, caso: intacto })
    }
    if (tarjeta) {
      const r = await aprobar(ctxDe(negocio.id, dueno.id), tarjeta.propuesta, tarjeta.huella)
      const [resuelto] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
      const salidos = envios.filter((e) => e.telefono === cliente.telefono)
      afirmar('7 Caso: aprobar por la ruta deja el Caso resuelto', r.tipo === 'aplicado' && resuelto.estado === 'resuelto', { r, estado: resuelto.estado })
      afirmar('7 Caso: un solo envío simulado, con el texto de la tarjeta', salidos.length === 1 && salidos[0].texto === texto, salidos)
    }
  }

  if (quiero('agente')) {
    titulo('8. Agente del dueño, Negocio abierto: proponer y el botón')
    const ctx = ctxDe(negocio.id, dueno.id)
    const propuestasDelDueno = () => db.select().from(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, negocio.id), eq(esquema.propuestas.pedidoPor, dueno.id)))

    const antesDeContar = (await propuestasDelDueno()).length
    const cuenta = await turno(negocio.id, dueno.id, 'Hoy vendimos 40 bolsas en la feria y la gente preguntó mucho por envíos a Cali.')
    afirmar('8 solo cuenta: no sale ninguna tarjeta ni propuesta', (await propuestasDelDueno()).length === antesDeContar && !herramientasDe(cuenta).includes('proponer'), herramientasDe(cuenta))

    const panel = await turno(negocio.id, dueno.id, 'Quiero ver cuántos pedidos tengo con novedad, en una lista.')
    const aplicadas = (await propuestasDelDueno()).filter((p) => p.estado === 'aplicada' && p.aprobadoPor === null)
    afirmar('8 Panel: lo que solo ve el Dueño queda aplicado sin botón', aplicadas.length > 0 && tarjetasDe([panel]).length === 0, { aplicadas, herramientas: herramientasDe(panel) })

    const reglasAntes = (await cambios.reglasActivas(negocio.id)).length
    const pedida = await turno(negocio.id, dueno.id, 'Si preguntan por envíos fuera de Manizales, no prometas fecha de entrega y pásamelo a mí.')
    const [tarjeta] = tarjetasDe([pedida])
    afirmar('8 regla: queda en una tarjeta que espera el botón', tarjeta !== undefined && (await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, tarjeta.propuesta)))[0]?.estado === 'espera_al_dueno', herramientasDe(pedida))
    if (tarjeta) {
      const { tools } = crearAgenteDelDueno(ctx, { negocio, dueno })
      const loQueVeElModelo = JSON.stringify(await convertToModelMessages(await leerHilo(dueno.id), { tools, convertDataPart: parteDeDatosParaElModelo, ignoreIncompleteToolCalls: true }))
      afirmar('8 regla: al modelo no le llega la huella', !loQueVeElModelo.includes(tarjeta.huella))
      await turno(negocio.id, dueno.id, 'Sí, aplícala.')
      const [sigue] = await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, tarjeta.propuesta))
      afirmar('8 regla: decir "sí" por escrito no la aplica', sigue.estado === 'espera_al_dueno' && (await cambios.reglasActivas(negocio.id)).length === reglasAntes, sigue.estado)
      const r = await aprobar(ctx, tarjeta.propuesta, tarjeta.huella)
      afirmar('8 regla: el botón la aplica y queda entre las reglas activas', r.tipo === 'aplicado' && (await cambios.reglasActivas(negocio.id)).length === reglasAntes + 1, r)
    }

    const faltantesAntes = await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    await turno(negocio.id, dueno.id, '¿Me puedes mandar una factura electrónica a cada cliente?')
    const faltantes = await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    console.log(`Capacidades faltantes registradas en ese turno: ${faltantes - faltantesAntes}`)
    afirmar('8 agente: pedir facturación registra una capacidad faltante', faltantes > faltantesAntes, { antes: faltantesAntes, despues: faltantes })

    titulo('9. Agente del dueño, Negocio nuevo (modo armando): alta + entrevista')
    const { negocio: nuevo, dueno: duenoNuevo } = await altaDeDueno({ id: `prueba-alta-${Date.now()}`, name: 'Marta', email: 'marta@example.com' })
    creadosNegocios.push(nuevo.id)
    const hiloInicial = (await leerHilo(duenoNuevo.id)).length
    console.log(`Alta: Negocio "${nuevo.nombre}" código ${nuevo.codigo} estado ${nuevo.estado}; Hilo inicial: ${hiloInicial} mensaje`)
    afirmar('9 alta: el Negocio nuevo nace armando con un solo mensaje en el Hilo', nuevo.estado === 'armando' && hiloInicial === 1, { estado: nuevo.estado, hilo: hiloInicial })
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
    const precio = await turno(nuevo.id, duenoNuevo.id, 'Sube el precio del arequipe de 500 g a 19000.')
    const si = await turno(nuevo.id, duenoNuevo.id, 'Sí, aplícalo.')
    const arequipesDe = () => db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, nuevo.id), like(esquema.productos.nombre, '%requipe%')))
    const antesDelBoton = (await arequipesDe()).filter((p) => p.activo)
    afirmar('9 precio: decir "sí" por escrito no cambia el precio', antesDelBoton.length > 0 && antesDelBoton.every((p) => p.precio === 18000), antesDelBoton)
    // El modelo puede preguntar antes de proponer: la tarjeta sale de cualquiera de los dos turnos.
    const tarjetaDelPrecio = tarjetasDe([precio, si]).at(-1)
    const r = tarjetaDelPrecio ? await aprobar(ctxDe(nuevo.id, duenoNuevo.id), tarjetaDelPrecio.propuesta, tarjetaDelPrecio.huella) : null
    const arequipes = await arequipesDe()
    console.log(`Precio del arequipe tras el botón: ${arequipes[0]?.precio}`)
    const [final] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, nuevo.id))
    const productos = await db.select().from(esquema.productos).where(eq(esquema.productos.negocioId, nuevo.id))
    console.log(`\nNegocio tras la entrevista: "${final.nombre}", estado ${final.estado}, rubro "${final.rubro}", ciudad "${final.conocimiento.ciudad}", ${productos.length} productos`)
    afirmar('9 alta: tras la entrevista el Negocio está listo', final.estado === 'listo', final.estado)
    afirmar('9 alta: guardó al menos 2 productos', productos.length >= 2, productos.map((p) => p.nombre))
    afirmar('9 alta: guardó la ciudad Popayán', final.conocimiento.ciudad.toLowerCase().includes('popay'), final.conocimiento.ciudad)
    const arequipesActivos = arequipes.filter((p) => p.activo)
    afirmar('9 precio: con el botón de la tarjeta el arequipe cuesta 19000', r?.tipo === 'aplicado' && arequipesActivos.length > 0 && arequipesActivos.every((p) => p.precio === 19000), { r, arequipes })
  }

  const turnos = await db.select().from(esquema.turnos).where(eq(esquema.turnos.negocioId, negocio.id))
  const porAgente = Object.groupBy(turnos, (t) => t.agente)
  console.log('\nTurnos registrados en el Negocio de prueba:', Object.entries(porAgente).map(([a, t]) => `${a}: ${t!.length}`).join(', '))
} catch (e) {
  afirmar('probar-dueno terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-dueno borró lo que creó', false, e))
  terminar()
}
