/**
 * `leer_enlace` sin abrir la red interna: la tabla de direcciones, un servidor local que no debe recibir ninguna
 * conexión, los saltos, los esquemas y los topes de bytes y de tiempo. Sin base ni modelo.
 *
 *   pnpm tsx scripts/probar-leer-enlace.mts
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afirmar, terminar } from './afirmar.mjs'

const { aTexto, crearLector, direccionPermitida, enlaceDe, LARGO_DEL_HTML, leerCuerpo, lectorDeGuion, LECTOR_DE_INTERNET, TOPES } = await import('../src/lib/leer-enlace')
type Respuesta = import('../src/lib/leer-enlace').Respuesta

let conexiones = 0
const servidor = createServer((_, res) => res.end('<html><title>interna</title>secreto</html>'))
servidor.on('connection', () => conexiones++)
await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
const puerto = (servidor.address() as AddressInfo).port

let destruidos = 0
const cuerpoDe = (partes: AsyncIterable<Uint8Array>) => Object.assign(partes, { destroy: () => destruidos++ })
const vacio = () => cuerpoDe((async function* () {})())

const PRUEBAS_DE_DIRECCION = {
  prohibidas: [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '255.255.255.255', '192.88.99.1',
    '::', '::1', '::a00:1', 'fc00::1', 'fd12::1', 'fe80::1', 'fec0::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:127.0.0.1',
    '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '64:ff9b::a00:1', '64:ff9b:1::a00:1', 'no-es-ip',
  ],
  permitidas: ['8.8.8.8', '190.24.130.10', '172.32.0.1', '2800:3f0:4005:400::200e', '2001:4860:4860::8888'],
}

try {
  console.log('\n=== direccionPermitida ===')
  const malPermitidas = PRUEBAS_DE_DIRECCION.prohibidas.filter((ip) => direccionPermitida(ip))
  afirmar('direccionPermitida: rechaza loopback, privadas, CGNAT, metadatos, 6to4, Teredo, NAT64, fec0::/10, ::/96 y la IPv4 envuelta en IPv6', malPermitidas.length === 0, malPermitidas)
  const malProhibidas = PRUEBAS_DE_DIRECCION.permitidas.filter((ip) => !direccionPermitida(ip))
  afirmar('direccionPermitida: acepta IPs públicas', malProhibidas.length === 0, malProhibidas)

  console.log('\n=== La red interna no se toca ===')
  const lector = crearLector('cualquiera')
  const directo = await lector(`http://127.0.0.1:${puerto}/`)
  afirmar('http://127.0.0.1:<puerto> vuelve no_permitida', directo.tipo === 'no_permitida', directo)
  const ipv6 = await lector(`http://[::1]:${puerto}/`)
  afirmar('http://[::1]:<puerto> vuelve no_permitida', ipv6.tipo === 'no_permitida', ipv6)
  const porNombre = await lector(`http://localtest.me:${puerto}/`)
  afirmar('localtest.me, un nombre público que resuelve a 127.0.0.1, vuelve no_permitida', porNombre.tipo === 'no_permitida' && porNombre.porQue === 'direccion_privada', porNombre)
  afirmar('el servidor local no recibió ninguna conexión', conexiones === 0, conexiones)
  const otroPuerto = await LECTOR_DE_INTERNET('http://example.com:8080/')
  afirmar('el lector de producción solo pide a los puertos 80 y 443', otroPuerto.tipo === 'no_permitida' && otroPuerto.porQue === 'puerto', otroPuerto)

  console.log('\n=== Cada salto se revisa de nuevo ===')
  const pedidas: string[] = []
  const conSalto = crearLector('cualquiera', async (url: URL): Promise<Respuesta> => {
    pedidas.push(url.toString())
    return { status: 302, ubicacion: 'http://169.254.169.254/latest/meta-data/', contentType: '', cuerpo: vacio() }
  })
  const salto = await conSalto('https://cafeladera.co/')
  afirmar('una redirección a 169.254.169.254 vuelve no_permitida sin pedirla', salto.tipo === 'no_permitida' && JSON.stringify(pedidas) === JSON.stringify(['https://cafeladera.co/']), { salto, pedidas })
  let vueltas = 0
  const enCirculo = crearLector('cualquiera', async (url: URL): Promise<Respuesta> => {
    vueltas++
    return { status: 301, ubicacion: `${url.origin}/otra-${vueltas}`, contentType: '', cuerpo: vacio() }
  })
  const circulo = await enCirculo('https://cafeladera.co/')
  afirmar(`más de ${TOPES.saltos} saltos: demasiados_saltos`, circulo.tipo === 'no_permitida' && circulo.porQue === 'demasiados_saltos' && vueltas === TOPES.saltos + 1, { circulo, vueltas })

  console.log('\n=== Nada se escapa del lector ===')
  const malSalto = await crearLector('cualquiera', async () => ({ status: 302, ubicacion: 'http://[mal', contentType: '', cuerpo: vacio() }))('https://cafeladera.co/')
  afirmar('un Location que no es URL vuelve respuesta, sin lanzar', malSalto.tipo === 'respuesta', malSalto)
  const roto = cuerpoDe(
    (async function* () {
      yield new Uint8Array(10)
      throw new Error('ECONNRESET')
    })(),
  )
  const cortado = await crearLector('cualquiera', async () => ({ status: 200, ubicacion: null, contentType: 'text/html', cuerpo: roto }))('https://cafeladera.co/')
  afirmar('un cuerpo que se corta a la mitad vuelve no_conecta, sin lanzar', cortado.tipo === 'no_conecta', cortado)
  destruidos = 0
  await crearLector('cualquiera', async () => ({ status: 404, ubicacion: null, contentType: 'text/html', cuerpo: vacio() }))('https://cafeladera.co/')
  await crearLector('cualquiera', async () => ({ status: 200, ubicacion: null, contentType: 'image/png', cuerpo: vacio() }))('https://cafeladera.co/')
  afirmar('el cuerpo que no se lee se destruye', destruidos === 2, destruidos)

  console.log('\n=== Lo que escribe el Dueño ===')
  const enlaces = { '@cafeladera': 'https://www.instagram.com/cafeladera', '@cafe.ladera': 'https://www.instagram.com/cafe.ladera', cafeladera: 'https://www.instagram.com/cafeladera', 'cafeladera.co': 'https://cafeladera.co', 'https://cafeladera.co/carta': 'https://cafeladera.co/carta', 'instagram.com/cafeladera': 'https://instagram.com/cafeladera' }
  const malEnlaces = Object.entries(enlaces).filter(([escrito, url]) => enlaceDe(escrito) !== url)
  afirmar('enlaceDe: @usuario es su Instagram y un dominio sin esquema va por https', malEnlaces.length === 0, malEnlaces.map(([e]) => [e, enlaceDe(e)]))
  const noEnlace = enlaceDe('mi página de café')
  afirmar('enlaceDe: algo con espacios y sin dominio es no_parece_enlace', typeof noEnlace !== 'string' && noEnlace.tipo === 'no_parece_enlace', noEnlace)

  console.log('\n=== Esquemas y credenciales ===')
  for (const url of ['file:///etc/passwd', 'ftp://cafeladera.co/precios.txt', 'http://usuario:clave@cafeladera.co/', 'javascript:alert(1)', 'no es una url']) {
    const r = await lector(url)
    afirmar(`${url}: no_permitida`, r.tipo === 'no_permitida', r)
  }

  console.log('\n=== Topes de bytes y de tiempo ===')
  const grande = cuerpoDe(
    (async function* () {
      for (let i = 0; i < 32; i++) yield new Uint8Array(64 * 1024)
    })(),
  )
  const dosMegas = await leerCuerpo(grande, TOPES.bytes, AbortSignal.timeout(5000))
  afirmar('un cuerpo de 2 MB se corta: muy_grande', typeof dosMegas !== 'string' && dosMegas.tipo === 'muy_grande', dosMegas)
  const inicio = Date.now()
  const sinFin = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
  const colgado = await leerCuerpo(sinFin as unknown as AsyncIterable<Uint8Array>, TOPES.bytes, AbortSignal.timeout(300))
  afirmar('un cuerpo que no termina vuelve tiempo con el reloj', typeof colgado !== 'string' && colgado.tipo === 'tiempo' && Date.now() - inicio < 2000, { colgado, ms: Date.now() - inicio })

  console.log('\n=== Lo leído es texto ===')
  const { titulo, texto } = aTexto(
    '<html><head><title>Café Ladera &amp; Co</title><meta property="og:description" content="Café de Manizales"><script>robar()</script><style>.x{}</style></head><body><p>Latte · $8.000</p><!-- oculto --></body></html>',
  )
  afirmar('aTexto: sin scripts, estilos ni comentarios, con el título y la descripción del meta', titulo === 'Café Ladera & Co' && texto.includes('Café de Manizales') && texto.includes('Latte · $8.000') && !texto.includes('robar') && !texto.includes('oculto'), { titulo, texto })
  const guion = await lectorDeGuion({ 'https://cafeladera.co': '<title>Ladera</title><p>Hola</p>' })('https://cafeladera.co/')
  afirmar('lectorDeGuion: lee la página de guion por el mismo aTexto, con su fuente', guion.tipo === 'leida' && guion.fuente === 'tu página (cafeladera.co)' && guion.texto === 'Hola', guion)
  const ig = await lectorDeGuion({ 'https://www.instagram.com/cafeladera': '<p>bio</p>' })('https://www.instagram.com/cafeladera/')
  afirmar('lectorDeGuion: un Instagram es "tu Instagram"', ig.tipo === 'leida' && ig.fuente === 'tu Instagram', ig)
  const muro = lectorDeGuion({
    'https://www.instagram.com/conog': '<meta property="og:url" content="https://www.instagram.com/accounts/login/"><p>Inicia sesión</p>',
    'https://www.instagram.com/contitulo': '<title>Login • Instagram</title><p>Entra</p>',
  })
  const [conOg, conTitulo] = [await muro('https://www.instagram.com/conog'), await muro('https://www.instagram.com/contitulo')]
  afirmar('el muro de login con 200 es pide_sesion, por og:url o por el título', conOg.tipo === 'pide_sesion' && conTitulo.tipo === 'pide_sesion', { conOg, conTitulo })

  console.log('\n=== aTexto es lineal ===')
  for (const [nombre, html] of [
    ['1 MB de <', '<'.repeat(1_000_000)],
    ['1 MB de <svg ', '<svg '.repeat(200_000)],
    ['1 MB de <!--', '<!--'.repeat(250_000)],
    ['1 MB de <meta ', '<meta '.repeat(170_000)],
    ['1 MB de <title', '<title>'.repeat(145_000)],
  ] as const) {
    const t0 = performance.now()
    const r = aTexto(html)
    const ms = performance.now() - t0
    afirmar(`aTexto: ${nombre} en menos de 1 s (${Math.round(ms)} ms)`, ms < 1000 && r.titulo.length <= 200, { ms })
  }
  const largo = aTexto(`<title>${'Café '.repeat(200)}</title><p>Hola</p>`)
  afirmar('aTexto: el título se corta a 200 caracteres', largo.titulo.length === 200 && largo.texto === 'Hola', largo.titulo.length)
  const lejos = aTexto(`<p>Hola</p>${' '.repeat(LARGO_DEL_HTML)}<p>secreto</p>`)
  afirmar(`aTexto: lo que pasa de ${LARGO_DEL_HTML} caracteres no se mira`, lejos.texto === 'Hola', lejos.texto.slice(0, 80))
  const entidad = aTexto('<p>&#99999999999; y &#x41;</p>')
  afirmar('aTexto: una entidad fuera de Unicode queda tal cual, sin lanzar', entidad.texto === '&#99999999999; y A', entidad.texto)
} catch (e) {
  afirmar('probar-leer-enlace terminó sin error inesperado', false, e)
} finally {
  servidor.close()
  terminar()
}
