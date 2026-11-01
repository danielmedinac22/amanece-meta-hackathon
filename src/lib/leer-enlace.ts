/**
 * Leer lo que el Dueño ya publicó, con una URL que escribe él y que corre en el servidor. Es el único lugar que
 * sale a internet por una URL ajena: nada de la red interna ni de metadatos, con tope de tiempo y de bytes. Lo leído
 * son datos; el HTML no sale de este archivo.
 */
import { lookup as resolver, type LookupAddress, type LookupOptions } from 'node:dns'
import { request as pedirHttp, type IncomingMessage } from 'node:http'
import { request as pedirHttps } from 'node:https'
import { BlockList, isIP } from 'node:net'

export type PaginaLeida = {
  readonly tipo: 'leida'
  readonly url: string
  /** Para la tarjeta: "tu página (cafeladera.co)" o "tu Instagram". */
  readonly fuente: string
  readonly titulo: string
  /** Sin etiquetas, scripts ni estilos; a lo sumo `TOPES.largoParaExtraer` caracteres. */
  readonly texto: string
}

export type NoSeLeyo =
  | { readonly tipo: 'no_permitida'; readonly porQue: 'esquema' | 'credenciales' | 'puerto' | 'direccion_privada' | 'demasiados_saltos' }
  | { readonly tipo: 'tiempo' }
  | { readonly tipo: 'muy_grande' }
  | { readonly tipo: 'no_es_una_pagina'; readonly contentType: string }
  | { readonly tipo: 'respuesta'; readonly status: number }
  /** Instagram y otras redes piden sesión: el Agente sigue con la entrevista. */
  | { readonly tipo: 'pide_sesion' }
  | { readonly tipo: 'no_conecta' }
  | { readonly tipo: 'no_parece_enlace' }

/** El puerto. Producción usa `LECTOR_DE_INTERNET`; los `probar`, `lectorDeGuion`. */
export type Lector = (url: string) => Promise<PaginaLeida | NoSeLeyo>

export const TOPES = { ms: 6000, bytes: 1_000_000, saltos: 3, largoParaExtraer: 20_000 } as const

const PROHIBIDAS = new BlockList()
for (const [red, prefijo] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PROHIBIDAS.addSubnet(red, prefijo, 'ipv4')
for (const [red, prefijo] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  PROHIBIDAS.addSubnet(red, prefijo, 'ipv6')

/** `::ffff:10.0.0.1` y `::ffff:a00:1` son la IPv4 10.0.0.1. */
function ipv4Envuelta(ip: string): string | null {
  const punteada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (punteada) return punteada[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip)
  if (!hex) return null
  const [a, b] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
  return [a >> 8, a & 255, b >> 8, b & 255].join('.')
}

/** Pura. Si una IP resuelta se puede tocar: nada de loopback, privadas, enlace local (169.254.169.254, la de metadatos), CGNAT, multicast ni reservadas. */
export function direccionPermitida(ip: string): boolean {
  const envuelta = ipv4Envuelta(ip)
  if (envuelta) return direccionPermitida(envuelta)
  const familia = isIP(ip)
  if (familia === 0) return false
  return !PROHIBIDAS.check(ip, familia === 4 ? 'ipv4' : 'ipv6')
}

class Prohibida extends Error {}

/** El `lookup` del socket: la IP revisada es la misma a la que se conecta, así un DNS que cambia entre revisar y conectar no pasa. */
function lookupRevisado(hostname: string, opciones: LookupOptions, alResolver: (e: NodeJS.ErrnoException | null, a: string | LookupAddress[], f?: number) => void) {
  resolver(hostname, { ...opciones, all: true }, (error, direcciones) => {
    if (error) return alResolver(error, '', 0)
    if (!direcciones.length || direcciones.some((d) => !direccionPermitida(d.address))) return alResolver(new Prohibida(hostname) as NodeJS.ErrnoException, '', 0)
    if (opciones.all) return alResolver(null, direcciones)
    alResolver(null, direcciones[0].address, direcciones[0].family)
  })
}

const USUARIO_DE_INSTAGRAM = /^@([\w.]+)$|^(\w+)$/
const CON_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i
const CON_DOMINIO = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]\S*)?$/i

/**
 * Pura. Lo que escribió el Dueño, como URL: `@cafeladera` y `cafeladera` son su Instagram; `cafeladera.co` es
 * `https://cafeladera.co`. Algo con espacios o sin dominio no se pide.
 */
export function enlaceDe(escrito: string): string | Extract<NoSeLeyo, { tipo: 'no_parece_enlace' }> {
  const limpio = escrito.trim()
  const usuario = USUARIO_DE_INSTAGRAM.exec(limpio)
  if (usuario) return `https://www.instagram.com/${usuario[1] ?? usuario[2]}`
  if (CON_ESQUEMA.test(limpio) && !CON_DOMINIO.test(limpio)) return limpio
  return CON_DOMINIO.test(limpio) ? `https://${limpio}` : { tipo: 'no_parece_enlace' }
}

/** Pura. Lo que se puede pedir antes de conectar: esquema, credenciales, puerto y una IP escrita tal cual. */
export function urlPermitida(crudo: string, puertos: readonly number[] | 'cualquiera'): URL | Extract<NoSeLeyo, { tipo: 'no_permitida' }> {
  let url: URL
  try {
    url = new URL(crudo.trim())
  } catch {
    return { tipo: 'no_permitida', porQue: 'esquema' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { tipo: 'no_permitida', porQue: 'esquema' }
  if (url.username || url.password) return { tipo: 'no_permitida', porQue: 'credenciales' }
  const puerto = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (puertos !== 'cualquiera' && !puertos.includes(puerto)) return { tipo: 'no_permitida', porQue: 'puerto' }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !direccionPermitida(host)) return { tipo: 'no_permitida', porQue: 'direccion_privada' }
  return url
}

/**
 * Lee el cuerpo por partes y corta en `bytes`. Cada parte compite con el reloj: un cuerpo que no termina no
 * deja colgado al Agente.
 */
export async function leerCuerpo(cuerpo: AsyncIterable<Uint8Array>, bytes: number, senal: AbortSignal): Promise<string | { readonly tipo: 'muy_grande' } | { readonly tipo: 'tiempo' }> {
  const partes: Uint8Array[] = []
  let leidos = 0
  const iterador = cuerpo[Symbol.asyncIterator]()
  const abortado = new Promise<'tiempo'>((listo) => (senal.aborted ? listo('tiempo') : senal.addEventListener('abort', () => listo('tiempo'), { once: true })))
  try {
    for (;;) {
      const r = await Promise.race([iterador.next(), abortado])
      if (r === 'tiempo') return { tipo: 'tiempo' }
      if (r.done) break
      leidos += r.value.byteLength
      if (leidos > bytes) return { tipo: 'muy_grande' }
      partes.push(r.value)
    }
  } finally {
    void iterador.return?.()
  }
  return Buffer.concat(partes).toString('utf8')
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü' }

function sinEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] !== '#') return ENTIDADES[e] ?? todo
    const punto = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return punto <= 0x10ffff ? String.fromCodePoint(punto) : todo
  })
}

/** Lo que se mira de una página: lo demás no cambia lo que se extrae y una regex sobre 1 MB es un riesgo. */
export const LARGO_DEL_HTML = 200_000
const LARGO_DEL_TITULO = 200

/**
 * Pura. Quita los bloques (`script`, `style`, `svg`, comentarios…) buscando cada cierre desde su apertura: lineal
 * aunque falte el cierre, y un bloque sin cierre se lleva el resto, como en el navegador.
 */
function sinBloques(html: string): string {
  const apertura = /<!--|<(script|style|noscript|template|svg|title)\b/gi
  const partes: string[] = []
  let desde = 0
  for (;;) {
    apertura.lastIndex = desde
    const a = apertura.exec(html)
    if (!a) break
    partes.push(html.slice(desde, a.index))
    const cierre = a[1] ? new RegExp(`</${a[1]}`, 'gi') : /-->/g
    cierre.lastIndex = a.index + a[0].length
    const c = cierre.exec(html)
    const fin = c ? html.indexOf('>', c.index) : -1
    if (fin < 0) return partes.join(' ')
    desde = fin + 1
  }
  partes.push(html.slice(desde))
  return partes.join(' ')
}

/** `[^<>]` deja la búsqueda lineal. */
function metasDe(html: string): readonly { readonly nombre: string; readonly contenido: string }[] {
  return [...html.matchAll(/<meta\b[^<>]*>/gi)].flatMap((m) => {
    const nombre = /(?:name|property)\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]
    const contenido = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(m[0])
    return nombre && contenido ? [{ nombre: nombre.toLowerCase(), contenido: contenido[1] ?? contenido[2] ?? '' }] : []
  })
}

function tituloDe(html: string): string {
  const a = /<title\b[^<>]*>/i.exec(html)
  if (!a) return ''
  const desde = a.index + a[0].length
  const c = /<\/title/gi
  c.lastIndex = desde
  const fin = c.exec(html)?.index ?? html.length
  return sinEntidades(html.slice(desde, Math.min(fin, desde + LARGO_DEL_TITULO * 4)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LARGO_DEL_TITULO)
}

/** Pura. El HTML a texto plano: las descripciones de `meta` primero (Instagram pone ahí la bio), sin scripts ni estilos. */
export function aTexto(crudo: string): { readonly titulo: string; readonly texto: string } {
  const html = crudo.slice(0, LARGO_DEL_HTML)
  const metas = metasDe(html)
    .filter((m) => m.nombre === 'description' || m.nombre === 'og:description' || m.nombre === 'og:title')
    .map((m) => m.contenido)
  const cuerpo = sinBloques(html)
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^<>]*>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
  const texto = sinEntidades([...metas, cuerpo].join('\n'))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, TOPES.largoParaExtraer)
  return { titulo: tituloDe(html), texto }
}

const REDES = /(^|\.)(instagram\.com|facebook\.com|tiktok\.com)$/i
const LOGIN = /\/(accounts\/)?login\b/i
const TITULO_DE_LOGIN = /^(log ?in|inicia(r)? sesi[oó]n|entrar)\b/i

function fuenteDe(url: URL): string {
  const host = url.hostname.replace(/^www\./, '')
  return REDES.test(host) ? `tu ${/instagram/i.test(host) ? 'Instagram' : /facebook/i.test(host) ? 'Facebook' : 'TikTok'}` : `tu página (${host})`
}

/** Pura. Lo leído, o `pide_sesion` cuando una red responde 200 con su muro de login (por `og:url` o por el título). */
function paginaDe(url: URL, html: string): PaginaLeida | Extract<NoSeLeyo, { tipo: 'pide_sesion' }> {
  const { titulo, texto } = aTexto(html)
  const ogUrl = metasDe(html.slice(0, LARGO_DEL_HTML)).find((m) => m.nombre === 'og:url')?.contenido ?? ''
  if (REDES.test(url.hostname) && (LOGIN.test(ogUrl) || TITULO_DE_LOGIN.test(titulo))) return { tipo: 'pide_sesion' }
  return { tipo: 'leida', url: url.toString(), fuente: fuenteDe(url), titulo, texto }
}

export type Respuesta = { readonly status: number; readonly ubicacion: string | null; readonly contentType: string; readonly cuerpo: AsyncIterable<Uint8Array> & { destroy(): unknown } }

/** El único `request` a internet: pasa por `lookupRevisado`. */
function pedir(url: URL, senal: AbortSignal): Promise<Respuesta> {
  const pedido = url.protocol === 'https:' ? pedirHttps : pedirHttp
  return new Promise((listo, falla) => {
    const req = pedido(url, { method: 'GET', lookup: lookupRevisado as never, signal: senal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Amanece/1.0)', accept: 'text/html,text/plain' } }, (res) =>
      listo({ status: res.statusCode ?? 0, ubicacion: res.headers.location ?? null, contentType: String(res.headers['content-type'] ?? ''), cuerpo: res as IncomingMessage }),
    )
    req.on('error', falla)
    req.end()
  })
}

/**
 * El lector de verdad. `redirect` a mano: cada salto se vuelve a revisar, hasta `TOPES.saltos`. Un solo reloj para
 * todo el recorrido. Solo `text/html` y `text/plain`. Nada se escapa: un error de la red, del cuerpo o de un
 * `Location` vuelve como `NoSeLeyo`. `transporte` solo lo cambia `probar-leer-enlace` para ver los saltos.
 */
export function crearLector(puertos: readonly number[] | 'cualquiera', transporte: (url: URL, senal: AbortSignal) => Promise<Respuesta> = pedir): Lector {
  async function recorrer(crudo: string, senal: AbortSignal): Promise<PaginaLeida | NoSeLeyo> {
    let destino: string = crudo
    for (let salto = 0; salto <= TOPES.saltos; salto++) {
      const url = urlPermitida(destino, puertos)
      if (!(url instanceof URL)) return url
      const r = await transporte(url, senal)
      if (r.status >= 300 && r.status < 400 && r.ubicacion) {
        r.cuerpo.destroy()
        if (!URL.canParse(r.ubicacion, url)) return { tipo: 'respuesta', status: r.status }
        destino = new URL(r.ubicacion, url).toString()
        if (LOGIN.test(destino)) return { tipo: 'pide_sesion' }
        continue
      }
      if (r.status < 200 || r.status >= 300) {
        r.cuerpo.destroy()
        return { tipo: 'respuesta', status: r.status }
      }
      if (!/^text\/(html|plain)\b/i.test(r.contentType)) {
        r.cuerpo.destroy()
        return { tipo: 'no_es_una_pagina', contentType: r.contentType }
      }
      const cuerpo = await leerCuerpo(r.cuerpo, TOPES.bytes, senal)
      r.cuerpo.destroy()
      return typeof cuerpo === 'string' ? paginaDe(url, cuerpo) : cuerpo
    }
    return { tipo: 'no_permitida', porQue: 'demasiados_saltos' }
  }

  return async (crudo) => {
    const senal = AbortSignal.timeout(TOPES.ms)
    try {
      return await recorrer(crudo, senal)
    } catch (e) {
      if (e instanceof Prohibida || (e as { cause?: unknown }).cause instanceof Prohibida) return { tipo: 'no_permitida', porQue: 'direccion_privada' }
      if (senal.aborted) return { tipo: 'tiempo' }
      return { tipo: 'no_conecta' }
    }
  }
}

export const LECTOR_DE_INTERNET: Lector = crearLector([80, 443])

/** Para los `probar`: URL → HTML de guion, por el mismo `aTexto` que producción. */
export function lectorDeGuion(paginas: Readonly<Record<string, string>>): Lector {
  const sinBarra = (u: string) => u.trim().replace(/\/+$/, '')
  return async (crudo) => {
    const url = urlPermitida(crudo, 'cualquiera')
    if (!(url instanceof URL)) return url
    const html = Object.entries(paginas).find(([u]) => sinBarra(u) === sinBarra(url.toString()))?.[1]
    return html === undefined ? { tipo: 'respuesta', status: 404 } : paginaDe(url, html)
  }
}
