/** Prueba viva de que con ENVIO_SIMULADO=1 `enviarAlCliente` no sale a la red (el fetch de entorno.mts bloquea cualquier host que no sea Meta AI o Neon). */
import { eventos } from './entorno.mts'
const { db, esquema } = await import('../../src/db')
const { eq } = await import('drizzle-orm')
const { enviarAlCliente } = await import('../../src/negocio/whatsapp')
const [A] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
const [c] = await db.insert(esquema.clientes).values({ negocioId: A.id, telefono: '570000000777', nombre: 'Cliente de la prueba de envío', ultimoMensajeEntrante: new Date() }).returning()
const antes = eventos.length
const r = await enviarAlCliente(c.id, 'Mensaje de prueba, no debe salir')
console.log('resultado:', JSON.stringify(r), '| llamadas de red durante el envío (solo Neon esperadas):', JSON.stringify([...new Set(eventos.slice(antes).map((e) => e.kind))]))
process.exit(0)
