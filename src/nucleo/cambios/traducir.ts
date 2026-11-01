/**
 * Cada `Quiere` a una `Escritura`, sin modelo. El único lugar que ramifica por `Quiere`. Puro salvo `revertir` y
 * `responder_caso`, que leen la base.
 */
import { and, eq } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { MotivoDeFaltante } from '../capacidades'
import { historiaParaRevertir, otrosNegocios, validarEscritura, type CambioDeElemento, type Escritura, type EstadoVigente } from '../estado'
import { claveNueva, comoVersion, definicionDe, describirCambio, sinCumplidorHoy, type Alcance, type Clave, type Elemento, type Problema } from '../estado/elementos'
import { marcar, type CasoId, type NegocioId, type PropuestaId } from '../identidad'
import { fueraDeVentana } from '../salida/compuerta'
import { revisarTextoDelDueno } from '../salida/revisar'

export const LARGO_DE_UNA_RESPUESTA = 4000

export type QuierePoner = { readonly tipo: 'poner'; readonly elemento: Elemento; readonly reemplaza: Clave | null }
export type Acto = { readonly tipo: 'responder_caso'; readonly caso: CasoId; readonly texto: string }
export type QuiereDeElementos =
  | QuierePoner
  | { readonly tipo: 'quitar'; readonly claves: readonly [Clave, ...Clave[]] }
  | { readonly tipo: 'revertir'; readonly propuesta: PropuestaId }
  | Acto

export type Traduccion = {
  readonly escritura: Escritura
  readonly actos: readonly Acto[]
  readonly revierte: PropuestaId | null
  readonly alcance: Alcance
  /** Lo que lee el Dueño en la tarjeta: `describir(antes, despues)` de cada clave, y cada acto. */
  readonly lineas: readonly string[]
}

export type SinTraduccion = { readonly tipo: 'corregir'; readonly problemas: readonly Problema[] } | { readonly tipo: 'faltante'; readonly motivo: MotivoDeFaltante }

const invalido = (campo: string, porQue: string): Problema => ({ tipo: 'valor_invalido', campo, porQue })
const corregir = (...problemas: Problema[]): SinTraduccion => ({ tipo: 'corregir', problemas })
const ahora = () => marcar.instante(new Date())

/** Varias `Quiere` se suman en una sola Escritura; dos sobre la misma clave se corrigen. */
export async function traducir(estado: EstadoVigente, quiere: readonly QuiereDeElementos[]): Promise<Traduccion | SinTraduccion> {
  const negocio = estado.identidad.id
  const cambios: CambioDeElemento[] = []
  const actos: Acto[] = []
  const lineas: string[] = []
  const problemas: Problema[] = []
  let revierte: PropuestaId | null = null
  const tocar = (c: CambioDeElemento) => {
    if (cambios.some((x) => x.clave === c.clave)) problemas.push(invalido('quiere', `Dos cosas del mismo pedido tocan ${c.clave}: júntalas en una`))
    else cambios.push(c)
  }

  for (const q of quiere) {
    switch (q.tipo) {
      case 'poner': {
        const fija = definicionDe(q.elemento.tipo).claveFija(q.elemento)
        if (q.reemplaza) {
          const v = estado.vigente(q.reemplaza)
          if (!v || v.elemento.tipo !== q.elemento.tipo) {
            problemas.push({ tipo: 'referencia_rota', clave: q.reemplaza })
            continue
          }
          if (fija && fija !== q.reemplaza) {
            problemas.push(invalido('reemplaza', `${q.reemplaza} no es ${fija}: para cambiar ${fija} no hace falta reemplaza`))
            continue
          }
        }
        const clave = q.reemplaza ?? fija ?? claveNueva(q.elemento.tipo)
        tocar({ clave, base: estado.vigente(clave)?.version ?? 'nueva', despues: q.elemento })
        break
      }
      case 'quitar':
        for (const clave of q.claves) {
          const v = estado.vigente(clave)
          if (v) tocar({ clave, base: v.version, despues: null })
          else problemas.push({ tipo: 'referencia_rota', clave })
        }
        break
      case 'revertir': {
        if (quiere.length > 1) return corregir(invalido('quiere', 'Deshacer algo va solo, en su propia propuesta'))
        const r = await reversion(estado, q.propuesta)
        if ('tipo' in r) return r
        for (const c of r.cambios) tocar(c)
        lineas.push(...r.lineas)
        revierte = q.propuesta
        break
      }
      case 'responder_caso': {
        const r = await respuesta(negocio, q)
        if ('problema' in r) problemas.push(r.problema)
        else {
          actos.push(q)
          lineas.push(`Responderle a ${r.nombre || 'el Cliente'}: «${q.texto}»`)
        }
        break
      }
    }
  }
  if (problemas.length) return corregir(...problemas)
  if (!cambios.length && !actos.length) return corregir(invalido('quiere', 'El pedido no dice qué cambiar'))

  const escritura: Escritura = { elementos: cambios, filas: [] }
  const sinCumplidor = new Set(cambios.flatMap((c) => (c.despues?.tipo === 'regla' ? sinCumplidorHoy(c.despues) : [])))
  if (sinCumplidor.size) return { tipo: 'faltante', motivo: { tipo: 'sin_cumplidor', que: [...sinCumplidor] } }
  const v = validarEscritura(estado, escritura)
  if (v.tipo === 'invalida') problemas.push(...v.problemas)
  const otros = cambios.some((c) => c.despues) ? await otrosNegocios(estado) : []
  for (const c of cambios) if (c.despues) for (const t of definicionDe(c.despues.tipo).textos(c.despues)) for (const motivo of revisarTextoDelDueno(t.texto, otros)) problemas.push({ tipo: 'norma', campo: t.campo, motivo })
  if (problemas.length) return corregir(...problemas)

  const alcances = cambios.flatMap((c) => {
    const tipo = (c.despues ?? estado.vigente(c.clave)?.elemento)?.tipo
    return tipo ? [definicionDe(tipo).alcance] : []
  })
  return {
    escritura,
    actos,
    revierte,
    alcance: actos.length || alcances.includes('clientes') || !alcances.length ? 'clientes' : 'panel',
    lineas: revierte ? lineas : [...cambios.map((c) => describirCambio(estado.vigente(c.clave)?.elemento ?? null, c.despues)), ...lineas],
  }
}

/** Cada clave que la propuesta escribió y nadie tocó después vuelve a lo de antes. */
async function reversion(estado: EstadoVigente, propuesta: PropuestaId): Promise<{ readonly cambios: readonly CambioDeElemento[]; readonly lineas: readonly string[] } | SinTraduccion> {
  const [p] = await db
    .select({ estado: esquema.propuestas.estado, actos: esquema.propuestas.actos, revierte: esquema.propuestas.revierte, escritura: esquema.propuestas.escritura, version: esquema.propuestas.version })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.id, propuesta), eq(esquema.propuestas.negocioId, estado.identidad.id)))
  const no = (porQue: string) => corregir(invalido('propuesta', porQue))
  if (!p || p.estado !== 'aplicada' || p.version === null) return no('Esa propuesta no está aplicada')
  if (p.actos.length) return no('Una respuesta que ya le llegó a un Cliente no se deshace')
  if (p.revierte) return no('Deshacer una reversión no se puede: para volver a tenerlo, pídelo de nuevo')
  const [revertida] = await db
    .select({ id: esquema.propuestas.id })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.revierte, propuesta), eq(esquema.propuestas.estado, 'aplicada')))
  if (revertida) return no('Eso ya se deshizo')
  if (!p.escritura.elementos.length) return no('Eso se aplicó antes del cambio de sistema: pídelo de nuevo')

  const historia = await historiaParaRevertir(estado.identidad.id, p.escritura.elementos.map((c) => c.clave), comoVersion(p.version))
  const cambios: CambioDeElemento[] = []
  const lineas: string[] = []
  for (const { clave } of p.escritura.elementos) {
    const h = historia.get(clave)
    const vigente = estado.vigente(clave)
    if (!h || h.ultima !== p.version) {
      lineas.push(`No se deshace ${describirCambio(null, vigente?.elemento ?? null) || clave}: lo cambió otra propuesta después`)
      continue
    }
    if (!h.antes && !vigente) continue
    cambios.push({ clave, base: vigente?.version ?? 'nueva', despues: h.antes })
    lineas.unshift(`Deshacer: ${describirCambio(vigente?.elemento ?? null, h.antes)}`)
  }
  if (!cambios.length) return no('Todo lo de esa propuesta ya lo cambió otra después')
  return { cambios, lineas }
}

/** Lo de hoy: un Caso de este Negocio, sin resolver, con Cliente y dentro de la ventana de 24 horas. */
async function respuesta(negocio: NegocioId, acto: Acto): Promise<{ readonly problema: Problema } | { readonly nombre: string }> {
  const no = (problema: Problema) => ({ problema })
  if (!acto.texto.trim() || acto.texto.length > LARGO_DE_UNA_RESPUESTA) return no(invalido('texto', `La respuesta tiene que tener texto, y no más de ${LARGO_DE_UNA_RESPUESTA} caracteres`))
  const [caso] = await db
    .select({ estado: esquema.casos.estado, cliente: esquema.clientes.id, nombre: esquema.clientes.nombre, ultimo: esquema.clientes.ultimoMensajeEntrante })
    .from(esquema.casos)
    .leftJoin(esquema.clientes, and(eq(esquema.clientes.id, esquema.casos.clienteId), eq(esquema.clientes.negocioId, esquema.casos.negocioId)))
    .where(and(eq(esquema.casos.id, acto.caso), eq(esquema.casos.negocioId, negocio)))
  if (!caso) return no(invalido('caso', 'No encontré ese Caso en este Negocio'))
  if (caso.estado === 'resuelto') return no({ tipo: 'caso_resuelto', caso: acto.caso })
  if (!caso.cliente) return no(invalido('cliente', 'Ese Caso no tiene un Cliente al que escribirle'))
  if (fueraDeVentana(caso.ultimo ? marcar.instante(caso.ultimo) : null, ahora())) return no({ tipo: 'fuera_de_ventana', cliente: marcar.cliente(caso.cliente) })
  return { nombre: caso.nombre ?? '' }
}

