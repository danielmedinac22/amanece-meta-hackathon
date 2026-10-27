/**
 * Siembra dos Negocios ficticios con catálogo, Clientes, pedidos y Casos para probar y medir.
 * Idempotente: el Negocio se actualiza por `codigo` y lo demás por ids que salen del texto, así que
 * correrlo de nuevo no duplica ni borra nada. Todo es inventado: nombres, teléfonos y direcciones.
 *
 *   pnpm tsx scripts/sembrar.mts
 */
import { createHash } from 'node:crypto'
import { config } from 'dotenv'
import { getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

config({ path: '.env.local', quiet: true })
const { db, esquema } = await import('../src/db')
type Conocimiento = import('../src/db/esquema').Conocimiento
type ItemDePedido = import('../src/db/esquema').ItemDePedido

const DIA = 24 * 60 * 60 * 1000
const AHORA = Date.now()

/** Id estable a partir de un texto, con forma de uuid. */
function uuid(semilla: string) {
  const h = createHash('sha1').update(`amanece:${semilla}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Números al azar que se repiten igual en cada corrida. */
function azar(semilla: number) {
  let a = semilla
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Para `onConflictDoUpdate`: que cada columna tome el valor que se intentó insertar. */
function excluidas(tabla: PgTable, claves: string[]) {
  const columnas = getTableColumns(tabla) as Record<string, { name: string }>
  return Object.fromEntries(claves.map((k) => [k, sql.raw(`excluded."${columnas[k].name}"`)])) as Record<string, SQL>
}

type ProductoSemilla = { clave: string; nombre: string; descripcion: string; precio: number; peso: number; unico?: boolean }
type ClienteSemilla = { telefono: string; nombre: string; ciudad: string; direccion: string }
type CasoSemilla = { pedido: number | null; titulo: string; detalle: string; propuesta: string; resolucion: string }

type NegocioSemilla = {
  codigo: string
  nombre: string
  rubro: string
  conocimiento: Conocimiento
  productos: ProductoSemilla[]
  clientes: ClienteSemilla[]
  pedidos: number
  dias: number
  casos: CasoSemilla[]
  /** Los Clientes sin dirección recogen en la tienda. */
  recoger?: boolean
  semilla: number
}

const cafeLadera: NegocioSemilla = {
  codigo: 'LADERA',
  nombre: 'Café Ladera',
  rubro: 'café de especialidad',
  semilla: 11,
  pedidos: 40,
  dias: 21,
  conocimiento: {
    descripcion:
      'Café de especialidad de Manizales, tostado en lotes pequeños con granos de fincas de Caldas y Risaralda. Vendemos por internet y entregamos en todo el país.',
    ciudad: 'Manizales',
    horario: 'Atendemos por WhatsApp de lunes a sábado, de 8:00 a. m. a 6:00 p. m. Despachamos de lunes a viernes.',
    envios:
      'Enviamos a todo el país con Servientrega e Inter Rapidísimo, y el envío va incluido en el precio. Ciudades principales (Bogotá, Medellín, Cali, Barranquilla, Bucaramanga, Pereira y Manizales): de 2 a 4 días hábiles. Resto del país: de 4 a 8 días hábiles, según la transportadora. No enviamos al exterior.',
    pagos:
      'Pago contra entrega en todo el país: pagas en efectivo cuando te llega el pedido. Por ahora no recibimos tarjeta ni transferencia.',
    tono: 'Cercano y cálido, como un barista amigo. Tuteamos, hablamos sencillo y no abusamos de los tecnicismos del café. Un emoji de café de vez en cuando.',
    preguntas: [
      {
        pregunta: '¿Qué diferencia hay entre los tuestes?',
        respuesta:
          'El claro tiene notas frutales y cítricas, es el más ligero. El medio es el más balanceado, con chocolate y caramelo. El oscuro tiene más cuerpo y un sabor más intenso y amargo.',
      },
      {
        pregunta: '¿Lo venden en grano o molido?',
        respuesta:
          'De las dos formas. El molido sale listo para greca, filtro o prensa francesa. Si tienes molino en casa, el grano se conserva mejor.',
      },
      {
        pregunta: '¿Cuánto dura el café una vez abierto?',
        respuesta:
          'Tostamos por tandas y lo despachamos fresco. Lo mejor es tomarlo dentro de las cuatro semanas siguientes al tueste, en un frasco cerrado y lejos del sol.',
      },
      {
        pregunta: '¿Cómo funciona la suscripción mensual?',
        respuesta:
          'Cada mes te llegan dos bolsas de 250 g del tueste que elijas, por $62.000. Se paga contra entrega, como todo, y la puedes pausar o cancelar avisándonos antes del día 25.',
      },
      {
        pregunta: '¿Si me llega mal o equivocado qué pasa?',
        respuesta:
          'Si el pedido llega dañado o no es el que pediste, nos escribes con una foto y te lo reponemos sin costo. Por ser un alimento no hacemos devoluciones por gusto.',
      },
    ],
  },
  productos: [
    { clave: 'medio-grano', nombre: 'Café Ladera tueste medio, grano 500 g', descripcion: 'Chocolate y caramelo, el más pedido.', precio: 38000, peso: 5 },
    { clave: 'medio-molido', nombre: 'Café Ladera tueste medio, molido 500 g', descripcion: 'Molido para greca, filtro o prensa francesa.', precio: 38000, peso: 4 },
    { clave: 'claro-grano', nombre: 'Café Ladera tueste claro, grano 250 g', descripcion: 'Notas frutales y cítricas, de la finca El Mirador.', precio: 24000, peso: 2 },
    { clave: 'oscuro-molido', nombre: 'Café Ladera tueste oscuro, molido 500 g', descripcion: 'Cuerpo intenso, para tinto y greca.', precio: 36000, peso: 2 },
    { clave: 'honey-grano', nombre: 'Micro lote Honey, grano 250 g', descripcion: 'Lote pequeño con proceso honey, dulce y de cuerpo suave.', precio: 32000, peso: 1 },
    { clave: 'molino', nombre: 'Molino manual de café', descripcion: 'Muelas de cerámica, ajustable, para moler en casa.', precio: 119000, peso: 0.6, unico: true },
    { clave: 'suscripcion', nombre: 'Suscripción mensual, 2 bolsas de 250 g', descripcion: 'Dos bolsas al mes del tueste que elijas, se paga contra entrega.', precio: 62000, peso: 0.8, unico: true },
    { clave: 'caja-regalo', nombre: 'Caja regalo Ladera', descripcion: 'Dos bolsas de 250 g y una taza esmaltada, en caja de cartón.', precio: 95000, peso: 0.8, unico: true },
  ],
  clientes: [
    { telefono: '573000000001', nombre: 'Camila Rojas', ciudad: 'Bogotá', direccion: 'Carrera 15 # 85-30, apto 402' },
    { telefono: '573000000002', nombre: 'Andrés Felipe Gómez', ciudad: 'Medellín', direccion: 'Calle 10 # 40-20, casa 3' },
    { telefono: '573000000003', nombre: 'Laura Valentina Pérez', ciudad: 'Cali', direccion: 'Avenida 6N # 25-18, apto 101' },
    { telefono: '573000000004', nombre: 'Juan David Cárdenas', ciudad: 'Bogotá', direccion: 'Calle 127 # 19-45, torre 2 apto 906' },
    { telefono: '573000000005', nombre: 'Mariana Ospina', ciudad: 'Manizales', direccion: 'Carrera 23 # 55-12' },
    { telefono: '573000000006', nombre: 'Santiago Herrera', ciudad: 'Barranquilla', direccion: 'Calle 84 # 51B-30, apto 5C' },
    { telefono: '573000000007', nombre: 'Daniela Quintero', ciudad: 'Pereira', direccion: 'Carrera 8 # 21-40' },
    { telefono: '573000000008', nombre: 'Sebastián Mejía', ciudad: 'Bucaramanga', direccion: 'Calle 45 # 28-15, apto 302' },
    { telefono: '573000000009', nombre: 'Paola Andrea Vargas', ciudad: 'Pasto', direccion: 'Calle 18 # 25-60, barrio Centro' },
    { telefono: '573000000010', nombre: 'Carlos Mario Londoño', ciudad: 'Medellín', direccion: 'Carrera 43A # 7-50, oficina 1204' },
    { telefono: '573000000011', nombre: 'Luisa Fernanda Ríos', ciudad: 'Cartagena', direccion: 'Calle 31 # 4-22, Getsemaní' },
    { telefono: '573000000012', nombre: 'Nicolás Aristizábal', ciudad: 'Bogotá', direccion: 'Carrera 7 # 72-41, apto 801' },
  ],
  casos: [
    {
      pedido: 3,
      titulo: 'La bolsa llegó rota',
      detalle: 'El Cliente dice que una de las bolsas llegó abierta y con café regado dentro de la caja. Mandó foto.',
      propuesta: 'Responderle que lamentamos lo ocurrido y reponer la bolsa sin costo en el próximo despacho.',
      resolucion: 'Se repuso la bolsa sin costo y salió con el despacho de esa semana.',
    },
    {
      pedido: null,
      titulo: 'Pregunta por envío a San Andrés',
      detalle: 'Pregunta si podemos enviar a San Andrés y en cuánto llega. No hay información de envíos a islas.',
      propuesta: 'Decirle que por ahora no enviamos a San Andrés y ofrecerle avisarle si eso cambia.',
      resolucion: 'Se le explicó que no hay envíos a islas por ahora. Quedó pendiente avisarle si se habilitan.',
    },
    {
      pedido: 9,
      titulo: 'Cambio de dirección después de confirmar',
      detalle: 'El Cliente confirmó el pedido y luego pidió cambiar la dirección de entrega porque no estará en casa.',
      propuesta: 'Si el pedido aún no sale, cambiar la dirección y confirmarle la nueva.',
      resolucion: 'El pedido no había salido; se cambió la dirección y se le confirmó.',
    },
  ],
}

const trigoYLena: NegocioSemilla = {
  codigo: 'TRIGO',
  nombre: 'Panadería Trigo y Leña',
  rubro: 'panadería y pastelería',
  semilla: 23,
  pedidos: 12,
  dias: 14,
  recoger: true,
  conocimiento: {
    descripcion:
      'Panadería artesanal en Chapinero, Bogotá. Hacemos pan de masa madre, pastelería y tortas por encargo, todo horneado el mismo día.',
    ciudad: 'Bogotá',
    horario: 'De martes a domingo, de 7:00 a. m. a 7:00 p. m. Los lunes cerramos.',
    envios:
      'Puedes recoger en la tienda (Calle 63 # 9-20, Chapinero) o pedir domicilio en Chapinero, Teusaquillo, Usaquén y Chicó. El domicilio cuesta $6.000 y se paga aparte al domiciliario. Para otras zonas hay que consultarlo. No enviamos fuera de Bogotá.',
    pagos: 'En la tienda pagas al recoger, en efectivo, con tarjeta o por Nequi. En domicilio pagas al domiciliario, en efectivo o por Nequi.',
    tono: 'Cálido y de barrio, como la panadería de toda la vida. Tuteamos y vamos al grano.',
    preguntas: [
      {
        pregunta: '¿Con cuánto tiempo hay que pedir una torta?',
        respuesta: 'Las tortas se encargan con 48 horas de anticipación. Los panes y la pastelería del día se piden antes de las 11:00 a. m. para recogerlos esa tarde.',
      },
      {
        pregunta: '¿Qué es el pan de masa madre?',
        respuesta: 'Es pan hecho con fermento natural, sin levadura industrial, que reposa unas 24 horas. Sale con corteza crocante y migas húmedas.',
      },
      {
        pregunta: '¿Tienen opciones sin gluten?',
        respuesta: 'No. Toda la cocina trabaja con harina de trigo, así que no podemos ofrecer productos sin gluten.',
      },
      {
        pregunta: '¿Hasta qué hora hay pan caliente?',
        respuesta: 'Horneamos en la mañana y otra tanda hacia las 3:00 p. m. Hasta las 5:00 p. m. todavía sale tibio.',
      },
    ],
  },
  productos: [
    { clave: 'masa-madre', nombre: 'Pan de masa madre, 750 g', descripcion: 'Corteza crocante y miga húmeda, fermentación de 24 horas.', precio: 16000, peso: 4 },
    { clave: 'croissant', nombre: 'Croissant de mantequilla', descripcion: 'Hojaldrado, con mantequilla.', precio: 6500, peso: 5 },
    { clave: 'pan-de-bono', nombre: 'Pan de bono, 6 unidades', descripcion: 'Calientico, con queso costeño.', precio: 9000, peso: 3 },
    { clave: 'almojabanas', nombre: 'Almojábanas, 6 unidades', descripcion: 'Con queso cuajada, recién horneadas.', precio: 8500, peso: 2 },
    { clave: 'torta-zanahoria', nombre: 'Torta de zanahoria, 8 porciones', descripcion: 'Con nueces y crema de queso. Por encargo, con 48 horas.', precio: 58000, peso: 1, unico: true },
    { clave: 'brownie', nombre: 'Brownie de chocolate', descripcion: 'Húmedo, con chocolate oscuro.', precio: 5500, peso: 2 },
    { clave: 'galletas', nombre: 'Galletas de avena, 6 unidades', descripcion: 'Con pasas y canela.', precio: 12000, peso: 1 },
  ],
  clientes: [
    { telefono: '573000000101', nombre: 'Martha Lucía Acosta', ciudad: 'Bogotá', direccion: 'Recoge en la tienda' },
    { telefono: '573000000102', nombre: 'Felipe Camargo', ciudad: 'Bogotá', direccion: 'Carrera 13 # 52-10, apto 702, Chapinero' },
    { telefono: '573000000103', nombre: 'Juliana Beltrán', ciudad: 'Bogotá', direccion: 'Calle 45 # 19-30, Teusaquillo' },
    { telefono: '573000000104', nombre: 'Gabriel Sarmiento', ciudad: 'Bogotá', direccion: 'Recoge en la tienda' },
    { telefono: '573000000105', nombre: 'Natalia Pardo', ciudad: 'Bogotá', direccion: 'Calle 119 # 6-40, torre 1 apto 303, Usaquén' },
  ],
  casos: [
    {
      pedido: 5,
      titulo: 'Faltó un croissant en el pedido',
      detalle: 'La Cliente pidió dos croissants y recibió uno. Pregunta si se lo pueden reponer.',
      propuesta: 'Pedir disculpas y dejarle el croissant que faltó para su próxima visita, o llevárselo en el próximo domicilio sin costo.',
      resolucion: 'Se le repuso el croissant en su siguiente pedido.',
    },
  ],
}

function estadoPorEdad(edadDias: number, ciudad: string, r: number) {
  if (ciudad === 'Pasto' && edadDias > 2 && r < 0.5) return 'novedad' as const
  if (edadDias > 8) return r < 0.78 ? ('entregado' as const) : r < 0.88 ? ('cancelado' as const) : ('novedad' as const)
  if (edadDias > 3) return r < 0.4 ? ('entregado' as const) : r < 0.8 ? ('enviado' as const) : r < 0.9 ? ('novedad' as const) : ('cancelado' as const)
  return r < 0.25 ? ('pendiente' as const) : r < 0.7 ? ('confirmado' as const) : ('enviado' as const)
}

async function sembrar(n: NegocioSemilla) {
  const r = azar(n.semilla)

  const [negocio] = await db
    .insert(esquema.negocios)
    .values({ codigo: n.codigo, nombre: n.nombre, rubro: n.rubro, conocimiento: n.conocimiento, estado: 'listo' })
    .onConflictDoUpdate({
      target: esquema.negocios.codigo,
      set: excluidas(esquema.negocios, ['nombre', 'rubro', 'conocimiento', 'estado']),
    })
    .returning()

  const productos = n.productos.map((p) => ({
    id: uuid(`${n.codigo}:producto:${p.clave}`),
    negocioId: negocio.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio: p.precio,
    activo: true,
    peso: p.peso,
    unico: p.unico ?? false,
  }))
  await db
    .insert(esquema.productos)
    .values(productos.map((p) => ({ id: p.id, negocioId: p.negocioId, nombre: p.nombre, descripcion: p.descripcion, precio: p.precio, activo: p.activo })))
    .onConflictDoUpdate({
      target: esquema.productos.id,
      set: excluidas(esquema.productos, ['nombre', 'descripcion', 'precio', 'activo']),
    })

  // Los pedidos, del más viejo al más nuevo, para que el número crezca con el tiempo.
  const fechas = Array.from({ length: n.pedidos }, () => AHORA - r() * n.dias * DIA).sort((a, b) => a - b)
  const pesoTotal = productos.reduce((s, p) => s + p.peso, 0)
  const elegirProducto = () => {
    let x = r() * pesoTotal
    for (const p of productos) if ((x -= p.peso) <= 0) return p
    return productos[0]
  }

  const clientes = n.clientes.map((c) => ({ ...c, id: uuid(`${n.codigo}:cliente:${c.telefono}`), ultimo: 0 }))
  const pedidos: (typeof esquema.pedidos.$inferInsert & { id: string })[] = []
  const mensajes: (typeof esquema.mensajesCliente.$inferInsert & { id: string })[] = []

  fechas.forEach((fecha, i) => {
    const numero = i + 1
    // Los primeros Clientes de la lista repiten más.
    const cliente = clientes[Math.floor(clientes.length * Math.pow(r(), 1.6))]
    const lineas: ItemDePedido[] = []
    const cuantas = r() < 0.65 ? 1 : 2
    while (lineas.length < cuantas) {
      const p = elegirProducto()
      if (lineas.some((l) => l.productoId === p.id)) continue
      lineas.push({ productoId: p.id, nombre: p.nombre, cantidad: p.unico ? 1 : 1 + Math.floor(r() * 3), precio: p.precio })
    }
    const total = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0)
    const edad = (AHORA - fecha) / DIA
    const estado = estadoPorEdad(edad, cliente.ciudad, r())
    const id = uuid(`${n.codigo}:pedido:${numero}`)
    pedidos.push({
      id,
      negocioId: negocio.id,
      clienteId: cliente.id,
      numero,
      items: lineas,
      total,
      ciudad: cliente.ciudad,
      direccion: cliente.direccion,
      estado,
      creado: new Date(fecha),
    })

    // La conversación que llevó al pedido, unos minutos antes de crearlo.
    const resumen = lineas.map((l) => `${l.cantidad} ${l.nombre}`).join(' y ')
    const entrega = n.recoger && cliente.direccion.startsWith('Recoge') ? 'Lo recojo en la tienda' : `A ${cliente.ciudad}, ${cliente.direccion}`
    const guion: ['cliente' | 'agente', string, number][] = [
      ['cliente', `Hola, quiero pedir ${resumen}`, 7],
      ['agente', `¡Hola ${cliente.nombre.split(' ')[0]}! Claro que sí. ¿Dónde te lo entregamos?`, 6.5],
      ['cliente', entrega, 4],
      ['agente', `Listo, tu pedido #${numero} por $${total.toLocaleString('es-CO')} quedó confirmado. ¡Gracias por escribirnos!`, 3.5],
    ]
    guion.forEach(([rol, texto, minutos], k) => {
      const creado = fecha - minutos * 60_000
      if (rol === 'cliente') cliente.ultimo = Math.max(cliente.ultimo, creado)
      mensajes.push({ id: uuid(`${n.codigo}:mensaje:${numero}:${k}`), negocioId: negocio.id, clienteId: cliente.id, rol, texto, creado: new Date(creado) })
    })
  })

  await db
    .insert(esquema.clientes)
    .values(
      clientes.map((c) => ({
        id: c.id,
        negocioId: negocio.id,
        telefono: c.telefono,
        nombre: c.nombre,
        // Un Cliente sin pedidos queda sin mensajes y sin ventana abierta.
        ultimoMensajeEntrante: c.ultimo ? new Date(c.ultimo) : null,
      })),
    )
    .onConflictDoUpdate({
      target: esquema.clientes.id,
      set: excluidas(esquema.clientes, ['nombre', 'ultimoMensajeEntrante']),
    })

  await db
    .insert(esquema.pedidos)
    .values(pedidos)
    .onConflictDoUpdate({
      target: esquema.pedidos.id,
      set: excluidas(esquema.pedidos, ['items', 'total', 'ciudad', 'direccion', 'estado', 'creado']),
    })
  await db
    .insert(esquema.mensajesCliente)
    .values(mensajes)
    .onConflictDoUpdate({ target: esquema.mensajesCliente.id, set: excluidas(esquema.mensajesCliente, ['texto', 'creado']) })

  // Casos ya cerrados, ligados a pedidos entregados cuando se puede.
  const entregados = pedidos.filter((p) => p.estado === 'entregado')
  const casos = n.casos.map((c, k) => {
    const pedido = c.pedido ? (entregados[c.pedido % entregados.length] ?? null) : null
    const cliente = pedido?.clienteId ?? clientes[k % clientes.length].id
    const creado = pedido ? pedido.creado!.getTime() + DIA : AHORA - (n.dias - 2 - k * 3) * DIA
    return {
      id: uuid(`${n.codigo}:caso:${k}`),
      negocioId: negocio.id,
      clienteId: cliente,
      pedidoId: pedido?.id ?? null,
      titulo: c.titulo,
      detalle: c.detalle,
      propuesta: c.propuesta,
      estado: 'resuelto' as const,
      resolucion: c.resolucion,
      creado: new Date(Math.min(creado, AHORA - 2 * 3600_000)),
      resuelto: new Date(Math.min(creado + 3 * 3600_000, AHORA - 3600_000)),
    }
  })
  if (casos.length) {
    await db
      .insert(esquema.casos)
      .values(casos)
      .onConflictDoUpdate({
        target: esquema.casos.id,
        set: excluidas(esquema.casos, ['titulo', 'detalle', 'propuesta', 'estado', 'resolucion', 'creado', 'resuelto']),
      })
  }

  const porEstado = pedidos.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.estado!]: (acc[p.estado!] ?? 0) + 1 }), {})
  console.log(`${n.nombre} (${n.codigo}): ${productos.length} productos, ${clientes.length} Clientes, ${pedidos.length} pedidos, ${casos.length} Casos`)
  console.log('  pedidos por estado:', porEstado)
}

await sembrar(cafeLadera)
await sembrar(trigoYLena)
console.log('Listo.')
process.exit(0)
