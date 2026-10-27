/**
 * Se importa primero en todo script de medición. Hace tres cosas antes de que cargue `src/`:
 *  1. carga `.env.local` por encima de lo que haya en el shell y exige ENVIO_SIMULADO=1;
 *  2. se niega a correr si alguna variable de base de datos no apunta a la rama de Neon de la medición
 *     (MEDIR_HOST_RAMA) o apunta a la principal (MEDIR_HOST_PROHIBIDO);
 *  3. envuelve `fetch`: solo deja salir a api.meta.ai y a Neon, y anota cada llamada (quién, cuándo,
 *     cuánto tardó, tokens) en `eventos`.
 */
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true, override: true })
process.env.ENVIO_SIMULADO = '1'

const rama = process.env.MEDIR_HOST_RAMA
const prohibido = process.env.MEDIR_HOST_PROHIBIDO
if (!rama || !prohibido) throw new Error('Faltan MEDIR_HOST_RAMA y MEDIR_HOST_PROHIBIDO')

const hostDe = (v: string) => {
  try {
    return new URL(v).hostname
  } catch {
    return v
  }
}
for (const [k, v] of Object.entries(process.env)) {
  if (!v || !/^(DATABASE_URL|POSTGRES_(URL|PRISMA|HOST)|PGHOST)/.test(k)) continue
  const h = hostDe(v)
  if (!h.includes(rama)) throw new Error(`${k} no apunta a la rama de medición`)
  if (h.includes(prohibido)) throw new Error(`${k} apunta a la base principal`)
}
if (process.env.ENVIO_SIMULADO !== '1') throw new Error('ENVIO_SIMULADO debe ser 1')

export const HOST_DE_LA_BASE = hostDe(process.env.DATABASE_URL!)

export type Uso = { entrada: number; salida: number; razonamiento: number | null; enCache: number | null; crudo: unknown }
export type Evento = {
  n: number
  corrida: string
  kind: 'modelo' | 'db'
  rol: 'dueno' | 'generador' | 'clientes' | 'aviso' | 'otro' | null
  t0: number
  ttfb: number
  t1: number
  status: number
  stream: boolean
  bytesPeticion: number
  bytesRespuesta: number
  uso: Uso | null
  cuerpo?: unknown
}

export const eventos: Evento[] = []
export const reloj = () => performance.now()
let corrida = 'sin-corrida'
let capturarCuerpos = false
export const ponerCorrida = (c: string) => (corrida = c)
export const capturarCuerposDelModelo = (v: boolean) => (capturarCuerpos = v)
const pendientes = new Set<Promise<unknown>>()

function rolDe(cuerpo: { stream?: boolean; messages?: { role: string; content: unknown }[] }): Evento['rol'] {
  const textos = (cuerpo.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
  const todo = textos.join('\n')
  if (todo.includes('Eres el Agente del dueño de "')) return 'dueno'
  if (todo.includes('Escribes el código de')) return 'generador'
  if (todo.includes('El Agente de clientes abrió un Caso')) return 'aviso'
  if (todo.includes('Eres el Agente de clientes de')) return 'clientes'
  return 'otro'
}

function leerUso(u: Record<string, any> | undefined): Uso | null {
  if (!u) return null
  return {
    entrada: u.prompt_tokens ?? 0,
    salida: u.completion_tokens ?? 0,
    razonamiento: u.completion_tokens_details?.reasoning_tokens ?? null,
    enCache: u.prompt_tokens_details?.cached_tokens ?? null,
    crudo: u,
  }
}

const fetchOriginal = globalThis.fetch
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
  const esModelo = url.hostname === 'api.meta.ai'
  const esDb = url.hostname.endsWith('.neon.tech')
  if (!esModelo && !esDb) throw new Error(`fetch bloqueado por la medición: ${url.hostname}`)

  const cuerpoTexto = typeof init?.body === 'string' ? init.body : ''
  let cuerpo: any = null
  if (esModelo) {
    try {
      cuerpo = JSON.parse(cuerpoTexto)
    } catch {}
  }
  const ev: Evento = {
    n: eventos.length,
    corrida,
    kind: esModelo ? 'modelo' : 'db',
    rol: esModelo && cuerpo ? rolDe(cuerpo) : null,
    t0: reloj(),
    ttfb: 0,
    t1: 0,
    status: 0,
    stream: Boolean(cuerpo?.stream),
    bytesPeticion: cuerpoTexto.length,
    bytesRespuesta: 0,
    uso: null,
    ...(esModelo && capturarCuerpos ? { cuerpo } : {}),
  }
  eventos.push(ev)

  const respuesta = await fetchOriginal(entrada, init)
  ev.ttfb = reloj()
  ev.status = respuesta.status
  const copia = respuesta.clone()
  const lectura = (async () => {
    const texto = await copia.text()
    ev.t1 = reloj()
    ev.bytesRespuesta = texto.length
    if (esModelo) {
      if (ev.stream) {
        for (const linea of texto.split('\n')) {
          if (!linea.startsWith('data:') || linea.includes('[DONE]')) continue
          try {
            const o = JSON.parse(linea.slice(5))
            if (o.usage) ev.uso = leerUso(o.usage)
          } catch {}
        }
      } else {
        try {
          ev.uso = leerUso(JSON.parse(texto).usage)
        } catch {}
      }
    }
  })().catch(() => {
    ev.t1 = reloj()
  })
  pendientes.add(lectura)
  lectura.finally(() => pendientes.delete(lectura))
  return respuesta
}) as typeof fetch

/** Espera a que terminen las llamadas en vuelo y 300 ms sin llamadas nuevas (lo que deja un turno al terminar). */
export async function quietud(ms = 300) {
  let n = -1
  while (n !== eventos.length || pendientes.size) {
    n = eventos.length
    await Promise.allSettled([...pendientes])
    await new Promise((r) => setTimeout(r, ms))
  }
}
