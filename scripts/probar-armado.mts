/**
 * Lo que la carta del armado dice, contra Neon real. Sin modelo: cada paso y fila sale del estado, también fuera del
 * orden del guion, y abrir con el botón deja el Negocio abierto. Con Muse Spark real y `ENVIO_SIMULADO=1`: una
 * conversación que no sigue el orden termina abierta, y la carta fue cierta en cada turno. Borra lo que crea.
 *
 *   pnpm tsx scripts/probar-armado.mts
 */
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { altaDeDueno } = await import('../src/negocio/alta')
const { abrirConElBoton } = await import('../src/negocio/abrir')
const { guardarEnElHilo, leerHilo, mensajeDelDuenoEnTexto } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo } = await import('../src/negocio/dueno-chat')
const { trasElBoton } = await import('../src/negocio/partes-del-hilo')
const { armadoDe, porCompletar } = await import('../src/nucleo/armado')
const { abrioElAgente, cuantoGuardo, estaLeyendo, loQueSigue, pasoDelArmado, titularDe, ultimoTurno } = await import('../src/nucleo/armado-paso')
const { armarLectura, guardarEnElAlta, lecturaPendiente, proponerLectura, aprobar } = await import('../src/nucleo/cambios')
const { leerAplicado } = await import('../src/nucleo/estado')
const { marcar } = await import('../src/nucleo/identidad')
type Ctx = import('../src/nucleo/identidad').ContextoDelDueno
type UIMessage = import('ai').UIMessage

const creados: string[] = []
const SIN_NADA_AHORA = { leyendo: false, pospusoElCobro: false }

async function darDeAlta(quien: string) {
  const { negocio, dueno } = await altaDeDueno({ id: `prueba-armado-${quien}-${Date.now()}`, name: quien, email: `${quien}@example.com` })
  creados.push(negocio.id)
  return { negocio, dueno, ctx: { negocio: marcar.negocio(negocio.id), dueno: marcar.dueno(dueno.id), medio: 'web' } as Ctx }
}

const carta = async (ctx: Ctx) => armadoDe(await leerAplicado(ctx.negocio), (await lecturaPendiente(ctx.negocio))?.escritura ?? null)
const fila = (d: Awaited<ReturnType<typeof carta>>, dato: string) => d.filas.find((f) => f.dato === dato)!

/** Lo que dice el Dueño queda en el Hilo: de ahí sale de quién es una cifra. */
const dice = async (ctx: Ctx, texto: string) => guardarEnElHilo(ctx.negocio, ctx.dueno, 'dueno', mensajeDelDuenoEnTexto(texto)!)
const datoDe = (campo: string, valor: string) => ({ tipo: 'poner', elemento: { tipo: 'dato', campo, valor }, reemplaza: null }) as never

function probarLoPuro() {
  const u = (role: 'user' | 'assistant', ...parts: object[]) => ({ id: crypto.randomUUID(), role, parts }) as UIMessage
  const leyendo = [u('user', { type: 'text', text: 'cafeladera.com' }), u('assistant', { type: 'tool-leer_enlace', state: 'input-available', input: { url: 'cafeladera.com' } })]
  const leyo = [u('user', { type: 'text', text: 'cafeladera.com' }), u('assistant', { type: 'tool-leer_enlace', state: 'output-available', output: {} })]
  afirmar('puro: un enlace en curso se lee como leyendo', estaLeyendo(leyendo) && !estaLeyendo(leyo))
  afirmar('puro: cuenta lo que guardó, no lo que está en curso', cuantoGuardo(leyendo) === 0 && cuantoGuardo(leyo) === 1)
  afirmar('puro: abrir que no pudo no cuenta como abierto', !abrioElAgente([u('assistant', { type: 'tool-abrir_negocio', state: 'output-available', output: { ok: false } })]) && abrioElAgente([u('assistant', { type: 'tool-abrir_negocio', state: 'output-available', output: { ok: true } })]))
  const t = ultimoTurno([u('assistant'), u('user'), u('assistant'), u('user'), u('assistant')])
  afirmar('puro: el turno va desde lo último que dijo el Dueño', t.antes.length === 3 && t.turno.length === 2)
  afirmar('puro: sin mensajes del Dueño, todo es el turno', ultimoTurno([u('assistant')]).turno.length === 1)

  const tarjeta = { propuesta: 'p', huella: 'h', vence: '2030-01-01T00:00:00Z', advertencias: [], lineas: [], accion: 'confirmar' }
  const conTarjeta = u('assistant', { type: 'tool-leer_enlace', state: 'output-available', output: { resumen: '', tarjeta } })
  const con = (estado: string) => ({ p: { estado, accion: 'confirmar', aprobadaPor: null, asunto: null, publicada: false } }) as never
  afirmar('tras el botón: la línea de lo aprobado cuenta', trasElBoton([conTarjeta, u('assistant', { type: 'data-aprobacion', data: {} })], {}) === 'aplicada')
  afirmar('tras el botón: antes de la línea lo dice el estado', trasElBoton([conTarjeta], con('aplicada')) === 'aplicada' && trasElBoton([conTarjeta], con('descartada')) === 'descartada')
  afirmar('tras el botón: si la tarjeta espera, no es momento', trasElBoton([conTarjeta], con('espera_al_dueno')) === null)
  afirmar('tras el botón: si el Dueño ya escribió, no es momento', trasElBoton([conTarjeta, u('user', { type: 'text', text: 'hola' })], con('aplicada')) === null)
  afirmar('tras el botón: sin mensajes no es momento', trasElBoton([], {}) === null)
}

/** El orden al revés del guion: tono y cobro, luego la tarjeta, luego lo que bloquea. */
async function probarSinModelo() {
  const { ctx } = await darDeAlta('Sin Modelo')
  let d = await carta(ctx)
  afirmar('recién nacido: conociendo, sin nombre, sin link y todo falta', pasoDelArmado(d, SIN_NADA_AHORA) === 'conociendo' && d.nombre === null && d.link === null && d.filas.every((f) => f.estado === 'falta'), d)
  afirmar('recién nacido: el nombre temporal no se muestra como nombre', titularDe('conociendo', d) === 'Cuéntame de tu negocio.', titularDe('conociendo', d))

  await guardarEnElAlta(ctx, { nombre: null, rubro: null, quiere: [datoDe('pagos', 'Contra entrega')] })
  d = await carta(ctx)
  afirmar('fuera de orden: cómo cobra se marca y el paso no se adelanta', fila(d, 'Cómo cobras').estado === 'sabido' && fila(d, 'Cómo cobras').valor === 'Contra entrega' && pasoDelArmado(d, SIN_NADA_AHORA) === 'conociendo', d)

  const pagina = { tipo: 'leida', url: 'https://cafe.example.com', fuente: 'tu página (cafe.example.com)', titulo: 'Café', texto: 'Bolsa de 500 g a $38.000. Enviamos a todo el país: el envío cuesta $10.000 y llega de 2 a 4 días hábiles.' } as const
  const extraido = { productos: [{ nombre: 'Bolsa 500 g', precio: 38000 }], datos: { envios: 'A todo el país: el envío cuesta $10.000 y llega de 2 a 4 días hábiles.' } }
  const lectura = await proponerLectura(ctx, armarLectura(await leerAplicado(ctx.negocio), pagina, extraido))
  d = await carta(ctx)
  afirmar('tarjeta: el paso es confirmar y lo leído no se marca como sabido', pasoDelArmado(d, SIN_NADA_AHORA) === 'confirmar' && fila(d, 'Productos').estado === 'en_la_tarjeta' && fila(d, 'Productos').valor === '1 con precio' && fila(d, 'Envíos').estado === 'en_la_tarjeta' && d.lectura?.productos === 1, d)
  afirmar('tarjeta: Tu Panel dice que el producto falta confirmarlo', d.productos.length === 1 && d.productos[0].estado === 'Por confirmar' && d.productos[0].precio === '$38.000', d.productos)
  afirmar('tarjeta: abrir sigue bloqueado', d.faltaParaAbrir.length > 0, d.faltaParaAbrir)
  afirmar('tarjeta: leyendo gana a confirmar', pasoDelArmado(d, { leyendo: true, pospusoElCobro: false }) === 'leyendo')

  const noAbre = await abrirConElBoton(ctx)
  const [sigue] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, ctx.negocio))
  afirmar('botón: con lo que bloquea no abre y dice qué falta', !noAbre.abierto && noAbre.falta.length > 0 && sigue.estado === 'armando', { noAbre, estado: sigue.estado })

  afirmar('tarjeta: la lectura trae una tarjeta', !!lectura.tarjeta, lectura)
  await aprobar(ctx, lectura.tarjeta!.propuesta, lectura.tarjeta!.huella)
  d = await carta(ctx)
  afirmar('confirmada: se marca y, sin nombre, el paso sigue conociendo', fila(d, 'Productos').estado === 'sabido' && fila(d, 'Envíos').estado === 'sabido' && d.lectura === null && d.nombre === null && pasoDelArmado(d, SIN_NADA_AHORA) === 'conociendo', d)
  afirmar('confirmada: el titular pregunta lo que de verdad falta', titularDe('conociendo', d) === '¿Cómo se llama tu negocio?', titularDe('conociendo', d))
  await guardarEnElAlta(ctx, { nombre: 'Café Trigo', rubro: null, quiere: [] })
  d = await carta(ctx)
  afirmar('con nombre: el paso es listo y trae el link de verdad', d.nombre === 'Café Trigo' && d.link?.includes('wa.me') === true && pasoDelArmado(d, SIN_NADA_AHORA) === 'listo', d)
  afirmar('confirmada: Tu Panel dice que el producto está listo', d.productos[0]?.estado === 'Listo', d.productos)
  afirmar('listo: el titular lleva el nombre de verdad', titularDe('listo', d) === 'Café Trigo puede abrir.', titularDe('listo', d))

  const abre = await abrirConElBoton(ctx)
  const [abierto] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, ctx.negocio))
  const hilo = await leerHilo(ctx.dueno)
  const conLink = (m: UIMessage) => m.parts.some((p) => p.type === 'text' && p.text.includes('wa.me'))
  afirmar('botón: abre y el Hilo cuenta el link', abre.abierto && abierto.estado === 'listo' && conLink(hilo.at(-1)!), { abre, estado: abierto.estado })
  await abrirConElBoton(ctx)
  afirmar('botón: abrir dos veces no repite la línea', (await leerHilo(ctx.dueno)).filter(conLink).length === 1)
}

async function probarLoQueFaltaPorLeer() {
  const { ctx } = await darDeAlta('Cobro Pendiente')
  await dice(ctx, 'Vendo pan a 5000')
  await guardarEnElAlta(ctx, { nombre: 'Pan de Marta', rubro: null, quiere: [{ tipo: 'poner', elemento: { tipo: 'producto', nombre: 'Pan', descripcion: '', precio: 5000, activo: true }, reemplaza: null } as never] })
  const d = await carta(ctx)
  afirmar('cobro: sin formas de pago el paso es cobro', pasoDelArmado(d, SIN_NADA_AHORA) === 'cobro', d)
  afirmar('cobro: si faltan más cosas no dice que solo falta una', titularDe('cobro', d) === 'Me falta saber cómo te pagan.', titularDe('cobro', d))
  afirmar('cobro: se puede dejar para después y queda sin marcar', pasoDelArmado(d, { leyendo: false, pospusoElCobro: true }) === 'listo' && fila(d, 'Cómo cobras').estado === 'falta', d.filas)
  afirmar('cobro: no bloquea abrir', d.faltaParaAbrir.length === 0, d.faltaParaAbrir)
}

async function probarAgendaNoEnvia() {
  const { ctx } = await darDeAlta('Agenda')
  await guardarEnElAlta(ctx, { nombre: 'Consultorio Trigo', rubro: 'Consultorio de fisioterapia', quiere: [] })
  const faltan = porCompletar(await leerAplicado(ctx.negocio)).map((f) => f.dato)
  afirmar('Inicio: una agenda no pide envíos, y sí lo demás', !faltan.includes('Envíos') && faltan.includes('Horario'), faltan)
}

async function probarOtroNegocio() {
  const una = await darDeAlta('Una')
  const otra = await darDeAlta('Otra')
  await dice(una.ctx, 'Vendo pan a 5000')
  await guardarEnElAlta(una.ctx, { nombre: 'Pan de Una', rubro: null, quiere: [{ tipo: 'poner', elemento: { tipo: 'producto', nombre: 'Pan', descripcion: '', precio: 5000, activo: true }, reemplaza: null } as never] })
  const d = await carta(otra.ctx)
  afirmar('aislamiento: lo de un Negocio no aparece en la carta de otro', d.nombre === null && d.productos.length === 0, d)
}

/** Una página sin precios, como la que dejó trabado al primer Dueño de producción: el botón no marcaba nada y nadie decía qué seguía. */
async function probarWebSinPrecios() {
  const { negocio, dueno, ctx } = await darDeAlta('Sin Precios')
  const pagina = { tipo: 'leida', url: 'https://sinprecios.example.com', fuente: 'tu página (sinprecios.example.com)', titulo: 'Inicio', texto: 'Tostamos café de especialidad en Manizales.' } as never
  const extraido = { productos: [], datos: { descripcion: 'Café de especialidad', ciudad: 'Manizales' } }
  const lectura = await proponerLectura(ctx, armarLectura(await leerAplicado(ctx.negocio), pagina, extraido))
  let d = await carta(ctx)
  afirmar('sin precios: lo leído se ve por confirmar', pasoDelArmado(d, SIN_NADA_AHORA) === 'confirmar' && fila(d, 'Qué haces').estado === 'en_la_tarjeta' && fila(d, 'Ciudad').estado === 'en_la_tarjeta', d.filas)
  await aprobar(ctx, lectura.tarjeta!.propuesta, lectura.tarjeta!.huella)
  d = await carta(ctx)
  afirmar('sin precios: el botón marca lo que trajo la página', fila(d, 'Qué haces').estado === 'sabido' && fila(d, 'Ciudad').estado === 'sabido', d.filas)
  afirmar('sin precios: lo siguiente es el nombre, y no volver a pedir que cuente', pasoDelArmado(d, SIN_NADA_AHORA) === 'conociendo' && titularDe('conociendo', d) === '¿Cómo se llama tu negocio?', titularDe('conociendo', d))
  const hilo = await leerHilo(ctx.dueno)
  afirmar('sin precios: lo último del Hilo real es el botón', trasElBoton(hilo, {}) === 'aplicada', hilo.at(-1))
  afirmar('sin precios: lo que sigue lo dice el código', loQueSigue(d, true) === 'Listo, ya lo tengo. ¿Cómo se llama tu negocio?', loQueSigue(d, true))

  const turno = async (texto: string) => {
    const [n] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
    await (await responderEnElHilo({ ctx, negocio: n, dueno, mensaje: mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })! })).text()
    await new Promise((r) => setTimeout(r, 400))
    return carta(ctx)
  }
  d = await turno('Café Trigo')
  afirmar('Muse Spark: tras el botón, contestar solo el nombre lo guarda como nombre', d.nombre === 'Café Trigo', { nombre: d.nombre })
  afirmar('sin precios: con nombre, lo que sigue es qué vende', loQueSigue(d, true) === 'Listo, ya lo tengo. ¿Qué vendes y a qué precio? Con uno me basta para abrir.', loQueSigue(d, true))
  d = await turno('La bolsa de 500 g vale 38000')
  afirmar('Muse Spark: contestar qué vende lo guarda con su precio', fila(d, 'Productos').estado === 'sabido' && d.productos.some((p) => p.precio === '$38.000'), d.filas)
  afirmar('sin precios: ya no bloquea nada y el cobro se puede responder', pasoDelArmado(d, SIN_NADA_AHORA) === 'cobro', d.faltaParaAbrir)

  const abre = await abrirConElBoton(ctx)
  afirmar('abierto: el botón abre con nombre y un producto', abre.abierto, abre)
  const faltan = porCompletar(await leerAplicado(ctx.negocio))
  afirmar('Inicio: pide lo que no bloqueó abrir, y no lo que ya sabe', ['Cómo cobras', 'Envíos', 'Horario', 'Tono'].every((x) => faltan.some((f) => f.dato === x)) && !faltan.some((f) => f.dato === 'Ciudad'), faltan.map((f) => f.dato))
  const contestar: Record<string, string> = { 'Cómo cobras': 'contra entrega', Horario: 'de lunes a viernes de 9 a 5', Tono: 'de tú y con cariño' }
  for (const f of faltan.filter((x) => contestar[x.dato])) {
    await turno(`${f.empieza}${contestar[f.dato]}`)
    const propuestas = await db.select({ escritura: esquema.propuestas.escritura, estado: esquema.propuestas.estado }).from(esquema.propuestas).where(eq(esquema.propuestas.negocioId, negocio.id))
    const tipo = f.dato === 'Tono' ? 'voz' : 'dato'
    const campo = f.dato === 'Cómo cobras' ? 'pagos' : 'horario'
    const preparada = propuestas.some((p) => p.estado === 'espera_al_dueno' && p.escritura.elementos.some((c) => c.despues?.tipo === tipo && (tipo === 'voz' || (c.despues as { campo?: string }).campo === campo)))
    afirmar(`Muse Spark: lo que empieza Decírselo en ${f.dato} trae su tarjeta`, preparada, propuestas.map((p) => p.estado))
  }
}

async function probarElNombreLeido() {
  const { ctx } = await darDeAlta('Nombre Leido')
  const pagina = { tipo: 'leida', url: 'https://cafeladera-prueba.co', fuente: 'tu página (cafeladera-prueba.co)', titulo: 'Tostadora Altamira', texto: 'Tostadora Altamira. Bolsa de 500 g a $38.000.' } as const
  const lectura = await proponerLectura(ctx, armarLectura(await leerAplicado(ctx.negocio), pagina, { nombre: 'Tostadora Altamira', productos: [{ nombre: 'Bolsa 500 g', precio: 38000 }], datos: {} }))
  let d = await carta(ctx)
  afirmar('nombre leído: Lo que ya sé lo muestra por confirmar', fila(d, 'Nombre').estado === 'en_la_tarjeta' && fila(d, 'Nombre').valor === 'Tostadora Altamira', d.filas)
  afirmar('nombre leído: Tu Panel lo pinta antes del botón', d.nombre === 'Tostadora Altamira', d.nombre)
  afirmar('nombre leído: sin botón no hay link ni se puede abrir', d.link === null && d.faltaParaAbrir.includes('el nombre del Negocio'), d)
  afirmar('nombre leído: el paso es confirmar', pasoDelArmado(d, SIN_NADA_AHORA) === 'confirmar', pasoDelArmado(d, SIN_NADA_AHORA))
  const noAbre = await abrirConElBoton(ctx)
  afirmar('nombre leído: el botón Abrir no abre con el nombre en la tarjeta', !noAbre.abierto, noAbre)
  await aprobar(ctx, lectura.tarjeta!.propuesta, lectura.tarjeta!.huella)
  d = await carta(ctx)
  afirmar('nombre leído: después del botón queda sabido, con su link', fila(d, 'Nombre').estado === 'sabido' && fila(d, 'Nombre').valor === 'Tostadora Altamira' && d.nombre === 'Tostadora Altamira' && decodeURIComponent(d.link ?? '').includes('Hola Tostadora Altamira'), d)
  afirmar('nombre leído: lo que dice la carta tras el botón no pregunta el nombre', loQueSigue(d, true) === 'Listo, ya lo tengo. ¿Qué vendes y a qué precio? Con uno me basta para abrir.', loQueSigue(d, true))
  afirmar('nombre leído: el paso ya no pregunta el nombre', titularDe(pasoDelArmado(d, SIN_NADA_AHORA), d) !== '¿Cómo se llama tu negocio?', titularDe(pasoDelArmado(d, SIN_NADA_AHORA), d))
}

/** Con el modelo: afirma lo que quedó en la base, nunca lo que dijo. */
async function probarConMuseSpark() {
  const { negocio, dueno, ctx } = await darDeAlta('Marta')
  const turno = async (texto: string) => {
    const [n] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
    const inicio = Date.now()
    const respuesta = await responderEnElHilo({ ctx, negocio: n, dueno, mensaje: mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })! })
    await respuesta.text()
    await new Promise((r) => setTimeout(r, 400))
    const d = await carta(ctx)
    console.log(`Dueño: ${texto}\n  ${Date.now() - inicio} ms · paso ${pasoDelArmado(d, SIN_NADA_AHORA)} · ${d.filas.filter((f) => f.estado === 'sabido').map((f) => f.dato).join(', ') || 'nada sabido'}`)
    return d
  }

  let d = await turno('Primero lo primero: cobro por Nequi y contra entrega, y me gusta hablarles de tú, con mucho cariño.')
  afirmar('Muse Spark, fuera de orden: guardó cómo cobra y el tono', fila(d, 'Cómo cobras').estado === 'sabido' && fila(d, 'Tono').estado === 'sabido', d.filas)
  afirmar('Muse Spark, fuera de orden: sin nombre ni productos sigue conociendo', pasoDelArmado(d, SIN_NADA_AHORA) === 'conociendo', d)

  d = await turno('Atiendo de lunes a sábado de 8 a 6. Envío a todo el país por Servientrega, de 3 a 5 días, y el envío cuesta 12000.')
  afirmar('Muse Spark: horario y envíos se marcan, y el paso sigue siendo cierto', fila(d, 'Horario').estado === 'sabido' && fila(d, 'Envíos').estado === 'sabido' && pasoDelArmado(d, SIN_NADA_AHORA) === 'conociendo', d.filas)

  d = await turno('Se llama Dulces de la Abuela. El arequipe de 500 g vale 18000 y las brevas caladas de 400 g valen 25000.')
  afirmar('Muse Spark: con nombre y productos con precio, puede abrir', d.nombre !== null && fila(d, 'Productos').estado === 'sabido' && pasoDelArmado(d, SIN_NADA_AHORA) === 'listo' && d.link?.includes('wa.me') === true, d)
  afirmar('Muse Spark: Tu Panel lleva los productos reales con su precio', d.productos.some((p) => p.precio === '$18.000' && p.estado === 'Listo'), d.productos)

  for (const texto of ['Sí, está todo bien, ábrelo ya.', 'Sí, ábrelo por favor.']) {
    const [n] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
    if (n.estado === 'listo') break
    await turno(texto)
  }
  const [abierto] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id))
  const hilo = await leerHilo(dueno.id)
  afirmar('Muse Spark: el agente abrió, y la carta lo reconoce para sacar el cielo', abierto.estado === 'listo' && abrioElAgente(hilo), { estado: abierto.estado })
}

try {
  probarLoPuro()
  await probarSinModelo()
  await probarLoQueFaltaPorLeer()
  await probarOtroNegocio()
  await probarAgendaNoEnvia()
  await probarWebSinPrecios()
  await probarElNombreLeido()
  await probarConMuseSpark()
} catch (e) {
  afirmar('probar-armado terminó sin error inesperado', false, e)
} finally {
  for (const id of creados) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, id)).catch((e) => afirmar('probar-armado borró lo que creó', false, e))
  terminar()
}
