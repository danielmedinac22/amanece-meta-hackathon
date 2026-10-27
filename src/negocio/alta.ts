import { eq } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { guardarEnElHilo, mensajeDelAgente } from '@/negocio/dueno-hilo'

/** Lo mínimo que se necesita del usuario de la sesión para darlo de alta como Dueño. */
type Usuario = { id: string; name?: string | null; email?: string | null }

/** El nombre con el que nace un Negocio, hasta que el Dueño cuenta cómo se llama. */
export const NOMBRE_TEMPORAL = 'Mi negocio'

// Sin vocales ni letras que se confunden: el código viaja escrito en un mensaje de WhatsApp.
const LETRAS = 'BCDFGHJKLMNPQRSTVWXYZ'

function codigoAlAzar(largo = 5) {
  return Array.from({ length: largo }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join('')
}

async function codigoLibre() {
  for (let i = 0; i < 8; i++) {
    const codigo = codigoAlAzar(i < 5 ? 5 : 6)
    const [existe] = await db.select({ id: esquema.negocios.id }).from(esquema.negocios).where(eq(esquema.negocios.codigo, codigo))
    if (!existe) return codigo
  }
  throw new Error('No encontré un código libre para el Negocio')
}

async function buscarDueno(usuarioId: string) {
  const [fila] = await db
    .select({ dueno: esquema.duenos, negocio: esquema.negocios })
    .from(esquema.duenos)
    .innerJoin(esquema.negocios, eq(esquema.negocios.id, esquema.duenos.negocioId))
    .where(eq(esquema.duenos.usuarioId, usuarioId))
  return fila ?? null
}

export const SALUDO_INICIAL =
  '¡Hola! Soy tu Agente en Amanece. Voy a ayudarte a dejar tu negocio listo para que tus clientes te escriban por WhatsApp y los atienda sin que estés pendiente.\n\nPara empezar: ¿cómo se llama tu negocio y qué vendes?'

/**
 * Da de alta al usuario que entra por primera vez: crea su Negocio (`armando`, con nombre temporal y un
 * código corto), su fila de Dueño y el primer mensaje del Hilo. Si ya existe, devuelve el que tiene.
 */
export async function altaDeDueno(usuario: Usuario) {
  const existente = await buscarDueno(usuario.id)
  if (existente) return existente

  const negocioId = crypto.randomUUID()
  const duenoId = crypto.randomUUID()
  try {
    // En un solo lote: o quedan el Negocio y el Dueño, o ninguno.
    await db.batch([
      db.insert(esquema.negocios).values({ id: negocioId, nombre: NOMBRE_TEMPORAL, codigo: await codigoLibre() }),
      db.insert(esquema.duenos).values({ id: duenoId, negocioId, usuarioId: usuario.id, nombre: usuario.name ?? '', email: usuario.email ?? '' }),
    ])
  } catch (e) {
    // Dos pedidos a la vez del mismo usuario: gana el primero y el otro se queda con ese.
    const ganador = await buscarDueno(usuario.id)
    if (ganador) return ganador
    throw e
  }
  await guardarEnElHilo(negocioId, duenoId, 'agente', mensajeDelAgente(SALUDO_INICIAL))
  const creado = await buscarDueno(usuario.id)
  if (!creado) throw new Error('No pude dar de alta al Dueño')
  return creado
}
