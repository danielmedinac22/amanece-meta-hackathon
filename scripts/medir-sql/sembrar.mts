/**
 * Siembra en la rama de medición dos Negocios inventados de venta contra entrega:
 *   SQL10K  10 000 pedidos en 180 días, 2 500 Clientes, 14 productos, 8 ciudades, conversaciones y Casos.
 *   SQL10KB 800 pedidos, para probar que A no ve a B.
 * Adaptado de scripts/medir/sintetico.mts. Cambios: más Clientes con compra repetida (cohortes), horas
 * del día en hora de Bogotá (para que UTC y hora local den días distintos), estados que dependen de la
 * edad del pedido, conversaciones con pares Cliente/Agente y Casos abiertos y resueltos. Idempotente.
 */
import '../medir/entorno.mts'
import { createHash } from 'node:crypto'

const { db, esquema } = await import('../../src/db')
const { eq } = await import('drizzle-orm')

const uuid = (s: string) => {
  const h = createHash('sha1').update(`sql:${s}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const trozos = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))

function crearAzar(semilla: number) {
  let a = semilla
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PRODUCTOS = [
  ['Camiseta básica', 38000], ['Jean slim', 119000], ['Gorra', 29000], ['Tenis urbanos', 189000], ['Medias x3', 24000],
  ['Chaqueta ligera', 159000], ['Correa de cuero', 45000], ['Billetera', 52000], ['Mochila', 98000], ['Buso con capucha', 89000],
  ['Pantaloneta', 42000], ['Camisa lino', 79000], ['Bufanda', 33000], ['Cinturón tejido', 27000],
] as const
const COMPANEROS: Record<number, number> = { 0: 4, 1: 6, 3: 4, 5: 9, 8: 7, 11: 1 }
const CIUDADES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga', 'Pereira', 'Manizales', 'Pasto']
const PESO_CIUDAD = [0.3, 0.2, 0.15, 0.1, 0.08, 0.07, 0.05, 0.05]
const PESO_HORA = [0, 0, 0, 0, 0, 0, 0.2, 0.5, 1, 2, 3, 3.5, 3, 2.5, 2.5, 3, 3.5, 4, 4.5, 5, 4.5, 3.5, 2, 0.8]
const BOGOTA_MS = 5 * 3600e3

type Opciones = { codigo: string; nombre: string; pedidos: number; clientes: number; dias: number; semilla: number; prefijo: string; productos: number }

async function sembrar(o: Opciones) {
  const azar = crearAzar(o.semilla)
  const elegir = (pesos: number[]) => {
    const total = pesos.reduce((a, b) => a + b, 0)
    let r = azar() * total
    for (let i = 0; i < pesos.length; i++) if ((r -= pesos[i]) <= 0) return i
    return pesos.length - 1
  }
  const [existe] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, o.codigo))
  if (existe) {
    console.log(`${o.codigo} ya existe`, existe.id)
    return existe.id
  }
  const [negocio] = await db
    .insert(esquema.negocios)
    .values({
      codigo: o.codigo,
      nombre: o.nombre,
      rubro: 'ropa y accesorios, venta contra entrega',
      estado: 'listo',
      conocimiento: { descripcion: 'Tienda inventada para medir consultas.', ciudad: 'Bogotá', horario: 'Todos los días', envios: 'Todo el país', pagos: 'Contra entrega', tono: 'Cercano', preguntas: [] },
    })
    .returning()
  const productos = PRODUCTOS.slice(0, o.productos).map(([nombre, precio], i) => ({ id: uuid(`${o.prefijo}p${i}`), negocioId: negocio.id, nombre, descripcion: `${nombre} de la tienda`, precio, activo: i !== o.productos - 1 || o.productos < 10 }))
  await db.insert(esquema.productos).values(productos)

  const ahora = Date.now()
  const hoyLocal0 = Math.floor((ahora - BOGOTA_MS) / 86400000) * 86400000 + BOGOTA_MS
  const instante = (diasAtras: number) => {
    const diaLocal0 = hoyLocal0 - Math.floor(diasAtras) * 86400000
    const hora = elegir(PESO_HORA)
    return Math.min(diaLocal0 + hora * 3600e3 + Math.floor(azar() * 3600e3), ahora - 1000)
  }

  const nuevas = Array.from({ length: o.pedidos }, () => 1 - Math.sqrt(azar())).map((u) => u * o.dias).sort((a, b) => b - a)
  const propension = Array.from({ length: o.clientes }, () => Math.exp((azar() + azar() + azar() - 1.5) * 1.6))
  const activos: number[] = []
  let siguienteNuevo = 0
  const primeraCompra: (number | null)[] = Array(o.clientes).fill(null)
  const pedidosBruto = nuevas.map((dias, i) => {
    const t = instante(dias)
    let c: number
    if ((activos.length === 0 || azar() < 0.27) && siguienteNuevo < o.clientes) {
      c = siguienteNuevo++
      activos.push(c)
    } else {
      const total = activos.reduce((s, k) => s + propension[k], 0)
      let r = azar() * total
      c = activos[activos.length - 1]
      for (const k of activos) if ((r -= propension[k]) <= 0) { c = k; break }
    }
    if (primeraCompra[c] === null) primeraCompra[c] = t
    return { i, t, c }
  })
  pedidosBruto.sort((a, b) => a.t - b.t)

  const clientes = Array.from({ length: o.clientes }, (_, i) => ({
    id: uuid(`${o.prefijo}c${i}`),
    negocioId: negocio.id,
    telefono: `57${o.prefijo === 'A' ? '31' : '32'}${String(i).padStart(8, '0')}`,
    nombre: `${o.prefijo === 'A' ? 'Cliente' : 'ClienteB'} ${i + 1}`,
    ultimoMensajeEntrante: new Date(ahora - Math.floor(azar() * 20) * 86400000),
    creado: new Date(primeraCompra[i] ?? ahora - azar() * o.dias * 86400000),
  }))
  for (const t of trozos(clientes, 500)) await db.insert(esquema.clientes).values(t)

  const pedidos = pedidosBruto.map((p, n) => {
    const principal = Math.min(Math.floor(-Math.log(1 - azar()) * 3.2), productos.length - 1)
    const ids = new Set<number>([principal])
    if (COMPANEROS[principal] !== undefined && COMPANEROS[principal] < productos.length && azar() < 0.55) ids.add(COMPANEROS[principal])
    while (azar() < 0.3 && ids.size < 4) ids.add(Math.floor(azar() * productos.length))
    const items = [...ids].map((k) => ({ productoId: productos[k].id, nombre: productos[k].nombre, cantidad: 1 + (azar() < 0.25 ? 1 : 0) + (azar() < 0.05 ? 1 : 0), precio: productos[k].precio }))
    const ciudad = CIUDADES[elegir(PESO_CIUDAD)]
    const edad = (ahora - p.t) / 86400000
    const r = azar()
    const pCancel = ciudad === 'Pasto' ? 0.25 : ciudad === 'Barranquilla' ? 0.05 : 0.12
    let estado: (typeof esquema.ESTADOS_DE_PEDIDO)[number]
    if (edad < 1) estado = r < 0.4 ? 'pendiente' : r < 0.85 ? 'confirmado' : r < 0.95 ? 'enviado' : 'cancelado'
    else if (edad < 4) estado = r < 0.1 ? 'pendiente' : r < 0.35 ? 'confirmado' : r < 0.75 ? 'enviado' : r < 0.9 ? 'entregado' : r < 0.95 ? 'novedad' : 'cancelado'
    else estado = r < 0.015 ? 'pendiente' : r < 0.02 ? 'confirmado' : r < 0.035 ? 'enviado' : r < 0.035 + pCancel ? 'cancelado' : r < 0.035 + pCancel + 0.08 ? 'novedad' : 'entregado'
    return {
      id: uuid(`${o.prefijo}o${n}`),
      negocioId: negocio.id,
      clienteId: clientes[p.c].id,
      numero: n + 1,
      items,
      total: items.reduce((s, x) => s + x.cantidad * x.precio, 0),
      ciudad,
      direccion: `Calle ${Math.floor(azar() * 100)} # ${Math.floor(azar() * 100)}-${Math.floor(azar() * 100)}`,
      estado,
      creado: new Date(p.t),
      _t: p.t,
      _c: p.c,
    }
  })
  for (const t of trozos(pedidos, 400)) await db.insert(esquema.pedidos).values(t.map(({ _t, _c, ...fila }) => fila))

  const TEXTOS_CLIENTE = ['Hola, quiero hacer un pedido.', 'Tienen disponible en talla M?', 'Cuánto vale el envío?', 'Sí, confirmo mi dirección.', 'Cuánto demora en llegar?', 'Puedo pagar contra entrega?', 'Gracias!']
  const TEXTOS_AGENTE = ['Hola! Claro, con gusto te ayudo.', 'Sí, lo tenemos disponible.', 'El envío es gratis y pagas al recibir.', 'Listo, tu pedido quedó confirmado.', 'Llega entre 2 y 4 días hábiles.', 'Sí, pagas contra entrega.', 'Con gusto!']
  const lognormal = (mediana: number, sigma: number) => mediana * Math.exp(sigma * (azar() + azar() + azar() + azar() - 2) * 1.73)
  const mensajes: (typeof esquema.mensajesCliente.$inferInsert)[] = []
  let m = 0
  const conversacion = (clienteIdx: number, t0: number, respondida: boolean) => {
    const pares = 1 + Math.floor(azar() * 3)
    let t = t0
    for (let k = 0; k < pares; k++) {
      mensajes.push({ id: uuid(`${o.prefijo}m${m++}`), negocioId: negocio.id, clienteId: clientes[clienteIdx].id, rol: 'cliente', texto: TEXTOS_CLIENTE[Math.floor(azar() * TEXTOS_CLIENTE.length)], creado: new Date(t) })
      if (k === 0 && !respondida) return
      const lento = k === 0 && azar() < 0.1
      t += (lento ? lognormal(900, 0.8) : lognormal(k === 0 ? 25 : 12, 0.9)) * 1000
      if (t > ahora) return
      mensajes.push({ id: uuid(`${o.prefijo}m${m++}`), negocioId: negocio.id, clienteId: clientes[clienteIdx].id, rol: 'agente', texto: TEXTOS_AGENTE[Math.floor(azar() * TEXTOS_AGENTE.length)], creado: new Date(t) })
      t += lognormal(40, 0.7) * 1000
    }
  }
  for (const p of pedidos) conversacion(p._c, p._t - Math.floor(60e3 + azar() * 600e3), azar() > 0.04)
  for (let k = 0; k < Math.round(o.pedidos * 0.25); k++) conversacion(Math.floor(azar() * o.clientes), instante((1 - Math.sqrt(azar())) * o.dias), azar() > 0.2)
  for (const t of trozos(mensajes, 1000)) await db.insert(esquema.mensajesCliente).values(t)

  const nCasos = Math.round(o.pedidos * 0.07)
  const casos = Array.from({ length: nCasos }, (_, i) => {
    const p = pedidos[Math.floor(azar() * pedidos.length)]
    const creado = p._t + Math.floor(azar() * 3 * 86400000)
    const r = azar()
    const estado = creado > ahora - 86400000 * 2 ? (r < 0.5 ? 'abierto' : 'esperando_dueno') : r < 0.7 ? 'resuelto' : r < 0.85 ? 'abierto' : 'esperando_dueno'
    return {
      id: uuid(`${o.prefijo}k${i}`),
      negocioId: negocio.id,
      clienteId: p.clienteId,
      pedidoId: p.id,
      titulo: ['Cliente pregunta por su envío', 'Dirección incorrecta', 'Quiere cambiar la talla', 'Pide devolución', 'Paquete sin recibir'][i % 5],
      detalle: 'Detalle inventado',
      estado: estado as 'abierto' | 'esperando_dueno' | 'resuelto',
      creado: new Date(Math.min(creado, ahora - 1000)),
      resuelto: estado === 'resuelto' ? new Date(Math.min(creado + lognormal(5 * 3600, 0.9) * 1000, ahora - 500)) : null,
    }
  })
  for (const t of trozos(casos, 350)) await db.insert(esquema.casos).values(t)
  console.log(`${o.codigo} ${negocio.id}: ${productos.length} productos, ${clientes.length} Clientes, ${pedidos.length} pedidos, ${mensajes.length} mensajes, ${casos.length} Casos`)
  return negocio.id
}

await sembrar({ codigo: 'SQL10K', nombre: 'Tienda contra entrega A', pedidos: 10000, clientes: 2500, dias: 180, semilla: 11, prefijo: 'A', productos: 14 })
await sembrar({ codigo: 'SQL10KB', nombre: 'Tienda contra entrega B', pedidos: 800, clientes: 300, dias: 120, semilla: 29, prefijo: 'B', productos: 8 })
process.exit(0)
