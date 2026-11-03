/**
 * El único escritor del estado de un Negocio. Lo importan `src/nucleo/cambios/**` y `scripts/` (eslint).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { esquema } from '@/db'
import type { Transaccion } from '@/db/pool'
import { marcar, type DuenoId, type Instante, type ModoDelNegocio, type NegocioId, type PropuestaId } from '../identidad'
import { comoVersion, definicionDe, describirVigente, type Clave, type Problema, type VersionDelNegocio } from './elementos'
import {
  elementoDe,
  historiaParaRevertir,
  huellaDeLoPendiente,
  leerAplicado,
  leerPublicado,
  loPendiente,
  origenDe,
  queCambiaLoAplicado,
  ultimasDe,
  validarEscritura,
  type ComoSeRevierte,
  type Escritura,
  type ItemPendiente,
  type OrigenDeEscritura,
} from './index'

/** Quién tocó la clave después de la `base` que vio quien propuso. Todo null si la clave ya no tiene filas. */
export type ClaveEnConflicto = {
  readonly clave: Clave
  readonly tocadaPor: OrigenDeEscritura | null
  readonly dueno: DuenoId | null
  readonly cuando: Instante | null
  /** Lo que vale ahora, sin "nuevo": "Horario: «…»", o "Se quitó". */
  readonly resumen: string
}

export type ResultadoDeEscribir =
  /** `deUna`: cuántas filas les llegan a los Clientes sin pasar por Publicar. */
  | { readonly tipo: 'escrito'; readonly version: VersionDelNegocio; readonly deUna: number; readonly modo: ModoDelNegocio }
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[] }
  /** No cabe en el estado de ahora (`validarEscritura`): quien llama hace ROLLBACK. */
  | { readonly tipo: 'invalida'; readonly problemas: readonly Problema[] }

/** Lo revertido: la propuesta y la versión que dejó su escritura. */
export type LoRevertido = { readonly propuesta: PropuestaId; readonly version: VersionDelNegocio }

const BIT_DE_LA_REVERSION = { frena: false, solo_vista_previa: true, no_se_puede: true } as const satisfies Record<ComoSeRevierte['tipo'], boolean>

/**
 * Pura. Con qué bit nace una fila. Lo decide solo `escribir`, bajo la fila del Negocio. Sin Clientes reales no hay nada
 * que retener, y lo de las tablas viejas ya lo notaban. `como`: la clave se está revirtiendo.
 */
export function naceSinPublicar(origen: OrigenDeEscritura['tipo'], modo: ModoDelNegocio, como: ComoSeRevierte | null): boolean {
  if (origen === 'tablas_viejas' || modo !== 'atendiendo') return false
  return como ? BIT_DE_LA_REVERSION[como.tipo] : true
}

const NO_SE_PUEDE: ComoSeRevierte = { tipo: 'no_se_puede', porQue: 'la_cambio_otra_publicada' }

/**
 * Dentro de la transacción de quien llama, después de tomar la fila del Negocio: ahí relee el estado y valida, así
 * dos escrituras a la vez no dejan dos productos con el mismo nombre. Una escritura vacía no sube la versión. Si
 * una clave cambió desde la `base` que vio quien propuso, no escribe nada y devuelve `conflicto`.
 */
export async function escribir(tx: Transaccion, negocio: NegocioId, origen: OrigenDeEscritura, escritura: Escritura, revierte: LoRevertido | null): Promise<ResultadoDeEscribir> {
  const [n] = await tx.select({ version: esquema.negocios.version, modo: esquema.negocios.modo }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('update')
  if (!n) throw new Error(`No existe el Negocio ${negocio}`)
  const modo = n.modo ?? 'armando'
  if (!escritura.elementos.length) return { tipo: 'escrito', version: comoVersion(n.version), deUna: 0, modo }

  const estado = await leerAplicado(negocio, tx)
  const claves = escritura.elementos.map((c) => c.clave)
  const ultimaDe = new Map((await ultimasDe(tx, negocio, inArray(esquema.elementos.clave, claves))).map((u) => [u.clave, u]))
  const historia = revierte ? await historiaParaRevertir(negocio, claves, revierte.version, tx) : null
  const comoDe = (clave: Clave): ComoSeRevierte | null => (historia ? (historia.get(clave)?.como ?? NO_SE_PUEDE) : null)
  const chocan = escritura.elementos.flatMap((c) => {
    const ultima = ultimaDe.get(c.clave)
    const viva = ultima && ultima.contenido !== null ? ultima : null
    const coincide = c.base === 'nueva' ? viva === null : viva !== null && viva.version === c.base
    return coincide && comoDe(c.clave)?.tipo !== 'no_se_puede' ? [] : [{ clave: c.clave, ultima, viva }]
  })
  if (chocan.length) {
    const ids = chocan.flatMap((c) => (c.ultima?.propuestaId ? [c.ultima.propuestaId] : []))
    const aprobadas = ids.length ? await tx.select({ id: esquema.propuestas.id, por: esquema.propuestas.aprobadoPor }).from(esquema.propuestas).where(inArray(esquema.propuestas.id, ids)) : []
    const por = new Map(aprobadas.map((a) => [a.id, a.por]))
    return {
      tipo: 'conflicto',
      claves: chocan.map(({ clave, ultima, viva }): ClaveEnConflicto => {
        const aprobo = ultima?.propuestaId ? por.get(ultima.propuestaId) : null
        return {
          clave,
          tocadaPor: ultima ? origenDe(ultima) : null,
          dueno: aprobo ? marcar.dueno(aprobo) : null,
          cuando: ultima ? marcar.instante(ultima.creado) : null,
          resumen: viva ? describirVigente(elementoDe(viva), estado) : 'Se quitó',
        }
      }),
    }
  }

  const v = validarEscritura(estado, revierte ? queCambiaLoAplicado(estado, escritura) : escritura)
  if (v.tipo === 'invalida') return v
  const validadas = new Map(v.escritura.elementos.map((c) => [c.clave, c]))
  const filas = escritura.elementos.map((c) => validadas.get(c.clave) ?? c)

  const nace = (c: { readonly clave: Clave }) => naceSinPublicar(origen.tipo, modo, comoDe(c.clave))
  const deFreno = revierte ? filas.filter((c) => modo === 'atendiendo' && !nace(c)) : []
  if (deFreno.length) {
    // Lo publicado es válido por inducción: nace igual a un aplicado válido, sellar lo iguala a otro, y solo lo cambian estas filas.
    const w = validarEscritura(await leerPublicado(negocio, tx), { elementos: deFreno, filas: [] })
    if (w.tipo === 'invalida') return { tipo: 'invalida', problemas: w.problemas.map((problema) => ({ tipo: 'rompe_lo_publicado', problema })) }
  }

  const version = n.version + 1
  await tx.insert(esquema.elementos).values(
    filas.map((c) => {
      const tipo = c.despues?.tipo ?? ultimaDe.get(c.clave)!.tipo
      return {
        negocioId: negocio,
        clave: c.clave,
        version,
        tipo,
        contrato: c.despues ? definicionDe(c.despues.tipo).contrato : ultimaDe.get(c.clave)!.contrato,
        contenido: c.despues,
        origen: origen.tipo,
        propuestaId: origen.tipo === 'propuesta' ? origen.propuesta : null,
        sinPublicar: nace(c),
      }
    }),
  )
  await tx.update(esquema.negocios).set({ version }).where(eq(esquema.negocios.id, negocio))
  return { tipo: 'escrito', version: comoVersion(version), deUna: modo === 'atendiendo' ? filas.filter((c) => !nace(c)).length : 0, modo }
}

/**
 * El único que baja el bit. Toca también las filas enterradas: una versión más alta siempre gana, así que no cambia
 * nada más. Lo llaman `sellar` y `scripts/retirar-sin-publicar.mts`.
 */
export async function bajarElBit(tx: Transaccion, negocio: NegocioId) {
  await tx
    .update(esquema.elementos)
    .set({ sinPublicar: false })
    .where(and(eq(esquema.elementos.negocioId, negocio), eq(esquema.elementos.sinPublicar, true)))
}

export type ResultadoDeSellar = { readonly tipo: 'sellado'; readonly items: readonly ItemPendiente[] } | { readonly tipo: 'sin_nada' } | { readonly tipo: 'cambio' }

/**
 * Dentro de la transacción de quien llama, con la misma fila del Negocio que toma `escribir`. Solo sella lo que se vio.
 * No sube la versión del Negocio: no hay contenido nuevo.
 */
export async function sellar(tx: Transaccion, negocio: NegocioId, vista: string): Promise<ResultadoDeSellar> {
  const [n] = await tx.select({ version: esquema.negocios.version }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('update')
  if (!n) throw new Error(`No existe el Negocio ${negocio}`)
  const aplicado = await leerAplicado(negocio, tx)
  const publicado = await leerPublicado(negocio, tx)
  const items = loPendiente(aplicado, publicado)
  if (!items.length) return { tipo: 'sin_nada' }
  if (huellaDeLoPendiente(aplicado, publicado) !== vista) return { tipo: 'cambio' }
  await bajarElBit(tx, negocio)
  return { tipo: 'sellado', items }
}

type Es<A extends true> = A
export type _EscribirPideTransaccion = Es<Parameters<typeof escribir>[0] extends Transaccion ? true : false>
/** Sin `.default()` en el esquema: todo INSERT en TypeScript tiene que decir el bit. */
export type _TodoInsertDiceElBit = Es<undefined extends (typeof esquema.elementos.$inferInsert)['sinPublicar'] ? false : true>
