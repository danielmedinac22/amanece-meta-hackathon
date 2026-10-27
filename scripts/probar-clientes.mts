/**
 * Prueba del Agente de clientes contra Café Ladera, sin mandar nada por WhatsApp:
 *  1. el agente en modo simulación, con tres mensajes seguidos;
 *  2. `recibirMensaje` de punta a punta con el envío simulado (ENVIO_SIMULADO=1, que se pone aquí);
 *  3. con `--pedido`, también un pedido y un Caso de verdad en la base, que al final quedan cancelado y resuelto.
 *
 *   pnpm tsx scripts/probar-clientes.mts [--pedido]
 */
import { config } from 'dotenv'
import { and, asc, desc, eq, gt, lt, ne } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })
// Antes de cargar nada: en esta prueba no sale ni un mensaje.
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { responderComoAgenteDeClientes } = await import('../src/agentes/clientes')
const { recibirMensaje, enviarAlCliente, ErrorDeEnvio } = await import('../src/negocio/whatsapp')
const { MODELO_ID } = await import('../src/lib/modelo')

const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
if (!ladera) throw new Error('Falta sembrar: pnpm tsx scripts/sembrar.mts')

console.log(`\n=== 1. Agente de clientes en simulación (${MODELO_ID}) ===`)
const historial: { rol: 'cliente' | 'agente'; texto: string }[] = []
const mensajes = [
  '¿Qué café tienen y cuánto cuesta?',
  'Quiero 2 bolsas del tueste medio en grano. Es para Medellín, Calle 10 # 40-20, casa 3',
  '¿Envían a Pasto y cuándo llega?',
]
for (const texto of mensajes) {
  const r = await responderComoAgenteDeClientes({ negocioId: ladera.id, clienteId: null, historial: [...historial], texto, modo: 'simulacion' })
  console.log(`\nCliente: ${texto}`)
  console.log(`Agente:  ${r.texto}`)
  console.log(`  herramientas: [${r.herramientas.join(', ')}] · ${r.ms} ms · tokens ${r.uso.inputTokens}/${r.uso.outputTokens}`)
  historial.push({ rol: 'cliente', texto }, { rol: 'agente', texto: r.texto })
}

console.log('\n=== 2. recibirMensaje de punta a punta (envío simulado) ===')
const telefono = '573000000001'
const base = `wamid.PRUEBA.${Date.now()}`

console.log('\n-- Con el código del Negocio en el texto')
await recibirMensaje({ wamid: `${base}.1`, telefono, nombre: 'Camila Rojas', texto: 'Hola Café Ladera (LADERA)' })

console.log('\n-- Sin código: usa la sesión')
await recibirMensaje({ wamid: `${base}.2`, telefono, nombre: 'Camila Rojas', texto: '¿Tienen café molido para greca?' })

console.log('\n-- El mismo wamid otra vez: no debe responder')
await recibirMensaje({ wamid: `${base}.2`, telefono, nombre: 'Camila Rojas', texto: '¿Tienen café molido para greca?' })

console.log('\n-- Un teléfono sin sesión ni código')
await recibirMensaje({ wamid: `${base}.3`, telefono: '573000000999', nombre: '', texto: 'Hola' })

const [camila] = await db
  .select()
  .from(esquema.clientes)
  .where(and(eq(esquema.clientes.negocioId, ladera.id), eq(esquema.clientes.telefono, telefono)))
const guardados = await db
  .select({ rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto, wamid: esquema.mensajesCliente.wamid })
  .from(esquema.mensajesCliente)
  .where(eq(esquema.mensajesCliente.clienteId, camila.id))
  .orderBy(asc(esquema.mensajesCliente.creado))
console.log('\nÚltimos mensajes guardados de Camila:')
for (const m of guardados.slice(-6)) console.log(`  [${m.rol}] ${m.texto.slice(0, 90).replace(/\n/g, ' ')}`)

console.log('\n-- enviarAlCliente fuera de la ventana de 24 horas')
const [viejo] = await db
  .select()
  .from(esquema.clientes)
  .where(and(eq(esquema.clientes.negocioId, ladera.id), lt(esquema.clientes.ultimoMensajeEntrante, new Date(Date.now() - 25 * 3600_000))))
  .limit(1)
try {
  await enviarAlCliente(viejo.id, 'Hola, esto no debe salir')
  console.log('ERROR: se envió fuera de la ventana')
} catch (error) {
  console.log(error instanceof ErrorDeEnvio ? `Rechazado (${error.codigo}): ${error.message}` : error)
}

if (process.argv.includes('--pedido')) {
  // Escribe de verdad en la base (pedido y Caso de Camila); al final los deja cancelado y resuelto.
  console.log('\n=== 3. Pedido y Caso reales en la base (envío simulado) ===')
  const pasos = [
    'Quiero el molino manual, para Bogotá, Carrera 15 # 85-30 apto 402',
    'Sí, confírmalo',
    '¿Cómo va mi último pedido?',
    'Quiero hablar con una persona, por favor',
  ]
  for (const [i, texto] of pasos.entries()) {
    console.log(`\nCliente: ${texto}`)
    await recibirMensaje({ wamid: `${base}.p${i}`, telefono, nombre: 'Camila Rojas', texto })
  }
  const pedidos = await db
    .select()
    .from(esquema.pedidos)
    .where(eq(esquema.pedidos.clienteId, camila.id))
    .orderBy(desc(esquema.pedidos.numero))
    .limit(2)
  console.log('\nPedidos de Camila (los 2 últimos):', pedidos.map((p) => ({ numero: p.numero, estado: p.estado, total: p.total, items: p.items.map((x) => `${x.cantidad} x ${x.nombre}`) })))
  const casos = await db.select().from(esquema.casos).where(and(eq(esquema.casos.clienteId, camila.id), ne(esquema.casos.estado, 'resuelto')))
  console.log('Casos sin resolver de Camila:', casos.map((c) => ({ titulo: c.titulo, estado: c.estado, pedidoId: c.pedidoId, propuesta: c.propuesta.slice(0, 120) })))
  // Se deja la base como estaba para los Indicadores.
  await db
    .update(esquema.pedidos)
    .set({ estado: 'cancelado' })
    .where(and(eq(esquema.pedidos.clienteId, camila.id), gt(esquema.pedidos.creado, new Date(Date.now() - 3600_000))))
  await db
    .update(esquema.casos)
    .set({ estado: 'resuelto', resolucion: 'Prueba del Agente de clientes', resuelto: new Date() })
    .where(and(eq(esquema.casos.clienteId, camila.id), ne(esquema.casos.estado, 'resuelto')))
}

process.exit(0)
