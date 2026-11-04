/**
 * Lo que lee el Tablero, contra Neon real y sin modelo. Dos Negocios desechables con los mismos nombres: cada cifra de
 * uno coincide con lo sembrado y nada del otro se cuela. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-tablero.mts
 */
import { config } from 'dotenv'
import { inArray } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { graficaDe, etiquetaLarga } = await import('../src/nucleo/graficas')
const { leerCifras } = await import('../src/nucleo/hoy')
const { marcar } = await import('../src/nucleo/identidad')
const { leerTablero } = await import('../src/nucleo/tablero')
const { tarjetasDelTablero } = await import('../src/nucleo/tablero-palabras')

const ZONA = 'America/Bogota'
const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const MINUTO = 60_000
const DIA = 24 * 60 * MINUTO
const ahora = Date.now()
const hace = (ms: number) => new Date(ahora - ms)
type Estado = (typeof esquema.ESTADOS_DE_PEDIDO)[number]

const unidad = { tipo: 'cantidad', nombre: '' } as const
const dias = (valores: number[]) => valores.map((valor, i) => ({ etiqueta: `2026-10-${String(26 + i).padStart(2, '0')}`, valor }))

console.log('Cómo se pinta')
afirmar('Sin una cifra positiva no hay gráfica', graficaDe(dias([0, 0, 0]), unidad) === null && graficaDe([], unidad) === null)
const semana = graficaDe(dias([3, 5, 4, 8, 0, 2, 6]), unidad)!
afirmar('El eje sube hasta un número redondo y se parte sin decimales', semana.marcas.map((m) => m.texto).join() === '0,4,8', semana.marcas)
afirmar('La más alta llena el eje y la de cero no pinta', semana.barras[3].alto === 100 && semana.barras[4].alto === 0, semana.barras)
afirmar('Una semana se lee por día', semana.barras.map((b) => b.eje).join() === 'Lun,Mar,Mié,Jue,Vie,Sáb,Dom', semana.barras.map((b) => b.eje))
afirmar('Solo se rotulan la más alta y la última', semana.barras.flatMap((b) => b.rotulo ?? []).join() === '8,6', semana.barras.map((b) => b.rotulo))
afirmar('Cada barra sabe su fecha y su cifra entera', semana.barras[3].cuando === 'Jue 29 oct' && semana.barras[3].cifra === '8', semana.barras[3])
const juntas = graficaDe(dias([1, 1, 1, 1, 1, 9, 7]), unidad)!
afirmar('La más alta pegada a la última no se rotula: los dos rótulos se pisarían', juntas.barras.flatMap((b) => b.rotulo ?? []).join() === '7', juntas.barras.map((b) => b.rotulo))
const plata = graficaDe(dias([40_000, 1_284_000]), { tipo: 'dinero' })!
afirmar('La plata va entera al tocarla y corta en el eje', plata.barras[1].cifra === '$1.284.000' && plata.barras[1].rotulo === '$1,3 M' && plata.marcas.at(-1)?.texto === '$2 M', plata)
afirmar('Bajo un millón la plata corta dice mil', graficaDe(dias([284_000]), { tipo: 'dinero' })!.barras[0].rotulo === '$284 mil')
const mes = graficaDe(Array.from({ length: 30 }, (_, i) => ({ etiqueta: `2026-10-${String(i + 1).padStart(2, '0')}`, valor: i + 1 })), unidad)!
afirmar('Con muchos puntos solo se rotulan los extremos del eje, con su fecha', mes.barras.filter((b) => b.eje).map((b) => b.eje).join() === '1 oct,30 oct', mes.barras.filter((b) => b.eje))
afirmar('Una etiqueta de mes se lee como mes, y lo que no es fecha queda igual', etiquetaLarga('2026-10') === 'oct 2026' && etiquetaLarga('Manizales') === 'Manizales')
afirmar('Un valor negativo no pinta barra, pero dice su cifra', (() => { const n = graficaDe(dias([-5, 10]), unidad)!; return n.barras[0].alto === 0 && n.barras[0].cifra === '-5' })())

const sinNada = { semana: { ventas: 0, pedidos: 0, clientes: 0 }, anterior: { ventas: 0, pedidos: 0 }, conversaciones: { total: 0, resueltas: 0 } }
const nada = { casos: 0, novedad: 0, pendiente: 0 }
const tarjetas = (t: Parameters<typeof tarjetasDelTablero>[0]) => Object.fromEntries(tarjetasDelTablero(t).map((c) => [c.clave, c]))
const vacias = tarjetas({ voz: 'tienda', cifras: sinNada, porAtender: nada })
afirmar('Sin conversaciones no hay porcentaje: un 0 % diría que el agente falló', vacias.resueltas.valor === '—', vacias.resueltas)
afirmar('Sin ventas lo dice, y nada espera', vacias.negocio.nota === 'Todavía sin ventas esta semana' && vacias.atencion.nota === 'Nada espera por ti' && !vacias.atencion.espera, vacias)
const llenas = tarjetas({ voz: 'tienda', cifras: { semana: { ventas: 1_284_000, pedidos: 23, clientes: 31 }, anterior: { ventas: 1_088_000, pedidos: 19 }, conversaciones: { total: 14, resueltas: 13 } }, porAtender: { casos: 1, novedad: 1, pendiente: 2 } })
afirmar('Las ventas comparan con la anterior como la frase de Inicio', llenas.negocio.valor === '$1.284.000' && llenas.negocio.nota === '18 % más que la anterior', llenas.negocio)
afirmar('Resueltas sin ti son porcentaje y cuenta', llenas.resueltas.valor === '93 %' && llenas.resueltas.nota === '13 de 14 conversaciones', llenas.resueltas)
afirmar('Necesitan atención suma y dice de qué', llenas.atencion.valor === '4' && llenas.atencion.nota === '1 Caso, 1 con novedad, 2 por confirmar' && llenas.atencion.espera, llenas.atencion)
afirmar('Con pocos pedidos no compara', tarjetas({ voz: 'tienda', cifras: { ...sinNada, semana: { ventas: 90_000, pedidos: 1, clientes: 1 }, anterior: { ventas: 30_000, pedidos: 2 } }, porAtender: nada }).negocio.nota === '1 pedido')
afirmar('Una agenda no habla de ventas', tarjetas({ voz: 'agenda', cifras: { ...sinNada, semana: { ventas: 0, pedidos: 0, clientes: 12 } }, porAtender: nada }).negocio.dato === 'Clientes de la semana')

async function negocioNuevo(sufijo: string, rubro = 'café') {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Tablero ${sufijo}${marca}`, codigo: `TAB${sufijo}${marca}`, rubro, estado: 'listo' }).returning()
  creados.push(n.id)
  return n
}

try {
  const a = await negocioNuevo('A')
  const b = await negocioNuevo('B')
  const clientesDe = async (negocioId: string) =>
    db
      .insert(esquema.clientes)
      .values(['Paola Rojas', ''].map((nombre, i) => ({ negocioId, nombre, telefono: `59${marca}${i}`, creado: hace(30 * DIA) })))
      .returning()
  const [paola, sinNombre] = await clientesDe(a.id)
  const [deB] = await clientesDe(b.id)
  // A mano. A: 3 por link, 1 por anuncio, y Paola y el sin nombre que nacieron sin origen, hace 30 días. B: sus 2 sin origen y 2 por anuncio.
  const conOrigen = (negocioId: string, prefijoTel: string, origenes: ('link' | 'anuncio')[]) => origenes.map((origen, i) => ({ negocioId, origen, nombre: `Origen ${i}`, telefono: `${prefijoTel}${marca}${i}` }))
  await db.insert(esquema.clientes).values([...conOrigen(a.id, '58', ['link', 'anuncio', 'link', 'link']), ...conOrigen(b.id, '58', ['anuncio', 'anuncio'])])
  let numero = 1
  const pedido = (negocioId: string, clienteId: string, estado: Estado, total: number, cuando: Date, ciudad = 'Pasto') => ({ negocioId, clienteId, numero: numero++, items: [{ productoId: 'x', nombre: 'Tueste medio', cantidad: 1, precio: total }], total, estado, creado: cuando, ciudad })

  // Ayer a las 23:00 en Bogotá ya es hoy en UTC: tiene que caer en ayer. El desfase de Bogotá es fijo, sin horario de verano.
  const hoyLocal = new Date(ahora - 5 * 60 * MINUTO).toISOString().slice(0, 10)
  const ayerTarde = new Date(`${hoyLocal}T04:00:00Z`)
  const ayerLocal = new Date(Date.parse(hoyLocal) - DIA).toISOString().slice(0, 10)
  const [conCaso] = await db
    .insert(esquema.pedidos)
    .values([
      pedido(a.id, paola.id, 'novedad', 30_000, hace(2 * MINUTO)),
      pedido(a.id, paola.id, 'confirmado', 40_000, hace(3 * MINUTO)),
      pedido(a.id, paola.id, 'pendiente', 50_000, hace(4 * MINUTO)),
      pedido(a.id, sinNombre.id, 'cancelado', 60_000, hace(5 * MINUTO), ''),
      pedido(a.id, paola.id, 'enviado', 70_000, ayerTarde),
      pedido(a.id, paola.id, 'entregado', 80_000, hace(3 * DIA)),
      // Más de una semana: fuera de la gráfica y del reparto, y un pendiente así ya no espera a nadie.
      pedido(a.id, paola.id, 'entregado', 90_000, hace(8 * DIA)),
      pedido(a.id, paola.id, 'pendiente', 95_000, hace(9 * DIA)),
    ])
    .returning()
  await db.insert(esquema.casos).values([
    { negocioId: a.id, clienteId: paola.id, pedidoId: conCaso.id, titulo: 'Un Caso con su pedido', estado: 'abierto' },
    { negocioId: a.id, clienteId: paola.id, titulo: 'Un Caso sin pedido', estado: 'esperando_dueno' },
    { negocioId: a.id, clienteId: paola.id, titulo: 'Un Caso resuelto', estado: 'resuelto' },
    { negocioId: b.id, clienteId: deB.id, titulo: 'Un Caso de otro Negocio', estado: 'abierto' },
  ])
  await db.insert(esquema.pedidos).values([
    pedido(b.id, deB.id, 'novedad', 7_777_777, hace(MINUTO), 'Intrusa'),
    pedido(b.id, deB.id, 'novedad', 7_777_777, hace(MINUTO), 'Intrusa'),
    // Lo que la base deja hacer aunque nada lo haga: un pedido de B a nombre de un Cliente de A no aparece en ninguno.
    pedido(b.id, paola.id, 'confirmado', 5_555_555, hace(MINUTO), 'Intrusa'),
  ])

  const N = marcar.negocio(a.id)
  const t = await leerTablero(N, ZONA, 'café')
  console.log('\nCifras')
  afirmar('Las cifras son las mismas de Inicio', JSON.stringify({ ...t.cifras }) === JSON.stringify(await leerCifras(N, ZONA)), t.cifras)
  afirmar('Necesitan atención: los Casos sin resolver, sin los de otro Negocio', t.porAtender.casos === 2, t.porAtender)
  afirmar('Un pedido con Caso abierto cuenta como Caso y no dos veces', t.porAtender.novedad === 0, t.porAtender)
  afirmar('Un pendiente de hace más de una semana ya no espera', t.porAtender.pendiente === 1, t.porAtender)

  console.log('\nGráfica')
  afirmar('Siempre son siete días, del más viejo a hoy', t.porDia.length === 7 && t.porDia.at(-1)?.dia === hoyLocal && t.porDia.every((d, i) => i === 0 || t.porDia[i - 1].dia < d.dia), t.porDia)
  const delDia = (dia: string) => t.porDia.find((d) => d.dia === dia)?.pedidos
  afirmar('Hoy cuenta lo vendido, sin pendiente ni cancelado', delDia(hoyLocal) === 2, t.porDia)
  afirmar('Un pedido cae en su día en la zona del Negocio', delDia(ayerLocal) === 1, t.porDia)
  afirmar('La gráfica suma solo la última semana', t.porDia.reduce((s, d) => s + d.pedidos, 0) === 4, t.porDia)

  console.log('\nReparto')
  afirmar('De dónde llegan cuadra con el conteo a mano, sin ventana, y un Cliente sin origen es Sin dato', t.porOrigen.map((f) => `${f.origen} ${f.cuenta}`).join() === 'link 3,anuncio 1,sin_dato 2', t.porOrigen)

  console.log('\nTabla')
  afirmar('Los cinco más recientes, con su estado', t.recientes.length === 5 && t.recientes.map((r) => r.estado).join() === 'novedad,confirmado,pendiente,cancelado,enviado', t.recientes)
  afirmar('Cada fila trae Cliente, ciudad, items y total', t.recientes[0].cliente === 'Paola Rojas' && t.recientes[0].ciudad === 'Pasto' && t.recientes[0].items === 'Tueste medio' && t.recientes[0].total === 30_000, t.recientes[0])
  afirmar('Un Cliente sin nombre sale con su teléfono', t.recientes[3].cliente === `+59${marca}1`, t.recientes[3])

  console.log('\nAislamiento')
  const todo = JSON.stringify(t)
  afirmar('Otro Negocio no se cuela en el Tablero', !todo.includes('7777777') && !todo.includes('5555555') && !todo.includes('Intrusa'), t)
  const deOtro = await leerTablero(marcar.negocio(b.id), ZONA, 'café')
  afirmar('Otro Negocio tiene lo suyo', deOtro.porAtender.novedad === 2 && deOtro.porAtender.casos === 1 && deOtro.recientes.length === 2 && deOtro.recientes.every((r) => r.total === 7_777_777), deOtro)
  afirmar('Un pedido a nombre de un Cliente ajeno no se muestra en la gráfica ni en la tabla', deOtro.porDia.at(-1)?.pedidos === 2 && !JSON.stringify(deOtro.recientes).includes('5555555'), deOtro)
  afirmar('Otro Negocio cuenta solo sus Clientes', deOtro.porOrigen.map((f) => `${f.origen} ${f.cuenta}`).join() === 'anuncio 2,sin_dato 2', deOtro.porOrigen)

  console.log('\nVacío y voz')
  const vacio = await negocioNuevo('C', 'Barbería')
  const sinDatos = await leerTablero(marcar.negocio(vacio.id), ZONA, 'Barbería')
  afirmar('Un Negocio sin nada trae siete días en cero y listas vacías', sinDatos.porDia.length === 7 && sinDatos.porDia.every((d) => d.pedidos === 0) && sinDatos.porOrigen.length === 0 && sinDatos.recientes.length === 0, sinDatos)
  afirmar('El Rubro decide la voz', sinDatos.voz === 'agenda' && t.voz === 'tienda')
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
}

terminar()
