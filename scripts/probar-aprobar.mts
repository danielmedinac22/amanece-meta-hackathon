/**
 * Propuestas y `aprobar` contra la base real, sin modelo y sin mandar nada: lo que espera el botón del Dueño, el
 * reclamo atómico con `escribir` adentro, el doble clic, el conflicto entre dos Dueños, la reversión por versiones,
 * las reglas que hoy no se cumplen y la respuesta a un Caso por `despachar`. Usa LADERA y TRIGO
 * sembrados, dos Dueños de prueba en LADERA y uno en TRIGO. Todo lo que crea lo borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-aprobar.mts
 */
import { config } from 'dotenv'
import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import { afirmar, capturarEnvios, capturarErrores, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()

const { db, esquema } = await import('../src/db')
const { marcar } = await import('../src/nucleo/identidad')
const { proponer, proponerRespuestaAlCaso, aprobar, descartar, historial, guardarEnElAlta } = await import('../src/nucleo/cambios')
const { politicaDeAprobacion } = await import('../src/nucleo/cambios/politica')
const { leerEstado } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
type Elemento = import('../src/nucleo/estado/elementos').Elemento

const inicio = new Date()
const marca = String(Date.now()).slice(-8)
const creados = { duenos: [] as string[], clientes: [] as string[], casos: [] as string[], negocios: [] as string[], cambios: [] as string[] }
const { propuestas, cambios, casos, clientes, mensajesDueno, mensajesSalientes, elementos, capacidadesFaltantes } = esquema

const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
const [trigo] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
if (!ladera || !trigo) {
  afirmar('probar-aprobar: LADERA y TRIGO están sembrados', false, 'pnpm tsx scripts/sembrar.mts')
  terminar()
}
const NEGOCIOS = [ladera.id, trigo.id]
const LADERA = marcar.negocio(ladera.id)
const versiones = { [ladera.id]: ladera.version, [trigo.id]: trigo.version }

async function conteos() {
  const de = <T extends typeof propuestas | typeof cambios | typeof casos | typeof mensajesDueno | typeof mensajesSalientes | typeof elementos | typeof capacidadesFaltantes>(t: T) =>
    db.$count(t, inArray(t.negocioId, NEGOCIOS))
  return {
    propuestas: await de(propuestas),
    cambios: await de(cambios),
    casos: await de(casos),
    mensajesDueno: await de(mensajesDueno),
    mensajesSalientes: await de(mensajesSalientes),
    elementos: await de(elementos),
    faltantes: await de(capacidadesFaltantes),
  }
}
const alEmpezar = await conteos()

async function nuevoDueno(negocio: string, nombre: string) {
  const [d] = await db.insert(esquema.duenos).values({ negocioId: negocio, usuarioId: `prueba-aprobar-${nombre}-${marca}`, nombre }).returning()
  creados.duenos.push(d.id)
  return { negocio: marcar.negocio(negocio), dueno: marcar.dueno(d.id), medio: 'web' as const }
}

const filaDe = async (id: string) => (await db.select().from(propuestas).where(eq(propuestas.id, id)))[0]
const productosLlamados = async (nombre: string) =>
  (await leerEstado(LADERA))
    .vigentes('producto')
    .filter((v) => v.elemento.nombre === nombre)
    .map((v) => ({ clave: v.clave, ...v.elemento }))
const producto = (nombre: string): Elemento => ({ tipo: 'producto', nombre, descripcion: '', precio: el.comoMonto(1000), activo: true })
const horario = (valor: string): Elemento => ({ tipo: 'dato', campo: 'horario', valor })
const poner = (elemento: Elemento) => ({ tipo: 'poner' as const, elemento, reemplaza: null })
const enviosA = (telefono: string, desde = 0) => envios.slice(desde).filter((e) => e.telefono === telefono)

/** Cuántas líneas `data-aprobacion` de esta propuesta tiene el Hilo de un Dueño. */
async function aprobacionesEn(dueno: string, propuesta: string): Promise<number> {
  const filas = await db.select({ mensaje: mensajesDueno.mensaje }).from(mensajesDueno).where(eq(mensajesDueno.duenoId, dueno))
  return filas.filter((f) => (f.mensaje as { parts: { type: string; data?: { propuesta?: string } }[] }).parts.some((p) => p.type === 'data-aprobacion' && p.data?.propuesta === propuesta)).length
}

function pedidoDeProducto(nombre: string): Parameters<typeof proponer>[1] {
  return { palabrasDelDueno: `agrega ${nombre}`, origen: 'hilo', quiere: [poner(producto(nombre))] }
}

async function proponerProducto(ctx: Parameters<typeof proponer>[0], nombre: string) {
  const r = await proponer(ctx, pedidoDeProducto(nombre))
  if (r.desenlace !== 'espera_al_dueno') throw new Error(`proponer ${nombre} dio ${r.desenlace}: ${r.resumen}`)
  return r
}

async function nuevoCaso(ultimoMensajeEntrante: Date) {
  const [cliente] = await db
    .insert(clientes)
    .values({ negocioId: ladera.id, telefono: `5714${marca}${creados.clientes.length}`, nombre: 'Cliente de prueba de aprobar', ultimoMensajeEntrante })
    .returning()
  creados.clientes.push(cliente.id)
  const [caso] = await db.insert(casos).values({ negocioId: ladera.id, clienteId: cliente.id, titulo: 'Caso de prueba de aprobar', estado: 'esperando_dueno' }).returning()
  creados.casos.push(caso.id)
  return { cliente, caso }
}

async function limpiar() {
  const ids = (await db.select({ id: propuestas.id }).from(propuestas).where(and(inArray(propuestas.negocioId, NEGOCIOS), gte(propuestas.creado, inicio)))).map((p) => p.id)
  for (const [negocio, version] of Object.entries(versiones)) {
    await db.delete(elementos).where(and(eq(elementos.negocioId, negocio), gt(elementos.version, version)))
    await db.update(esquema.negocios).set({ version }).where(eq(esquema.negocios.id, negocio))
  }
  await db.delete(capacidadesFaltantes).where(and(inArray(capacidadesFaltantes.negocioId, NEGOCIOS), gte(capacidadesFaltantes.creado, inicio)))
  // La línea del desenlace va al Hilo de cada Dueño de LADERA, no solo a los de la prueba.
  const lineas = ids.length ? (await db.select({ id: mensajesDueno.id, mensaje: mensajesDueno.mensaje }).from(mensajesDueno).where(eq(mensajesDueno.negocioId, ladera.id))).filter((m) => ids.some((id) => JSON.stringify(m.mensaje).includes(id))) : []
  if (lineas.length) await db.delete(mensajesDueno).where(inArray(mensajesDueno.id, lineas.map((m) => m.id)))
  if (ids.length) await db.delete(propuestas).where(inArray(propuestas.id, ids))
  if (creados.casos.length) await db.delete(casos).where(inArray(casos.id, creados.casos))
  if (creados.clientes.length) await db.delete(clientes).where(inArray(clientes.id, creados.clientes))
  if (creados.duenos.length) await db.delete(esquema.duenos).where(inArray(esquema.duenos.id, creados.duenos))
  if (creados.negocios.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados.negocios))
  if (creados.cambios.length) await db.delete(cambios).where(inArray(cambios.id, creados.cambios))
  const alTerminar = await conteos()
  afirmar('limpieza: LADERA y TRIGO quedan con las mismas filas que al empezar', JSON.stringify(alTerminar) === JSON.stringify(alEmpezar), { alEmpezar, alTerminar })
}

try {
  console.log('\n=== 1. Política ===')
  const tabla: [Parameters<typeof politicaDeAprobacion>, ReturnType<typeof politicaDeAprobacion>][] = [
    [['atendiendo', 'clientes', 'hilo', true], 'espera_al_dueno'],
    [['armando', 'panel', 'hilo', true], 'espera_al_dueno'],
    [['en_sombra', 'panel', 'hilo', true], 'espera_al_dueno'],
    [['armando', 'clientes', 'hilo', false], 'se_aplica'],
    [['en_sombra', 'clientes', 'hilo', false], 'se_aplica'],
    [['atendiendo', 'clientes', 'panel', false], 'se_aplica'],
    [['atendiendo', 'panel', 'hilo', false], 'se_aplica'],
    [['atendiendo', 'clientes', 'hilo', false], 'espera_al_dueno'],
  ]
  for (const [entrada, esperado] of tabla) afirmar(`política: ${entrada.join(', ')} → ${esperado}`, politicaDeAprobacion(...entrada) === esperado)

  const A = await nuevoDueno(ladera.id, 'Ana')
  const B = await nuevoDueno(ladera.id, 'Beto')
  const T = await nuevoDueno(trigo.id, 'Tomás')

  console.log('\n=== 2. Proponer lo que llega a los Clientes espera el botón ===')
  const nombre1 = `Café de prueba ${marca} uno`
  const p1 = await proponerProducto(A, nombre1)
  const f1 = await filaDe(p1.propuesta)
  const horas = (Date.parse(p1.tarjeta.vence) - Date.now()) / 3600_000
  afirmar('proponer: la fila espera al Dueño, pedida por A, sin actos y con la huella de la tarjeta', f1.estado === 'espera_al_dueno' && f1.pedidoPor === A.dueno && f1.actos.length === 0 && f1.huella === p1.tarjeta.huella && f1.aprobadoPor === null, f1)
  afirmar('proponer: vence en 24 horas', horas > 23.9 && horas <= 24, horas)
  afirmar('proponer: la fila guarda la escritura del producto, con base nueva', f1.escritura.elementos.length === 1 && f1.escritura.elementos[0].base === 'nueva' && f1.escritura.elementos[0].despues?.tipo === 'producto', f1.escritura)
  afirmar('proponer: el producto todavía no existe', (await productosLlamados(nombre1)).length === 0)
  afirmar('proponer: el resumen para el modelo no trae la huella', !p1.resumen.includes(p1.tarjeta.huella), p1.resumen)
  afirmar('proponer: la tarjeta dice Aplicar', p1.tarjeta.accion === 'aplicar', p1.tarjeta)

  console.log('\n=== 3. Lo que no es esta propuesta no la aplica ===')
  const desdeTrigo = await aprobar(T, p1.propuesta, p1.tarjeta.huella)
  const otraHuella = await aprobar(A, p1.propuesta, 'f'.repeat(64))
  const malFormado = await aprobar(A, 'no-es-uuid', p1.tarjeta.huella)
  const descartarDesdeTrigo = await descartar(T, p1.propuesta)
  afirmar('aprobar desde otro Negocio: no_existe', desdeTrigo.tipo === 'no_existe', desdeTrigo)
  afirmar('aprobar con otra huella: no_existe', otraHuella.tipo === 'no_existe', otraHuella)
  afirmar('aprobar con un id mal formado: no_existe, sin excepción', malFormado.tipo === 'no_existe', malFormado)
  afirmar('descartar desde otro Negocio: no_existe', descartarDesdeTrigo.tipo === 'no_existe', descartarDesdeTrigo)
  afirmar('nada de eso tocó la propuesta ni el catálogo', (await filaDe(p1.propuesta)).estado === 'espera_al_dueno' && (await productosLlamados(nombre1)).length === 0)

  console.log('\n=== 4. Si escribir no la deja entrar dentro del reclamo, nada queda aplicado ===')
  const original = f1.escritura
  // Una escritura guardada que ya no parsea: solo `escribir`, dentro del reclamo, la ve.
  await db.update(propuestas).set({ escritura: sql`jsonb_set(${propuestas.escritura}, '{elementos,0,despues,activo}', '"si"')` }).where(eq(propuestas.id, p1.propuesta))
  const erroresAntes = errores.length
  const fallo = await aprobar(A, p1.propuesta, p1.tarjeta.huella).then(
    (r) => r,
    (e: unknown) => e,
  )
  const dobleFallo = await Promise.allSettled([aprobar(A, p1.propuesta, p1.tarjeta.huella), aprobar(B, p1.propuesta, p1.tarjeta.huella)])
  errores.splice(erroresAntes)
  const tras = await filaDe(p1.propuesta)
  afirmar('falla al escribir: aprobar da ya_no_cabe, sin excepción', !(fallo instanceof Error) && (fallo as { tipo?: string }).tipo === 'ya_no_cabe', fallo)
  afirmar('falla al escribir: con doble clic, ningún clic recibe aplicado', dobleFallo.every((d) => d.status === 'rejected' || d.value.tipo !== 'aplicado'), dobleFallo)
  afirmar('falla al escribir: la propuesta sigue esperando, sin aprobador ni versión', tras.estado === 'espera_al_dueno' && tras.aprobadoPor === null && tras.version === null, tras)
  afirmar('falla al escribir: no quedó producto ni línea en los Hilos', (await productosLlamados(nombre1)).length === 0 && (await aprobacionesEn(A.dueno, p1.propuesta)) + (await aprobacionesEn(B.dueno, p1.propuesta)) === 0)
  await db.update(propuestas).set({ escritura: original }).where(eq(propuestas.id, p1.propuesta))

  console.log('\n=== 5. B aprueba lo que pidió A ===')
  const r5 = await aprobar(B, p1.propuesta, p1.tarjeta.huella)
  const f5 = await filaDe(p1.propuesta)
  afirmar('B aprueba: aplicado, con la versión del Negocio que dejó', r5.tipo === 'aplicado' && r5.envio === null && r5.version !== null, r5)
  afirmar('B aprueba: la fila queda aplicada, pedida por A y aprobada por B', f5.estado === 'aplicada' && f5.pedidoPor === A.dueno && f5.aprobadoPor === B.dueno, f5)
  afirmar('B aprueba: hay un solo producto nuevo, activo', (await productosLlamados(nombre1)).filter((p) => p.activo).length === 1)
  afirmar('B aprueba: una línea del desenlace en el Hilo de A y una en el de B', (await aprobacionesEn(A.dueno, p1.propuesta)) === 1 && (await aprobacionesEn(B.dueno, p1.propuesta)) === 1)
  const otraVez = await aprobar(A, p1.propuesta, p1.tarjeta.huella)
  afirmar('B aprueba: el clic de A después devuelve aplicado y no deja otra línea', otraVez.tipo === 'aplicado' && (await aprobacionesEn(A.dueno, p1.propuesta)) === 1, otraVez)

  console.log('\n=== 6. Doble clic de dos Dueños a la vez ===')
  const nombre2 = `Café de prueba ${marca} dos`
  const p2 = await proponerProducto(A, nombre2)
  const dos = await Promise.all([aprobar(A, p2.propuesta, p2.tarjeta.huella), aprobar(B, p2.propuesta, p2.tarjeta.huella)])
  afirmar('doble clic: los dos reciben aplicado', dos.every((r) => r.tipo === 'aplicado'), dos)
  afirmar('doble clic: un solo producto', (await productosLlamados(nombre2)).length === 1)
  afirmar('doble clic: una sola línea por Hilo', (await aprobacionesEn(A.dueno, p2.propuesta)) === 1 && (await aprobacionesEn(B.dueno, p2.propuesta)) === 1)

  console.log('\n=== 7. Lo aplicado queda con su propuesta y su versión ===')
  const nombre3 = `Café de prueba ${marca} tres`
  const p3 = await proponerProducto(A, nombre3)
  const r7 = await aprobar(A, p3.propuesta, p3.tarjeta.huella)
  const [clave3] = await productosLlamados(nombre3)
  const [fila7] = clave3 ? await db.select().from(elementos).where(and(eq(elementos.negocioId, ladera.id), eq(elementos.clave, clave3.clave))) : []
  const f7 = await filaDe(p3.propuesta)
  afirmar('versión: la fila del Elemento lleva la propuesta y la misma versión que la propuesta', r7.tipo === 'aplicado' && fila7?.origen === 'propuesta' && fila7.propuestaId === p3.propuesta && fila7.version === f7.version && (await leerEstado(LADERA)).version === f7.version, { fila7, f7 })

  console.log('\n=== 8. Vencida y descartada ===')
  const p4 = await proponerProducto(A, `Café de prueba ${marca} cuatro`)
  await db.update(propuestas).set({ vence: sql`now() - interval '1 minute'` }).where(eq(propuestas.id, p4.propuesta))
  const r8 = await aprobar(A, p4.propuesta, p4.tarjeta.huella)
  const [h8] = await historial(A, { propuestas: [p4.propuesta] })
  afirmar('vencida: aprobar devuelve vencido y no aplica nada', r8.tipo === 'vencido' && (await productosLlamados(`Café de prueba ${marca} cuatro`)).length === 0, r8)
  afirmar('vencida: el historial la da vencida', h8?.estado === 'vencida', h8)
  const p5 = await proponerProducto(A, `Café de prueba ${marca} cinco`)
  const d5 = await descartar(A, p5.propuesta)
  const r5b = await aprobar(A, p5.propuesta, p5.tarjeta.huella)
  afirmar('descartada: descartar responde descartada y aprobar después no_existe, sin producto', d5.tipo === 'descartada' && r5b.tipo === 'no_existe' && (await productosLlamados(`Café de prueba ${marca} cinco`)).length === 0, { d5, r5b })
  const dAplicada = await descartar(A, p1.propuesta)
  afirmar('descartada: descartar una aplicada no hace nada', dAplicada.tipo === 'no_existe' && (await filaDe(p1.propuesta)).estado === 'aplicada', dAplicada)

  console.log('\n=== 9. Revertir es otra propuesta con su botón ===')
  const rv = await proponer(A, { palabrasDelDueno: 'quita ese café', origen: 'hilo', quiere: [{ tipo: 'revertir', propuesta: p1.propuesta }] })
  afirmar('revertir: espera el botón y el producto sigue activo', rv.desenlace === 'espera_al_dueno' && (await productosLlamados(nombre1)).every((p) => p.activo), rv)
  if (rv.desenlace === 'espera_al_dueno') {
    afirmar('revertir: la fila apunta a la propuesta que revierte', (await filaDe(rv.propuesta)).revierte === p1.propuesta)
    const r9 = await aprobar(A, rv.propuesta, rv.tarjeta.huella)
    const [h9] = await historial(A, { propuestas: [p1.propuesta] })
    afirmar('revertir: aprobar la deja aplicada y el producto ya no está', r9.tipo === 'aplicado' && (await productosLlamados(nombre1)).length === 0, r9)
    afirmar('revertir: las versiones anteriores siguen en la tabla', (await db.$count(elementos, and(eq(elementos.negocioId, ladera.id), eq(elementos.propuestaId, rv.propuesta)))) === 1)
    afirmar('revertir: el historial da la original revertida', h9?.estado === 'revertida', h9)
  }
  const rv2 = await proponer(A, { palabrasDelDueno: 'quítalo otra vez', origen: 'hilo', quiere: [{ tipo: 'revertir', propuesta: p1.propuesta }] })
  afirmar('revertir: lo ya revertido no se vuelve a revertir', rv2.desenlace === 'corregir', rv2)

  console.log('\n=== 10. Respuesta a un Caso: un envío, con su Caso ===')
  const { cliente: camila, caso } = await nuevoCaso(new Date())
  const texto = `Hola, sí te cambiamos la talla (${marca}).`
  let desde = envios.length
  const rc = await proponerRespuestaAlCaso(caso.id, texto)
  afirmar('respuesta: espera el botón, con el verbo Enviar y sin envíos', rc.desenlace === 'espera_al_dueno' && rc.tarjeta?.accion === 'enviar' && enviosA(camila.telefono, desde).length === 0, rc)
  if (rc.desenlace === 'espera_al_dueno') {
    const fc = await filaDe(rc.propuesta)
    afirmar('respuesta: sin pedido_por y con el acto responder_caso', fc.pedidoPor === null && fc.actos.length === 1 && fc.actos[0].caso === caso.id && fc.actos[0].texto === texto, fc)
    const r10 = await aprobar(B, rc.propuesta, rc.tarjeta.huella)
    const salientes = await db.select().from(mensajesSalientes).where(eq(mensajesSalientes.clienteId, camila.id))
    const [cerrado] = await db.select().from(casos).where(eq(casos.id, caso.id))
    afirmar('respuesta: aprobar sale simulado', r10.tipo === 'aplicado' && r10.envio?.tipo === 'simulado', r10)
    afirmar('respuesta: un solo envío a la Cliente, con el texto de la propuesta', enviosA(camila.telefono, desde).length === 1 && enviosA(camila.telefono, desde)[0].texto === texto, enviosA(camila.telefono, desde))
    afirmar('respuesta: una fila resolucion_de_caso con su Caso y la huella en la clave', salientes.length === 1 && salientes[0].clase === 'resolucion_de_caso' && salientes[0].casoId === caso.id && salientes[0].clave.includes(rc.tarjeta.huella), salientes)
    afirmar('respuesta: el Caso queda resuelto con ese texto', cerrado.estado === 'resuelto' && cerrado.resolucion === texto, cerrado)
    const mas = [await aprobar(A, rc.propuesta, rc.tarjeta.huella), ...(await Promise.all([aprobar(A, rc.propuesta, rc.tarjeta.huella), aprobar(B, rc.propuesta, rc.tarjeta.huella)]))]
    afirmar('respuesta: más clics devuelven aplicado y no sale nada más', mas.every((r) => r.tipo === 'aplicado') && enviosA(camila.telefono, desde).length === 1, mas)
  }

  console.log('\n=== 10b. Dos Dueños envían la misma respuesta a la vez ===')
  const { cliente: dobleCliente, caso: casoAlaVez } = await nuevoCaso(new Date())
  const ra = await proponerRespuestaAlCaso(casoAlaVez.id, `Respuesta a la vez (${marca})`)
  if (ra.desenlace !== 'espera_al_dueno') throw new Error(`la respuesta a la vez dio ${ra.desenlace}`)
  desde = envios.length
  const aLaVez = await Promise.all([aprobar(A, ra.propuesta, ra.tarjeta.huella), aprobar(B, ra.propuesta, ra.tarjeta.huella)])
  const lineasDeA = (await db.select({ mensaje: mensajesDueno.mensaje }).from(mensajesDueno).where(eq(mensajesDueno.duenoId, A.dueno))).map((m) => JSON.stringify(m.mensaje)).filter((m) => m.includes(ra.propuesta))
  afirmar('a la vez: los dos reciben aplicado y sale un solo envío', aLaVez.every((r) => r.tipo === 'aplicado') && enviosA(dobleCliente.telefono, desde).length === 1, aLaVez)
  afirmar('a la vez: ninguna línea del Hilo dice que WhatsApp no la tomó', lineasDeA.length === 1 && !lineasDeA[0].includes('no la tomó'), lineasDeA)

  console.log('\n=== 11. Ventana de 24 horas ===')
  const { cliente: tardia, caso: casoTardio } = await nuevoCaso(new Date())
  const rt = await proponerRespuestaAlCaso(casoTardio.id, 'Te respondo tarde')
  if (rt.desenlace !== 'espera_al_dueno') throw new Error(`la respuesta en ventana dio ${rt.desenlace}`)
  await db.update(clientes).set({ ultimoMensajeEntrante: new Date(Date.now() - 25 * 3600_000) }).where(eq(clientes.id, tardia.id))
  desde = envios.length
  const r11 = await aprobar(A, rt.propuesta, rt.tarjeta.huella)
  const [sigueAbierto] = await db.select().from(casos).where(eq(casos.id, casoTardio.id))
  afirmar('ventana cerrada al aprobar: ya_no_cabe por fuera_de_ventana, sin envío', r11.tipo === 'ya_no_cabe' && r11.problemas.some((p) => p.tipo === 'fuera_de_ventana') && enviosA(tardia.telefono, desde).length === 0, r11)
  afirmar('ventana cerrada al aprobar: el Caso sigue esperando y la propuesta también', sigueAbierto.estado === 'esperando_dueno' && (await filaDe(rt.propuesta)).estado === 'espera_al_dueno', sigueAbierto)
  await db.update(clientes).set({ ultimoMensajeEntrante: new Date() }).where(eq(clientes.id, tardia.id))
  const r11b = await aprobar(A, rt.propuesta, rt.tarjeta.huella)
  afirmar('ventana abierta otra vez: la misma tarjeta sirve y sale una vez', r11b.tipo === 'aplicado' && enviosA(tardia.telefono, desde).length === 1, r11b)

  const { cliente: vencida, caso: casoVencido } = await nuevoCaso(new Date(Date.now() - 25 * 3600_000))
  const antes = await db.$count(propuestas, eq(propuestas.negocioId, ladera.id))
  const rf = await proponerRespuestaAlCaso(casoVencido.id, 'No debe quedar')
  afirmar('ventana cerrada al proponer: corregir por fuera_de_ventana, sin fila', rf.desenlace === 'corregir' && rf.problemas.some((p) => p.tipo === 'fuera_de_ventana') && (await db.$count(propuestas, eq(propuestas.negocioId, ladera.id))) === antes, rf)
  void vencida

  console.log('\n=== 12. Una respuesta pendiente por Caso, y un Caso ya resuelto ===')
  const { caso: casoDoble } = await nuevoCaso(new Date())
  const primera = await proponerRespuestaAlCaso(casoDoble.id, 'Primera versión')
  const segunda = await proponerRespuestaAlCaso(casoDoble.id, 'Segunda versión')
  if (primera.desenlace !== 'espera_al_dueno' || segunda.desenlace !== 'espera_al_dueno') throw new Error('las respuestas al mismo Caso no quedaron en espera')
  afirmar('una pendiente por Caso: la nueva deja descartada a la vieja', (await filaDe(primera.propuesta)).estado === 'descartada' && (await filaDe(segunda.propuesta)).estado === 'espera_al_dueno')
  await db.update(casos).set({ estado: 'resuelto' }).where(eq(casos.id, casoDoble.id))
  desde = envios.length
  const r12 = await aprobar(A, segunda.propuesta, segunda.tarjeta.huella)
  afirmar('Caso ya resuelto: ya_no_cabe por caso_resuelto y sin envío', r12.tipo === 'ya_no_cabe' && r12.problemas.some((p) => p.tipo === 'caso_resuelto') && envios.length === desde, r12)

  console.log('\n=== 13. Dos Dueños sobre la misma clave: el segundo da conflicto ===')
  const antesDelHorario = (await leerEstado(LADERA)).version
  const deAna = await proponer(A, { palabrasDelDueno: 'abrimos los domingos', origen: 'hilo', quiere: [poner(horario(`Todos los días (${marca})`))] })
  const deBeto = await proponer(B, { palabrasDelDueno: 'cerramos los sábados', origen: 'hilo', quiere: [poner(horario(`Lunes a viernes (${marca})`))] })
  if (deAna.desenlace !== 'espera_al_dueno' || deBeto.desenlace !== 'espera_al_dueno') throw new Error('las propuestas de horario no quedaron en espera')
  const r13a = await aprobar(A, deAna.propuesta, deAna.tarjeta.huella)
  const r13b = await aprobar(B, deBeto.propuesta, deBeto.tarjeta.huella)
  const tras13 = await leerEstado(LADERA)
  const vale = tras13.vigente(el.comoClave('dato:horario'))
  afirmar('conflicto: la de Ana se aplica', r13a.tipo === 'aplicado', r13a)
  afirmar('conflicto: la de Beto da conflicto en dato:horario, con quién la tocó', r13b.tipo === 'conflicto' && r13b.claves[0]?.clave === 'dato:horario' && r13b.claves[0].dueno === A.dueno, r13b)
  afirmar('conflicto: el resumen nombra a Ana y dice lo que vale ahora, sin "nuevo"', r13b.tipo === 'conflicto' && r13b.resumen.includes('Ana') && r13b.resumen.includes(`Horario: «Todos los días (${marca})»`) && !r13b.resumen.includes('Horario nuevo'), r13b)
  afirmar('conflicto: el horario es el de Ana, la versión subió una sola vez y la de Beto queda descartada', vale?.elemento.tipo === 'dato' && vale.elemento.valor.startsWith('Todos') && tras13.version === antesDelHorario + 1 && (await filaDe(deBeto.propuesta)).estado === 'descartada', { vale, version: tras13.version })
  const deNuevoBeto = await aprobar(B, deBeto.propuesta, deBeto.tarjeta.huella)
  afirmar('conflicto: un segundo clic sobre la descartada es no_existe', deNuevoBeto.tipo === 'no_existe', deNuevoBeto)
  const pagos = await proponer(A, { palabrasDelDueno: 'pagos', origen: 'hilo', quiere: [poner({ tipo: 'dato', campo: 'pagos', valor: `Nequi (${marca})` })] })
  const envios13 = await proponer(B, { palabrasDelDueno: 'envíos', origen: 'hilo', quiere: [poner({ tipo: 'dato', campo: 'envios', valor: `Todo el país (${marca})` })] })
  const dosClaves = pagos.tarjeta && envios13.tarjeta ? [await aprobar(A, pagos.tarjeta.propuesta, pagos.tarjeta.huella), await aprobar(B, envios13.tarjeta.propuesta, envios13.tarjeta.huella)] : []
  afirmar('conflicto: sobre claves distintas se aplican las dos', dosClaves.length === 2 && dosClaves.every((x) => x.tipo === 'aplicado'), dosClaves)

  console.log('\n=== 14. Una regla que hoy nada hace cumplir queda como Capacidad faltante ===')
  const escenarios: Extract<Elemento, { tipo: 'regla' }>['escenarios'] = { activan: [{ mensajeDelCliente: '¿Me llega el viernes a Cali?', momento: null, pedido: null, esperado: { hace: ['abrir_caso'], noHace: [] } }], noActivan: [] }
  for (const [nombre, cuando] of [
    ['tema', { tipo: 'tema', tema: 'envíos fuera de Manizales' }],
    ['fuera_de_horario', { tipo: 'fuera_de_horario', abierto: { lunes: null, martes: null, miercoles: null, jueves: null, viernes: null, sabado: null, domingo: null }, festivosCerrado: true }],
  ] as const) {
    const filas = { elementos: await db.$count(elementos, eq(elementos.negocioId, ladera.id)), propuestas: await db.$count(propuestas, eq(propuestas.negocioId, ladera.id)) }
    const f = await proponer(A, { palabrasDelDueno: `regla de ${nombre} (${marca})`, origen: 'hilo', quiere: [poner({ tipo: 'regla', nombre: `Regla ${nombre}`, cuando: cuando as never, efectos: [{ tipo: 'pasar_al_dueno', avisoAlCliente: 'Ya le paso tu mensaje al equipo.' }], escenarios })] })
    const [faltante] = await db.select().from(capacidadesFaltantes).where(and(eq(capacidadesFaltantes.negocioId, ladera.id), eq(capacidadesFaltantes.pedido, `regla de ${nombre} (${marca})`)))
    const despues = { elementos: await db.$count(elementos, eq(elementos.negocioId, ladera.id)), propuestas: await db.$count(propuestas, eq(propuestas.negocioId, ladera.id)) }
    afirmar(`${nombre}: capacidad_faltante sin_cumplidor, sin propuesta ni fila en elementos`, f.desenlace === 'capacidad_faltante' && faltante?.motivo === `sin_cumplidor:${nombre}` && JSON.stringify(despues) === JSON.stringify(filas), { f, faltante, filas, despues })
  }

  console.log('\n=== 14b. Siempre con pasar_al_dueno o abrir_caso no se propone ===')
  for (const efecto of [{ tipo: 'pasar_al_dueno', avisoAlCliente: 'Ya le paso tu mensaje al equipo.' }, { tipo: 'abrir_caso', titulo: 'Un Cliente escribió' }] as const) {
    const filas = { elementos: await db.$count(elementos, eq(elementos.negocioId, ladera.id)), propuestas: await db.$count(propuestas, eq(propuestas.negocioId, ladera.id)) }
    const f = await proponer(A, { palabrasDelDueno: `siempre ${efecto.tipo} (${marca})`, origen: 'hilo', quiere: [poner({ tipo: 'regla', nombre: `Siempre ${efecto.tipo}`, cuando: { tipo: 'siempre' }, efectos: [efecto], escenarios })] })
    const despues = { elementos: await db.$count(elementos, eq(elementos.negocioId, ladera.id)), propuestas: await db.$count(propuestas, eq(propuestas.negocioId, ladera.id)) }
    afirmar(`siempre con ${efecto.tipo}: corregir, sin propuesta ni fila en elementos`, f.desenlace === 'corregir' && f.problemas.some((p) => p.tipo === 'valor_invalido' && p.campo === 'efectos') && JSON.stringify(despues) === JSON.stringify(filas), { f, filas, despues })
  }

  console.log('\n=== 15. La regla de Manizales: siempre y no_prometer plazo, por el botón ===')
  const manizales = await proponer(A, {
    palabrasDelDueno: 'No prometas fechas de entrega',
    origen: 'hilo',
    quiere: [poner({ tipo: 'regla', nombre: `Sin fechas (${marca})`, cuando: { tipo: 'siempre' }, efectos: [{ tipo: 'no_prometer', que: 'plazo' }], escenarios })],
  })
  afirmar('Manizales: espera el botón y todavía no está vigente', manizales.desenlace === 'espera_al_dueno' && (await leerEstado(LADERA)).vigentes('regla').every((v) => v.elemento.nombre !== `Sin fechas (${marca})`), manizales)
  if (manizales.tarjeta) {
    const r15 = await aprobar(B, manizales.tarjeta.propuesta, manizales.tarjeta.huella)
    const regla = (await leerEstado(LADERA)).vigentes('regla').find((v) => v.elemento.nombre === `Sin fechas (${marca})`)
    afirmar('Manizales: el botón la deja vigente, escrita por esa propuesta', r15.tipo === 'aplicado' && regla?.origen.tipo === 'propuesta' && regla.origen.propuesta === manizales.tarjeta.propuesta, { r15, regla })
  }

  console.log('\n=== 17. Mientras se arma: la política se decide con el modo leído dentro del reclamo ===')
  const [armando] = await db.insert(esquema.negocios).values({ nombre: `Prueba de aprobar ${marca}`, codigo: `PAP${marca}`, estado: 'armando' }).returning()
  creados.negocios.push(armando.id)
  const D = await nuevoDueno(armando.id, 'Dora')
  const sinBoton = await proponer(D, pedidoDeProducto(`Pan (${marca})`))
  afirmar('armando: se aplica sin tarjeta', sinBoton.desenlace === 'aplicado' && sinBoton.tarjeta === null, sinBoton)
  const dosTortas = await Promise.all([proponer(D, pedidoDeProducto(`Torta (${marca})`)), proponer(D, pedidoDeProducto(`Torta (${marca})`))])
  const esperan = await db.$count(propuestas, and(eq(propuestas.negocioId, armando.id), eq(propuestas.estado, 'espera_al_dueno')))
  console.log(`dos Torta a la vez: ${dosTortas.map((r) => r.desenlace).join(', ')}; filas descartadas: ${await db.$count(propuestas, and(eq(propuestas.negocioId, armando.id), eq(propuestas.estado, 'descartada')))}`)
  afirmar('armando: dos Torta a la vez dan una aplicada y una corregir, sin tarjeta ni propuesta esperando', JSON.stringify(dosTortas.map((r) => r.desenlace).sort()) === JSON.stringify(['aplicado', 'corregir']) && dosTortas.every((r) => r.tarjeta === null) && esperan === 0, { dosTortas, esperan })
  const alta = await guardarEnElAlta(A, { nombre: null, rubro: null, quiere: [poner(horario(`De alta (${marca})`))] })
  afirmar('alta con el Negocio abierto: solo mientras se arma, sin escribir', 'problemas' in alta && alta.problemas.some((p) => p.tipo === 'solo_mientras_se_arma') && !(await leerEstado(LADERA)).todos().some((v) => v.elemento.tipo === 'dato' && v.elemento.valor.startsWith('De alta')), alta)

  console.log('\n=== 18. Una tarjeta de antes del corte dice que se pida de nuevo ===')
  const huellaVieja = 'e'.repeat(64)
  const [vieja] = await db.insert(propuestas).values({ negocioId: ladera.id, palabrasDelDueno: 'regla de antes', huella: huellaVieja, vence: new Date(Date.now() + 3600_000), vistaPrevia: { lineas: ['Regla: no prometer fechas'] } }).returning()
  const [cambioViejo] = await db.insert(cambios).values({ negocioId: ladera.id, tipo: 'regla', pedido: 'no prometas fechas', propuesta: { texto: 'No prometas fechas' }, propuestaId: vieja.id }).returning()
  creados.cambios.push(cambioViejo.id)
  const r18 = await aprobar(A, vieja.id, huellaVieja)
  afirmar('tarjeta vieja: ya_no_cabe y el resumen dice que se pida de nuevo', r18.tipo === 'ya_no_cabe' && r18.resumen.includes('pídelo de nuevo'), r18)

  console.log('\n=== 16. Dos propuestas con el mismo producto nuevo: la segunda ya no cabe al aprobarla ===')
  const tortaA = await proponerProducto(A, `Torta doble (${marca})`)
  const tortaB = await proponerProducto(B, `Torta doble (${marca})`)
  const r16a = await aprobar(A, tortaA.tarjeta.propuesta, tortaA.tarjeta.huella)
  const r16b = await aprobar(B, tortaB.tarjeta.propuesta, tortaB.tarjeta.huella)
  afirmar('mismo producto: la primera se aplica y la segunda da ya_no_cabe por el nombre', r16a.tipo === 'aplicado' && r16b.tipo === 'ya_no_cabe' && r16b.problemas.some((p) => p.tipo === 'valor_invalido' && p.campo === 'nombre'), { r16a, r16b })
  afirmar('mismo producto: queda uno solo vigente', (await productosLlamados(`Torta doble (${marca})`)).length === 1)
} catch (e) {
  afirmar('probar-aprobar terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-aprobar borró lo que creó', false, e))
  afirmar('probar-aprobar no registró errores', errores.length === 0, errores)
  terminar()
}
