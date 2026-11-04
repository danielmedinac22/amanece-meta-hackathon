/**
 * Lo que dice Inicio, contra Neon real y sin modelo. Dos Negocios desechables con los mismos datos en las mismas
 * horas: cada cifra de uno coincide con lo sembrado y nada del otro se cuela. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-hoy.mts
 */
import { config } from 'dotenv'
import { eq, inArray, sql } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { marcar } = await import('../src/nucleo/identidad')
const { leerHoy } = await import('../src/nucleo/hoy')
const { fraseDeHoy, haceCuanto, recorteDeLoEscrito, vozDelRubro } = await import('../src/nucleo/hoy-palabras')
const { sinSuFicha } = await import('../src/nucleo/ficha')
const { puertoDeLaBase } = await import('../src/nucleo/clientes/acciones')
const { leerPublicado } = await import('../src/nucleo/estado')

const ZONA = 'America/Bogota'
const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/** Bogotá no cambia de hora: medianoche allá son las 05:00 UTC. */
const ahora = new Date()
const hoyLocal = new Date(Math.floor((ahora.getTime() - 5 * HORA) / DIA) * DIA + 5 * HORA)
const diaDeLaSemana = new Date(ahora.getTime() - 5 * HORA).getUTCDay()
const lunesLocal = new Date(hoyLocal.getTime() - ((diaDeLaSemana + 6) % 7) * DIA)

const texto = (partes: ReturnType<typeof fraseDeHoy>) => partes.map((p) => (typeof p === 'string' ? p : p.cifra)).join('')

async function negocioNuevo(sufijo: string) {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Hoy ${sufijo}${marca}`, codigo: `HOY${sufijo}${marca}`, rubro: 'café', estado: 'listo' }).returning()
  creados.push(n.id)
  return n
}

async function clientesDe(negocioId: string, nombres: string[], desde = 0) {
  const filas = await db
    .insert(esquema.clientes)
    .values(nombres.map((nombre, i) => ({ negocioId, nombre, telefono: `57${marca}${desde + i}` })))
    .returning()
  return Object.fromEntries(filas.map((f) => [f.nombre || 'sin-nombre', f.id]))
}

async function sembrar(negocioId: string) {
  const c = await clientesDe(negocioId, ['Paola Rojas', 'Daniela Quintero', 'Santiago Herrera', 'Nicolás Aristizábal', 'Andrés Gómez', ''])
  let numero = 1
  const pedido = (cliente: string, estado: (typeof esquema.ESTADOS_DE_PEDIDO)[number], total: number, creado: Date, ciudad = '') => ({ negocioId, clienteId: cliente, numero: numero++, items: [], total, estado, creado, ciudad })
  const pedidos = await db
    .insert(esquema.pedidos)
    .values([
      // Esta semana: cuentan los tres primeros y `novedad`; `pendiente` y `cancelado` no son venta.
      pedido(c['Paola Rojas'], 'confirmado', 100_000, new Date(lunesLocal.getTime() + 2_000)),
      pedido(c['Daniela Quintero'], 'entregado', 50_000, new Date(lunesLocal.getTime() + 3_000)),
      pedido(c['Paola Rojas'], 'novedad', 30_000, new Date(lunesLocal.getTime() + 4_000), 'Pasto'),
      pedido(c['Daniela Quintero'], 'pendiente', 76_000, new Date(ahora.getTime() - 12 * MINUTO)),
      pedido(c['Santiago Herrera'], 'cancelado', 999_000, new Date(lunesLocal.getTime() + 5_000)),
      // Un minuto antes del lunes en Bogotá: es de la semana pasada aunque en UTC ya sea lunes.
      pedido(c['Santiago Herrera'], 'confirmado', 40_000, new Date(lunesLocal.getTime() - MINUTO)),
      // La semana pasada, dentro del mismo tramo: los tres que se comparan.
      pedido(c['Santiago Herrera'], 'confirmado', 50_000, new Date(lunesLocal.getTime() - 7 * DIA + 2_000)),
      pedido(c['Nicolás Aristizábal'], 'entregado', 50_000, new Date(lunesLocal.getTime() - 7 * DIA + 3_000)),
      pedido(c['Andrés Gómez'], 'enviado', 50_000, new Date(lunesLocal.getTime() - 7 * DIA + 4_000)),
      // Sin confirmar hace dos semanas: ya no pide el ojo.
      pedido(c['Andrés Gómez'], 'pendiente', 10_000, new Date(ahora.getTime() - 14 * DIA)),
      // Con novedad, pero con un Caso abierto: sale una vez, como el Caso.
      pedido(c['Nicolás Aristizábal'], 'novedad', 20_000, new Date(ahora.getTime() - 20 * DIA), 'Cali'),
    ])
    .returning()
  const delCaso = pedidos.find((p) => p.total === 20_000)!

  const minutoDeHoy = (n: number) => new Date(hoyLocal.getTime() + n * 1_000)
  const mensaje = (cliente: string, rol: 'cliente' | 'agente', creado: Date) => ({ negocioId, clienteId: cliente, rol, texto: 'hola', creado })
  await db.insert(esquema.mensajesCliente).values([
    // Paola: le respondió el agente y no tiene Caso: resuelta.
    mensaje(c['Paola Rojas'], 'cliente', minutoDeHoy(1)),
    mensaje(c['Paola Rojas'], 'agente', minutoDeHoy(2)),
    // Daniela: sigue esperando respuesta: no resuelta aunque no tenga Caso.
    mensaje(c['Daniela Quintero'], 'agente', minutoDeHoy(1)),
    mensaje(c['Daniela Quintero'], 'cliente', minutoDeHoy(2)),
    // Santiago: respondida, pero con Caso abierto de días atrás: no resuelta.
    mensaje(c['Santiago Herrera'], 'cliente', minutoDeHoy(1)),
    mensaje(c['Santiago Herrera'], 'agente', minutoDeHoy(2)),
    // Nicolás: respondida, y su Caso de hoy ya se resolvió: el Dueño intervino, no fue sin él.
    mensaje(c['Nicolás Aristizábal'], 'cliente', minutoDeHoy(1)),
    mensaje(c['Nicolás Aristizábal'], 'agente', minutoDeHoy(2)),
    // Un Cliente sin nombre, respondido: resuelta. Y escribió solo hoy.
    mensaje(c['sin-nombre'], 'cliente', minutoDeHoy(3)),
    mensaje(c['sin-nombre'], 'agente', minutoDeHoy(4)),
    // Andrés: escribió ayer a las 23:59 de Bogotá, ya hoy en UTC: es de ayer, y de la semana solo si ayer fue de esta semana.
    mensaje(c['Andrés Gómez'], 'cliente', new Date(hoyLocal.getTime() - MINUTO)),
    mensaje(c['Andrés Gómez'], 'agente', new Date(hoyLocal.getTime() - 30_000)),
  ])
  const casos = await db
    .insert(esquema.casos)
    .values([
      { negocioId, clienteId: c['Santiago Herrera'], titulo: `Quiere 20 bolsas`, estado: 'esperando_dueno', creado: new Date(ahora.getTime() - 3 * DIA) },
      { negocioId, clienteId: c['Nicolás Aristizábal'], pedidoId: delCaso.id, titulo: `Su envío no llega`, estado: 'abierto', creado: new Date(ahora.getTime() - 2 * DIA) },
      { negocioId, clienteId: c['Nicolás Aristizábal'], titulo: `Ya se resolvió hoy`, estado: 'resuelto', creado: minutoDeHoy(1), resuelto: minutoDeHoy(5) },
    ])
    .returning()
  return { c, pedidos, casos }
}

try {
  console.log('\nLas palabras')
  afirmar('Rubro: café habla de ventas', vozDelRubro('café de especialidad') === 'tienda')
  afirmar('Rubro: vacío habla de ventas', vozDelRubro('') === 'tienda')
  afirmar('Rubro: uno que no reconoce habla de ventas', vozDelRubro('Artesanías del Eje') === 'tienda')
  afirmar('Rubro: peluquería con tilde y mayúscula es agenda', vozDelRubro('Peluquería') === 'agenda')
  afirmar('Rubro: uñas es agenda', vozDelRubro('Salón de uñas') === 'agenda')
  afirmar('Rubro: lunas y cosméticos no son agenda', vozDelRubro('lunas de miel') === 'tienda' && vozDelRubro('Cosméticos') === 'tienda' && vozDelRubro('Medicamentos') === 'tienda')

  const nada = { semana: { ventas: 0, pedidos: 0, clientes: 0 }, anterior: { ventas: 0, pedidos: 0 }, conversaciones: { total: 0, resueltas: 0 } }
  const conVentas = (ventas: number, pedidos: number, antes = 0, pedidosAntes = 0) => ({ ...nada, semana: { ventas, pedidos, clientes: 0 }, anterior: { ventas: antes, pedidos: pedidosAntes } })
  afirmar('Frase: cero pedidos no dice $0', texto(fraseDeHoy('tienda', nada)) === 'Esta semana todavía no tienes ventas.', texto(fraseDeHoy('tienda', nada)))
  afirmar('Frase: un pedido en singular y sin semana anterior no compara', texto(fraseDeHoy('tienda', conVentas(76_000, 1))) === 'Esta semana vendiste $76.000 en 1 pedido.', texto(fraseDeHoy('tienda', conVentas(76_000, 1))))
  afirmar('Frase: con dos pedidos antes tampoco compara', !texto(fraseDeHoy('tienda', conVentas(500_000, 3, 10_000, 2))).includes('%'))
  afirmar('Frase: sube', texto(fraseDeHoy('tienda', conVentas(1_284_000, 23, 1_088_000, 19))) === 'Esta semana vendiste $1.284.000 en 23 pedidos, 18\u00a0% más que la anterior.', texto(fraseDeHoy('tienda', conVentas(1_284_000, 23, 1_088_000, 19))))
  afirmar('Frase: baja', texto(fraseDeHoy('tienda', conVentas(50_000, 4, 100_000, 8))).endsWith('50\u00a0% menos que la anterior.'))
  afirmar('Frase: igual', texto(fraseDeHoy('tienda', conVentas(100_000, 4, 100_000, 8))).endsWith('igual que la anterior.'))
  afirmar('Frase: una agenda no dice ventas ni pedidos', !/vendiste|ventas|pedido/.test(texto(fraseDeHoy('agenda', { ...conVentas(100_000, 4), semana: { ventas: 100_000, pedidos: 4, clientes: 2 } }))))
  afirmar('Frase: una conversación resuelta no dice 1 de 1', texto(fraseDeHoy('tienda', { ...nada, conversaciones: { total: 1, resueltas: 1 } })).includes('la única conversación'))
  afirmar('Frase: con 0 resueltas no dice 0 de 2', texto(fraseDeHoy('tienda', { ...nada, conversaciones: { total: 2, resueltas: 0 } })).endsWith('Hoy te escribieron 2 clientes.'))
  afirmar('Frase: hoy sin conversaciones no habla de hoy', !texto(fraseDeHoy('tienda', nada)).includes('Hoy'))

  const base = new Date('2026-11-03T17:00:00Z')
  afirmar('Hace: minutos', haceCuanto(new Date(base.getTime() - 12 * MINUTO), base, ZONA) === 'hace 12 min')
  afirmar('Hace: horas', haceCuanto(new Date(base.getTime() - 3 * HORA), base, ZONA) === 'hace 3 h')
  afirmar('Hace: ayer se cuenta en la zona del Negocio', haceCuanto(new Date('2026-11-03T04:30:00Z'), base, ZONA) === 'ayer', haceCuanto(new Date('2026-11-03T04:30:00Z'), base, ZONA))
  afirmar('Hace: días', haceCuanto(new Date(base.getTime() - 3 * DIA), base, ZONA) === 'hace 3 días')

  console.log('\nLas lecturas')
  const nuevo = await negocioNuevo('N')
  const recien = await leerHoy(marcar.negocio(nuevo.id), ZONA, nuevo.rubro)
  afirmar('Recién abierto: nadie ha escrito', recien.recienAbierto && recien.ojo.length === 0 && recien.ultimo.length === 0, recien)

  const a = await negocioNuevo('A')
  const b = await negocioNuevo('B')
  const sembrado = await sembrar(a.id)
  await sembrar(b.id)
  // Solo en B: si algo se cuela, sus cifras se notan en A.
  const soloB = await clientesDe(b.id, ['Intruso de B'], 50)
  await db.insert(esquema.pedidos).values({ negocioId: b.id, clienteId: soloB['Intruso de B'], numero: 900, items: [], total: 7_777_777, estado: 'confirmado', creado: new Date(lunesLocal.getTime() + 6_000) })
  await db.insert(esquema.mensajesCliente).values({ negocioId: b.id, clienteId: soloB['Intruso de B'], rol: 'cliente', texto: 'hola', creado: new Date(hoyLocal.getTime() + 9_000) })
  await db.insert(esquema.casos).values({ negocioId: b.id, clienteId: soloB['Intruso de B'], titulo: 'Caso de B', estado: 'abierto' })

  const hoy = await leerHoy(marcar.negocio(a.id), ZONA, a.rubro)
  const { semana, anterior, conversaciones } = hoy.cifras
  afirmar('No está recién abierto', !hoy.recienAbierto)
  afirmar('Voz: café', hoy.voz === 'tienda')
  afirmar('Ventas: solo los estados que cuentan, desde el lunes en Bogotá', semana.ventas === 180_000, semana)
  afirmar('Pedidos: los mismos', semana.pedidos === 3, semana)
  // Si hoy es lunes, Andrés escribió la semana pasada.
  afirmar('Clientes de la semana: los que escribieron desde el lunes', semana.clientes === (hoyLocal.getTime() === lunesLocal.getTime() ? 5 : 6), semana)
  afirmar('Semana anterior: el tramo hasta este mismo momento', anterior.pedidos === 3 && anterior.ventas === 150_000, anterior)
  afirmar('Conversaciones de hoy: las que tuvieron mensaje del Cliente hoy en Bogotá', conversaciones.total === 5, conversaciones)
  afirmar('Resueltas: respondidas y sin Caso abierto ni de hoy', conversaciones.resueltas === 2, conversaciones)
  afirmar('La frase dice esas cifras', texto(fraseDeHoy(hoy.voz, hoy.cifras)) === 'Esta semana vendiste $180.000 en 3 pedidos, 20\u00a0% más que la anterior. Hoy tu agente resolvió 2 de 5 conversaciones.', texto(fraseDeHoy(hoy.voz, hoy.cifras)))

  const titulos = hoy.ojo.map((o) => o.titulo)
  afirmar('Ojo: los Casos sin resolver van primero', hoy.ojo[0].accion === 'Decidir' && hoy.ojo[1].accion === 'Decidir' && titulos.slice(0, 2).sort().join('|') === 'Quiere 20 bolsas|Su envío no llega', titulos)
  afirmar('Ojo: un Caso resuelto no aparece', !titulos.includes('Ya se resolvió hoy'), titulos)
  afirmar('Ojo: la novedad dice ciudad', titulos.includes('Paola tiene una novedad con su envío a Pasto'), titulos)
  afirmar('Ojo: el pendiente dice monto', hoy.ojo.some((o) => o.titulo === 'Daniela todavía no confirma su pedido' && o.detalle.includes('$76.000')), hoy.ojo)
  afirmar('Ojo: un pedido con Caso abierto sale una sola vez', !titulos.some((t) => t.includes('Cali')), titulos)
  afirmar('Ojo: un pendiente de hace dos semanas ya no', hoy.ojo.length === 4, titulos)
  afirmar('Ojo: el Caso lleva a Casos y el pedido a ese pedido', hoy.ojo.every((o) => (o.accion === 'Decidir' ? o.ruta === '/panel/casos' : o.ruta === `/panel/pedidos/${o.clave.replace('pedido-', '')}`)), hoy.ojo)

  const ultimos = hoy.ultimo.map((u) => u.texto)
  afirmar('Lo último: cinco, lo más reciente primero', hoy.ultimo.length === 5 && ultimos[0] === 'Tu agente le tomó un pedido a Daniela Quintero', ultimos)
  afirmar('Lo último: un Cliente sin nombre no queda en blanco', ultimos.includes('Un cliente te escribió: «hola»'), ultimos)
  const todo = JSON.stringify(hoy)
  afirmar('Otro Negocio no se cuela', !todo.includes('Intruso') && !todo.includes('Caso de B') && !todo.includes('7.777.777'), hoy)

  const deB = await leerHoy(marcar.negocio(b.id), ZONA, b.rubro)
  afirmar('Otro Negocio tiene lo suyo', deB.cifras.semana.ventas === 7_957_777 && deB.cifras.conversaciones.total === 6 && deB.ojo.some((o) => o.titulo === 'Caso de B'), deB.cifras)

  console.log('\nLos que ya tienen Caso no le quitan el lugar a otro')
  const lleno = await negocioNuevo('L')
  const deLleno = await clientesDe(lleno.id, ['Con Caso', 'Sin Caso'], 700)
  const conCaso = await db
    .insert(esquema.pedidos)
    .values(Array.from({ length: 10 }, (_, i) => ({ negocioId: lleno.id, clienteId: deLleno['Con Caso'], numero: i + 1, items: [], total: 10_000, estado: 'novedad' as const, ciudad: 'Cali', creado: new Date(ahora.getTime() - i * MINUTO) })))
    .returning()
  const [viejo] = await db.insert(esquema.pedidos).values({ negocioId: lleno.id, clienteId: deLleno['Sin Caso'], numero: 11, items: [], total: 10_000, estado: 'novedad', ciudad: 'Pasto', creado: new Date(ahora.getTime() - 2 * DIA) }).returning()
  await db.insert(esquema.casos).values(conCaso.map((p) => ({ negocioId: lleno.id, clienteId: deLleno['Con Caso'], pedidoId: p.id, titulo: `Caso del ${p.numero}`, estado: 'abierto' as const })))
  const delLleno = await leerHoy(marcar.negocio(lleno.id), ZONA, lleno.rubro)
  afirmar('Ojo: el pedido sin Caso sale aunque diez más nuevos tengan el suyo', delLleno.ojo.some((o) => o.clave === `pedido-${viejo.id}`), delLleno.ojo.map((o) => o.clave))
  afirmar('Ojo: los que tienen Caso salen solo como Caso', delLleno.ojo.filter((o) => o.accion === 'Decidir').length === 10 && delLleno.ojo.filter((o) => o.accion === 'Ver el pedido').length === 1, delLleno.ojo.map((o) => o.clave))

  console.log('\nLo resuelto sale')
  const quiere = sembrado.casos.find((c) => c.titulo === 'Quiere 20 bolsas')!
  await db.update(esquema.casos).set({ estado: 'resuelto', resuelto: new Date() }).where(eq(esquema.casos.id, quiere.id))
  const novedad = sembrado.pedidos.find((p) => p.estado === 'novedad' && p.ciudad === 'Pasto')!
  await db.update(esquema.pedidos).set({ estado: 'entregado' }).where(eq(esquema.pedidos.id, novedad.id))
  const despues = await leerHoy(marcar.negocio(a.id), ZONA, a.rubro)
  const quedan = despues.ojo.map((o) => o.titulo)
  afirmar('El Caso resuelto sale del ojo', !quedan.includes('Quiere 20 bolsas'), quedan)
  afirmar('El pedido entregado sale del ojo', !quedan.some((t) => t.includes('Pasto')), quedan)
  afirmar('Lo último cuenta que lo resolviste', despues.ultimo[0].texto === 'Resolviste un Caso: Quiere 20 bolsas', despues.ultimo)
  afirmar('Un Caso que el Dueño resolvió hoy no vuelve resuelta sin él esa conversación', despues.cifras.conversaciones.resueltas === 2, despues.cifras.conversaciones)

  console.log('\nLa hora en que se confirma un pedido')
  const conPedidos = await negocioNuevo('C')
  const dePedidos = await clientesDe(conPedidos.id, ['Carolina Ruiz', 'Antes Pérez'])
  const hace2Dias = new Date(ahora.getTime() - 2 * DIA)
  const [porConfirmar] = await db.insert(esquema.pedidos).values({ negocioId: conPedidos.id, clienteId: dePedidos['Carolina Ruiz'], numero: 1, items: [], total: 30_000, estado: 'pendiente', creado: hace2Dias }).returning()
  await db.insert(esquema.pedidos).values({ negocioId: conPedidos.id, clienteId: dePedidos['Antes Pérez'], numero: 2, items: [], total: 40_000, estado: 'confirmado', creado: hace2Dias })
  const leerDelPedido = async () => (await db.select({ confirmado: esquema.pedidos.confirmado }).from(esquema.pedidos).where(eq(esquema.pedidos.id, porConfirmar.id)))[0].confirmado
  afirmar('Sin confirmar no tiene hora', (await leerDelPedido()) === null)

  const relojDeLaBase = async () => new Date((await db.execute(sql`select now() as ahora`)).rows[0].ahora as string)
  const puerto = puertoDeLaBase(await leerPublicado(marcar.negocio(conPedidos.id)), marcar.cliente(dePedidos['Carolina Ruiz']))
  const antes = await relojDeLaBase()
  const confirmacion = await puerto.confirmar_pedido(1)
  const luego = await relojDeLaBase()
  const hora = await leerDelPedido()
  afirmar('confirmar_pedido guarda la hora en que se confirma', confirmacion.ok && hora !== null && hora >= antes && hora <= luego, { confirmacion, antes, hora, luego })

  const repetida = await puerto.confirmar_pedido(1)
  afirmar('Confirmar otra vez no mueve la hora', !repetida.ok && (await leerDelPedido())?.getTime() === hora?.getTime(), { repetida, hora })

  const conConfirmados = await leerHoy(marcar.negocio(conPedidos.id), ZONA, conPedidos.rubro)
  const linea = (texto: string) => conConfirmados.ultimo.find((u) => u.texto === texto)
  afirmar('Lo último: quien confirmó, con la hora de confirmar y no la de tomarlo', linea('Carolina Ruiz confirmó su pedido')?.cuando === haceCuanto(hora!, new Date(), ZONA) && linea('Tu agente le tomó un pedido a Carolina Ruiz')?.cuando === haceCuanto(hace2Dias, new Date(), ZONA), conConfirmados.ultimo)
  afirmar('Lo último: confirmado sin hora guardada no se cuenta como confirmado, sí como tomado', !linea('Antes Pérez confirmó su pedido') && !!linea('Tu agente le tomó un pedido a Antes Pérez'), conConfirmados.ultimo)

  console.log('\nLo que escribió un Cliente')
  const conMensajes = await negocioNuevo('D')
  const deMensajes = await clientesDe(conMensajes.id, ['Con Ficha', 'Solo Ficha', 'Larga Díaz', 'Gabriel Luna', 'Entre Paréntesis'])
  const hace = (minutos: number) => new Date(ahora.getTime() - minutos * MINUTO)
  const largo = `¿Tienen café\n\nen grano? ${'palabra '.repeat(20)}`
  await db.insert(esquema.mensajesCliente).values([
    { negocioId: conMensajes.id, clienteId: deMensajes['Entre Paréntesis'], rol: 'cliente', texto: '(sin) azúcar', creado: hace(5) },
    { negocioId: conMensajes.id, clienteId: deMensajes['Con Ficha'], rol: 'cliente', texto: `(${conMensajes.codigo}) Hola Café`, creado: hace(4) },
    { negocioId: conMensajes.id, clienteId: deMensajes['Solo Ficha'], rol: 'cliente', texto: `(${conMensajes.codigo})`, creado: hace(3) },
    { negocioId: conMensajes.id, clienteId: deMensajes['Larga Díaz'], rol: 'cliente', texto: largo, creado: hace(2) },
    { negocioId: conMensajes.id, clienteId: deMensajes['Gabriel Luna'], rol: 'cliente', texto: 'Lo primero que escribió', creado: hace(9) },
    { negocioId: conMensajes.id, clienteId: deMensajes['Gabriel Luna'], rol: 'cliente', texto: 'Lo último que escribió', creado: hace(1) },
    { negocioId: conMensajes.id, clienteId: deMensajes['Gabriel Luna'], rol: 'agente', texto: 'Esto lo dijo el agente', creado: hace(0) },
  ])
  const escritos = (await leerHoy(marcar.negocio(conMensajes.id), ZONA, conMensajes.rubro)).ultimo.map((u) => u.texto)
  afirmar('Lo último: su último mensaje, no el anterior ni el del agente', escritos[0] === 'Gabriel Luna te escribió: «Lo último que escribió»', escritos)
  afirmar('Lo último: en una línea y recortado sin partir una palabra', escritos[1] === `Larga Díaz te escribió: «¿Tienen café en grano? ${'palabra '.repeat(6)}palabra…»`, escritos)
  afirmar('Lo último: el código del link no se le muestra al Dueño', escritos[3] === 'Con Ficha te escribió: «Hola Café»', escritos)
  afirmar('Lo último: si solo mandó el código, no hay comillas vacías', escritos[2] === 'Solo Ficha te escribió', escritos)
  afirmar('Lo último: un paréntesis que no es su código se queda', escritos[4] === 'Entre Paréntesis te escribió: «(sin) azúcar»', escritos)
  afirmar('Lo último: lo confirmado de otro Negocio no se cuela', !escritos.some((t) => t.includes('Carolina')), escritos)
  const otraVez = JSON.stringify(await leerHoy(marcar.negocio(conPedidos.id), ZONA, conPedidos.rubro))
  afirmar('Lo último: lo que escribió un Cliente de otro Negocio no se cuela', !otraVez.includes('Gabriel') && !otraVez.includes('Lo último que escribió'), otraVez)

  const emojis = '🧑‍🌾'.repeat(81)
  afirmar('El recorte no parte un emoji', recorteDeLoEscrito(emojis) === `${'🧑‍🌾'.repeat(80)}…`, recorteDeLoEscrito(emojis))
  afirmar('Justo en el tope no se recorta', recorteDeLoEscrito('a'.repeat(80)) === 'a'.repeat(80))
  afirmar('El código del link se quita también en minúsculas', sinSuFicha(`(${conMensajes.codigo.toLowerCase()}) Hola`, conMensajes.codigo) === ' Hola')
  afirmar('El código de otro Negocio se queda', sinSuFicha('(OTRO123) Hola', conMensajes.codigo) === '(OTRO123) Hola')
  afirmar('Un link largo después de otras palabras se corta y no se pierde', recorteDeLoEscrito(`Mira este ${'x'.repeat(100)}`) === `Mira este ${'x'.repeat(70)}…`, recorteDeLoEscrito(`Mira este ${'x'.repeat(100)}`))
  afirmar('El corte en un espacio no pierde la palabra', recorteDeLoEscrito(`${'a'.repeat(80)} b`) === `${'a'.repeat(80)}…`)
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
}

terminar()
