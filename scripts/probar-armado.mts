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
const { armadoDe } = await import('../src/nucleo/armado')
const { abrioElAgente, cuantoGuardo, estaLeyendo, pasoDelArmado, titularDe, ultimoTurno } = await import('../src/nucleo/armado-paso')
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

async function probarOtroNegocio() {
  const una = await darDeAlta('Una')
  const otra = await darDeAlta('Otra')
  await dice(una.ctx, 'Vendo pan a 5000')
  await guardarEnElAlta(una.ctx, { nombre: 'Pan de Una', rubro: null, quiere: [{ tipo: 'poner', elemento: { tipo: 'producto', nombre: 'Pan', descripcion: '', precio: 5000, activo: true }, reemplaza: null } as never] })
  const d = await carta(otra.ctx)
  afirmar('aislamiento: lo de un Negocio no aparece en la carta de otro', d.nombre === null && d.productos.length === 0, d)
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
  await probarConMuseSpark()
} catch (e) {
  afirmar('probar-armado terminó sin error inesperado', false, e)
} finally {
  for (const id of creados) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, id)).catch((e) => afirmar('probar-armado borró lo que creó', false, e))
  terminar()
}
