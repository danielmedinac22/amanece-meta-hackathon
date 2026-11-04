/**
 * La agenda de verdad: una sesión de Clerk de desarrollo y un Negocio creado aquí, con citas que entran por el Agente de
 * clientes con guion. Afirma lo que pinta `/panel/agenda`, Inicio y el Tablero con filas reales, y que otro Negocio no se
 * cuela. Lo que crea lo borra al final, también el usuario. Necesita `ENVIO_SIMULADO=1 pnpm dev` corriendo y solo acepta
 * una llave `sk_test_`.
 *
 *   PANEL_URL=http://localhost:3461 pnpm tsx scripts/recorrer-agenda.mts /ruta/a/carpeta
 */
import { join } from 'node:path'
import { config } from 'dotenv'
import { inArray } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'
import { clerkConLlave } from './importar-cuentas.mjs'
import { abrirNavegador } from './navegador.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const LLAVE = process.env.CLERK_SECRET_KEY
if (!LLAVE?.startsWith('sk_test_')) throw new Error('recorrer-agenda solo corre con una llave de desarrollo de Clerk.')
const carpeta = process.argv[2]
if (!carpeta) throw new Error('Uso: recorrer-agenda.mts <carpeta de capturas>')
const base = process.env.PANEL_URL ?? 'http://localhost:3000'

const { db, esquema } = await import('../src/db')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { marcar } = await import('../src/nucleo/identidad')
const { enPalabras, fechaDeCalendario, instanteLocal } = await import('../src/nucleo/citas-palabras')
const { comoClave, comoMonto } = await import('../src/nucleo/estado/elementos')
type Motores = import('../src/nucleo/clientes/turno').Motores

const clerk = clerkConLlave(LLAVE)
const marca = String(Date.now()).slice(-8)
const email = `recorrido-agenda-${marca}+clerk_test@example.com`
const clave = `una-clave-larga-${marca}`
const ZONA = 'America/Bogota'
const creados: string[] = []

async function negocio(nombre: string, codigo: string, rubro: string) {
  const [n] = await db.insert(esquema.negocios).values({ nombre, codigo, rubro, zonaHoraria: ZONA, estado: 'listo', version: 1 }).returning()
  creados.push(n.id)
  await db.insert(esquema.elementos).values({ negocioId: n.id, clave: comoClave('producto:corte'), version: 1, tipo: 'producto', contrato: 1, contenido: { tipo: 'producto', nombre: 'Corte', descripcion: '', precio: comoMonto(30_000), activo: true }, origen: 'tablas_viejas', sinPublicar: false })
  return n
}

const conCita = (dias: number, hora: string): Motores => ({
  async responder({ puerto }) {
    await puerto.guardar_cita({ fecha: fechaDeCalendario(new Date(Date.now() + dias * 86_400_000), ZONA), hora, asunto: 'Corte y barba', cambiaLaQueTiene: false })
    return { texto: 'Gracias.', uso: { inputTokens: 0, outputTokens: 0 } }
  },
  async reescribir() {
    throw new Error('el guion no esperaba una corrección')
  },
})

let n = 0
const escribe = (telefono: string, nombre: string, motores: Motores, a: { id: string }) =>
  atenderMensaje({ wamid: marcar.wamid(`wamid.AGENDA.${marca}.${++n}`), telefono, nombre, texto: 'Quiero una cita', enviadoEn: marcar.instante(new Date()), boton: null, referido: 'ninguno' }, marcar.negocio(a.id), motores)

const agenda = await negocio(`Barbería Recorrido ${marca}`, `AGE${marca}`, 'barbería')
const ajena = await negocio(`Otra Barbería ${marca}`, `AJE${marca}`, 'barbería')
const usuario = (await clerk.pedir('/users', 'POST', { email_address: [email], password: clave, first_name: 'Recorrido' })) as { id: string }
await db.insert(esquema.duenos).values({ negocioId: agenda.id, usuarioId: usuario.id, nombre: 'Recorrido', email })
const nav = await abrirNavegador()

try {
  const sinSesion = await fetch(`${base}/panel/agenda`, { redirect: 'manual' })
  afirmar('Sin sesión, /panel/agenda no pinta nada', sinSesion.status >= 300 && sinSesion.status < 400 && (sinSesion.headers.get('location') ?? '').includes('/entrar'), { estado: sinSesion.status, a: sinSesion.headers.get('location') })

  const { token } = (await clerk.pedir('/testing_tokens', 'POST')) as { token: string }
  await nav.conTestingToken(token, atob(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, ''))
  await nav.ir(`${base}/entrar`)
  await nav.escribe('email', email)
  await nav.escribe('password', clave)
  await nav.clic('Entrar')
  await nav.hastaQue(`document.body.innerText.includes('Confirma que eres tú') || location.pathname.startsWith('/panel')`)
  if (await nav.ve('Confirma que eres tú', 500)) {
    await nav.escribe('codigo', '424242')
    await nav.clic('Entrar')
  }
  afirmar('Entra a su Negocio', await nav.ve(agenda.nombre, 90_000), await nav.ruta())
  await nav.ajustar(1440, 900, false)

  await nav.ir(`${base}/panel`)
  afirmar('Inicio sin citas no inventa cifras', await nav.ve('Todavía no te ha escrito nadie.', 60_000), (await nav.texto()).slice(0, 300))
  await nav.ir(`${base}/panel/agenda`)
  afirmar('Sidebar real: lleva Agenda', await nav.ve('Agenda', 60_000))
  afirmar('Agenda sin filas dice qué sigue', await nav.ve('Todavía no tienes citas.', 60_000), (await nav.texto()).slice(0, 300))

  await escribe(`57311${marca}`, 'Daniela Quintero', conCita(2, '10:00'), agenda)
  await escribe(`57312${marca}`, 'Julián Ramírez', conCita(3, '11:30'), agenda)
  await escribe(`57313${marca}`, 'Persona Ajena', conCita(2, '10:00'), ajena)

  await nav.ir(`${base}/panel/agenda`)
  const inicio = instanteLocal({ fecha: fechaDeCalendario(new Date(Date.now() + 2 * 86_400_000), ZONA), hora: '10:00' }, ZONA)!
  afirmar('Agenda: las filas reales con su estado', (await nav.ve('Daniela Quintero', 60_000)) && (await nav.ve('Julián Ramírez', 5000)) && (await nav.ve('Agendada', 5000)) && (await nav.ve('Corte y barba', 5000)), (await nav.texto()).slice(0, 400))
  afirmar('Agenda: la hora es la del Negocio', (await nav.texto()).includes('10:00 a. m.'), (await nav.texto()).slice(0, 400))
  afirmar('Agenda: la misma hora en otro Negocio no se cuela', !(await nav.texto()).includes('Persona Ajena'))
  await new Promise((r) => setTimeout(r, 1000))
  await nav.captura(join(carpeta, 'real-agenda-pc-claro.png'), 1440, 900, false)
  await nav.captura(join(carpeta, 'real-agenda-pc-oscuro.png'), 1440, 900, true)

  await nav.ir(`${base}/panel`)
  afirmar('Inicio: lo último dice la cita de la fila', await nav.ve(`Tu agente le agendó una cita a Daniela Quintero: ${enPalabras(inicio, ZONA)}`, 60_000), (await nav.texto()).slice(0, 500))
  afirmar('Inicio: no habla de ventas', !(await nav.texto()).includes('vendiste'))
  await nav.captura(join(carpeta, 'real-inicio-pc-claro.png'), 1440, 900, false)

  await nav.ir(`${base}/panel/tablero`)
  afirmar('Tablero: Citas de la semana y Próximas citas con filas reales', (await nav.ve('Citas de la semana', 60_000)) && (await nav.ve('Próximas citas', 5000)) && (await nav.ve('Daniela Quintero', 5000)), (await nav.texto()).slice(0, 400))
  afirmar('Tablero: no hay ventas ni pedidos que mostrar', !(await nav.texto()).includes('Ventas de la semana') && !(await nav.texto()).includes('Pedidos recientes'))
  await nav.captura(join(carpeta, 'real-tablero-pc-claro.png'), 1440, 900, false)

  await nav.ir(`${base}/panel/agenda`)
  await nav.ajustar(390, 844, true)
  await nav.clic('Tu negocio')
  afirmar('Teléfono: la Agenda real se ve en Tu negocio', await nav.ve('Daniela Quintero', 30_000), (await nav.texto()).slice(0, 300))
  await new Promise((r) => setTimeout(r, 600))
  await nav.captura(join(carpeta, 'real-agenda-telefono-claro.png'), 390, 844, false)
  await nav.captura(join(carpeta, 'real-agenda-telefono-oscuro.png'), 390, 844, true)
} catch (e) {
  afirmar('recorrer-agenda terminó sin lanzar', false, e)
} finally {
  nav.cerrar()
  await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
  await clerk.pedir(`/users/${usuario.id}`, 'DELETE').catch((e) => afirmar('recorrer-agenda borró su usuario', false, e))
  const sigue = await clerk.pedir(`/users/${usuario.id}`).then(() => true, () => false)
  afirmar(`Usuario de prueba creado y borrado: ${email}`, !sigue)
}
terminar()
