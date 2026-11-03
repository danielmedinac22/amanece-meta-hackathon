/**
 * La puerta de sesión con Clerk de verdad: la instancia de desarrollo, un `next dev` propio y sesiones reales por HTTP y
 * en un navegador. Una sesión no llega al Negocio de otro, un correo sin verificar no se enlaza, un Dueño viejo no
 * termina en un Negocio vacío y sin sesión nada deja pasar. Solo corre con una llave `sk_test_`. Lo que crea, en Clerk y
 * en la base, lo borra al final, también si falla. Cierra antes tu `pnpm dev`: `next dev` toma un candado por carpeta.
 *
 *   pnpm tsx scripts/probar-sesion.mts
 *   pnpm tsx scripts/probar-sesion.mts --capturas=/ruta/a/carpeta
 *   pnpm tsx scripts/probar-sesion.mts --start     con `next build` y `next start`
 */
import { execSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { eq, inArray, like, sql } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'
import { clerkConLlave, CUENTAS_VIEJAS_SQL, decidir, digestDeClerk, DUENOS_SIN_CUENTA_SQL, importar, type CuentaVieja } from './importar-cuentas.mjs'
import { abrirNavegador } from './navegador.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const LLAVE = process.env.CLERK_SECRET_KEY
if (!LLAVE?.startsWith('sk_test_')) throw new Error('probar-sesion solo corre con una llave de desarrollo de Clerk.')

const { db, esquema } = await import('../src/db')
const { guardarEnElHilo, mensajeDelAgente } = await import('../src/negocio/dueno-hilo')
const carpetaDeCapturas = process.argv.find((a) => a.startsWith('--capturas='))?.split('=')[1]

const marca = String(Date.now()).slice(-9)
const CODIGO_DE_PRUEBA = '424242'
const CLAVE = `una-clave-larga-${marca}`
const correo = (quien: string) => `sesion-${quien}-${marca}+clerk_test@example.com`
const clerk = clerkConLlave(LLAVE)
const usuarios: string[] = []
const negocios: string[] = []
const filasDeNeon: string[] = []
let cuentaSinVerificar: { clerkId: string; email: string; negocio: string; duenoId: string; idViejo: string } | null = null

type UsuarioCreado = { id: string }

/** Como guarda una contraseña Better Auth, el motor de Neon Auth: `hashPassword` de `@better-auth/utils`. */
function hashDeBetterAuth(clave: string) {
  const sal = randomBytes(16).toString('hex')
  const llave = scryptSync(clave.normalize('NFKC'), sal, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 })
  return `${sal}:${llave.toString('hex')}`
}

async function crearUsuario(cuerpo: Record<string, unknown>) {
  const u = (await clerk.pedir('/users', 'POST', { skip_password_requirement: true, ...cuerpo })) as UsuarioCreado
  usuarios.push(u.id)
  return u.id
}

async function tokenDe(usuario: string) {
  const sesion = (await clerk.pedir('/sessions', 'POST', { user_id: usuario })) as { id: string }
  return ((await clerk.pedir(`/sessions/${sesion.id}/tokens`, 'POST', {})) as { jwt: string }).jwt
}

/** Un Negocio ya abierto y su Dueño de antes de Clerk, con una línea del Hilo que solo es suya. */
async function sembrar(quien: string, email = correo(quien)) {
  const [negocio] = await db.insert(esquema.negocios).values({ nombre: `Negocio ${quien} ${marca}`, codigo: `S${quien.slice(0, 2).toUpperCase()}${marca}`, estado: 'listo' }).returning()
  negocios.push(negocio.id)
  const idViejo = `viejo-${quien}-${marca}`
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: negocio.id, usuarioId: idViejo, nombre: `Dueño ${quien}`, email }).returning()
  const linea = `Línea privada de ${quien} ${marca}`
  await guardarEnElHilo(negocio.id, dueno.id, 'agente', mensajeDelAgente(linea))
  return { negocio, dueno, idViejo, email, linea }
}

const usuarioIdDe = async (duenoId: string) => (await db.select({ u: esquema.duenos.usuarioId }).from(esquema.duenos).where(eq(esquema.duenos.id, duenoId)))[0]?.u
const cuantosNegocios = () => db.$count(esquema.negocios)

const puerto = 3400 + Math.floor(Math.random() * 400)
const base = `http://localhost:${puerto}`
const conStart = process.argv.includes('--start')
if (conStart) execSync('pnpm exec next build', { stdio: 'pipe' })
const servidor = spawn('pnpm', ['exec', 'next', conStart ? 'start' : 'dev', '-p', String(puerto)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  env: { ...process.env, ENVIO_SIMULADO: '1', EQUIPO_DE_AMANECE: correo('equipo') + ',' + correo('equipo-sin') },
})
const salidaDelServidor: string[] = []
for (const flujo of [servidor.stdout, servidor.stderr]) flujo.on('data', (d: Buffer) => salidaDelServidor.push(String(d)))
const pararServidor = () => {
  try {
    process.kill(-servidor.pid!, 'SIGTERM')
  } catch {}
}

const ver = (ruta: string, token?: string, opciones: RequestInit = {}) =>
  fetch(`${base}${ruta}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000), ...opciones, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...opciones.headers } })

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(carpeta, e.name)) : [join(carpeta, e.name)]))
}

async function limpiar() {
  // Por el correo de la corrida, para borrar también lo que se creó en el navegador o quedó a medias.
  const deLaCorrida = (await clerk.pedir(`/users?query=${encodeURIComponent(marca)}&limit=100`)) as UsuarioCreado[]
  for (const id of new Set([...usuarios, ...deLaCorrida.map((u) => u.id)])) await clerk.pedir(`/users/${id}`, 'DELETE').catch(() => {})
  const nuevos = await db.select({ negocio: esquema.duenos.negocioId }).from(esquema.duenos).where(like(esquema.duenos.email, `sesion-%-${marca}+clerk_test@example.com`))
  const todos = [...new Set([...negocios, ...nuevos.map((d) => d.negocio)])]
  if (todos.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, todos))
  for (const id of filasDeNeon) {
    await db.execute(sql`delete from neon_auth.account where "userId" = ${id}::uuid`)
    await db.execute(sql`delete from neon_auth."user" where id = ${id}::uuid`)
  }
}

try {
  const limite = Date.now() + 180_000
  while (Date.now() < limite) {
    if (await fetch(`${base}/entrar`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) }).then((r) => r.status < 500, () => false)) break
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log('Lo que corre el proxy')
  const proxy = readFileSync('src/proxy.ts', 'utf8')
  const cubiertas = [...(proxy.match(/matcher: \[(.*)\]/)?.[1] ?? '').matchAll(/'(\/[^']+)'/g)].map((m) => m[1].replace('/:path*', ''))
  const conPuerta = archivos('src/app')
    .filter((f) => /(^|\/)(route|page|layout)\.tsx?$/.test(f))
    .filter((f) => /@\/negocio\/sesion|@\/lib\/equipo|from '\.\/leer'|panel\/leer'/.test(readFileSync(f, 'utf8')))
    .map((f) => f.replace(/^src\/app/, '').replace(/\/(route|page|layout)\.tsx?$/, ''))
  afirmar('Hay rutas que importan la puerta', conPuerta.length > 8, conPuerta)
  for (const ruta of conPuerta) afirmar(`${ruta} corre el proxy, porque auth() lanza fuera de él`, cubiertas.some((c) => ruta === c || ruta.startsWith(`${c}/`)), cubiertas)
  afirmar('El webhook de Kapso no corre el proxy', !cubiertas.some((c) => '/api/kapso/webhook'.startsWith(c)))

  console.log('Sin sesión')
  for (const ruta of ['/panel', '/panel/casos', '/panel/pedidos', '/panel/ajustes', '/medicion']) {
    const r = await ver(ruta)
    afirmar(`${ruta} manda a /entrar`, [302, 307].includes(r.status) && (r.headers.get('location') ?? '').endsWith('/entrar'), { estado: r.status, a: r.headers.get('location') })
  }
  const SIN_ID = '00000000-0000-4000-8000-000000000000'
  for (const [metodo, ruta] of [['GET', '/api/dueno/chat'], ['POST', '/api/dueno/chat'], ['POST', '/api/dueno/abrir'], ['POST', '/api/dueno/plantilla'], ['POST', '/api/publicar'], ['POST', `/api/propuestas/${SIN_ID}/aprobar`], ['POST', `/api/propuestas/${SIN_ID}/descartar`], ['POST', `/api/propuestas/${SIN_ID}/deshacer`]]) {
    const r = await ver(ruta, undefined, { method: metodo, body: metodo === 'POST' ? '{}' : undefined })
    afirmar(`${metodo} ${ruta} responde 401`, r.status === 401, r.status)
  }
  afirmar('La portada no pide sesión', (await ver('/')).status === 200)
  const webhook = await ver('/api/kapso/webhook', undefined, { method: 'POST', body: '{}' })
  afirmar('El webhook no se redirige al login', ![302, 307].includes(webhook.status), webhook.status)

  console.log('Una sesión no llega al Negocio de otro')
  const a = await sembrar('ana')
  const b = await sembrar('beto')
  const digest = digestDeClerk(hashDeBetterAuth(CLAVE))
  afirmar('El digest de Better Auth tiene la forma que Clerk recibe', digest?.startsWith('scrypt:16384:16:1$') === true)
  const claveDeAna = await crearUsuario({ email_address: [a.email], external_id: a.idViejo, password_digest: digest, password_hasher: 'scrypt_werkzeug', skip_password_requirement: false })
  const claveDeBeto = await crearUsuario({ email_address: [b.email], external_id: b.idViejo })
  const tokenDeAna = await tokenDe(claveDeAna)
  const tokenDeBeto = await tokenDe(claveDeBeto)
  const hiloDeAna = await (await ver('/api/dueno/chat', tokenDeAna)).text()
  afirmar('Ana ve su Hilo', hiloDeAna.includes(a.linea), hiloDeAna.slice(0, 200))
  afirmar('Ana no ve el de Beto', !hiloDeAna.includes(b.linea))
  afirmar('Ana quedó enlazada a su Dueño con el id de Clerk', (await usuarioIdDe(a.dueno.id)) === claveDeAna)
  afirmar('La fila de Beto sigue con su id viejo hasta que él entre', (await usuarioIdDe(b.dueno.id)) === b.idViejo)
  const conOtroNegocio = await (await ver(`/api/dueno/chat?negocio=${b.negocio.id}&negocioId=${b.negocio.id}`, tokenDeAna)).text()
  afirmar('Pedir el Negocio de Beto por parámetro no cambia nada', conOtroNegocio.includes(a.linea) && !conOtroNegocio.includes(b.linea))
  const panelDeAna = await (await ver('/panel', tokenDeAna)).text()
  afirmar('El Panel de Ana pinta su Negocio y no el de Beto', panelDeAna.includes(a.negocio.nombre) && !panelDeAna.includes(b.negocio.nombre))
  const hiloDeBeto = await (await ver('/api/dueno/chat', tokenDeBeto)).text()
  afirmar('Beto ve su Hilo y no el de Ana', hiloDeBeto.includes(b.linea) && !hiloDeBeto.includes(a.linea))

  const [propuestaDeBeto] = await db
    .insert(esquema.propuestas)
    .values({ negocioId: b.negocio.id, palabrasDelDueno: 'prueba de sesión', huella: `sesion-${marca}`, vence: new Date(Date.now() + 3_600_000), vistaPrevia: {} as never, pedidoPor: b.dueno.id })
    .returning()
  for (const accion of ['aprobar', 'descartar', 'deshacer']) {
    const r = await ver(`/api/propuestas/${propuestaDeBeto.id}/${accion}`, tokenDeAna, { method: 'POST', body: '{}' })
    const [fila] = await db.select({ estado: esquema.propuestas.estado }).from(esquema.propuestas).where(eq(esquema.propuestas.id, propuestaDeBeto.id))
    const respuesta = (await r.json()) as { tipo?: string }
    afirmar(`Ana no puede ${accion} la propuesta de Beto: para ella no existe`, r.status === 200 && respuesta.tipo === 'no_existe' && fila.estado === 'espera_al_dueno', { estado: r.status, respuesta, fila })
  }
  const deBeto = await ver(`/api/propuestas/${propuestaDeBeto.id}/descartar`, tokenDeBeto, { method: 'POST', body: '{}' })
  const [yaDescartada] = await db.select({ estado: esquema.propuestas.estado }).from(esquema.propuestas).where(eq(esquema.propuestas.id, propuestaDeBeto.id))
  afirmar('Control: Beto sí puede descartar la suya, con la misma ruta', deBeto.status === 200 && yaDescartada.estado !== 'espera_al_dueno', { estado: deBeto.status, yaDescartada })
  const r401 = await ver('/api/dueno/chat', `${tokenDeAna.slice(0, -2)}xx`)
  afirmar('Un token alterado responde 401', r401.status === 401, r401.status)

  console.log('Un correo sin verificar no se enlaza a ningún Dueño')
  const c = await sembrar('carla')
  const sinVerificar = await crearUsuario({ email_address: [c.email], email_address_identification_status: ['reserved'], external_id: c.idViejo })
  const tokenSinVerificar = await tokenDe(sinVerificar)
  const antes = await cuantosNegocios()
  const hiloSinVerificar = await ver('/api/dueno/chat', tokenSinVerificar)
  afirmar('Responde 409 y no el Hilo', hiloSinVerificar.status === 409, hiloSinVerificar.status)
  afirmar('La fila no se tocó', (await usuarioIdDe(c.dueno.id)) === c.idViejo)
  afirmar('No nació un Negocio', (await cuantosNegocios()) === antes)
  const panelEnEspera = await (await ver('/panel', tokenSinVerificar)).text()
  afirmar('El Panel pinta la espera, sin el Negocio', panelEnEspera.includes('Confirma tu correo') && !panelEnEspera.includes(c.negocio.nombre))
  const publicarSinVerificar = await ver('/api/publicar', tokenSinVerificar, { method: 'POST', body: '{}' })
  afirmar('Tampoco actúa: para las rutas del Negocio no hay Dueño', publicarSinVerificar.status === 401, publicarSinVerificar.status)

  console.log('Un Dueño viejo que se registra antes de importar no termina en un Negocio vacío')
  const d = await sembrar('dora')
  const dora = await crearUsuario({ email_address: [d.email] })
  const tokenDeDora = await tokenDe(dora)
  const antesDeDora = await cuantosNegocios()
  const doraEspera = await ver('/api/dueno/chat', tokenDeDora)
  afirmar('Espera con 409', doraEspera.status === 409, doraEspera.status)
  afirmar('No nació un Negocio y su fila sigue igual', (await cuantosNegocios()) === antesDeDora && (await usuarioIdDe(d.dueno.id)) === d.idViejo)
  const cuentaDeDora: CuentaVieja = { id: d.idViejo, nombre: 'Dora', email: d.email, verificado: true, contrasena: null, correoDelDueno: d.email }
  const importada = await importar([cuentaDeDora], clerk, { deVerdad: true })
  afirmar('El importador le pone el id viejo a su cuenta de Clerk', importada.poner_id_viejo.length === 1, importada)
  const hiloDeDora = await (await ver('/api/dueno/chat', tokenDeDora)).text()
  afirmar('Y al siguiente sondeo llega a su Negocio', hiloDeDora.includes(d.linea) && (await usuarioIdDe(d.dueno.id)) === dora)

  console.log('Quien es nuevo')
  const nuevo = await crearUsuario({ email_address: [correo('nuevo')], first_name: 'Nueva' })
  const tokenNuevo = await tokenDe(nuevo)
  const antesDelNuevo = await cuantosNegocios()
  const [uno, dos] = await Promise.all([ver('/api/dueno/chat', tokenNuevo), ver('/api/dueno/chat', tokenNuevo)])
  afirmar('Recibe su Negocio', uno.ok && dos.ok, [uno.status, dos.status])
  afirmar('Solo uno, aunque pida dos veces a la vez', (await cuantosNegocios()) === antesDelNuevo + 1)
  const [filaNueva] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.usuarioId, nuevo))
  afirmar('Con su nombre y su correo de Clerk', filaNueva?.nombre === 'Nueva' && filaNueva?.email === correo('nuevo'), filaNueva)

  console.log('Veinte sondeos a la vez de un Dueño recién importado')
  const e = await sembrar('elsa')
  const elsa = await crearUsuario({ email_address: [e.email], external_id: e.idViejo })
  const tokenDeElsa = await tokenDe(elsa)
  const antesDeElsa = await cuantosNegocios()
  const veinte = await Promise.all(Array.from({ length: 20 }, () => ver('/api/dueno/chat', tokenDeElsa).then(async (r) => ({ ok: r.ok, texto: await r.text() }))))
  afirmar('Todos llegan a su Hilo', veinte.every((r) => r.ok && r.texto.includes(e.linea)), veinte.filter((r) => !r.ok).length)
  afirmar('Un Dueño y ningún Negocio nuevo', (await cuantosNegocios()) === antesDeElsa && (await usuarioIdDe(e.dueno.id)) === elsa)

  console.log('esDelEquipo falla cerrada')
  afirmar('Sin estar en la lista, /medicion da 404', (await ver('/medicion', tokenDeAna)).status === 404)
  const delEquipo = await crearUsuario({ email_address: [correo('equipo')] })
  afirmar('Con correo verificado en la lista entra', (await ver('/medicion', await tokenDe(delEquipo))).status === 200)
  const delEquipoSin = await crearUsuario({ email_address: [correo('equipo-sin')], email_address_identification_status: ['reserved'] })
  afirmar('En la lista pero sin verificar, 404', (await ver('/medicion', await tokenDe(delEquipoSin))).status === 404)

  console.log('El importador')
  const hashDeLaPrueba = hashDeBetterAuth(CLAVE)
  const viejas: CuentaVieja[] = [
    { id: `vieja-con-${marca}`, nombre: 'Con Clave', email: correo('vieja-con'), verificado: true, contrasena: hashDeLaPrueba, correoDelDueno: correo('vieja-con') },
    { id: `vieja-google-${marca}`, nombre: null, email: correo('vieja-google'), verificado: true, contrasena: null, correoDelDueno: null },
    { id: `vieja-rara-${marca}`, nombre: null, email: correo('vieja-rara'), verificado: true, contrasena: '$2b$10$otra-forma', correoDelDueno: correo('otro-correo') },
    { id: `vieja-sin-${marca}`, nombre: null, email: correo('vieja-sin'), verificado: false, contrasena: hashDeLaPrueba, correoDelDueno: null },
  ]
  const simulada = await importar(viejas, clerk, { deVerdad: false })
  afirmar('Sin --de-verdad no escribe en Clerk', simulada.crear.length === 3 && (await clerk.porCorreo(viejas[0].email)) === null, simulada)
  const primera = await importar(viejas, clerk, { deVerdad: true })
  afirmar('Crea las verificadas y omite la otra', primera.crear.length === 3 && primera.omitir_sin_verificar.length === 1, primera)
  afirmar('Avisa de la contraseña que no puede pasar y del correo distinto', primera.sinDigest.length === 2 && primera.correoDistintoDelDueno.length === 1, primera)
  for (const v of viejas) {
    const u = await clerk.porCorreo(v.email)
    if (u) usuarios.push(u.id)
  }
  afirmar('La sin verificar no llegó a Clerk', (await clerk.porCorreo(viejas[3].email)) === null)
  const segunda = await importar(viejas, clerk, { deVerdad: true })
  afirmar('La segunda corrida no cambia nada', segunda.ya_estaba.length === 3 && segunda.crear.length === 0 && segunda.omitir_sin_verificar.length === 1, segunda)
  const conClave = await clerk.porIdViejo(viejas[0].id, viejas[0].email)
  const verifica = (await clerk.pedir(`/users/${conClave?.id}/verify_password`, 'POST', { password: CLAVE })) as { verified: boolean }
  afirmar('La contraseña vieja sirve en Clerk', verifica.verified === true)
  afirmar('Una cuenta de Clerk con otro id viejo choca', decidir(viejas[1], null, { id: 'u', idViejo: 'otro', correoVerificado: true, tieneDueno: false }).accion === 'choca')
  afirmar('Un correo sin verificar en Clerk choca', decidir(viejas[1], null, { id: 'u', idViejo: null, correoVerificado: false, tieneDueno: false }).accion === 'choca')
  afirmar('Una cuenta de Clerk que ya tiene su Negocio choca, y no deja huérfano el de antes', decidir(viejas[1], null, { id: 'u', idViejo: null, correoVerificado: true, tieneDueno: true }).accion === 'choca')
  afirmar('Sin verificar y con la bandera, se crea por confirmar', (() => { const d = decidir(viejas[3], null, null, true); return d.accion === 'crear' && d.confirmaAlEntrar })())

  console.log('La lectura de cuentas viejas, con filas de verdad en neon_auth')
  const idDeNeon = randomUUID()
  await db.execute(sql`insert into neon_auth."user" (id, name, email, "emailVerified") values (${idDeNeon}::uuid, ${'Fila Vieja'}, ${correo('fila-vieja')}, ${false})`)
  await db.execute(sql`insert into neon_auth.account (id, "accountId", "providerId", "userId", password, "updatedAt") values (${randomUUID()}::uuid, ${idDeNeon}, ${'credential'}, ${idDeNeon}::uuid, ${hashDeLaPrueba}, now())`)
  filasDeNeon.push(idDeNeon)
  const f = await sembrar('fila', correo('fila-vieja'))
  await db.update(esquema.duenos).set({ usuarioId: idDeNeon }).where(eq(esquema.duenos.id, f.dueno.id))
  const huerfano = await sembrar('huerfano')
  const filas = (await db.execute(sql.raw(CUENTAS_VIEJAS_SQL))).rows as CuentaVieja[]
  const leida = filas.find((x) => x.id === idDeNeon)
  afirmar('Lee la cuenta, su contraseña y el correo de su Dueño', leida?.verificado === false && digestDeClerk(leida.contrasena) !== null && leida.correoDelDueno === correo('fila-vieja'), leida)
  const sinCuenta = (await db.execute(sql.raw(DUENOS_SIN_CUENTA_SQL))).rows as { id: string }[]
  afirmar('Reporta al Dueño que no tiene cuenta vieja', sinCuenta.some((x) => x.id === huerfano.dueno.id) && !sinCuenta.some((x) => x.id === f.dueno.id), sinCuenta.length)
  if (leida) {
    const sinBandera = await importar([leida], clerk, { deVerdad: true })
    afirmar('Sin la bandera, la cuenta sin verificar se queda afuera', sinBandera.omitir_sin_verificar.length === 1 && (await clerk.porCorreo(leida.email)) === null, sinBandera)
    const conBandera = await importar([leida], clerk, { deVerdad: true, conSinVerificar: true })
    afirmar('Con la bandera se crea con el correo por confirmar', conBandera.crear.length === 1, conBandera)
    const importadaSinVerificar = await clerk.porIdViejo(leida.id, leida.email)
    afirmar('Y en Clerk el correo sigue sin verificar', importadaSinVerificar?.correoVerificado === false, importadaSinVerificar)
    if (importadaSinVerificar) cuentaSinVerificar = { clerkId: importadaSinVerificar.id, email: leida.email, negocio: f.negocio.nombre, duenoId: f.dueno.id, idViejo: idDeNeon }
  }

  console.log('En un navegador')
  const nav = await abrirNavegador()
  // La protección de Clerk reta a un Chrome automatizado aunque el correo sea `+clerk_test`.
  const { token: testingToken } = (await clerk.pedir('/testing_tokens', 'POST')) as { token: string }
  const dominio = atob(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, '')
  await nav.conTestingToken(testingToken, dominio)
  await nav.ajustar(1440, 900, false)
  const capturar = async (nombre: string) => {
    if (!carpetaDeCapturas) return
    await nav.captura(join(carpetaDeCapturas, `${nombre}-pc-claro.png`), 1440, 900, false)
    await nav.captura(join(carpetaDeCapturas, `${nombre}-pc-oscuro.png`), 1440, 900, true)
    await nav.captura(join(carpetaDeCapturas, `${nombre}-tel-claro.png`), 390, 844, false)
    await nav.captura(join(carpetaDeCapturas, `${nombre}-tel-oscuro.png`), 390, 844, true)
    await nav.ajustar(1440, 900, false)
  }
  try {
    const palabras = `Vendo café de Manizales ${marca}`
    const correoNuevo = correo('registro')
    await nav.ir(`${base}/`)
    await nav.hastaQue(`Boolean(document.querySelector('textarea'))`)
    await nav.evalua(`(() => { const t = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(palabras)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await nav.clic('Entrar')
    afirmar('De Alba a /entrar, con lo escrito a la vista', await nav.ve(palabras), await nav.ruta())
    afirmar('Abre en registro', await nav.ve('Crear cuenta'))
    await capturar('entrar-registro')
    await nav.escribe('nombre', 'Lucía Prueba')
    await nav.escribe('email', a.email)
    await nav.escribe('password', CLAVE)
    await nav.clic('Crear cuenta')
    afirmar('El correo de una cuenta que ya existe lo dice y no crea otra', await nav.ve('Ese correo ya tiene cuenta.'), await nav.texto())
    await nav.escribe('nombre', 'Lucía Prueba')
    await nav.escribe('email', correoNuevo)
    await nav.escribe('password', 'corta')
    await nav.evalua(`document.querySelector('form').noValidate = true`)
    await nav.clic('Crear cuenta')
    afirmar('Una contraseña corta lo dice en nuestras palabras', await nav.ve('Esa contraseña es muy corta.'), await nav.texto())
    await nav.escribe('password', CLAVE)
    await nav.clic('Crear cuenta')
    afirmar('Pide el código del correo', await nav.ve('Confirma tu correo'), await nav.texto())
    await capturar('entrar-codigo')
    await nav.escribe('codigo', '000000')
    await nav.clic('Confirmar')
    afirmar('Un código equivocado lo dice', await nav.ve('Ese código no coincide.'), await nav.texto())
    await nav.escribe('codigo', CODIGO_DE_PRUEBA)
    await nav.clic('Confirmar')
    afirmar('Con el código llega a /panel', await nav.hastaQue(`location.pathname.startsWith('/panel')`), await nav.ruta())
    const hastaElTexto = await nav.ve(palabras, 120_000)
    afirmar('Lo que escribió en Alba sigue en el armado', hastaElTexto, (await nav.texto()).slice(0, 300))
    const [filaDelRegistro] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.email, correoNuevo))
    afirmar('Nació su Dueño', Boolean(filaDelRegistro) && filaDelRegistro.nombre === 'Lucía Prueba', filaDelRegistro)
    const claveDelRegistro = filaDelRegistro?.usuarioId
    if (claveDelRegistro) usuarios.push(claveDelRegistro)
    const llegoElMensaje = async () => {
      if (!filaDelRegistro) return 0
      const filas = await db.select({ rol: esquema.mensajesDueno.rol, mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.negocioId, filaDelRegistro.negocioId))
      return filas.filter((m) => m.rol === 'dueno' && JSON.stringify(m.mensaje).includes(palabras)).length
    }
    let llego = 0
    for (let i = 0; i < 60 && !llego; i++) {
      llego = Number(await llegoElMensaje())
      if (!llego) await new Promise((r) => setTimeout(r, 1000))
    }
    await new Promise((r) => setTimeout(r, 3000))
    afirmar('El texto llegó una sola vez al Hilo como mensaje del Dueño', Number(await llegoElMensaje()) === 1, await llegoElMensaje())
    afirmar('Ya no queda guardado en el navegador', await nav.hastaQue(`!Object.values(localStorage).some((v) => String(v).includes(${JSON.stringify(palabras)}))`, 60_000))
    await capturar('armado')

    await nav.ir(`${base}/entrar`)
    afirmar('Con sesión, /entrar lleva a /panel', await nav.hastaQue(`location.pathname.startsWith('/panel')`), await nav.ruta())
    afirmar('El Panel tiene a Clerk para renovar el token', await nav.hastaQue(`window.Clerk?.loaded === true`))
    await nav.evalua(`window.Clerk.signOut({ redirectUrl: '/entrar' })`)
    afirmar('Salió del armado', await nav.hastaQue(`location.pathname === '/entrar'`), await nav.ruta())

    await nav.escribe('email', a.email)
    await nav.escribe('password', 'una-clave-equivocada-aqui')
    await nav.clic('Entrar')
    afirmar('Una contraseña equivocada lo dice en nuestras palabras', await nav.ve('El correo o la contraseña no coinciden.'), await nav.texto())
    await nav.escribe('email', a.email)
    await nav.escribe('password', CLAVE)
    await nav.clic('Entrar')
    const pidioCodigo = await nav.hastaQue(`document.body.innerText.includes('Confirma que eres tú') || location.pathname.startsWith('/panel')`)
    afirmar('La contraseña vieja entra', pidioCodigo, await nav.texto())
    if (await nav.ve('Confirma que eres tú', 1000)) {
      await capturar('entrar-dispositivo')
      await nav.escribe('codigo', CODIGO_DE_PRUEBA)
      await nav.clic('Entrar')
    }
    afirmar('Ana llega a su Negocio', await nav.ve(a.negocio.nombre, 90_000), (await nav.texto()).slice(0, 300))
    const paginaDeAna = await nav.texto()
    afirmar('Y no al de Beto', !paginaDeAna.includes(b.negocio.nombre))

    await new Promise((r) => setTimeout(r, 75_000))
    const sondeo = await nav.evalua<number>(`fetch('/api/dueno/chat').then((r) => r.status)`)
    afirmar('Pasado el minuto que dura el token, el sondeo sigue respondiendo', sondeo === 200, sondeo)

    await nav.clic(`Tu cuenta: Dueño ana`)
    await nav.clic('Cerrar sesión')
    afirmar('Cerrar sesión lleva a /entrar', await nav.hastaQue(`location.pathname === '/entrar'`), await nav.ruta())
    await nav.atras()
    afirmar('Volver atrás no muestra el Panel', await nav.hastaQue(`location.pathname === '/entrar' && !document.body.innerText.includes(${JSON.stringify(a.negocio.nombre)})`, 30_000), await nav.ruta())
    await nav.ir(`${base}/panel`)
    afirmar('/panel ya no deja pasar', await nav.hastaQue(`location.pathname === '/entrar'`), await nav.ruta())

    if (cuentaSinVerificar) {
      const c = cuentaSinVerificar
      await nav.ir(`${base}/entrar`)
      await nav.escribe('email', c.email)
      await nav.escribe('password', CLAVE)
      await nav.clic('Entrar')
      afirmar('Una cuenta sin verificar entra con su contraseña y pide confirmar el correo', await nav.ve('Confirma tu correo', 60_000), await nav.texto())
      afirmar('Sin confirmar no llega a su Negocio', !(await nav.texto()).includes(c.negocio) && (await usuarioIdDe(c.duenoId)) === c.idViejo)
      await capturar('cuenta-por-confirmar')
      await nav.clic('Mandarme el código')
      afirmar('Le manda el código', await nav.ve('Escríbelo aquí'), await nav.texto())
      await nav.escribe('codigo', CODIGO_DE_PRUEBA)
      await nav.clic('Confirmar')
      afirmar('Con el código llega a su Negocio', await nav.ve(c.negocio, 90_000), (await nav.texto()).slice(0, 300))
      afirmar('Y su fila pasó al id de Clerk', (await usuarioIdDe(c.duenoId)) === c.clerkId)

      await nav.ir(`${base}/`)
      await nav.hastaQue(`Boolean(document.querySelector('textarea'))`)
      await nav.evalua(`(() => { for (const c of document.cookie.split(';')) { const n = c.split('=')[0].trim(); if (n.startsWith('__session')) document.cookie = n + '=; Max-Age=0; path=/' } return true })()`)
      await nav.clic('Entrar')
      afirmar('Con la sesión viva y el token vencido, Entrar en Alba vuelve a su Negocio', await nav.ve(c.negocio, 90_000), await nav.ruta())
      await nav.hastaQue(`window.Clerk?.loaded === true`)
      await nav.evalua(`window.Clerk.signOut({ redirectUrl: '/entrar' })`)
      await nav.hastaQue(`location.pathname === '/entrar'`)
    }

    await nav.clic('Seguir con Google')
    afirmar('Seguir con Google lleva a Google', await nav.hastaQue(`location.hostname === 'accounts.google.com'`), await nav.evalua('location.hostname'))
    await nav.ir(`${base}/entrar`)
    await nav.clic('¿Olvidaste tu contraseña?')
    afirmar('Pide el correo para recuperar', await nav.ve('Mandarme el código'), await nav.texto())
    await capturar('entrar-olvido')
    await nav.escribe('email', correo('no-existe'))
    await nav.clic('Mandarme el código')
    afirmar('Un correo sin cuenta lo dice', await nav.ve('No encontré una cuenta con ese correo.'), await nav.texto())
    await nav.escribe('email', a.email)
    await nav.clic('Mandarme el código')
    afirmar('Manda el código', await nav.ve('Con él creas una contraseña nueva.'), await nav.texto())
    await nav.escribe('codigo', CODIGO_DE_PRUEBA)
    await nav.clic('Seguir')
    afirmar('Pide la contraseña nueva', await nav.ve('Crea tu contraseña nueva'), await nav.texto())
    await capturar('entrar-contrasena-nueva')
    const claveNueva = `otra-clave-larga-${marca}`
    await nav.escribe('password', claveNueva)
    await nav.clic('Guardar y entrar')
    afirmar('Recuperar la contraseña vuelve al mismo Negocio', await nav.ve(a.negocio.nombre, 90_000), (await nav.texto()).slice(0, 300))
    afirmar('Sigue siendo el mismo Dueño', (await usuarioIdDe(a.dueno.id)) === claveDeAna)

  } finally {
    nav.cerrar()
  }
} catch (e) {
  afirmar('probar-sesion terminó sin lanzar', false, e)
  console.log(salidaDelServidor.join('').slice(-1500))
} finally {
  pararServidor()
  await limpiar().catch((e) => afirmar('probar-sesion borró lo que creó', false, e))
}
terminar()
