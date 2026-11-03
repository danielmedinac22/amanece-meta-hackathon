/**
 * Lo que leen Pedidos y Clientes, contra Neon real y sin modelo. Dos Negocios desechables con los mismos nombres: cada
 * fila de uno coincide con lo sembrado y nada del otro se cuela. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-listas.mts
 */
import { config } from 'dotenv'
import { inArray } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { leerCifras } = await import('../src/nucleo/hoy')
const { marcar } = await import('../src/nucleo/identidad')
const { CUANTOS_CLIENTES, CUANTOS_POR_GRUPO, leerClientes, leerPedidos } = await import('../src/nucleo/listas')
const { lineaDeItems, nombreDelCliente, ORDEN_DE_PEDIDOS } = await import('../src/nucleo/listas-palabras')

const ZONA = 'America/Bogota'
const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const MINUTO = 60_000
const DIA = 24 * 60 * MINUTO
const ahora = Date.now()
const hace = (ms: number) => new Date(ahora - ms)
type Estado = (typeof esquema.ESTADOS_DE_PEDIDO)[number]

console.log('Cómo se escribe')
afirmar('Todo estado tiene su lugar en la lista', esquema.ESTADOS_DE_PEDIDO.every((e) => (ORDEN_DE_PEDIDOS as readonly string[]).includes(e)) && ORDEN_DE_PEDIDOS.at(-1) === 'cancelado', ORDEN_DE_PEDIDOS)
afirmar('Un item con cantidad baja la inicial y sigue con el nombre', lineaDeItems([{ nombre: 'Tueste medio, grano 500 g', cantidad: 2 }]) === '2 tueste medio, grano 500 g')
afirmar('Un item solo no lleva cantidad, y varios no se confunden con la coma del nombre', lineaDeItems([{ nombre: 'Molino manual', cantidad: 1 }, { nombre: 'Tueste, grano', cantidad: 3 }]) === 'Molino manual + 3 tueste, grano')
afirmar('Una sigla no baja', lineaDeItems([{ nombre: 'XL de café', cantidad: 2 }]) === '2 XL de café')
afirmar('Un Cliente sin nombre se reconoce por su teléfono', nombreDelCliente('  ', '573001112233') === '+573001112233')

async function negocioNuevo(sufijo: string) {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Listas ${sufijo}${marca}`, codigo: `LIS${sufijo}${marca}`, rubro: 'café', estado: 'listo' }).returning()
  creados.push(n.id)
  return n
}

async function sembrar(negocioId: string, totalDeA: number) {
  const filas = await db
    .insert(esquema.clientes)
    .values(['Paola Rojas', 'Daniela Quintero', 'Santiago Herrera', ''].map((nombre, i) => ({ negocioId, nombre, telefono: `57${marca}${i}`, creado: hace(30 * DIA), ultimoMensajeEntrante: nombre === 'Santiago Herrera' ? hace(5 * MINUTO) : null })))
    .returning()
  const [paola, daniela, santiago] = filas
  let numero = 1
  const pedido = (clienteId: string, estado: Estado, total: number, atras: number, ciudad = '', items = [{ productoId: 'x', nombre: 'Tueste medio', cantidad: 2, precio: total / 2 }]) => ({ negocioId, clienteId, numero: numero++, items, total, estado, creado: hace(atras), ciudad })
  await db.insert(esquema.pedidos).values([
    pedido(paola.id, 'entregado', totalDeA, 3 * DIA, 'Manizales'),
    pedido(paola.id, 'novedad', 30_000, 2 * DIA, 'Pasto'),
    // El último pedido de Paola no dice ciudad y no cuenta como venta: la ciudad sigue siendo Pasto.
    pedido(paola.id, 'cancelado', 999_000, DIA),
    pedido(daniela.id, 'pendiente', 76_000, 12 * MINUTO, 'Pereira'),
    pedido(daniela.id, 'pendiente', 40_000, 2 * DIA, 'Pereira'),
    pedido(daniela.id, 'confirmado', 62_000, 3 * DIA, 'Pereira'),
    pedido(daniela.id, 'enviado', 32_000, 4 * DIA, 'Pereira'),
  ])
  return { paola, daniela, santiago }
}

try {
  const a = await negocioNuevo('A')
  const b = await negocioNuevo('B')
  const deA = await sembrar(a.id, 100_000)
  await sembrar(b.id, 7_777_777)
  // Lo que la base deja hacer aunque nada lo haga: un pedido de B a nombre de un Cliente de A no aparece en ninguno.
  await db.insert(esquema.pedidos).values({ negocioId: b.id, clienteId: deA.paola.id, numero: 99, items: [], total: 5_555_555, estado: 'confirmado', creado: hace(MINUTO), ciudad: 'Intrusa' })

  console.log('\nPedidos')
  const pedidos = await leerPedidos(marcar.negocio(a.id), ZONA)
  afirmar('Los grupos salen en el orden del diseño, con cancelado al final', pedidos.grupos.map((g) => g.estado).join() === 'novedad,pendiente,confirmado,enviado,entregado,cancelado', pedidos.grupos.map((g) => g.estado))
  const pendientes = pedidos.grupos.find((g) => g.estado === 'pendiente')!
  afirmar('Cada grupo trae su cuenta y lo más reciente primero', pendientes.cuenta === 2 && pendientes.filas[0].total === 76_000 && pendientes.filas[0].hace === 'hace 12 min', pendientes)
  afirmar('Cada fila trae Cliente, items y ciudad', pendientes.filas[0].cliente === 'Daniela Quintero' && pendientes.filas[0].items === '2 tueste medio' && pendientes.filas[0].ciudad === 'Pereira', pendientes.filas[0])
  const inicio = await leerCifras(marcar.negocio(a.id), ZONA)
  afirmar('El resumen dice lo mismo que Inicio', JSON.stringify(pedidos.cifras) === JSON.stringify({ semana: inicio.semana, conversaciones: inicio.conversaciones }), { pedidos: pedidos.cifras, inicio })
  const todo = JSON.stringify(pedidos)
  afirmar('Otro Negocio no se cuela en Pedidos', !todo.includes('7.777.777') && !todo.includes('7777777') && !todo.includes('Intrusa') && !todo.includes('5555555'), pedidos.grupos)

  const deOtro = await leerPedidos(marcar.negocio(b.id), ZONA)
  const entregadosDeB = deOtro.grupos.find((g) => g.estado === 'entregado')!
  afirmar('Otro Negocio tiene lo suyo', entregadosDeB.filas[0].total === 7_777_777, entregadosDeB)
  afirmar('Un pedido a nombre de un Cliente ajeno no se muestra', !JSON.stringify(deOtro).includes('Intrusa'), deOtro.grupos)

  console.log('\nClientes')
  const clientes = await leerClientes(marcar.negocio(a.id), ZONA)
  const por = (nombre: string) => clientes.filas.find((c) => c.nombre === nombre)!
  afirmar('Todos los Clientes del Negocio, también los que no han comprado', clientes.cuenta === 4 && clientes.filas.length === 4, clientes.filas)
  afirmar('Pedidos y total cuentan solo lo vendido', por('Paola Rojas').pedidos === 2 && por('Paola Rojas').total === 130_000, por('Paola Rojas'))
  afirmar('Lo pendiente no cuenta, y lo vendido de la misma persona sí', por('Daniela Quintero').pedidos === 2 && por('Daniela Quintero').total === 94_000, por('Daniela Quintero'))
  afirmar('La ciudad es la del último pedido que dijo una', por('Paola Rojas').ciudad === 'Pasto', por('Paola Rojas'))
  afirmar('Sin pedidos: ceros y sin ciudad', por('Santiago Herrera').pedidos === 0 && por('Santiago Herrera').total === 0 && por('Santiago Herrera').ciudad === '', por('Santiago Herrera'))
  afirmar('Primero quien se movió hace menos, sea escribiendo o pidiendo', clientes.filas[0].nombre === 'Santiago Herrera' && clientes.filas[0].ultimo === 'hace 5 min' && clientes.filas[1].nombre === 'Daniela Quintero' && clientes.filas[1].ultimo === 'hace 12 min', clientes.filas)
  afirmar('Un Cliente sin nombre sale con su teléfono', clientes.filas.at(-1)!.nombre === `+57${marca}3`, clientes.filas.at(-1))
  const todoDeClientes = JSON.stringify(clientes)
  afirmar('Otro Negocio no se cuela en Clientes', !todoDeClientes.includes('7777777') && !todoDeClientes.includes('5555555') && !todoDeClientes.includes('Intrusa'), clientes.filas)
  const deOtroClientes = await leerClientes(marcar.negocio(b.id), ZONA)
  afirmar('Otro Negocio tiene sus propios Clientes', deOtroClientes.cuenta === 4 && deOtroClientes.filas.some((c) => c.total === 7_777_777 + 30_000) && !deOtroClientes.filas.some((c) => c.id === deA.paola.id), deOtroClientes.filas)

  console.log('\nMuchas filas')
  const c = await negocioNuevo('C')
  const muchos = await db
    .insert(esquema.clientes)
    .values(Array.from({ length: CUANTOS_CLIENTES + 5 }, (_, i) => ({ negocioId: c.id, nombre: `Cliente ${i}`, telefono: `58${marca}${i}`, creado: hace(i * MINUTO) })))
    .returning()
  await db.insert(esquema.pedidos).values(Array.from({ length: CUANTOS_POR_GRUPO + 10 }, (_, i) => ({ negocioId: c.id, clienteId: muchos[0].id, numero: i + 1, items: [], total: 1_000, estado: 'entregado' as const, creado: hace(i * MINUTO) })))
  const listaLarga = await leerPedidos(marcar.negocio(c.id), ZONA)
  const entregados = listaLarga.grupos[0]
  afirmar('Un grupo con más filas que el límite dice el total y trae las más recientes', entregados.cuenta === CUANTOS_POR_GRUPO + 10 && entregados.filas.length === CUANTOS_POR_GRUPO && entregados.filas[0].numero === 1, { cuenta: entregados.cuenta, filas: entregados.filas.length })
  const tablaLarga = await leerClientes(marcar.negocio(c.id), ZONA)
  afirmar('La tabla con más filas que el límite dice el total y trae las más recientes', tablaLarga.cuenta === CUANTOS_CLIENTES + 5 && tablaLarga.filas.length === CUANTOS_CLIENTES && tablaLarga.filas[0].nombre === 'Cliente 0', { cuenta: tablaLarga.cuenta, filas: tablaLarga.filas.length })
  const negocioVacio = await negocioNuevo('D')
  afirmar('Un Negocio sin pedidos ni Clientes queda vacío', (await leerPedidos(marcar.negocio(negocioVacio.id), ZONA)).grupos.length === 0 && (await leerClientes(marcar.negocio(negocioVacio.id), ZONA)).filas.length === 0)
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
}

terminar()
