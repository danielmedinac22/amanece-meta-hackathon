/**
 * El único escritor del estado de un Negocio. Lo importan `src/nucleo/cambios/**` y `scripts/` (eslint).
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { esquema } from '@/db'
import type { Transaccion } from '@/db/pool'
import { marcar, type DuenoId, type Instante, type NegocioId } from '../identidad'
import { comoVersion, definicionDe, describirCambio, ESQUEMA_DE_ELEMENTO, sinCumplidorHoy, type Clave, type VersionDelNegocio } from './elementos'
import { elementoDe, origenDe, type Escritura, type OrigenDeEscritura } from './index'

export type ClaveEnConflicto = {
  readonly clave: Clave
  readonly tocadaPor: OrigenDeEscritura
  readonly dueno: DuenoId | null
  readonly cuando: Instante
  readonly resumen: string
}

export type ResultadoDeEscribir =
  | { readonly tipo: 'escrito'; readonly version: VersionDelNegocio }
  | { readonly tipo: 'conflicto'; readonly claves: readonly ClaveEnConflicto[] }

/**
 * Dentro de la transacción de quien llama. Una escritura vacía no sube la versión. Si una clave cambió desde la
 * `base` que vio quien propuso, no escribe nada y devuelve `conflicto`: quien llama hace ROLLBACK.
 */
export async function escribir(tx: Transaccion, negocio: NegocioId, origen: OrigenDeEscritura, escritura: Escritura): Promise<ResultadoDeEscribir> {
  for (const c of escritura.elementos) {
    if (!c.despues) continue
    const e = ESQUEMA_DE_ELEMENTO.parse(c.despues)
    const faltan = e.tipo === 'regla' ? sinCumplidorHoy(e) : []
    if (faltan.length) throw new Error(`${c.clave}: hoy nada hace cumplir ${faltan.join(', ')}; validar debía frenarlo`)
  }
  const claves = escritura.elementos.map((c) => c.clave)
  if (new Set(claves).size !== claves.length) throw new Error('Una escritura toca cada clave una sola vez')

  const [n] = await tx.select({ version: esquema.negocios.version }).from(esquema.negocios).where(eq(esquema.negocios.id, negocio)).for('update')
  if (!n) throw new Error(`No existe el Negocio ${negocio}`)
  if (!claves.length) return { tipo: 'escrito', version: comoVersion(n.version) }

  const e = esquema.elementos
  const vigentes = await tx
    .selectDistinctOn([e.clave], {
      clave: e.clave,
      version: e.version,
      tipo: e.tipo,
      contrato: e.contrato,
      contenido: e.contenido,
      origen: e.origen,
      propuestaId: e.propuestaId,
      creado: e.creado,
      aprobadoPor: esquema.propuestas.aprobadoPor,
    })
    .from(e)
    .leftJoin(esquema.propuestas, eq(esquema.propuestas.id, e.propuestaId))
    .where(and(eq(e.negocioId, negocio), inArray(e.clave, claves)))
    .orderBy(e.clave, desc(e.version))
  const ultimaDe = new Map(vigentes.map((v) => [v.clave, v]))

  const conflictos: ClaveEnConflicto[] = []
  for (const c of escritura.elementos) {
    const ultima = ultimaDe.get(c.clave)
    const viva = ultima && ultima.contenido !== null ? ultima : null
    const coincide = c.base === 'nueva' ? viva === null : viva !== null && viva.version === c.base
    if (coincide || !ultima) continue
    const antes = viva ? elementoDe(viva) : null
    conflictos.push({
      clave: c.clave,
      tocadaPor: origenDe(ultima),
      dueno: ultima.aprobadoPor ? marcar.dueno(ultima.aprobadoPor) : null,
      cuando: marcar.instante(ultima.creado),
      resumen: antes ? describirCambio(null, antes) : 'Se quitó',
    })
  }
  if (conflictos.length) return { tipo: 'conflicto', claves: conflictos }

  const version = n.version + 1
  await tx.insert(e).values(
    escritura.elementos.map((c) => ({
      negocioId: negocio,
      clave: c.clave,
      version,
      tipo: c.despues?.tipo ?? ultimaDe.get(c.clave)?.tipo ?? c.clave.split(':')[0],
      contrato: c.despues ? definicionDe(c.despues.tipo).contrato : (ultimaDe.get(c.clave)?.contrato ?? 1),
      contenido: c.despues,
      origen: origen.tipo,
      propuestaId: origen.tipo === 'propuesta' ? origen.propuesta : null,
    })),
  )
  await tx.update(esquema.negocios).set({ version }).where(eq(esquema.negocios.id, negocio))
  return { tipo: 'escrito', version: comoVersion(version) }
}

