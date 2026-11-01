/**
 * La primera conversación, variante B, con Muse Spark y Neon reales y `ENVIO_SIMULADO=1`. El Dueño es un guion de
 * mensajes fijos; la página es de guion y el extractor, el real. Dos Negocios desechables: uno con página y otro sin
 * nada publicado. Afirma filas y envíos, nunca el texto del modelo. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-primera.mts [pagina] [sin-pagina]
 */
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()

const { db, esquema } = await import('../src/db')
const { lectorDeGuion } = await import('../src/lib/leer-enlace')
const { costoUsd } = await import('../src/lib/modelo')
const { altaDeDueno } = await import('../src/negocio/alta')
const { leerHilo } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo, tarjetasDe } = await import('../src/negocio/dueno-chat')
const { aprobar, EXTRACTOR, lecturaPendiente } = await import('../src/nucleo/cambios')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { leerEstado } = await import('../src/nucleo/estado')
const { numerosEn } = await import('../src/nucleo/cambios/lectura')
const { montosEn } = await import('../src/nucleo/salida/revisar')
const { marcar } = await import('../src/nucleo/identidad')

type Ctx = import('../src/nucleo/identidad').ContextoDelDueno
type PuertosDelDueno = import('../src/agentes/dueno').PuertosDelDueno

const quiero = (nombre: string) => process.argv.length <= 2 || process.argv.includes(nombre)
const titulo = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
const TABLAS = { negocios: esquema.negocios, duenos: esquema.duenos, propuestas: esquema.propuestas, elementos: esquema.elementos, casos: esquema.casos, pedidos: esquema.pedidos, mensajes_dueno: esquema.mensajesDueno }
const contar = async () => Object.fromEntries(await Promise.all(Object.entries(TABLAS).map(async ([n, t]) => [n, await db.$count(t)] as const)))
const antes = await contar()
const creados: string[] = []

const URL_DE_LA_PAGINA = 'https://cafeladera-prueba.co'
const PAGINA = `<html><head><title>Café Ladera · Manizales</title><meta name="description" content="Café de especialidad de Manizales"></head><body>
<h1>Café Ladera</h1><p>Café de especialidad de Manizales, tostado en lotes pequeños.</p>
<h2>Carta</h2>
<ul><li>Tinto · $3.500</li><li>Capuchino · $8.500</li><li>Latte · $8.000</li><li>Café molido 500 g · $38.000</li><li>Café en grano 250 g · $22.000</li></ul>
<p>Pagos: Nequi, Bancolombia y efectivo.</p>
<p>Enviamos a todo el país.</p>
</body></html>`

type Medida = { readonly ms: number; readonly usd: number; readonly entrada: number; readonly salida: number }

async function negocioNuevo(nombre: string) {
  const { negocio, dueno } = await altaDeDueno({ id: `prueba-primera-${nombre}-${Date.now()}`, name: 'Ana', email: 'ana@example.com' })
  creados.push(negocio.id)
  return { ctx: { negocio: marcar.negocio(negocio.id), dueno: marcar.dueno(dueno.id), medio: 'web' as const } satisfies Ctx, negocioId: negocio.id, duenoId: dueno.id }
}

/** Un turno del Dueño contra el Hilo, con el modelo real. Devuelve el mensaje del agente y cuánto tardó. */
async function dice(n: Awaited<ReturnType<typeof negocioNuevo>>, texto: string, puertos?: PuertosDelDueno) {
  const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, n.negocioId))
  const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, n.duenoId))
  const inicio = Date.now()
  const r = await responderEnElHilo({ ctx: n.ctx, negocio, dueno, mensaje: mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })!, puertos })
  await r.text()
  await new Promise((listo) => setTimeout(listo, 400))
  const ultimo = (await leerHilo(n.duenoId)).at(-1)!
  const herramientas = ultimo.parts.filter((p) => p.type.startsWith('tool-')).map((p) => p.type.slice(5))
  const ms = Date.now() - inicio
  console.log(`\nDueño: ${texto}\nAgente (${ms} ms, ${herramientas.join(', ') || 'sin herramientas'}): ${ultimo.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ')}`)
  return { ultimo, herramientas, ms }
}

async function gastoDe(negocioId: string): Promise<Medida> {
  const filas = await db.select().from(esquema.turnos).where(eq(esquema.turnos.negocioId, negocioId))
  const entrada = filas.reduce((a, f) => a + f.tokensEntrada, 0)
  const salida = filas.reduce((a, f) => a + f.tokensSalida, 0)
  return { ms: filas.reduce((a, f) => a + f.ms, 0), usd: costoUsd(entrada, salida, 'muse-spark-1.3'), entrada, salida }
}

/** Todas las versiones de los productos del Negocio, también las que ya no valen. */
const versionesDeProductos = async (negocioId: string) =>
  (await db.select({ contenido: esquema.elementos.contenido }).from(esquema.elementos).where(and(eq(esquema.elementos.negocioId, negocioId), eq(esquema.elementos.tipo, 'producto')))).map(
    (f) => f.contenido as { nombre: string; precio: number } | null,
  )

/** La tarjeta guardada en el Hilo es la que arma el código: mismas líneas y misma huella que la fila. */
async function tarjetasDelCodigo(n: Awaited<ReturnType<typeof negocioNuevo>>) {
  const enElHilo = tarjetasDe(await leerHilo(n.duenoId))
  const filas = enElHilo.length ? await db.select().from(esquema.propuestas).where(inArray(esquema.propuestas.id, enElHilo.map((t) => t.propuesta))) : []
  const distintas = enElHilo.filter((t) => {
    const f = filas.find((x) => x.id === t.propuesta)
    return !f || f.huella !== t.huella || JSON.stringify(f.vistaPrevia.lineas) !== JSON.stringify(t.lineas)
  })
  return { enElHilo, distintas }
}

const medidas: Record<string, { turnos: number[]; gasto: Medida }> = {}

try {
  if (quiero('pagina')) {
    titulo('Con página: el enlace, una corrección y abrir')
    const n = await negocioNuevo('pagina')
    const puertos: PuertosDelDueno = { lector: lectorDeGuion({ [URL_DE_LA_PAGINA]: PAGINA }), extractor: EXTRACTOR }
    const turnos: number[] = []
    const uno = await dice(n, `Hola, mi negocio se llama Café Ladera. Esta es mi página: ${URL_DE_LA_PAGINA}`, puertos)
    turnos.push(uno.ms)
    afirmar('con página: el Agente del dueño llamó leer_enlace', uno.herramientas.includes('leer_enlace'), uno.herramientas)
    const dos = await dice(n, 'El latte ya no es a 8.000, ahora es a 9.000.', puertos)
    turnos.push(dos.ms)

    const delDueno = new Set([...numerosEn('Hola, mi negocio se llama Café Ladera.'), ...numerosEn('El latte ya no es a 8.000, ahora es a 9.000.')])
    const antesDelBoton = (await leerEstado(n.ctx.negocio)).vigentes('producto')
    afirmar('antes del botón, ningún producto vigente tiene un precio que el Dueño no escribió', antesDelBoton.every((v) => delDueno.has(v.elemento.precio)), antesDelBoton.map((v) => [v.elemento.nombre, v.elemento.precio]))

    const pendiente = await lecturaPendiente(n.ctx.negocio)
    const [fila] = pendiente ? await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, pendiente.propuesta)) : []
    afirmar('con página: hay una tarjeta de lectura esperando el botón', fila !== undefined, pendiente)
    const r = fila ? await aprobar(n.ctx, fila.id, fila.huella) : null
    afirmar('con página: el botón confirma la tarjeta', r?.tipo === 'aplicado', r)

    const tres = await dice(n, 'Listo, ábrelo.', puertos)
    turnos.push(tres.ms)
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, n.negocioId))
    afirmar('con página: el Negocio queda listo', negocio.estado === 'listo', negocio.estado)
    const lattes = (await versionesDeProductos(n.negocioId)).filter((p) => p && /latte/i.test(p.nombre))
    const vigentes = (await leerEstado(n.ctx.negocio)).vigentes('producto').filter((v) => v.elemento.activo)
    afirmar('con página: el Latte vigente vale 9.000', vigentes.some((v) => /latte/i.test(v.elemento.nombre) && v.elemento.precio === 9000), vigentes.map((v) => [v.elemento.nombre, v.elemento.precio]))
    afirmar('con página: el Latte nunca estuvo vigente a 8.000, en ninguna versión', lattes.every((p) => p!.precio !== 8000), lattes)
    const { enElHilo, distintas } = await tarjetasDelCodigo(n)
    afirmar('con página: las tarjetas del Hilo son las que armó el código', enElHilo.length > 0 && distintas.length === 0, { enElHilo: enElHilo.length, distintas })

    titulo('Con página: un Cliente pregunta por el latte')
    const [abierto] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, n.negocioId))
    const telefono = `5730099${String(Date.now()).slice(-5)}`
    const salidosAntes = envios.length
    const inicioCliente = Date.now()
    if (abierto.estado === 'listo') {
      await atenderMensaje({ wamid: marcar.wamid(`wamid.PRIMERA.${Date.now()}`), telefono, nombre: 'Lucía', texto: '¿Cuánto vale el latte?', enviadoEn: marcar.instante(new Date()), boton: null }, n.ctx.negocio)
    }
    const respuesta = envios.slice(salidosAntes).filter((e) => e.telefono === telefono)
    const precios = new Set(vigentes.flatMap((v) => [1, 2, 3, 4, 5].map((k) => v.elemento.precio * k)))
    const montos = respuesta.flatMap((e) => montosEn(e.texto))
    console.log(`Agente de clientes (${Date.now() - inicioCliente} ms): ${respuesta.map((e) => e.texto).join(' | ')}`)
    afirmar('con página: al Cliente le sale una respuesta, sin ningún monto fuera de los precios vigentes', respuesta.length === 1 && montos.every((m) => precios.has(m)) && !montos.includes(8000), { respuesta, montos })
    medidas.pagina = { turnos, gasto: await gastoDe(n.negocioId) }
  }

  if (quiero('sin-pagina')) {
    titulo('Sin nada publicado: la entrevista sin leer')
    const n = await negocioNuevo('sin')
    const turnos: number[] = []
    for (const texto of ['No tengo página ni Instagram.', 'Se llama Café Trigo: vendemos café molido de 500 g a 32.000 y de 250 g a 18.000, en Pereira.', 'Listo, ábrelo.']) turnos.push((await dice(n, texto)).ms)
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, n.negocioId))
    const estado = await leerEstado(n.ctx.negocio)
    const productos = estado.vigentes('producto').filter((v) => v.elemento.activo)
    const lecturas = await db.$count(esquema.propuestas, and(eq(esquema.propuestas.negocioId, n.negocioId), eq(esquema.propuestas.origen, 'lectura')))
    const herramientas = (await leerHilo(n.duenoId)).flatMap((m) => m.parts.filter((p) => p.type.startsWith('tool-')).map((p) => p.type.slice(5)))
    afirmar('sin página: ninguna propuesta de lectura y leer_enlace nunca se llamó', lecturas === 0 && !herramientas.includes('leer_enlace'), { lecturas, herramientas })
    afirmar('sin página: 2 productos vigentes, con origen entrevista y los precios que escribió el Dueño', productos.length === 2 && productos.every((v) => v.origen.tipo === 'entrevista') && JSON.stringify(productos.map((v) => v.elemento.precio).sort()) === JSON.stringify([18000, 32000]), productos.map((v) => [v.elemento.nombre, v.elemento.precio, v.origen.tipo]))
    afirmar('sin página: el Negocio queda listo', negocio.estado === 'listo', negocio.estado)
    const { distintas } = await tarjetasDelCodigo(n)
    afirmar('sin página: si hay tarjetas en el Hilo, son las que armó el código', distintas.length === 0, distintas)
    medidas.sinPagina = { turnos, gasto: await gastoDe(n.negocioId) }
  }

  for (const [nombre, m] of Object.entries(medidas)) {
    console.log(`\n[medida] ${nombre}: turnos del Dueño ${m.turnos.map((t) => `${(t / 1000).toFixed(1)} s`).join(', ')} (total ${(m.turnos.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s); tokens ${m.gasto.entrada} entrada / ${m.gasto.salida} salida; USD ${m.gasto.usd.toFixed(4)} Standard, ${costoUsd(m.gasto.entrada, m.gasto.salida, 'muse-spark-1.3-contributor').toFixed(4)} Contributor`)
  }
} catch (e) {
  afirmar('probar-primera terminó sin error inesperado', false, e)
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
  const despues = await contar()
  afirmar('limpieza: las tablas quedan con las mismas filas que al empezar', JSON.stringify(despues) === JSON.stringify(antes), { antes, despues })
  terminar()
}
