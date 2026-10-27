/**
 * Crea en la rama de medición un Negocio con ~10 mil pedidos y miles de mensajes, para ver qué pasa
 * cuando un Negocio crece. Todo es inventado. Idempotente por código de Negocio.
 */
import './entorno.mts'
import { createHash } from 'node:crypto'

const { db, esquema } = await import('../../src/db')
const { eq } = await import('drizzle-orm')

const PEDIDOS = Number(process.argv[2] ?? 10000)
const DIAS = 90
const CODIGO = 'SINTETICO'

const uuid = (s: string) => {
  const h = createHash('sha1').update(`medir:${s}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
let a = 7
const azar = () => {
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const trozos = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))

const [existe] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, CODIGO))
if (existe) {
  console.log('Ya existe', existe.id)
  process.exit(0)
}
const [negocio] = await db
  .insert(esquema.negocios)
  .values({ codigo: CODIGO, nombre: 'Negocio sintético', rubro: 'pruebas de volumen', estado: 'listo', conocimiento: { descripcion: 'Negocio inventado con mucho volumen.', ciudad: 'Bogotá', horario: 'Todos los días', envios: 'Todo el país', pagos: 'Contra entrega', tono: 'Cercano', preguntas: [] } })
  .returning()
const productos = Array.from({ length: 12 }, (_, i) => ({ id: uuid(`p${i}`), negocioId: negocio.id, nombre: `Producto ${i + 1}`, descripcion: '', precio: 10000 + i * 3500, activo: true }))
await db.insert(esquema.productos).values(productos)
const ciudades = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga', 'Pereira', 'Manizales', 'Pasto']
const clientes = Array.from({ length: 400 }, (_, i) => ({ id: uuid(`c${i}`), negocioId: negocio.id, telefono: `5731000${String(i).padStart(5, '0')}`, nombre: `Cliente ${i + 1}`, ultimoMensajeEntrante: new Date() }))
for (const t of trozos(clientes, 400)) await db.insert(esquema.clientes).values(t)

const ahora = Date.now()
const estados = ['pendiente', 'confirmado', 'enviado', 'entregado', 'novedad', 'cancelado'] as const
const pedidos = Array.from({ length: PEDIDOS }, (_, i) => {
  const cl = clientes[Math.floor(azar() * clientes.length)]
  const n = 1 + Math.floor(azar() * 3)
  const items = Array.from({ length: n }, () => {
    const p = productos[Math.floor(azar() * productos.length)]
    return { productoId: p.id, nombre: p.nombre, cantidad: 1 + Math.floor(azar() * 3), precio: p.precio }
  })
  const r = azar()
  return {
    id: uuid(`o${i}`),
    negocioId: negocio.id,
    clienteId: cl.id,
    numero: i + 1,
    items,
    total: items.reduce((s, x) => s + x.cantidad * x.precio, 0),
    ciudad: ciudades[Math.floor(azar() * ciudades.length)],
    direccion: `Calle ${Math.floor(azar() * 100)} # ${Math.floor(azar() * 100)}-${Math.floor(azar() * 100)}`,
    estado: r < 0.1 ? estados[0] : r < 0.35 ? estados[1] : r < 0.5 ? estados[2] : r < 0.85 ? estados[3] : r < 0.92 ? estados[4] : estados[5],
    creado: new Date(ahora - (i / PEDIDOS) * DIAS * 86400000),
  }
})
for (const t of trozos(pedidos, 500)) await db.insert(esquema.pedidos).values(t)
const mensajes = Array.from({ length: PEDIDOS + 2000 }, (_, i) => ({
  id: uuid(`m${i}`),
  negocioId: negocio.id,
  clienteId: clientes[i % clientes.length].id,
  rol: (i % 2 ? 'agente' : 'cliente') as 'agente' | 'cliente',
  texto: i % 2 ? 'Listo, tu pedido quedó confirmado.' : 'Hola, quiero hacer un pedido.',
  creado: new Date(ahora - (i / (PEDIDOS + 2000)) * DIAS * 86400000),
}))
for (const t of trozos(mensajes, 1000)) await db.insert(esquema.mensajesCliente).values(t)
const casos = Array.from({ length: 700 }, (_, i) => ({ id: uuid(`k${i}`), negocioId: negocio.id, clienteId: clientes[i % clientes.length].id, titulo: `Caso ${i + 1}`, detalle: 'Detalle inventado', estado: 'resuelto' as const, creado: new Date(ahora - (i / 700) * DIAS * 86400000), resuelto: new Date(ahora - (i / 700) * DIAS * 86400000 + 3600000) }))
for (const t of trozos(casos, 350)) await db.insert(esquema.casos).values(t)
console.log(`Negocio sintético ${negocio.id}: ${productos.length} productos, ${clientes.length} Clientes, ${pedidos.length} pedidos, ${mensajes.length} mensajes, ${casos.length} Casos`)
process.exit(0)
