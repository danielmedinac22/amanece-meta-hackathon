/**
 * Un armado desde cada plantilla, contra Neon y Muse Spark reales con `ENVIO_SIMULADO=1`. Sin modelo: lo que queda al
 * partir, que repetirlo no duplica, que con el Negocio abierto no hace nada y que una cifra inventada no entra. Con
 * modelo: el Dueño cuenta lo suyo, abre, nada del ejemplo queda, lo que la plantilla ofrece pedir ya abierto se arma de
 * verdad y el Cliente recibe lo que la tarjeta muestra. Borra lo que crea.
 *
 *   pnpm tsx scripts/probar-plantillas.mts [tienda|logistica|agenda]
 */
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { altaDeDueno } = await import('../src/negocio/alta')
const { abrirConElBoton } = await import('../src/negocio/abrir')
const { leerHilo } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo, mensajesParaElModelo } = await import('../src/negocio/dueno-chat')
const { partirDePlantilla } = await import('../src/negocio/plantilla')
const { crearAgenteDelDueno } = await import('../src/agentes/dueno')
const { guardarEnElAlta } = await import('../src/nucleo/cambios')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { leerAplicado } = await import('../src/nucleo/estado')
const { cifrasDe } = await import('../src/nucleo/cambios/lectura')
const { marcar } = await import('../src/nucleo/identidad')
const { vozDelRubro } = await import('../src/nucleo/hoy-palabras')
const { IDS_DE_PLANTILLA, PARTIDAS, plantillaDelHilo } = await import('../src/nucleo/plantillas')
const { montosEn } = await import('../src/nucleo/salida/revisar')
const { PLANTILLAS } = await import('../src/app/plantillas-datos')
const { SECCIONES } = await import('../src/app/panel/secciones')
type Ctx = import('../src/nucleo/identidad').ContextoDelDueno
type Id = import('../src/nucleo/plantillas').IdDePlantilla
type Plantilla = import('../src/app/plantillas-datos').Plantilla

const envios = capturarEnvios()
const creados: string[] = []

async function darDeAlta(quien: string) {
  const { negocio, dueno } = await altaDeDueno({ id: `prueba-plantilla-${quien}-${Date.now()}-${crypto.randomUUID()}`, name: quien, email: `${quien}@example.com` })
  creados.push(negocio.id)
  return { negocio, dueno, ctx: { negocio: marcar.negocio(negocio.id), dueno: marcar.dueno(dueno.id), medio: 'web' } as Ctx }
}

const reglasDe = async (ctx: Ctx) => (await leerAplicado(ctx.negocio)).vigentes('regla').map((v) => v.elemento.nombre)
const lineasDePlantilla = async (ctx: Ctx) => (await leerHilo(ctx.dueno)).filter((m) => plantillaDelHilo([m])).length
const filaDe = async (id: string) => (await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, id)))[0]

/** Todo lo inventado de una tarjeta, en pedazos: un nombre o un monto suelto también cuenta. */
function loInventado(p: Plantilla) {
  const ciudades = p.filas.flatMap((f) => (f.detalle.includes(' · ') ? [f.detalle.split(' · ')[0]] : []))
  const textos = [p.negocio, ...p.filas.map((f) => f.nombre), ...ciudades, ...p.chat.map((c) => c.texto)]
  const montos = [...p.filas.map((f) => f.detalle), ...p.chat.map((c) => c.texto), ...p.globos.map((c) => c.texto)].flatMap((t) => montosEn(t))
  return { textos, montos }
}

function probarLoPuro() {
  const reales = new Set(SECCIONES.map((s) => s.nombre))
  for (const p of PLANTILLAS) {
    afirmar(`${p.id}: cada Sección de la tarjeta existe en el Panel`, p.secciones.every((s) => reales.has(s)), p.secciones)
    afirmar(`${p.id}: la tarjeta lleva el nombre de su partida`, p.nombre === PARTIDAS[p.id].nombre)
    const partida = JSON.stringify(PARTIDAS[p.id])
    const { textos, montos } = loInventado(p)
    afirmar(`${p.id}: nada inventado de la tarjeta está en lo que el armado recibe`, !textos.some((t) => partida.includes(t)), textos.filter((t) => partida.includes(t)))
    afirmar(`${p.id}: lo que dice el agente al partir no trae cifras`, montosEn(PARTIDAS[p.id].primero).length === 0)
    afirmar(`${p.id}: la tarjeta sí trae montos, o esta prueba no prueba nada`, montos.length > 0 || p.id !== 'tienda')
    afirmar(`${p.id}: sus reglas no traen cifras`, PARTIDAS[p.id].reglas.every((r) => cifrasDe(r).length === 0))
  }
  afirmar('las tres plantillas tienen tarjeta y partida', PLANTILLAS.length === IDS_DE_PLANTILLA.length && IDS_DE_PLANTILLA.every((id) => PLANTILLAS.some((p) => p.id === id)))
  afirmar('Servicios con agenda hace hablar a Inicio de quién escribe', vozDelRubro(PARTIDAS.agenda.rubro) === 'agenda')

  const fuente = (ruta: string) => readFileSync(ruta, 'utf8')
  const importaDeVerdad = (ruta: string) => [...fuente(ruta).matchAll(/^import (?!type )[^\n]*from '([^']+)'/gm)].map((m) => m[1])
  afirmar('la partida no importa nada que lea un Negocio', importaDeVerdad('src/nucleo/plantillas.ts').length === 0, importaDeVerdad('src/nucleo/plantillas.ts'))
  afirmar('la tarjeta solo importa la partida', importaDeVerdad('src/app/plantillas-datos.ts').join() === '@/nucleo/plantillas', importaDeVerdad('src/app/plantillas-datos.ts'))
  const quienes: string[] = []
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name)
      if (e.isDirectory()) recorrer(ruta)
      else if (/\.tsx?$/.test(e.name) && /from '[^']*plantillas-datos'/.test(fuente(ruta))) quienes.push(ruta)
    }
  }
  recorrer('src')
  afirmar('lo inventado solo lo leen las tarjetas: el servidor y el modelo no', quienes.toSorted().join() === 'src/app/alba.tsx,src/app/plantillas.tsx', quienes)
}

async function probarSinModelo() {
  for (const id of IDS_DE_PLANTILLA) {
    const { negocio, ctx } = await darDeAlta(`Partir ${id}`)
    const linea = await partirDePlantilla(ctx, id)
    afirmar(`${id}: deja su línea en el Hilo con el rastro`, plantillaDelHilo(linea ? [linea] : []) === id && (await lineasDePlantilla(ctx)) === 1)
    afirmar(`${id}: el Negocio sigue armándose, con el Rubro de la plantilla y su nombre temporal`, (await filaDe(negocio.id)).estado === 'armando' && (await filaDe(negocio.id)).rubro === PARTIDAS[id].rubro && (await filaDe(negocio.id)).nombre === negocio.nombre)
    afirmar(`${id}: deja exactamente sus reglas`, (await reglasDe(ctx)).join() === PARTIDAS[id].reglas.map((r) => r.nombre).join())
    const estado = await leerAplicado(ctx.negocio)
    afirmar(`${id}: no deja productos ni datos`, estado.vigentes('producto').length === 0 && estado.vigentes('dato').length === 0 && estado.vigentes('pregunta').length === 0)

    afirmar(`${id}: repetirla no agrega nada`, (await partirDePlantilla(ctx, id)) === null && (await lineasDePlantilla(ctx)) === 1 && (await reglasDe(ctx)).length === PARTIDAS[id].reglas.length)
  }

  const conRubro = await darDeAlta('Con Rubro')
  await guardarEnElAlta(conRubro.ctx, { nombre: null, rubro: 'mochilas', quiere: [] })
  await partirDePlantilla(conRubro.ctx, 'agenda')
  afirmar('el Rubro que dijo el Dueño no se pisa', (await filaDe(conRubro.negocio.id)).rubro === 'mochilas')

  const segunda = await darDeAlta('Segunda')
  await partirDePlantilla(segunda.ctx, 'tienda')
  afirmar('una segunda plantilla no se suma a la primera', (await partirDePlantilla(segunda.ctx, 'agenda')) === null && plantillaDelHilo(await leerHilo(segunda.ctx.dueno)) === 'tienda' && (await reglasDe(segunda.ctx)).length === 0)

  const abierto = await darDeAlta('Abierto')
  await guardarEnElAlta(abierto.ctx, { nombre: 'Ya Abierto', rubro: 'ropa', quiere: [] })
  await db.update(esquema.negocios).set({ estado: 'listo' }).where(eq(esquema.negocios.id, abierto.negocio.id))
  afirmar('con el Negocio abierto no hace nada', (await partirDePlantilla(abierto.ctx, 'agenda')) === null && (await lineasDePlantilla(abierto.ctx)) === 0 && (await reglasDe(abierto.ctx)).length === 0 && (await filaDe(abierto.negocio.id)).rubro === 'ropa')

  const inventa = await darDeAlta('Inventa')
  const r = await guardarEnElAlta(inventa.ctx, { nombre: null, rubro: null, quiere: [{ tipo: 'poner', elemento: { tipo: 'pregunta', pregunta: '¿Cuánto vale?', respuesta: 'Vale $89.000' }, reemplaza: null }] })
  afirmar('una cifra que nadie escribió no entra por este camino', 'sinFuente' in r && r.sinFuente.length === 1 && (await leerAplicado(inventa.ctx.negocio)).vigentes('pregunta').length === 0, r)

  const a = await darDeAlta('Vecino A')
  const b = await darDeAlta('Vecino B')
  await partirDePlantilla(a.ctx, 'agenda')
  afirmar('partir no toca a otro Negocio', (await reglasDe(b.ctx)).length === 0 && (await lineasDePlantilla(b.ctx)) === 0 && (await filaDe(b.negocio.id)).rubro === '')

  const agente = crearAgenteDelDueno(a.ctx, { negocio: await filaDe(a.negocio.id), dueno: a.dueno })
  const modelo = JSON.stringify(await mensajesParaElModelo(await leerHilo(a.ctx.dueno), agente))
  afirmar('el modelo lee el texto de la línea, y no la marca', modelo.includes('Servicios con agenda') && !modelo.includes('data-plantilla'))
}

const GUIONES: Readonly<Record<Id, { readonly dueno: readonly string[]; readonly cliente: { readonly texto: string; readonly cifra: number | null } }>> = {
  tienda: {
    dueno: ['Se llama Mochilas del Valle, en Cali. La mochila wayuu vale 145000 y el bolso tejido vale 98000. Envío a todo el país por Coordinadora, de 2 a 4 días, y el envío cuesta 11000.', 'Me pagan contra entrega.'],
    cliente: { texto: '¿Cuánto vale la mochila wayuu?', cifra: 145000 },
  },
  logistica: {
    dueno: ['Se llama Cargas del Sur, en Pasto. El kilo a Miami por avión vale 41000 y el kilo a Panamá por barco vale 17000. A Miami tarda 5 días y a Panamá 3 semanas. No transporto líquidos.', 'Me pagan por transferencia.'],
    cliente: { texto: '¿Cuánto vale el kilo a Miami por avión?', cifra: 41000 },
  },
  agenda: {
    dueno: ['Se llama Fisio Norte, en Tunja. La terapia física vale 72000 y la valoración vale 55000. Atiendo de lunes a viernes de 8 a 5.', 'Me pagan por transferencia.'],
    cliente: { texto: 'Hola, necesito mover mi cita del martes para otro día', cifra: null },
  },
}

async function armarDesde(id: Id) {
  const { negocio, dueno, ctx } = await darDeAlta(`Armado ${id}`)
  const partida = PARTIDAS[id]
  const inicio = Date.now()
  const turno = async (texto: string) => {
    const respuesta = await responderEnElHilo({ ctx, negocio: await filaDe(negocio.id), dueno, mensaje: mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })! })
    await respuesta.text()
    await new Promise((r) => setTimeout(r, 400))
  }

  await partirDePlantilla(ctx, id)
  for (const texto of GUIONES[id].dueno) await turno(texto)
  let abrio = await abrirConElBoton(ctx)
  if (!abrio.abierto) {
    await turno(`Te falta esto: ${abrio.falta.join(', ')}. Guárdalo con lo que ya te dije.`)
    abrio = await abrirConElBoton(ctx)
  }
  afirmar(`${id}, Muse Spark: abrió con lo que dijo el Dueño`, abrio.abierto, abrio)

  const p = PLANTILLAS.find((x) => x.id === id)!
  const { textos, montos } = loInventado(p)
  const estado = await leerAplicado(ctx.negocio)
  const fila = await filaDe(negocio.id)
  const guardado = JSON.stringify({ nombre: fila.nombre, rubro: fila.rubro, elementos: (['regla', 'voz', 'dato', 'pregunta', 'producto', 'seccion', 'indicador'] as const).flatMap((t) => estado.vigentes(t).map((v) => v.elemento)) })
  const delAgente = (await leerHilo(dueno.id)).filter((m) => m.role === 'assistant').flatMap((m) => m.parts.flatMap((x) => (x.type === 'text' ? [x.text] : []))).join('\n')
  const quedan = textos.filter((t) => guardado.includes(t) || delAgente.includes(t))
  afirmar(`${id}, Muse Spark: nada inventado de la tarjeta quedó en el Negocio ni en el Hilo`, quedan.length === 0, quedan)
  const precios = estado.vigentes('producto').map((v) => v.elemento.precio as number)
  afirmar(`${id}, Muse Spark: ningún monto de la tarjeta quedó en sus productos`, precios.length > 0 && !precios.some((c) => montos.includes(c)), precios)
  afirmar(`${id}, Muse Spark: el Negocio lleva el nombre del Dueño`, fila.nombre !== negocio.nombre && !fila.nombre.includes(p.negocio), fila.nombre)
  afirmar(`${id}, Muse Spark: las reglas de partida siguen ahí`, partida.reglas.every((r) => estado.vigentes('regla').some((v) => v.elemento.nombre === r.nombre)))

  for (const pedido of partida.alAbrir) {
    const antes = await leerAplicado(ctx.negocio)
    const cuantas = antes.vigentes('seccion').length + antes.vigentes('indicador').length
    await turno(pedido)
    const despues = await leerAplicado(ctx.negocio)
    afirmar(`${id}, Muse Spark: «${pedido}» arma algo en el Panel`, despues.vigentes('seccion').length + despues.vigentes('indicador').length === cuantas + 1, { turno: (await leerHilo(dueno.id)).at(-1)?.parts.map((x) => x.type) })
  }

  const telefono = `5730077${String(Date.now()).slice(-5)}`
  const salidos = envios.length
  await atenderMensaje({ wamid: marcar.wamid(`wamid.PLANTILLA.${id}.${Date.now()}`), telefono, nombre: 'Cliente de Prueba', texto: GUIONES[id].cliente.texto, enviadoEn: marcar.instante(new Date()), boton: null, referido: 'ninguno' }, ctx.negocio)
  const respuesta = envios.slice(salidos).filter((e) => e.telefono === telefono).map((e) => e.texto).join('\n')
  afirmar(`${id}, Muse Spark: el Cliente recibió respuesta`, respuesta.length > 0)
  const { cifra } = GUIONES[id].cliente
  if (cifra) afirmar(`${id}, Muse Spark: el Cliente recibe la cifra del Dueño`, montosEn(respuesta).includes(cifra), respuesta)
  if (id === 'agenda') {
    const casos = await db.select().from(esquema.casos).where(eq(esquema.casos.negocioId, negocio.id))
    afirmar('agenda, Muse Spark: mover una cita le llega al Dueño como Caso', casos.length > 0, respuesta)
    afirmar('agenda, Muse Spark: el Cliente no recibe una cita por agendada', !/agendad|te agend|cita confirmada/i.test(respuesta), respuesta)
  }
  console.log(`${id}: ${Math.round((Date.now() - inicio) / 1000)} s`)
}

try {
  probarLoPuro()
  await probarSinModelo()
  for (const id of IDS_DE_PLANTILLA) if (!process.argv[2] || process.argv[2] === id) await armarDesde(id)
} catch (e) {
  afirmar('probar-plantillas terminó sin error inesperado', false, e)
} finally {
  for (const id of creados) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, id)).catch((e) => afirmar('probar-plantillas borró lo que creó', false, e))
  terminar()
}
