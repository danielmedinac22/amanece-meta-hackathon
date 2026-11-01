/**
 * Pasa las tablas viejas (`negocios.conocimiento`, `productos`, `reglas`) a Elementos con origen `tablas_viejas`.
 * Idempotente: corrida dos veces, la segunda escribe 0 y no sube `negocios.version`. Nunca pisa una clave que ya
 * escribió una propuesta o la entrevista. Reconcilia: lo que ya no está en las tablas viejas se quita. Las reglas
 * viejas no se traducen: quedan como Capacidad faltante y con una línea en el Hilo de cada Dueño.
 *
 *   pnpm tsx scripts/a-elementos.mts [--en-seco]
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import { and, asc, eq } from 'drizzle-orm'

config({ path: '.env.local', quiet: true })

const { db, esquema } = await import('../src/db')
const viejo = await import('../src/db/viejo')
const { conTransaccion } = await import('../src/db/pool')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { revisarTextoDelDueno } = await import('../src/nucleo/salida/revisar')
const { registrarFaltante, motivoEnTexto } = await import('../src/nucleo/capacidades')
const { marcar } = await import('../src/nucleo/identidad')
const { ultimasDe } = await import('../src/nucleo/estado')
const { guardarEnElHilo, mensajeDelAgente } = await import('../src/negocio/dueno-hilo')
const { canonico } = await import('../src/lib/canonico')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Clave = import('../src/nucleo/estado/elementos').Clave
type NegocioId = import('../src/nucleo/identidad').NegocioId
type CambioDeElemento = import('../src/nucleo/estado').CambioDeElemento
export type Conocimiento = import('../src/db/viejo').Conocimiento
export type ProductoViejo = { readonly id: string; readonly nombre: string; readonly descripcion: string | null; readonly precio: number; readonly activo: boolean }
export type Deseado = { readonly clave: Clave; readonly elemento: Elemento }
/** Lo que dicen las tablas viejas y lo que no entra, con el porqué, para el resumen de la corrida. */
export type DeLasTablasViejas = { readonly deseados: readonly Deseado[]; readonly saltados: readonly string[] }

/** Lo que llega de la columna jsonb: cualquier campo puede faltar o venir null. */
type ConocimientoCrudo = { readonly [K in keyof Conocimiento]?: Conocimiento[K] | null }

function claveDePregunta(pregunta: string): Clave {
  const h = createHash('sha1').update(el.normalizar(pregunta)).digest('hex')
  return el.comoClave(`pregunta:${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`)
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Pura. Lo que dicen hoy las tablas viejas de un Negocio, con claves deterministas. Un campo null o una pregunta sin
 * respuesta no lanzan; un precio que no es positivo o un texto que no puede llegar a un Cliente se saltan.
 */
export function elementosDeLasTablasViejas(conocimiento: ConocimientoCrudo, productos: readonly ProductoViejo[]): DeLasTablasViejas {
  const saltados: string[] = []
  const pasa = (que: string, ...textos: string[]) => {
    const motivos = textos.flatMap((t) => revisarTextoDelDueno(t, []))
    if (motivos.length) saltados.push(`${que}: ${[...new Set(motivos)].join(', ')}`)
    return motivos.length === 0
  }
  const datos = el.CAMPOS_DE_CONOCIMIENTO.flatMap((campo): Deseado[] => {
    const valor = texto(conocimiento[campo])
    return valor && pasa(`dato:${campo}`, valor) ? [{ clave: el.comoClave(`dato:${campo}`), elemento: { tipo: 'dato', campo, valor } }] : []
  })
  const tono = texto(conocimiento.tono)
  const voz: Deseado[] =
    tono && pasa('voz', tono)
      ? [{ clave: el.comoClave('voz'), elemento: { tipo: 'voz', nombreDelAgente: null, trato: el.tratoDelTono(tono), emojisPorMensaje: 1, estilo: tono.slice(0, el.LARGO_DEL_ESTILO) } }]
      : []
  const preguntas = (conocimiento.preguntas ?? []).flatMap((p): Deseado[] => {
    const pregunta = texto(p?.pregunta)
    const respuesta = texto(p?.respuesta)
    if (!pregunta || !respuesta) return []
    return pasa(`pregunta «${pregunta}»`, respuesta) ? [{ clave: claveDePregunta(pregunta), elemento: { tipo: 'pregunta', pregunta, respuesta } }] : []
  })
  const delCatalogo = productos.flatMap((p): Deseado[] => {
    const nombre = texto(p.nombre)
    const descripcion = texto(p.descripcion)
    if (!nombre || !Number.isInteger(p.precio) || p.precio <= 0) {
      saltados.push(`producto «${p.nombre}»: el precio ${p.precio} no es un entero positivo`)
      return []
    }
    return pasa(`producto «${nombre}»`, nombre, descripcion) ? [{ clave: el.claveDeProducto.deId(p.id), elemento: { tipo: 'producto', nombre, descripcion, precio: el.comoMonto(p.precio), activo: p.activo } }] : []
  })
  return { deseados: [...datos, ...voz, ...new Map(preguntas.map((p) => [p.clave, p])).values(), ...delCatalogo], saltados }
}

export type Pasada = { readonly escritas: readonly Clave[]; readonly quitadas: readonly Clave[]; readonly respetadas: readonly Clave[]; readonly version: number }

/**
 * Escribe solo lo que falta o cambió, y quita lo que la migración había puesto y ya no está en las tablas viejas.
 * Una clave cuyo último escritor no es `tablas_viejas` (una propuesta o la entrevista, también si la quitó) se
 * respeta. Una transacción por Negocio; con `enSeco` no escribe.
 */
export async function pasarAElementos(negocio: NegocioId, deseados: readonly Deseado[], opciones: { readonly enSeco?: boolean } = {}): Promise<Pasada> {
  return conTransaccion<Pasada>(async (tx, deshacer) => {
    const [n] = await tx.select({ version: esquema.negocios.version }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('update')
    const ultimaDe = new Map((await ultimasDe(tx, negocio)).map((u) => [u.clave, u]))
    const cambios: CambioDeElemento[] = []
    const respetadas: Clave[] = []
    for (const d of deseados) {
      const u = ultimaDe.get(d.clave)
      if (u && u.origen !== 'tablas_viejas') respetadas.push(d.clave)
      else if (!u || u.contenido === null) cambios.push({ clave: d.clave, base: 'nueva', despues: d.elemento })
      else if (canonico(u.contenido) !== canonico(d.elemento)) cambios.push({ clave: d.clave, base: el.comoVersion(u.version), despues: d.elemento })
    }
    const deseadas = new Set<string>(deseados.map((d) => d.clave))
    const lapidas = [...ultimaDe.values()]
      .filter((u) => u.origen === 'tablas_viejas' && u.contenido !== null && !deseadas.has(u.clave))
      .map((u): CambioDeElemento => ({ clave: el.comoClave(u.clave), base: el.comoVersion(u.version), despues: null }))
    const pasada = { escritas: cambios.map((c) => c.clave), quitadas: lapidas.map((c) => c.clave), respetadas, version: n.version }
    if (opciones.enSeco) return deshacer(pasada)
    const r = await escribir(tx, negocio, { tipo: 'tablas_viejas' }, { elementos: [...cambios, ...lapidas], filas: [] })
    if (r.tipo === 'conflicto') throw new Error(`conflicto en ${r.claves.map((c) => c.clave).join(', ')}; vuelve a correrlo`)
    if (r.tipo === 'invalida') throw new Error(`no cabe: ${r.problemas.map((p) => JSON.stringify(p)).join('; ')}`)
    return { ...pasada, version: r.version }
  })
}

const REGLA_VIEJA = { tipo: 'regla_vieja' } as const

/**
 * Cada texto, una sola vez, como Capacidad faltante `regla_vieja`, y una línea en el Hilo de cada Dueño con las que
 * dejaron de valer, para que las vuelva a pedir y esperen su botón.
 */
export async function migrarReglasViejas(negocio: NegocioId, textos: readonly string[], opciones: { readonly enSeco?: boolean } = {}): Promise<{ readonly anotadas: number; readonly saltadas: number; readonly avisados: number }> {
  const ya = new Set(
    (
      await db
        .select({ pedido: esquema.capacidadesFaltantes.pedido })
        .from(esquema.capacidadesFaltantes)
        .where(and(eq(esquema.capacidadesFaltantes.negocioId, negocio), eq(esquema.capacidadesFaltantes.motivo, motivoEnTexto(REGLA_VIEJA))))
    ).map((f) => f.pedido),
  )
  const nuevas = [...new Set(textos)].filter((t) => !ya.has(t))
  const saltadas = textos.length - nuevas.length
  if (opciones.enSeco || !nuevas.length) return { anotadas: nuevas.length, saltadas, avisados: 0 }
  for (const t of nuevas) await registrarFaltante(negocio, t, REGLA_VIEJA)
  const duenos = await db.select({ id: esquema.duenos.id }).from(esquema.duenos).where(eq(esquema.duenos.negocioId, negocio))
  const linea = `Con el cambio de sistema dejaron de valer estas reglas de tu agente de clientes: ${nuevas.map((t) => `«${t}»`).join('; ')}. Si todavía las quieres, pídemelas de nuevo y te dejo cada una lista para tu botón.`
  for (const d of duenos) await guardarEnElHilo(negocio, d.id, 'agente', mensajeDelAgente(linea))
  return { anotadas: nuevas.length, saltadas, avisados: duenos.length }
}

/** Un Negocio que falla no corta la corrida: queda en el resumen del final. */
async function migrar(enSeco: boolean) {
  const negocios = await db.select({ id: esquema.negocios.id, codigo: esquema.negocios.codigo, conocimiento: esquema.negocios.conocimientoSinLector }).from(esquema.negocios).orderBy(asc(esquema.negocios.codigo))
  console.log(`${enSeco ? '[en seco] ' : ''}${negocios.length} Negocios`)
  const fallaron: string[] = []
  const conSaltados: string[] = []
  for (const n of negocios) {
    try {
      const negocio = marcar.negocio(n.id)
      const productos = await db.select().from(viejo.productos).where(eq(viejo.productos.negocioId, n.id))
      const reglas = await db.select({ texto: viejo.reglas.texto }).from(viejo.reglas).where(and(eq(viejo.reglas.negocioId, n.id), eq(viejo.reglas.activa, true)))
      const { deseados, saltados } = elementosDeLasTablasViejas((n.conocimiento ?? {}) as ConocimientoCrudo, productos)
      const p = await pasarAElementos(negocio, deseados, { enSeco })
      const r = await migrarReglasViejas(negocio, reglas.map((x) => x.texto), { enSeco })
      console.log(
        `${n.codigo}: ${p.escritas.length} claves ${enSeco ? 'por escribir' : 'escritas'}, ${p.quitadas.length} ${enSeco ? 'por quitar' : 'quitadas'}, ${p.respetadas.length} respetadas, versión ${p.version}; reglas viejas: ${r.anotadas} anotadas, ${r.saltadas} ya estaban, ${r.avisados} Dueños avisados`,
      )
      for (const c of p.escritas) console.log(`  + ${c}`)
      for (const c of p.quitadas) console.log(`  - ${c}`)
      for (const c of p.respetadas) console.log(`  = ${c} (la escribió otro)`)
      for (const x of saltados) console.log(`  ! saltado ${x}`)
      if (saltados.length) conSaltados.push(`${n.codigo} (${saltados.length})`)
    } catch (e) {
      console.error(`${n.codigo}: falló`, e)
      fallaron.push(n.codigo)
    }
  }
  console.log(`\nResumen: ${negocios.length - fallaron.length} de ${negocios.length} Negocios pasaron${fallaron.length ? `; fallaron ${fallaron.join(', ')}` : ''}${conSaltados.length ? `; con cosas saltadas: ${conSaltados.join(', ')}` : ''}.`)
  return fallaron.length
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit((await migrar(process.argv.includes('--en-seco'))) ? 1 : 0)
}
