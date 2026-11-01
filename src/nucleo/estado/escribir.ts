/**
 * El único escritor del estado de un Negocio. Lo importan `src/nucleo/cambios/**` y `scripts/` (eslint).
 */
import { eq, inArray } from 'drizzle-orm'
import { esquema } from '@/db'
import type { Transaccion } from '@/db/pool'
import { marcar, type DuenoId, type Instante, type NegocioId } from '../identidad'
import { comoVersion, definicionDe, describirVigente, type Clave, type Problema, type VersionDelNegocio } from './elementos'
import { elementoDe, leerEstado, origenDe, ultimasDe, validarEscritura, type Escritura, type OrigenDeEscritura } from './index'

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
  | { readonly tipo: 'escrito'; readonly version: VersionDelNegocio }
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[] }
  /** No cabe en el estado de ahora (`validarEscritura`): quien llama hace ROLLBACK. */
  | { readonly tipo: 'invalida'; readonly problemas: readonly Problema[] }

/**
 * Dentro de la transacción de quien llama, después de tomar la fila del Negocio: ahí relee el estado y valida, así
 * dos escrituras a la vez no dejan dos productos con el mismo nombre. Una escritura vacía no sube la versión. Si
 * una clave cambió desde la `base` que vio quien propuso, no escribe nada y devuelve `conflicto`.
 */
export async function escribir(tx: Transaccion, negocio: NegocioId, origen: OrigenDeEscritura, escritura: Escritura): Promise<ResultadoDeEscribir> {
  const [n] = await tx.select({ version: esquema.negocios.version }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('update')
  if (!n) throw new Error(`No existe el Negocio ${negocio}`)
  if (!escritura.elementos.length) return { tipo: 'escrito', version: comoVersion(n.version) }

  const estado = await leerEstado(negocio, tx)
  const claves = escritura.elementos.map((c) => c.clave)
  const ultimaDe = new Map((await ultimasDe(tx, negocio, inArray(esquema.elementos.clave, claves))).map((u) => [u.clave, u]))
  const chocan = escritura.elementos.flatMap((c) => {
    const ultima = ultimaDe.get(c.clave)
    const viva = ultima && ultima.contenido !== null ? ultima : null
    const coincide = c.base === 'nueva' ? viva === null : viva !== null && viva.version === c.base
    return coincide ? [] : [{ clave: c.clave, ultima, viva }]
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

  const v = validarEscritura(estado, escritura)
  if (v.tipo === 'invalida') return v

  const version = n.version + 1
  await tx.insert(esquema.elementos).values(
    v.escritura.elementos.map((c) => {
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
      }
    }),
  )
  await tx.update(esquema.negocios).set({ version }).where(eq(esquema.negocios.id, negocio))
  return { tipo: 'escrito', version: comoVersion(version) }
}

type Es<A extends true> = A
export type _EscribirPideTransaccion = Es<Parameters<typeof escribir>[0] extends Transaccion ? true : false>
