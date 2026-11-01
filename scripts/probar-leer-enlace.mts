/**
 * `leer_enlace` sin abrir la red interna: la tabla de direcciones, un servidor local que no debe recibir ninguna
 * conexión, los saltos, los esquemas y los topes de bytes y de tiempo. Sin base ni modelo.
 *
 *   pnpm tsx scripts/probar-leer-enlace.mts
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afirmar, terminar } from './afirmar.mjs'

const { aTexto, crearLector, direccionPermitida, leerCuerpo, lectorDeGuion, LECTOR_DE_INTERNET, PRUEBAS_DE_DIRECCION, TOPES } = await import('../src/lib/leer-enlace')
type Respuesta = import('../src/lib/leer-enlace').Respuesta

let conexiones = 0
const servidor = createServer((_, res) => res.end('<html><title>interna</title>secreto</html>'))
servidor.on('connection', () => conexiones++)
await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
const puerto = (servidor.address() as AddressInfo).port

const cuerpoDe = (partes: AsyncIterable<Uint8Array>) => Object.assign(partes, { resume: () => undefined, destroy: () => undefined })

try {
  console.log('\n=== direccionPermitida ===')
  const malPermitidas = PRUEBAS_DE_DIRECCION.prohibidas.filter((ip) => direccionPermitida(ip))
  afirmar('direccionPermitida: rechaza loopback, privadas, CGNAT, metadatos, 0.0.0.0, ::1, fc00::/7, fe80::/10 y la IPv4 envuelta en IPv6', malPermitidas.length === 0, malPermitidas)
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
    return { status: 302, ubicacion: 'http://169.254.169.254/latest/meta-data/', contentType: '', cuerpo: cuerpoDe((async function* () {})()) }
  })
  const salto = await conSalto('https://cafeladera.co/')
  afirmar('una redirección a 169.254.169.254 vuelve no_permitida sin pedirla', salto.tipo === 'no_permitida' && JSON.stringify(pedidas) === JSON.stringify(['https://cafeladera.co/']), { salto, pedidas })
  let vueltas = 0
  const enCirculo = crearLector('cualquiera', async (url: URL): Promise<Respuesta> => {
    vueltas++
    return { status: 301, ubicacion: `${url.origin}/otra-${vueltas}`, contentType: '', cuerpo: cuerpoDe((async function* () {})()) }
  })
  const circulo = await enCirculo('https://cafeladera.co/')
  afirmar(`más de ${TOPES.saltos} saltos: demasiados_saltos`, circulo.tipo === 'no_permitida' && circulo.porQue === 'demasiados_saltos' && vueltas === TOPES.saltos + 1, { circulo, vueltas })

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
} catch (e) {
  afirmar('probar-leer-enlace terminó sin error inesperado', false, e)
} finally {
  servidor.close()
  terminar()
}
