/**
 * El único lector del estado de un Negocio. Nadie más consulta `elementos`; `probar-elementos` lo verifica.
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { marcar, type Marca, type ModoDelNegocio, type NegocioId, type PropuestaId } from '../identidad'
import {
  comoClave,
  comoVersion,
  DEFINICIONES,
  definicionDe,
  ESQUEMA_DE_ELEMENTO,
  type Clave,
  type Elemento,
  type ElementoDe,
  type TipoDeElemento,
  type VersionDelNegocio,
  type Vigentes,
} from './elementos'

export type OrigenDeEscritura =
  | { readonly tipo: 'propuesta'; readonly propuesta: PropuestaId }
  /** La migración de las tablas viejas y `sembrar`. */
  | { readonly tipo: 'tablas_viejas' }
  /** La entrevista mientras el Negocio se arma, hasta que pase a `proponer`. */
  | { readonly tipo: 'entrevista' }

export type IdentidadDelNegocio = {
  readonly id: NegocioId
  readonly nombre: string
  readonly rubro: string
  readonly codigo: string
  readonly pais: 'CO'
  readonly moneda: 'COP'
  readonly zonaHoraria: string
  readonly modo: ModoDelNegocio
}

export type ElementoVigente<T extends TipoDeElemento = TipoDeElemento> = {
  [K in T]: {
    readonly clave: Clave
    readonly version: VersionDelNegocio
    readonly origen: OrigenDeEscritura
    readonly elemento: ElementoDe<K>
  }
}[T]

export interface EstadoDelNegocio extends Vigentes {
  readonly identidad: IdentidadDelNegocio
  readonly version: VersionDelNegocio
  vigentes<T extends TipoDeElemento>(tipo: T): readonly ElementoVigente<T>[]
  vigente(clave: Clave): ElementoVigente | null
  todos(): readonly ElementoVigente[]
}

/** Lo que está funcionando ahora. Solo lo produce `leerEstado`. */
export type EstadoVigente = Marca<EstadoDelNegocio, 'EstadoVigente'>

export type CambioDeElemento = {
  readonly clave: Clave
  /** La versión que vio quien propuso, o `nueva`: así `escribir` detecta el choque. */
  readonly base: VersionDelNegocio | 'nueva'
  /** `null` quita el Elemento. */
  readonly despues: Elemento | null
}

/** Lo que se escribe junto o no se escribe. Nadie escribe filas hasta que exista `tabla`. */
export type Escritura = { readonly elementos: readonly CambioDeElemento[]; readonly filas: readonly never[] }

export const ESCRITURA_VACIA: Escritura = { elementos: [], filas: [] }

export type EstadoBorrador = Marca<EstadoDelNegocio & { readonly base: VersionDelNegocio; readonly propuesta: Escritura }, 'EstadoBorrador'>

/** Un Elemento con `contrato` mayor que el del código (un despliegue hacia atrás) o que ya no parsea: se cierra. */
export class EstadoIlegible extends Error {}
export class NegocioInexistente extends Error {}

type FilaDeElemento = {
  readonly clave: string
  readonly version: number
  readonly tipo: string
  readonly contrato: number
  readonly contenido: unknown
  readonly origen: (typeof esquema.elementos.$inferSelect)['origen']
  readonly propuestaId: string | null
}

export function origenDe(f: { readonly origen: FilaDeElemento['origen']; readonly propuestaId: string | null }): OrigenDeEscritura {
  if (f.origen === 'propuesta') return { tipo: 'propuesta', propuesta: marcar.propuesta(f.propuestaId ?? '') }
  return { tipo: f.origen }
}

/** Los esquemas solo crecen: un contrato viejo se lee con el de hoy, y uno del futuro no se adivina. */
export function elementoDe(f: Pick<FilaDeElemento, 'clave' | 'tipo' | 'contrato' | 'contenido'>): Elemento {
  const definicion = f.tipo in DEFINICIONES ? definicionDe(f.tipo as TipoDeElemento) : null
  if (!definicion) throw new EstadoIlegible(`${f.clave}: el tipo ${f.tipo} no existe en este código`)
  if (f.contrato > definicion.contrato) throw new EstadoIlegible(`${f.clave}: contrato ${f.contrato} y este código conoce el ${definicion.contrato}`)
  const r = ESQUEMA_DE_ELEMENTO.safeParse(f.contenido)
  if (!r.success) throw new EstadoIlegible(`${f.clave}: ${r.error.message}`)
  return r.data
}

export function vigenteDe(clave: Clave, version: VersionDelNegocio, origen: OrigenDeEscritura, elemento: Elemento): ElementoVigente {
  return { clave, version, origen, elemento } as ElementoVigente
}

export function armarEstado(identidad: IdentidadDelNegocio, version: VersionDelNegocio, vigentes: readonly ElementoVigente[]): EstadoDelNegocio {
  const porClave = new Map(vigentes.map((v) => [v.clave, v]))
  return {
    identidad,
    version,
    vigentes: <T extends TipoDeElemento>(tipo: T) => vigentes.filter((v) => v.elemento.tipo === tipo) as readonly ElementoVigente[] as readonly ElementoVigente<T>[],
    vigente: (clave) => porClave.get(clave) ?? null,
    todos: () => vigentes,
  }
}

const ultimas = esquema.elementos

/** Una sola foto (el lote de `neon-http` corre en una transacción). Sin caché: un Cambio vale desde el siguiente mensaje. */
export async function leerEstado(negocio: NegocioId): Promise<EstadoVigente> {
  const [negocios, filas] = await db.batch([
    db
      .select({
        nombre: esquema.negocios.nombre,
        rubro: esquema.negocios.rubro,
        codigo: esquema.negocios.codigo,
        pais: esquema.negocios.pais,
        moneda: esquema.negocios.moneda,
        zonaHoraria: esquema.negocios.zonaHoraria,
        modo: esquema.negocios.modo,
        version: esquema.negocios.version,
      })
      .from(esquema.negocios)
      .where(eq(esquema.negocios.id, negocio)),
    db
      .selectDistinctOn([ultimas.clave], {
        clave: ultimas.clave,
        version: ultimas.version,
        tipo: ultimas.tipo,
        contrato: ultimas.contrato,
        contenido: ultimas.contenido,
        origen: ultimas.origen,
        propuestaId: ultimas.propuestaId,
      })
      .from(ultimas)
      .where(eq(ultimas.negocioId, negocio))
      .orderBy(ultimas.clave, desc(ultimas.version)),
  ])
  const [n] = negocios
  if (!n) throw new NegocioInexistente(`No existe el Negocio ${negocio}`)
  const vigentes = filas
    .filter((f) => f.contenido !== null)
    .map((f) => vigenteDe(comoClave(f.clave), comoVersion(f.version), origenDe(f), elementoDe(f)))
  const identidad: IdentidadDelNegocio = { id: negocio, nombre: n.nombre, rubro: n.rubro, codigo: n.codigo, pais: n.pais, moneda: n.moneda, zonaHoraria: n.zonaHoraria, modo: n.modo ?? 'armando' }
  return armarEstado(identidad, comoVersion(n.version), vigentes) as EstadoVigente
}

/** Pura. El mismo estado con lo propuesto encima. */
export function conPropuesta(estado: EstadoDelNegocio, escritura: Escritura): EstadoBorrador {
  const tocadas = new Map(escritura.elementos.map((c) => [c.clave, c]))
  const sin = estado.todos().filter((v) => !tocadas.has(v.clave))
  const propuestas = escritura.elementos.flatMap((c): ElementoVigente[] =>
    c.despues ? [vigenteDe(c.clave, comoVersion(estado.version + 1), { tipo: 'entrevista' }, c.despues)] : [],
  )
  return { ...armarEstado(estado.identidad, estado.version, [...sin, ...propuestas]), base: estado.version, propuesta: escritura } as EstadoBorrador
}

export type HistoriaDeClave = { readonly ultima: VersionDelNegocio; readonly antes: Elemento | null }

/** Para revertir: la última versión de cada clave (también si la quitó) y lo que valía justo antes de `version`. */
export async function historiaParaRevertir(negocio: NegocioId, claves: readonly Clave[], version: VersionDelNegocio): Promise<ReadonlyMap<Clave, HistoriaDeClave>> {
  if (!claves.length) return new Map()
  const deEstas = and(eq(ultimas.negocioId, negocio), inArray(ultimas.clave, [...claves]))
  const campos = { clave: ultimas.clave, version: ultimas.version, tipo: ultimas.tipo, contrato: ultimas.contrato, contenido: ultimas.contenido }
  const [ahora, previas] = await db.batch([
    db.selectDistinctOn([ultimas.clave], campos).from(ultimas).where(deEstas).orderBy(ultimas.clave, desc(ultimas.version)),
    db
      .selectDistinctOn([ultimas.clave], campos)
      .from(ultimas)
      .where(and(deEstas, lt(ultimas.version, version)))
      .orderBy(ultimas.clave, desc(ultimas.version)),
  ])
  const antes = new Map(previas.map((f) => [f.clave, f.contenido === null ? null : elementoDe(f)]))
  return new Map(ahora.map((f) => [comoClave(f.clave), { ultima: comoVersion(f.version), antes: antes.get(f.clave) ?? null }]))
}
