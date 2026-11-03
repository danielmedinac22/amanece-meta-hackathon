/**
 * Lo leído de un enlace es una propuesta que espera el botón: contra la base real, con la página y el extractor de
 * guion, sin modelo. Crea Negocios desechables y los borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-lectura.mts
 */
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { lectorDeGuion } = await import('../src/lib/leer-enlace')
const { guardarEnElHilo, leerHilo, mensajeDelDuenoEnTexto } = await import('../src/negocio/dueno-hilo')
const { mensajesParaElModelo } = await import('../src/negocio/dueno-chat')
const { aprobar, guardarEnElAlta, proponerLectura, queFaltaParaAbrir, lecturaPendiente } = await import('../src/nucleo/cambios')
const { armarLectura, buscarProducto, corregirEscritura, corregirLectura, MAXIMO_DE_PRODUCTOS_LEIDOS } = await import('../src/nucleo/cambios/lectura')
const { crearAgenteDelDueno } = await import('../src/agentes/dueno')
const { armarEstado, leerAplicado } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')

type LoExtraido = import('../src/nucleo/cambios/lectura').LoExtraido
type PaginaLeida = import('../src/lib/leer-enlace').PaginaLeida
type Elemento = import('../src/nucleo/estado/elementos').Elemento

const creados: string[] = []
const marca = String(Date.now()).slice(-7)
const URL_DE_LA_PAGINA = 'https://cafetrigo.co'
const PAGINA = `<html><title>Café Trigo</title><body>
<h1>Café Trigo, café de Pereira</h1>
<p>Capuchino · $8.500</p><p>Latte · $8.000</p><p>Molido 500 g · $32.000</p>
<p>Enviamos a todo el país: el envío cuesta $10.000 y llega de 2 a 4 días hábiles.</p>
</body></html>`
const EXTRAIDO: LoExtraido = {
  productos: [
    { nombre: 'Capuchino', precio: 8500 },
    { nombre: 'Latte', precio: 8000 },
    { nombre: 'Molido 500 g', precio: 32000 },
    { nombre: 'Tinto doble', precio: 4500 },
  ],
  datos: { ciudad: 'Pereira', envios: 'A todo el país: el envío cuesta $10.000 y llega de 2 a 4 días hábiles.' },
}

async function negocioArmando(letra: string) {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Trigo ${letra}`, codigo: `PLE${marca}${letra}` }).returning({ id: esquema.negocios.id })
  creados.push(n.id)
  const [d] = await db.insert(esquema.duenos).values({ negocioId: n.id, usuarioId: `prueba-lectura-${marca}-${letra}`, nombre: 'Dueño de prueba' }).returning({ id: esquema.duenos.id })
  return { negocio: marcar.negocio(n.id), dueno: marcar.dueno(d.id), medio: 'web' as const }
}

const dice = (ctx: Awaited<ReturnType<typeof negocioArmando>>, texto: string) => guardarEnElHilo(ctx.negocio, ctx.dueno, 'dueno', mensajeDelDuenoEnTexto(texto)!)
const leer = async (url: string) => {
  const r = await lectorDeGuion({ [URL_DE_LA_PAGINA]: PAGINA })(url)
  if (r.tipo !== 'leida') throw new Error(`no se leyó la página de guion: ${r.tipo}`)
  return r
}
const productosDe = async (ctx: { negocio: ReturnType<typeof marcar.negocio> }) => (await leerAplicado(ctx.negocio)).vigentes('producto')
const propuestasDe = (ctx: { negocio: ReturnType<typeof marcar.negocio> }) => db.select().from(esquema.propuestas).where(eq(esquema.propuestas.negocioId, ctx.negocio))
const poner = (elemento: Elemento) => ({ tipo: 'poner' as const, elemento, reemplaza: null })

try {
  console.log('\n=== armarLectura no le cree al extractor ===')
  {
    const pagina: PaginaLeida = await leer(URL_DE_LA_PAGINA)
    const identidad = { id: marcar.negocio('00000000-0000-4000-8000-0000000000f2'), nombre: 'Café Trigo', rubro: 'café', codigo: 'PURA', pais: 'CO', moneda: 'COP', zonaHoraria: 'America/Bogota', modo: 'armando' } as const
    const conCapuchino = armarEstado(identidad, el.comoVersion(1), [
      { clave: el.comoClave('producto:1'), version: el.comoVersion(1), origen: { tipo: 'entrevista' }, elemento: { tipo: 'producto', nombre: 'Capuchino grande', descripcion: '', precio: el.comoMonto(9000), activo: true } } as never,
    ])
    const l = armarLectura(conCapuchino, pagina, EXTRAIDO)
    const nombres = l.quiere.flatMap((q) => (q.elemento.tipo === 'producto' ? [q.elemento.nombre] : []))
    afirmar('armarLectura: un precio que no está en la página se cae (Tinto doble a 4.500)', !nombres.includes('Tinto doble'), nombres)
    afirmar('armarLectura: un producto que es el mismo que uno vigente se cae (Capuchino)', !nombres.includes('Capuchino') && nombres.includes('Latte'), nombres)
    afirmar('armarLectura: la descripción de todo lo leído queda vacía', l.quiere.every((q) => q.elemento.tipo !== 'producto' || q.elemento.descripcion === ''), l.quiere)
    afirmar('armarLectura: cuenta lo que descartó', l.descartados === 2, l.descartados)

    const vigente = (nombre: string) => ({ clave: el.comoClave('producto:1'), version: el.comoVersion(1), origen: { tipo: 'entrevista' }, elemento: { tipo: 'producto', nombre, descripcion: '', precio: el.comoMonto(9000), activo: true } }) as never
    const conCafe = armarEstado(identidad, el.comoVersion(1), [vigente('Café')])
    const cafe500: LoExtraido = { productos: [{ nombre: 'Café 500 g', precio: 32000 }], datos: {} }
    afirmar('identidad: «Café» vigente no se come «Café 500 g»', armarLectura(conCafe, pagina, cafe500).quiere.length === 1 && buscarProducto(conCafe, 'Café 500 g') === null)
    const conMolino = armarEstado(identidad, el.comoVersion(1), [vigente('Molino manual de café')])
    afirmar('identidad: «Molino manual» es el mismo que «Molino manual de café»', buscarProducto(conMolino, 'Molino manual')?.elemento.nombre === 'Molino manual de café')

    const muchos: LoExtraido = { productos: Array.from({ length: MAXIMO_DE_PRODUCTOS_LEIDOS + 5 }, (_, i) => ({ nombre: `Bebida ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, precio: 8000 })), datos: {} }
    const tope = armarLectura(armarEstado(identidad, el.comoVersion(1), []), pagina, muchos)
    afirmar(`armarLectura: pasa de ${MAXIMO_DE_PRODUCTOS_LEIDOS} productos y lo que sobra cuenta en descartados`, tope.quiere.length === MAXIMO_DE_PRODUCTOS_LEIDOS && tope.descartados === 5, { quiere: tope.quiere.length, descartados: tope.descartados })
  }

  console.log('\n=== Doce productos y cinco datos dejan una tarjeta con los diecisiete ===')
  {
    const ctx12 = await negocioArmando('D')
    const url = 'https://cafedoce.co'
    const doce = Array.from({ length: 12 }, (_, i) => ({ nombre: `Origen ${['Huila', 'Nariño', 'Cauca', 'Tolima', 'Quindío', 'Caldas', 'Antioquia', 'Santander', 'Boyacá', 'Cesar', 'Risaralda', 'Valle'][i]}`, precio: 20000 + i * 1000 }))
    const html = `<html><title>Café Doce</title><body>${doce.map((p) => `<p>${p.nombre} · $${p.precio.toLocaleString('es-CO')}</p>`).join('')}
<p>Café de doce regiones. Estamos en Pereira. Abrimos de lunes a sábado. Enviamos a todo el país. Pagos con Nequi.</p></body></html>`
    const extraido: LoExtraido = { productos: doce, datos: { descripcion: 'Café de doce regiones', ciudad: 'Pereira', horario: 'De lunes a sábado', envios: 'A todo el país', pagos: 'Nequi' } }
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, ctx12.negocio))
    const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, ctx12.dueno))
    const agente = crearAgenteDelDueno(ctx12, { negocio, dueno }, { lector: lectorDeGuion({ [url]: html }), extractor: async () => ({ extraido, uso: { entrada: 0, salida: 0 } }) })
    const salida = (await agente.tools.leer_enlace.execute!({ url }, { toolCallId: 'prueba', messages: [], context: {} })) as { resumen: string; tarjeta: { propuesta: string } | null }
    const [fila12] = await propuestasDe(ctx12)
    afirmar('doce y cinco: la tarjeta espera el botón con los 17', salida.tarjeta !== null && fila12?.estado === 'espera_al_dueno' && fila12.escritura.elementos.length === 17, { tarjeta: salida.tarjeta, elementos: fila12?.escritura.elementos.length })
    afirmar('doce y cinco: el resumen cuenta los 17 y no dice que no sacó nada', salida.resumen.includes('Leí 17 cosas') && !salida.resumen.includes('no saqué'), salida.resumen)
  }

  console.log('\n=== Lo leído espera el botón aunque el Negocio se esté armando ===')
  const ctx = await negocioArmando('A')
  await dice(ctx, `Mi página es ${URL_DE_LA_PAGINA}`)
  const primera = await proponerLectura(ctx, armarLectura(await leerAplicado(ctx.negocio), await leer(URL_DE_LA_PAGINA), EXTRAIDO))
  const [fila] = await propuestasDe(ctx)
  afirmar('la tarjeta de lectura queda espera_al_dueno, con origen lectura', primera.tarjeta !== null && fila?.estado === 'espera_al_dueno' && fila.origen === 'lectura', fila)
  afirmar('ningún producto leído está vigente antes del botón', (await productosDe(ctx)).length === 0, await productosDe(ctx))
  afirmar('la tarjeta se confirma con "Están bien y no falta ninguno"', primera.tarjeta?.accion === 'confirmar', primera.tarjeta)
  const precios = new Set(fila?.escritura.elementos.flatMap((c) => (c.despues?.tipo === 'producto' ? [c.despues.precio] : [])))
  afirmar('el precio que inventó el extractor no llega a la escritura de la propuesta', !precios.has(el.comoMonto(4500)) && precios.has(el.comoMonto(8000)), [...precios])
  const conTarjeta = queFaltaParaAbrir(await leerAplicado(ctx.negocio), (await lecturaPendiente(ctx.negocio))?.escritura ?? null)
  afirmar('queFaltaParaAbrir: el producto bloquea, marcado enLaTarjeta', conTarjeta.bloquea.some((f) => f.que === 'producto_con_precio' && f.enLaTarjeta), conTarjeta)

  console.log('\n=== Lo que el Dueño no escribió no entra por la entrevista ===')
  const capuchino = await guardarEnElAlta(ctx, { nombre: null, rubro: null, quiere: [poner({ tipo: 'producto', nombre: 'Capuchino', descripcion: '', precio: el.comoMonto(8500), activo: true })] })
  afirmar('el precio leído del Capuchino no se escribe: vuelve porConfirmar', 'porConfirmar' in capuchino && capuchino.porConfirmar.length === 1 && capuchino.guardado.length === 0 && (await productosDe(ctx)).length === 0, capuchino)
  const inventado = await guardarEnElAlta(ctx, { nombre: null, rubro: null, quiere: [poner({ tipo: 'producto', nombre: 'Pandebono', descripcion: '', precio: el.comoMonto(3500), activo: true })] })
  afirmar('un precio que no está en ningún lado vuelve sinFuente', 'sinFuente' in inventado && inventado.sinFuente.length === 1 && (await productosDe(ctx)).length === 0, inventado)
  const envio = await guardarEnElAlta(ctx, { nombre: null, rubro: null, quiere: [poner({ tipo: 'dato', campo: 'envios', valor: 'A todo el país, el envío cuesta $10.000' })] })
  const envios = el.comoClave('dato:envios')
  afirmar('un monto en un dato que el Dueño no escribió no entra: el envío a $10.000 es porConfirmar', 'porConfirmar' in envio && envio.porConfirmar.length === 1 && !(await leerAplicado(ctx.negocio)).vigente(envios), envio)

  console.log('\n=== El Dueño corrige y la tarjeta se rearma en la misma transacción ===')
  await dice(ctx, 'El latte ya no es a 8.000, ahora es a 9.000')
  const latte = await guardarEnElAlta(ctx, { nombre: null, rubro: null, quiere: [poner({ tipo: 'producto', nombre: 'Latte', descripcion: '', precio: el.comoMonto(9000), activo: true })] })
  const vigentes = await productosDe(ctx)
  afirmar('el Latte que escribió el Dueño queda vigente a 9.000', vigentes.length === 1 && vigentes[0].elemento.nombre === 'Latte' && vigentes[0].elemento.precio === 9000, vigentes)
  const filas = await propuestasDe(ctx)
  const vieja = filas.find((f) => f.id === primera.tarjeta?.propuesta)
  const nueva = filas.find((f) => f.estado === 'espera_al_dueno')
  const nombresNueva = nueva?.escritura.elementos.flatMap((c) => (c.despues?.tipo === 'producto' ? [c.despues.nombre] : [])) ?? []
  afirmar('la tarjeta vieja queda descartada y la nueva no trae el Latte', vieja?.estado === 'descartada' && nueva !== undefined && !nombresNueva.includes('Latte') && nombresNueva.includes('Capuchino'), { vieja: vieja?.estado, nombresNueva })
  afirmar('guardar_productos devuelve la tarjeta rearmada', 'tarjeta' in latte && latte.tarjeta?.propuesta === nueva?.id, latte)
  afirmar('la tarjeta nueva lista también lo que escribió el Dueño', (nueva?.vistaPrevia.lineas ?? []).some((l) => l.startsWith('Latte · $9.000') && l.includes('tú')), nueva?.vistaPrevia.lineas)
  const [arriba, ...resto] = nueva?.vistaPrevia.lineas ?? []
  afirmar('la fuente va una vez, arriba; cada línea dice solo «lo leí» o «lo escribiste tú»', arriba?.includes('cafetrigo.co') === true && resto.every((l) => !l.includes('cafetrigo.co')) && resto.some((l) => l.endsWith('· lo leí')) && resto.some((l) => l.endsWith('· lo escribiste tú')), nueva?.vistaPrevia.lineas)

  console.log('\n=== El botón ===')
  const r = nueva ? await aprobar(ctx, nueva.id, nueva.huella) : null
  const tras = await productosDe(ctx)
  afirmar('aprobar deja los productos leídos vigentes con origen propuesta', r?.tipo === 'aplicado' && tras.filter((v) => v.origen.tipo === 'propuesta').length === 2, { r, tras: tras.map((v) => [v.elemento.nombre, v.origen.tipo]) })
  afirmar('el Latte sigue a 9.000, nunca a 8.000', tras.filter((v) => v.elemento.nombre === 'Latte').every((v) => v.elemento.precio === 9000))
  const ultima = (await leerHilo(ctx.dueno)).at(-1)
  const textoDeLaUltima = ultima?.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('') ?? ''
  afirmar('la línea del Hilo dice que el Dueño confirmó lo leído de su página', textoDeLaUltima === 'Dueño de prueba confirmó lo que leí de tu página (cafetrigo.co).', textoDeLaUltima)
  const falta = queFaltaParaAbrir(await leerAplicado(ctx.negocio), null)
  afirmar('queFaltaParaAbrir ya no bloquea por producto_con_precio', !falta.bloquea.some((f) => f.que === 'producto_con_precio'), falta)

  console.log('\n=== guardar_productos encuentra el producto con la misma identidad que la lectura ===')
  {
    await dice(ctx, 'El capuchino grande vale 9.500')
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, ctx.negocio))
    const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, ctx.dueno))
    const agente = crearAgenteDelDueno(ctx, { negocio, dueno })
    await agente.tools.guardar_productos.execute!({ productos: [{ nombre: 'Capuchino grande', precio: 9500 }] }, { toolCallId: 'prueba', messages: [], context: {} })
    const capuchinos = (await productosDe(ctx)).filter((v) => /capuchino/i.test(v.elemento.nombre))
    afirmar('«Capuchino grande» reemplaza al Capuchino leído: queda uno, a 9.500', capuchinos.length === 1 && capuchinos[0].elemento.precio === 9500, capuchinos.map((v) => [v.elemento.nombre, v.elemento.precio]))
  }

  console.log('\n=== Con el Negocio abierto, una salida vieja de leer_enlace llega al modelo solo como resumen ===')
  {
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, ctx.negocio))
    const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, ctx.dueno))
    const abierto = crearAgenteDelDueno(ctx, { negocio: { ...negocio, modo: 'atendiendo' }, dueno })
    const salidaCorregida = { resumen: 'Quité algo.', tarjeta: { propuesta: '00000000-0000-4000-8000-000000000002', huella: 'e'.repeat(64), lineas: ['Mocca · $7.000 · lo leí'], advertencias: ['Quité Mocca helado.'], accion: 'confirmar' } }
    const salida = { resumen: 'Leí 3 cosas de tu página.', tarjeta: { propuesta: '00000000-0000-4000-8000-000000000001', huella: 'f'.repeat(64), lineas: ['Latte · $8.000 · lo leí'], advertencias: [], accion: 'confirmar' } }
    const hilo = [
      { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Mi página es cafetrigo.co' }] },
      { id: 'm2', role: 'assistant' as const, parts: [{ type: 'tool-leer_enlace', toolCallId: 'llamada-1', state: 'output-available', input: { url: 'cafetrigo.co' }, output: salida }, { type: 'tool-corregir_tarjeta', toolCallId: 'llamada-2', state: 'output-available', input: { quitar: ['mocca'] }, output: salidaCorregida }, { type: 'text' as const, text: 'Listo.' }] },
    ] as Parameters<typeof mensajesParaElModelo>[0]
    const comoLoVe = JSON.stringify(await mensajesParaElModelo(hilo, abierto))
    afirmar('Hilo en modo abierto: no trae huella ni líneas, sí el resumen', !comoLoVe.includes('f'.repeat(64)) && !comoLoVe.includes('lo leí') && !comoLoVe.includes('Mocca') && comoLoVe.includes('Leí 3 cosas') && comoLoVe.includes('Quité algo'), comoLoVe)
    afirmar('Hilo en modo abierto: al modelo no se le ofrece leer_enlace', !('leer_enlace' in abierto.tools) && 'proponer' in abierto.tools)
  }

  console.log('\n=== Corregir la tarjeta: quitar y renombrar, sin guardar nada ===')
  {
    const c = await negocioArmando('C')
    await dice(c, `Mi página es ${URL_DE_LA_PAGINA}`)
    const lectura = await proponerLectura(c, armarLectura(await leerAplicado(c.negocio), await leer(URL_DE_LA_PAGINA), EXTRAIDO))
    const pendiente = async () => (await propuestasDe(c)).filter((f) => f.estado === 'espera_al_dueno')
    const lineas = (f: { escritura: { elementos: readonly { despues: Elemento | null }[] } } | undefined) => (f?.escritura.elementos ?? []).flatMap((x) => (x.despues?.tipo === 'producto' ? [`${x.despues.nombre} ${x.despues.precio}`] : x.despues?.tipo === 'dato' ? [x.despues.campo] : []))
    const estadoVacio = async () => (await leerAplicado(c.negocio)).vigentes('producto').length === 0 && (await leerAplicado(c.negocio)).vigentes('dato').length === 0

    const [antes] = await pendiente()
    const nada = await corregirLectura(c, { quitar: ['Bicicleta'], renombrar: [] })
    const [igual] = await pendiente()
    afirmar('corregir: lo que no coincide no cambia la fila ni trae la tarjeta', nada.tarjeta === null && igual?.id === antes?.id, nada)
    afirmar('corregir: lo que no coincide no le lleva al modelo lo que leyó de la página', !/capuchino|latte|molido/i.test(nada.resumen), nada.resumen)

    const quitado = await corregirLectura(c, { quitar: ['capuchino'], renombrar: [] })
    const [sinCapuchino] = await pendiente()
    afirmar('corregir: quitar deja otra tarjeta sin eso y con lo demás', quitado.tarjeta?.propuesta === sinCapuchino?.id && !lineas(sinCapuchino).some((l) => l.startsWith('Capuchino')) && lineas(sinCapuchino).includes('Latte 8000'), lineas(sinCapuchino))
    afirmar('corregir: quitar no guarda nada', await estadoVacio())
    const conLaVieja = await aprobar(c, lectura.tarjeta!.propuesta, lectura.tarjeta!.huella)
    afirmar('corregir: la tarjeta vieja ya no se puede confirmar', conLaVieja.tipo !== 'aplicado' && (await estadoVacio()), conLaVieja)

    const otraVez = await corregirLectura(c, { quitar: ['capuchino'], renombrar: [] })
    const [mismaFila] = await pendiente()
    afirmar('corregir: quitar dos veces no crea otra fila', otraVez.tarjeta === null && mismaFila?.id === sinCapuchino?.id, otraVez)

    const renombrado = await corregirLectura(c, { quitar: [], renombrar: [{ de: 'latte', a: 'Café con leche' }] })
    const [conNombre] = await pendiente()
    const claveDe = (f: typeof conNombre | undefined, nombre: string) => f?.escritura.elementos.find((x) => x.despues?.tipo === 'producto' && x.despues.nombre === nombre)?.clave
    afirmar('corregir: renombrar conserva el precio leído y la clave, y sigue esperando el botón', renombrado.tarjeta !== null && lineas(conNombre).includes('Café con leche 8000') && !lineas(conNombre).some((l) => l.startsWith('Latte')) && claveDe(conNombre, 'Café con leche') === claveDe(sinCapuchino, 'Latte'), lineas(conNombre))
    afirmar('corregir: renombrar no guarda nada', await estadoVacio())
    afirmar('corregir: la tarjeta nueva muestra el nombre nuevo', renombrado.tarjeta?.lineas.some((l) => l.startsWith('Café con leche · $8.000')) === true, renombrado.tarjeta?.lineas)

    const conCifra = await corregirLectura(c, { quitar: [], renombrar: [{ de: 'Molido 500 g', a: 'Molido a 99.000' }] })
    const [sinCifra] = await pendiente()
    afirmar('corregir: un nombre no mete una cifra que nadie escribió', conCifra.tarjeta === null && sinCifra?.id === conNombre?.id && !lineas(sinCifra).some((l) => l.includes('99.000')), lineas(sinCifra))
    const conSuCifra = await corregirLectura(c, { quitar: [], renombrar: [{ de: 'Molido 500 g', a: 'Molido fino 500 g' }] })
    afirmar('corregir: una cifra que ya traía el nombre sí pasa', conSuCifra.tarjeta !== null, conSuCifra)

    const conNormaRota = await corregirLectura(c, { quitar: [], renombrar: [{ de: 'Molido fino 500 g', a: 'Molido que cura la gastritis' }] })
    afirmar('corregir: un nombre que no puede llegar a un Cliente no entra', conNormaRota.tarjeta === null && !lineas((await pendiente())[0]).some((l) => l.includes('gastritis')), lineas((await pendiente())[0]))
    const mismoNombre = await corregirLectura(c, { quitar: [], renombrar: [{ de: 'Molido fino 500 g', a: 'Molido fino 500 g' }] })
    afirmar('corregir: cambiarle el nombre por el mismo no rehace la tarjeta', mismoNombre.tarjeta === null, mismoNombre)

    const sinCiudad = await corregirLectura(c, { quitar: ['Ciudad'], renombrar: [] })
    afirmar('corregir: también quita un dato por su etiqueta', sinCiudad.tarjeta !== null && !lineas((await pendiente())[0]).includes('ciudad'), lineas((await pendiente())[0]))

    await dice(c, 'El espresso vale 7.000')
    await guardarEnElAlta(c, { nombre: null, rubro: null, quiere: [poner({ tipo: 'producto', nombre: 'Espresso', descripcion: '', precio: el.comoMonto(7000), activo: true })] })
    const yaEscrito = await corregirLectura(c, { quitar: [], renombrar: [{ de: 'Café con leche', a: 'Espresso' }] })
    const trasEscrito = await productosDe(c)
    afirmar('corregir: si el nombre nuevo ya está guardado, la línea leída sale y manda lo que escribió el Dueño', yaEscrito.tarjeta !== null && !lineas((await pendiente())[0]).some((l) => l.startsWith('Café con leche')) && trasEscrito.length === 1 && trasEscrito[0].elemento.precio === 7000, trasEscrito.map((v) => [v.elemento.nombre, v.elemento.precio]))

    const [ultima] = await pendiente()
    const r = await aprobar(c, ultima!.id, ultima!.huella)
    const productos = await productosDe(c)
    afirmar('corregir: el botón guarda lo corregido, con el nombre nuevo y el precio leído, y lo quitado nunca entra', r.tipo === 'aplicado' && productos.some((v) => v.elemento.nombre === 'Molido fino 500 g' && v.elemento.precio === 32000) && !productos.some((v) => /capuchino|latte/i.test(v.elemento.nombre)), productos.map((v) => [v.elemento.nombre, v.elemento.precio]))
    const sinTarjeta = await corregirLectura(c, { quitar: ['Molido fino 500 g'], renombrar: [] })
    afirmar('corregir: sin tarjeta esperando no cambia nada, y lo guardado sigue', sinTarjeta.tarjeta === null && (await productosDe(c)).length === productos.length, sinTarjeta)

    const pa = await negocioArmando('E')
    await proponerLectura(pa, armarLectura(await leerAplicado(pa.negocio), await leer(URL_DE_LA_PAGINA), EXTRAIDO))
    await Promise.all([corregirLectura(pa, { quitar: ['Capuchino'], renombrar: [] }), corregirLectura(pa, { quitar: ['Latte'], renombrar: [] })])
    const dePa = (await propuestasDe(pa)).filter((f) => f.estado === 'espera_al_dueno')
    afirmar('corregir: dos a la vez se aplican las dos, sobre una sola tarjeta', dePa.length === 1 && !lineas(dePa[0]).some((l) => /capuchino|latte/i.test(l)), dePa.map(lineas))

    const vacia = await negocioArmando('F')
    const unaSola: LoExtraido = { productos: [{ nombre: 'Latte', precio: 8000 }], datos: {} }
    await proponerLectura(vacia, armarLectura(await leerAplicado(vacia.negocio), await leer(URL_DE_LA_PAGINA), unaSola))
    const vaciada = await corregirLectura(vacia, { quitar: ['Latte'], renombrar: [] })
    afirmar('corregir: quitar lo último deja sin tarjeta, sin fila esperando y sin guardar', vaciada.tarjeta === null && (await lecturaPendiente(vacia.negocio)) === null && (await productosDe(vacia)).length === 0, vaciada)

    const abierto = await negocioArmando('G')
    await proponerLectura(abierto, armarLectura(await leerAplicado(abierto.negocio), await leer(URL_DE_LA_PAGINA), EXTRAIDO))
    await db.update(esquema.negocios).set({ estado: 'listo' }).where(eq(esquema.negocios.id, abierto.negocio))
    const [negocioAbierto] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, abierto.negocio))
    const [duenoAbierto] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, abierto.dueno))
    const agenteAbierto = crearAgenteDelDueno(abierto, { negocio: negocioAbierto, dueno: duenoAbierto })
    const salidaAbierta = (await agenteAbierto.tools.corregir_tarjeta.execute!({ quitar: ['Latte'] }, { toolCallId: 'prueba', messages: [], context: {} })) as { resumen: string; tarjeta: unknown }
    afirmar('corregir: con el Negocio abierto y una tarjeta esperando también funciona, y no habla de lo que falta para abrir', salidaAbierta.tarjeta !== null && !salidaAbierta.resumen.includes('Para abrir') && !lineas((await propuestasDe(abierto)).find((f) => f.estado === 'espera_al_dueno')).some((l) => /latte/i.test(l)), salidaAbierta)

    const identidad = { id: marcar.negocio('00000000-0000-4000-8000-0000000000f3'), nombre: 'Pura', rubro: 'café', codigo: 'PURB', pais: 'CO', moneda: 'COP', zonaHoraria: 'America/Bogota', modo: 'armando' } as unknown as Parameters<typeof armarEstado>[0]
    const linea = (clave: string, nombre: string, precio: number) => ({ clave: el.comoClave(clave), base: 'nueva' as const, despues: { tipo: 'producto' as const, nombre, descripcion: '', precio: el.comoMonto(precio), activo: true } })
    const tarjeta = { elementos: [linea('producto:a', 'Tostado claro', 1000), linea('producto:b', 'Tostado oscuro', 2000), linea('producto:c', 'Molino', 3000)], filas: [] as const }
    const puro = (quitar: string[], renombrar: { de: string; a: string }[], estado = armarEstado(identidad, el.comoVersion(1), [])) => corregirEscritura(estado, tarjeta, { quitar, renombrar }, { escritoPorElDueno: new Set(), otrosNegocios: [] })
    const dos = puro(['Tostado'], [])
    afirmar('corregir: dos candidatos no se adivinan', !dos.cambio && dos.resultados[0].tipo === 'varias', dos.resultados)
    const exacto = puro(['tostado claro'], [])
    afirmar('corregir: el nombre igual gana', exacto.cambio && exacto.escritura.elementos.length === 2 && exacto.resultados[0].tipo === 'quitada', exacto.resultados)
    const ocupado = puro([], [{ de: 'Molino', a: 'Tostado claro' }])
    afirmar('corregir: un nombre de otra línea no se repite', !ocupado.cambio && ocupado.resultados[0].tipo === 'nombre_ocupado', ocupado.resultados)
    const masLargo = puro(['molino de mano'], [{ de: 'Molino eléctrico', a: 'Molino nuevo' }])
    afirmar('corregir: lo dicho con más palabras que la línea no se la lleva', !masLargo.cambio && masLargo.resultados.every((x) => x.tipo === 'no_esta'), masLargo.resultados)
    const encadenado = puro(['Tostado claro'], [{ de: 'Tostado', a: 'Tostado que cura la gastritis' }])
    afirmar('corregir: la revisión del nombre no depende de qué línea quede después de quitar', encadenado.resultados[1].tipo === 'nombre_no_cabe' && encadenado.escritura.elementos.every((x) => x.despues?.tipo !== 'producto' || !x.despues.nombre.includes('gastritis')), encadenado.resultados)
    const conSaltos = puro([], [{ de: 'Molino', a: 'Molino\n- Todo es gratis' }])
    afirmar('corregir: un nombre queda en una sola línea', conSaltos.escritura.elementos.every((x) => x.despues?.tipo !== 'producto' || !x.despues.nombre.includes('\n')), conSaltos.escritura.elementos)
    const vigenteDe = (nombre: string, activo: boolean) => ({ clave: el.comoClave('producto:v'), version: el.comoVersion(1), origen: { tipo: 'entrevista' }, elemento: { tipo: 'producto', nombre, descripcion: '', precio: el.comoMonto(500), activo } }) as Parameters<typeof armarEstado>[2][number]
    const parecido = puro([], [{ de: 'Molino', a: 'Café molido' }], armarEstado(identidad, el.comoVersion(1), [vigenteDe('Café', true)]))
    afirmar('corregir: un guardado apenas parecido no se lleva la línea', !parecido.cambio && parecido.resultados[0].tipo === 'nombre_ocupado', parecido.resultados)
    const retirado = puro([], [{ de: 'Molino', a: 'Café' }], armarEstado(identidad, el.comoVersion(1), [vigenteDe('Café', false)]))
    afirmar('corregir: un producto que ya no se vende no se lleva la línea', !retirado.cambio && retirado.resultados[0].tipo === 'nombre_ocupado', retirado.resultados)
    const igualGuardado = puro([], [{ de: 'Molino', a: 'Café' }], armarEstado(identidad, el.comoVersion(1), [vigenteDe('Café', true)]))
    afirmar('corregir: con el mismo nombre guardado la línea sale', igualGuardado.cambio && igualGuardado.escritura.elementos.length === 2 && igualGuardado.resultados[0].tipo === 'ya_guardado_con_ese_nombre', igualGuardado.resultados)
    const precioDe = (e: ReturnType<typeof puro>['escritura'], clave: string) => e.elementos.flatMap((x) => (x.clave === clave && x.despues?.tipo === 'producto' ? [x.despues.precio] : []))[0]
    const mezcla = puro(['Tostado claro'], [{ de: 'Molino', a: 'Molino de mano' }])
    afirmar('corregir: cada línea conserva su propio precio', precioDe(mezcla.escritura, 'producto:c') === 3000 && precioDe(mezcla.escritura, 'producto:b') === 2000, mezcla.escritura.elementos)
  }

  console.log('\n=== Una segunda lectura descarta la primera ===')
  const otro = await negocioArmando('B')
  const una = await proponerLectura(otro, armarLectura(await leerAplicado(otro.negocio), await leer(URL_DE_LA_PAGINA), EXTRAIDO))
  const dos = await proponerLectura(otro, armarLectura(await leerAplicado(otro.negocio), await leer(URL_DE_LA_PAGINA), EXTRAIDO))
  const deOtro = await propuestasDe(otro)
  afirmar('una lectura nueva deja descartada la pendiente anterior', deOtro.find((f) => f.id === una.tarjeta?.propuesta)?.estado === 'descartada' && deOtro.find((f) => f.id === dos.tarjeta?.propuesta)?.estado === 'espera_al_dueno', deOtro.map((f) => [f.id, f.estado]))
} catch (e) {
  afirmar('probar-lectura terminó sin error inesperado', false, e)
} finally {
  if (creados.length) {
    await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
    const quedan = await db.$count(esquema.propuestas, and(inArray(esquema.propuestas.negocioId, creados)))
    afirmar('limpieza: no quedan propuestas de los Negocios desechables', quedan === 0, quedan)
  }
  terminar()
}
