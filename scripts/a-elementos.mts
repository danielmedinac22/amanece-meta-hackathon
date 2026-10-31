/**
 * Pasa las tablas viejas (`negocios.conocimiento`, `productos`, `reglas`) a Elementos con origen `tablas_viejas`.
 * Idempotente: corrida dos veces, la segunda escribe 0 y no sube `negocios.version`. Nunca pisa una clave que ya
 * escribió una propuesta o la entrevista. Las reglas viejas no se traducen: quedan como Capacidad faltante.
 *
 *   pnpm tsx scripts/a-elementos.mts [--en-seco]
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import { and, desc, eq, inArray } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { revisarTextoDelDueno } = await import('../src/nucleo/salida/revisar')
const { registrarFaltante, motivoEnTexto } = await import('../src/nucleo/capacidades')
const { marcar } = await import('../src/nucleo/identidad')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Clave = import('../src/nucleo/estado/elementos').Clave
type NegocioId = import('../src/nucleo/identidad').NegocioId
type CambioDeElemento = import('../src/nucleo/estado').CambioDeElemento
export type Conocimiento = import('../src/db/esquema').Conocimiento
export type ProductoViejo = { readonly id: string; readonly nombre: string; readonly descripcion: string; readonly precio: number; readonly activo: boolean }
export type Deseado = { readonly clave: Clave; readonly elemento: Elemento }

function claveDePregunta(pregunta: string): Clave {
  const h = createHash('sha1').update(el.normalizar(pregunta)).digest('hex')
  return el.comoClave(`pregunta:${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`)
}

/** Pura. Lo que dicen hoy las tablas viejas de un Negocio, con claves deterministas. */
export function elementosDeLasTablasViejas(conocimiento: Conocimiento, productos: readonly ProductoViejo[]): readonly Deseado[] {
  const datos = el.CAMPOS_DE_CONOCIMIENTO.flatMap((campo): Deseado[] => {
    const valor = conocimiento[campo].trim()
    return valor ? [{ clave: el.comoClave(`dato:${campo}`), elemento: { tipo: 'dato', campo, valor } }] : []
  })
  const tono = conocimiento.tono.trim()
  const estilo = tono && revisarTextoDelDueno(tono, []).length === 0 ? tono.slice(0, el.LARGO_DEL_ESTILO) : ''
  const voz: Deseado[] = tono ? [{ clave: el.comoClave('voz'), elemento: { tipo: 'voz', nombreDelAgente: null, trato: /\busted\b/i.test(tono) ? 'usted' : 'tu', emojisPorMensaje: 1, estilo } }] : []
  const preguntas = conocimiento.preguntas
    .filter((p) => p.pregunta.trim() && p.respuesta.trim())
    .map((p): Deseado => ({ clave: claveDePregunta(p.pregunta), elemento: { tipo: 'pregunta', pregunta: p.pregunta, respuesta: p.respuesta } }))
  const delCatalogo = productos.map(
    (p): Deseado => ({ clave: el.claveDeProducto.deId(p.id), elemento: { tipo: 'producto', nombre: p.nombre, descripcion: p.descripcion, precio: el.comoMonto(p.precio), activo: p.activo } }),
  )
  return [...datos, ...voz, ...new Map(preguntas.map((p) => [p.clave, p])).values(), ...delCatalogo]
}

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export type Pasada = { readonly escritas: readonly Clave[]; readonly respetadas: readonly Clave[]; readonly version: number }

/**
 * Escribe solo lo que falta o cambió. Una clave cuyo último escritor no es `tablas_viejas` (una propuesta o la
 * entrevista, también si la quitó) se respeta. Una transacción por Negocio; con `enSeco` no escribe.
 */
export async function pasarAElementos(negocio: NegocioId, deseados: readonly Deseado[], opciones: { readonly enSeco?: boolean } = {}): Promise<Pasada> {
  return conTransaccion<Pasada>(async (tx, deshacer) => {
    const [n] = await tx.select({ version: esquema.negocios.version }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('update')
    const e = esquema.elementos
    const ultimas = deseados.length
      ? await tx
          .selectDistinctOn([e.clave], { clave: e.clave, version: e.version, contenido: e.contenido, origen: e.origen })
          .from(e)
          .where(and(eq(e.negocioId, negocio), inArray(e.clave, deseados.map((d) => d.clave))))
          .orderBy(e.clave, desc(e.version))
      : []
    const ultimaDe = new Map(ultimas.map((u) => [u.clave, u]))
    const cambios: CambioDeElemento[] = []
    const respetadas: Clave[] = []
    for (const d of deseados) {
      const u = ultimaDe.get(d.clave)
      if (u && u.origen !== 'tablas_viejas') respetadas.push(d.clave)
      else if (!u || u.contenido === null) cambios.push({ clave: d.clave, base: 'nueva', despues: d.elemento })
      else if (canonico(u.contenido) !== canonico(d.elemento)) cambios.push({ clave: d.clave, base: el.comoVersion(u.version), despues: d.elemento })
    }
    const pasada = { escritas: cambios.map((c) => c.clave), respetadas, version: n.version }
    if (opciones.enSeco) return deshacer(pasada)
    const r = await escribir(tx, negocio, { tipo: 'tablas_viejas' }, { elementos: cambios, filas: [] })
    if (r.tipo === 'conflicto') throw new Error(`${negocio}: conflicto en ${r.claves.map((c) => c.clave).join(', ')}; vuelve a correrlo`)
    return { ...pasada, version: r.version }
  })
}

const REGLA_VIEJA = { tipo: 'regla_vieja' } as const

/** Cada texto, una sola vez, como Capacidad faltante `regla_vieja`. El Dueño la vuelve a pedir y espera su botón. */
export async function migrarReglasViejas(negocio: NegocioId, textos: readonly string[], opciones: { readonly enSeco?: boolean } = {}): Promise<{ readonly anotadas: number; readonly saltadas: number }> {
  const ya = new Set(
    (
      await db
        .select({ pedido: esquema.capacidadesFaltantes.pedido })
        .from(esquema.capacidadesFaltantes)
        .where(and(eq(esquema.capacidadesFaltantes.negocioId, negocio), eq(esquema.capacidadesFaltantes.motivo, motivoEnTexto(REGLA_VIEJA))))
    ).map((f) => f.pedido),
  )
  const nuevas = [...new Set(textos)].filter((t) => !ya.has(t))
  if (!opciones.enSeco) for (const t of nuevas) await registrarFaltante(negocio, t, REGLA_VIEJA)
  return { anotadas: nuevas.length, saltadas: textos.length - nuevas.length }
}

async function migrar(enSeco: boolean) {
  const negocios = await db.select({ id: esquema.negocios.id, codigo: esquema.negocios.codigo, conocimiento: esquema.negocios.conocimiento }).from(esquema.negocios)
  console.log(`${enSeco ? '[en seco] ' : ''}${negocios.length} Negocios`)
  for (const n of negocios) {
    const negocio = marcar.negocio(n.id)
    const productos = await db.select().from(esquema.productos).where(eq(esquema.productos.negocioId, n.id))
    const reglas = await db.select({ texto: esquema.reglas.texto }).from(esquema.reglas).where(and(eq(esquema.reglas.negocioId, n.id), eq(esquema.reglas.activa, true)))
    const p = await pasarAElementos(negocio, elementosDeLasTablasViejas(n.conocimiento, productos), { enSeco })
    const r = await migrarReglasViejas(negocio, reglas.map((x) => x.texto), { enSeco })
    console.log(`${n.codigo}: ${p.escritas.length} claves ${enSeco ? 'por escribir' : 'escritas'}, ${p.respetadas.length} respetadas, versión ${p.version}; reglas viejas: ${r.anotadas} anotadas, ${r.saltadas} ya estaban`)
    for (const c of p.escritas) console.log(`  + ${c}`)
    for (const c of p.respetadas) console.log(`  = ${c} (la escribió otro)`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await migrar(process.argv.includes('--en-seco'))
  process.exit(0)
}
