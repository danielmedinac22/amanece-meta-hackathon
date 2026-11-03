/**
 * El único lector del estado de un Negocio. Nadie más consulta `elementos`; `probar-elementos` lo verifica.
 */
import { and, desc, eq, inArray, lt, ne, type SQL } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { Transaccion } from '@/db/pool'
import { NOMBRE_TEMPORAL } from '@/negocio/alta'
import { marcar, type Marca, type ModoDelNegocio, type NegocioId, type PropuestaId } from '../identidad'
import {
  comoClave,
  comoVersion,
  DEFINICIONES,
  definicionDe,
  ESQUEMA_DE_ELEMENTO,
  normalizar,
  sinCumplidorHoy,
  type CampoDeConocimiento,
  type Clave,
  type Elemento,
  type ElementoDe,
  type Problema,
  type TipoDeElemento,
  type VersionDelNegocio,
  type Vigentes,
} from './elementos'

export type OrigenDeEscritura =
  /** `null` si la propuesta ya no existe: la llave es ON DELETE SET NULL. */
  | { readonly tipo: 'propuesta'; readonly propuesta: PropuestaId | null }
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

/** Lo que ve el Dueño: su vista previa. Solo lo produce `leerAplicado`. */
export type EstadoAplicado = Marca<EstadoDelNegocio, 'EstadoAplicado'>
/** Lo que notan los Clientes. Solo lo produce `leerPublicado`. */
export type EstadoPublicado = Marca<EstadoDelNegocio, 'EstadoPublicado'>

export type CambioDeElemento = {
  readonly clave: Clave
  /** La versión que vio quien propuso, o `nueva`: así `escribir` detecta el choque. */
  readonly base: VersionDelNegocio | 'nueva'
  /** `null` quita el Elemento. */
  readonly despues: Elemento | null
}

/** Lo que se escribe junto o no se escribe. Nadie escribe filas hasta que exista `tabla`. */
export type Escritura = { readonly elementos: readonly CambioDeElemento[]; readonly filas: readonly never[] }

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
  if (f.origen === 'propuesta') return { tipo: 'propuesta', propuesta: f.propuestaId ? marcar.propuesta(f.propuestaId) : null }
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

/** Quien lee: la base, o la transacción de quien escribe, que relee después de su `FOR UPDATE`. */
export type Lector = typeof db | Transaccion

/** La última fila de cada clave del Negocio, también la que la quitó (`contenido` null). La única consulta de `elementos`. */
export function ultimasDe(x: Lector, negocio: NegocioId, filtro?: SQL) {
  return x
    .selectDistinctOn([ultimas.clave], {
      clave: ultimas.clave,
      version: ultimas.version,
      tipo: ultimas.tipo,
      contrato: ultimas.contrato,
      contenido: ultimas.contenido,
      origen: ultimas.origen,
      propuestaId: ultimas.propuestaId,
      sinPublicar: ultimas.sinPublicar,
      creado: ultimas.creado,
    })
    .from(ultimas)
    .where(and(eq(ultimas.negocioId, negocio), filtro))
    .orderBy(ultimas.clave, desc(ultimas.version))
}

async function identidadDe(x: Lector, negocio: NegocioId): Promise<IdentidadDelNegocio & { readonly versionDelNegocio: number }> {
  const [n] = await x
    .select({
      nombre: esquema.negocios.nombre,
      rubro: esquema.negocios.rubro,
      codigo: esquema.negocios.codigo,
      pais: esquema.negocios.pais,
      moneda: esquema.negocios.moneda,
      zonaHoraria: esquema.negocios.zonaHoraria,
      modo: esquema.negocios.modo,
      versionDelNegocio: esquema.negocios.version,
    })
    .from(esquema.negocios)
    .where(eq(esquema.negocios.id, negocio))
  if (!n) throw new NegocioInexistente(`No existe el Negocio ${negocio}`)
  return { ...n, id: negocio, modo: n.modo ?? 'armando' }
}

const vivasDe = (filas: Awaited<ReturnType<typeof ultimasDe>>) =>
  filas.filter((f) => f.contenido !== null).map((f) => vigenteDe(comoClave(f.clave), comoVersion(f.version), origenDe(f), elementoDe(f)))

function sinVersion({ versionDelNegocio: _, ...identidad }: Awaited<ReturnType<typeof identidadDe>>): IdentidadDelNegocio {
  return identidad
}

/**
 * La última fila de cada clave. Sin caché: un Cambio se ve desde la siguiente lectura. Son dos lecturas en READ
 * COMMITTED, no una sola foto: quien escribe no confía en esta, relee con `x = tx` después de tomar la fila del Negocio.
 */
export async function leerAplicado(negocio: NegocioId, x: Lector = db): Promise<EstadoAplicado> {
  const [identidad, filas] = await Promise.all([identidadDe(x, negocio), ultimasDe(x, negocio)])
  return armarEstado(sinVersion(identidad), comoVersion(identidad.versionDelNegocio), vivasDe(filas)) as EstadoAplicado
}

/**
 * La última fila sellada de cada clave. Las filas salen de un solo SELECT: un Cliente nunca ve una publicación a medias.
 * `version` es la más alta de esas filas, lápidas incluidas: 0 quiere decir que no hay Elementos.
 */
export async function leerPublicado(negocio: NegocioId, x: Lector = db): Promise<EstadoPublicado> {
  const [identidad, filas] = await Promise.all([identidadDe(x, negocio), ultimasDe(x, negocio, eq(ultimas.sinPublicar, false))])
  const version = filas.reduce((max, f) => Math.max(max, f.version), 0)
  return armarEstado(sinVersion(identidad), comoVersion(version), vivasDe(filas)) as EstadoPublicado
}

/**
 * Pura. De los nombres de los otros Negocios, los que el Agente de clientes no debe nombrar: de dos palabras o más
 * (un "Trigo" suelto frenaría a cualquiera) y que no aparezcan en lo que el propio Negocio dice de sí.
 */
export function nombresAjenos(nombres: readonly string[], estado: EstadoDelNegocio): readonly string[] {
  const propio = normalizar([estado.identidad.nombre, ...estado.todos().flatMap((v) => definicionDe(v.elemento.tipo).textos(v.elemento).map((t) => t.texto))].join(' \n '))
  return nombres.filter((n) => n.trim().split(/\s+/).length >= 2 && !propio.includes(normalizar(n)))
}

/** Los nombres de los otros Negocios abiertos que se vigilan en lo que llega a un Cliente. El único que los consulta. */
export async function otrosNegocios(estado: EstadoDelNegocio): Promise<readonly string[]> {
  const filas = await db
    .select({ nombre: esquema.negocios.nombre })
    .from(esquema.negocios)
    .where(and(ne(esquema.negocios.id, estado.identidad.id), eq(esquema.negocios.estado, 'listo'), ne(esquema.negocios.nombre, NOMBRE_TEMPORAL)))
  return nombresAjenos(
    filas.map((f) => f.nombre),
    estado,
  )
}

export function valorDelDato(estado: EstadoDelNegocio, campo: CampoDeConocimiento): string {
  return estado.vigentes('dato').find((v) => v.elemento.campo === campo)?.elemento.valor ?? ''
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

export type ResultadoDeValidar = { readonly tipo: 'valida'; readonly escritura: Escritura } | { readonly tipo: 'invalida'; readonly problemas: readonly Problema[] }

const invalido = (campo: string, porQue: string): Problema => ({ tipo: 'valor_invalido', campo, porQue })

/**
 * Pura. La única validación de una Escritura: la corre `traducir` para la tarjeta y otra vez `escribir`, dentro de la
 * transacción, contra lo que leyó después del `FOR UPDATE`. Devuelve los Elementos parseados: eso es lo que se guarda.
 */
export function validarEscritura(estado: EstadoDelNegocio, escritura: Escritura): ResultadoDeValidar {
  const problemas: Problema[] = []
  const parseados = escritura.elementos.map((c): CambioDeElemento => {
    if (!c.despues) return c
    const r = ESQUEMA_DE_ELEMENTO.safeParse(c.despues)
    if (r.success) return { ...c, despues: r.data }
    problemas.push(invalido(c.clave, `No tiene la forma de su tipo: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`))
    return c
  })
  if (problemas.length) return { tipo: 'invalida', problemas }
  const claves = parseados.map((c) => c.clave)
  if (new Set(claves).size !== claves.length) return { tipo: 'invalida', problemas: [invalido('quiere', 'Una escritura toca cada clave una sola vez')] }

  const parseada: Escritura = { elementos: parseados, filas: escritura.filas }
  const borrador = conPropuesta(estado, parseada)
  for (const c of parseados) {
    if (!c.despues) {
      if (!estado.vigente(c.clave)) problemas.push(invalido('quitar', `${c.clave} no está vigente: no hay nada que quitar`))
      for (const v of borrador.todos()) if (definicionDe(v.elemento.tipo).referencias(v.elemento).includes(c.clave)) problemas.push({ tipo: 'referencia_huerfana', quitada: c.clave, usadaPor: v.clave })
      continue
    }
    const e = c.despues
    const d = definicionDe(e.tipo)
    const fija = d.claveFija(e)
    if (fija ? c.clave !== fija : !c.clave.startsWith(`${e.tipo}:`)) problemas.push(invalido('clave', `${c.clave} no es la clave de un Elemento de tipo ${e.tipo}`))
    for (const r of d.referencias(e)) if (!borrador.vigente(r)) problemas.push({ tipo: 'referencia_rota', clave: r })
    if (e.tipo === 'regla') {
      const faltan = sinCumplidorHoy(e)
      if (faltan.length) problemas.push(invalido('regla', `Hoy nada hace cumplir ${faltan.join(', ')}`))
    }
    problemas.push(...d.validar(e, c.clave, borrador))
  }
  return problemas.length ? { tipo: 'invalida', problemas } : { tipo: 'valida', escritura: parseada }
}

export type HistoriaDeClave = { readonly ultima: VersionDelNegocio; readonly antes: Elemento | null }

/** Para revertir: la última versión de cada clave (también si la quitó) y lo que valía justo antes de `version`. */
export async function historiaParaRevertir(negocio: NegocioId, claves: readonly Clave[], version: VersionDelNegocio): Promise<ReadonlyMap<Clave, HistoriaDeClave>> {
  if (!claves.length) return new Map()
  const deEstas = inArray(ultimas.clave, [...claves])
  const [ahora, previas] = await Promise.all([ultimasDe(db, negocio, deEstas), ultimasDe(db, negocio, and(deEstas, lt(ultimas.version, version)))])
  const antes = new Map(previas.map((f) => [f.clave, f.contenido === null ? null : elementoDe(f)]))
  return new Map(ahora.map((f) => [comoClave(f.clave), { ultima: comoVersion(f.version), antes: antes.get(f.clave) ?? null }]))
}
