/**
 * La vista previa de una propuesta, por tipo (decisiones 6 y 11). `describir` no llama al modelo ni lee la base.
 * `conversaciones` corre el Agente de clientes de verdad, en ensayo, sobre los escenarios de las reglas y sobre
 * conversaciones reales recientes, con el estado de hoy y con el borrador. Lo que se guarda son referencias, cuentas
 * y acciones: nunca texto de un Cliente. Si una muestra falla, la propuesta igual espera el botón, con la advertencia.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { costoUsd } from '@/lib/modelo'
import { conPropuesta, type CambioDeElemento, type EstadoBorrador, type EstadoDelNegocio, type Escritura, type EstadoVigente } from '../estado'
import { VISTA_PREVIA, type Clave, type ElementoDe, type ProfundidadDeVistaPrevia } from '../estado/elementos'
import type { ClienteId, Marca, Wamid } from '../identidad'
import type { AccionHecha } from '../clientes/acciones'
import { entornoDeEnsayo, MOTORES, pedidoDelCliente, turno, type ClienteDelTurno, type Conversacion, type Motores, type TurnoDeConversacion } from '../clientes/turno'
import type { Revision } from '../salida/revisar'

export type MensajeDeClienteId = Marca<string, 'MensajeDeClienteId'>

const ORDEN = { describir: 0, conversaciones: 1 } as const satisfies Record<ProfundidadDeVistaPrevia, number>

/** Pura. La más honda de los tipos que toca la escritura, también de lo que quita. */
export function profundidadDe(hoy: EstadoDelNegocio, escritura: Escritura): ProfundidadDeVistaPrevia {
  const tipos = escritura.elementos.flatMap((c) => {
    const tipo = (c.despues ?? hoy.vigente(c.clave)?.elemento)?.tipo
    return tipo ? [tipo] : []
  })
  return tipos.reduce<ProfundidadDeVistaPrevia>((hondo, t) => (ORDEN[VISTA_PREVIA[t]] > ORDEN[hondo] ? VISTA_PREVIA[t] : hondo), 'describir')
}

export const MUESTRAS = { reales: 6, concurrencia: 4, relojPorTurnoMs: 25_000, historial: 20 } as const

/** Una muestra por referencia. Los escenarios son texto del Dueño y viven en la regla; se nombran por índice. */
export type Muestra =
  | { readonly origen: 'escenario'; readonly regla: Clave; readonly lista: 'activan' | 'noActivan'; readonly indice: number }
  | { readonly origen: 'real'; readonly mensaje: MensajeDeClienteId }

/** Lo que pasó en un turno ensayado, sin texto. */
export type LoQuePaso = {
  readonly acciones: readonly AccionHecha['nombre'][]
  readonly reglasActivas: readonly Clave[]
  readonly revision: Revision['tipo']
  readonly corregido: 'no' | 'si' | 'respaldo'
}

export type Ensayo =
  | {
      readonly muestra: Muestra
      /** `null` en los escenarios: con el estado de hoy la regla no existe. */
      readonly hoy: LoQuePaso | null
      readonly conElCambio: LoQuePaso
      /** Contra `esperado` del escenario, por acciones. `null` en una real. */
      readonly cumpleLoEsperado: boolean | null
    }
  | { readonly muestra: Muestra; readonly fallo: 'error' | 'reloj' }

export type VistaPreviaDeConversaciones = {
  readonly ensayos: readonly Ensayo[]
  readonly probadas: number
  /** Reales en las que el agente actuaría distinto con el cambio. */
  readonly cambiaron: number
  readonly frenadasPorElNucleo: number
  readonly fallaron: number
}

/**
 * Lo que se guarda en `propuestas.vista_previa` y lo que muestra la tarjeta. `lineas` y `advertencias` las escribe el
 * código; solo citan escenarios, que escribió el Dueño. Las filas viejas traen solo `lineas`.
 */
export type VistaPreviaGuardada = {
  readonly lineas: readonly string[]
  readonly advertencias?: readonly string[]
  readonly conversaciones?: VistaPreviaDeConversaciones | null
}

export type GastoDelEnsayo = { readonly llamadas: number; readonly usd: number; readonly ms: number }

/**
 * Pura. El borrador del ensayo: el estado de hoy, las reglas de las propuestas que esperan el botón (ninguna que toque
 * una clave de esta propuesta) y esta propuesta encima. Una tarjeta de lectura no aporta nada: no trae reglas.
 */
export function borradorDelEnsayo(hoy: EstadoDelNegocio, escritura: Escritura, pendientes: readonly Escritura[]): EstadoBorrador {
  const propias = new Set(escritura.elementos.map((c) => c.clave))
  const reglas = new Map<Clave, CambioDeElemento>()
  for (const p of pendientes) for (const c of p.elementos) if (c.despues?.tipo === 'regla' && !propias.has(c.clave)) reglas.set(c.clave, c)
  return conPropuesta(hoy, { elementos: [...reglas.values(), ...escritura.elementos], filas: [] })
}

const loQuePaso = (t: { readonly acciones: readonly AccionHecha[]; readonly reglasActivas: readonly Clave[]; readonly revision: Revision; readonly corregido: LoQuePaso['corregido'] }): LoQuePaso => ({
  acciones: t.acciones.map((a) => a.nombre),
  reglasActivas: t.reglasActivas,
  revision: t.revision.tipo,
  corregido: t.corregido,
})

/** Lo que un cambio de regla o de voz mueve: qué reglas valen, si se abre un Caso y si el núcleo corrige. Las demás acciones varían de una corrida a otra. */
const huellaDelEnsayo = (l: LoQuePaso) => JSON.stringify([[...l.reglasActivas].sort(), l.acciones.includes('abrir_caso'), l.corregido])
const distinto = (a: LoQuePaso, b: LoQuePaso) => huellaDelEnsayo(a) !== huellaDelEnsayo(b)

const CLIENTE_DE_EJEMPLO: ClienteDelTurno = { id: '00000000-0000-4000-8000-00000000e5e0' as ClienteId, nombre: '', telefono: null, pedidos: [] }

type Real = { readonly mensaje: MensajeDeClienteId; readonly conversacion: Conversacion }

/** Los Clientes con mensajes más recientes del Negocio, uno por Cliente, con su historial y sus pedidos. Solo lee. */
async function conversacionesReales(hoy: EstadoDelNegocio): Promise<readonly Real[]> {
  const negocio = hoy.identidad.id
  const recientes = await db
    .select({ cliente: esquema.mensajesCliente.clienteId, ultimo: sql<Date>`max(${esquema.mensajesCliente.creado})` })
    .from(esquema.mensajesCliente)
    .where(and(eq(esquema.mensajesCliente.negocioId, negocio), eq(esquema.mensajesCliente.rol, 'cliente')))
    .groupBy(esquema.mensajesCliente.clienteId)
    .orderBy(desc(sql`max(${esquema.mensajesCliente.creado})`))
    .limit(MUESTRAS.reales)
  if (!recientes.length) return []
  const ids = recientes.map((r) => r.cliente)
  const [clientes, pedidos] = await Promise.all([
    db.select().from(esquema.clientes).where(and(eq(esquema.clientes.negocioId, negocio), inArray(esquema.clientes.id, ids))),
    db.select().from(esquema.pedidos).where(and(eq(esquema.pedidos.negocioId, negocio), inArray(esquema.pedidos.clienteId, ids))).orderBy(desc(esquema.pedidos.creado)),
  ])
  return Promise.all(
    recientes.map(async ({ cliente }): Promise<Real> => {
      const mensajes = (
        await db
          .select({ id: esquema.mensajesCliente.id, rol: esquema.mensajesCliente.rol, texto: esquema.mensajesCliente.texto, creado: esquema.mensajesCliente.creado })
          .from(esquema.mensajesCliente)
          .where(and(eq(esquema.mensajesCliente.clienteId, cliente), eq(esquema.mensajesCliente.negocioId, negocio)))
          .orderBy(desc(esquema.mensajesCliente.creado))
          .limit(MUESTRAS.historial + 10)
      ).reverse()
      const i = mensajes.findLastIndex((m) => m.rol === 'cliente')
      const ultimo = mensajes[i]
      const fila = clientes.find((c) => c.id === cliente)
      return {
        mensaje: ultimo.id as MensajeDeClienteId,
        conversacion: {
          cliente: { id: cliente as ClienteId, nombre: fila?.nombre ?? '', telefono: fila?.telefono ?? null, pedidos: pedidos.filter((p) => p.clienteId === cliente).slice(0, 5).map(pedidoDelCliente) },
          historial: mensajes.slice(Math.max(0, i - MUESTRAS.historial), i).map((m): TurnoDeConversacion => ({ rol: m.rol, texto: m.texto })),
          mensaje: { texto: ultimo.texto, wamid: `ensayo:${ultimo.id}` as Wamid, enviadoEn: ultimo.creado.toISOString() as Conversacion['mensaje']['enviadoEn'] },
        },
      }
    }),
  )
}

/** Las escrituras de las propuestas del Negocio que esperan el botón. De ellas, `borradorDelEnsayo` solo toma reglas. */
async function pendientesDe(hoy: EstadoDelNegocio): Promise<readonly Escritura[]> {
  const filas = await db
    .select({ escritura: esquema.propuestas.escritura })
    .from(esquema.propuestas)
    .where(and(eq(esquema.propuestas.negocioId, hoy.identidad.id), eq(esquema.propuestas.estado, 'espera_al_dueno'), sql`${esquema.propuestas.vence} > now()`))
  return filas.map((f) => f.escritura)
}

async function conReloj<T>(trabajo: Promise<T>): Promise<T | 'reloj'> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([trabajo, new Promise<'reloj'>((listo) => (reloj = setTimeout(() => listo('reloj'), MUESTRAS.relojPorTurnoMs)))])
  } finally {
    clearTimeout(reloj)
  }
}

/** Corre hasta `concurrencia` trabajos a la vez, en orden de llegada. */
async function aLaVez<T, R>(cosas: readonly T[], trabajo: (t: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(cosas.length)
  let siguiente = 0
  await Promise.all(
    Array.from({ length: Math.min(MUESTRAS.concurrencia, cosas.length) }, async () => {
      while (siguiente < cosas.length) {
        const i = siguiente++
        salida[i] = await trabajo(cosas[i])
      }
    }),
  )
  return salida
}

/**
 * Pura. Las advertencias y las líneas que suma el ensayo a la tarjeta. Una conversación real se cuenta, nunca se cita;
 * un mensaje de ejemplo sí, porque lo escribió el Dueño.
 */
export function enPalabras(v: VistaPreviaDeConversaciones, escenarioDe: (m: Extract<Muestra, { origen: 'escenario' }>) => string): { readonly advertencias: readonly string[]; readonly lineas: readonly string[] } {
  const total = v.ensayos.length
  const advertencias = [
    ...(v.fallaron ? [`No pude ensayar ${v.fallaron} de ${total} conversaciones: revisa con calma antes de aplicar.`] : []),
    ...v.ensayos.flatMap((e) => ('fallo' in e || e.cumpleLoEsperado !== false || e.muestra.origen !== 'escenario' ? [] : [`En el mensaje de ejemplo «${escenarioDe(e.muestra)}» tu agente no hizo lo esperado.`])),
  ]
  const reales = v.ensayos.filter((e) => e.muestra.origen === 'real' && !('fallo' in e)).length
  const escenarios = v.ensayos.filter((e) => e.muestra.origen === 'escenario' && !('fallo' in e))
  const cumplen = escenarios.filter((e) => !('fallo' in e) && e.cumpleLoEsperado).length
  const lineas = [
    ...(escenarios.length ? [`Probé ${escenarios.length} ${escenarios.length === 1 ? 'mensaje' : 'mensajes'} de ejemplo: en ${cumplen} tu agente hizo lo esperado.`] : []),
    ...(reales ? [`Probé ${reales} ${reales === 1 ? 'conversación reciente' : 'conversaciones recientes'}: en ${v.cambiaron} tu agente actuaría distinto con este cambio.`] : []),
    ...(v.frenadasPorElNucleo ? [`En ${v.frenadasPorElNucleo} la respuesta la frenaría el núcleo y te abriría un Caso.`] : []),
  ]
  return { advertencias, lineas }
}

/**
 * La vista previa de una propuesta, por tipo. La llama `proponerComo` entre `traducir` y el INSERT. `turno` corre en
 * ensayo con `puertoEnMemoria`: no escribe pedidos ni Casos y devuelve una intención que `despachar` no acepta.
 */
export async function vistaPreviaDe(
  hoy: EstadoVigente,
  escritura: Escritura,
  lineas: readonly string[],
  motores: Motores = MOTORES,
): Promise<{ readonly guardada: VistaPreviaGuardada; readonly gasto: GastoDelEnsayo }> {
  if (profundidadDe(hoy, escritura) === 'describir') return { guardada: { lineas, advertencias: [], conversaciones: null }, gasto: { llamadas: 0, usd: 0, ms: 0 } }
  const inicio = Date.now()
  const [pendientes, reales] = await Promise.all([pendientesDe(hoy), conversacionesReales(hoy)])
  const borrador = borradorDelEnsayo(hoy, escritura, pendientes)
  const reglas = borrador.vigentes('regla').filter((v) => escritura.elementos.some((c) => c.clave === v.clave) || pendientes.some((p) => p.elementos.some((c) => c.clave === v.clave)))
  const escenarios = reglas.flatMap((v) =>
    (['activan', 'noActivan'] as const).flatMap((lista) => v.elemento.escenarios[lista].map((escenario, indice) => ({ muestra: { origen: 'escenario' as const, regla: v.clave, lista, indice }, escenario }))),
  )
  let llamadas = 0
  let entrada = 0
  let salida = 0
  const ensayar = async (estado: EstadoDelNegocio, conversacion: Conversacion): Promise<LoQuePaso> => {
    const t = await turno(estado, conversacion, entornoDeEnsayo(estado, conversacion.cliente), motores)
    llamadas += t.gasto.llamadas
    entrada += t.gasto.entrada
    salida += t.gasto.salida
    return loQuePaso(t)
  }
  const trabajos: { readonly muestra: Muestra; correr(): Promise<Ensayo> }[] = [
    ...escenarios.map(({ muestra, escenario }) => ({
      muestra,
      async correr(): Promise<Ensayo> {
        const mensaje = { texto: escenario.mensajeDelCliente, wamid: `ensayo:${muestra.regla}:${muestra.lista}:${muestra.indice}` as Wamid, enviadoEn: new Date().toISOString() as Conversacion['mensaje']['enviadoEn'] }
        const conElCambio = await ensayar(borrador, { cliente: CLIENTE_DE_EJEMPLO, historial: [], mensaje })
        const cumple = escenario.esperado.hace.every((a) => conElCambio.acciones.includes(a)) && !escenario.esperado.noHace.some((a) => conElCambio.acciones.includes(a))
        return { muestra, hoy: null, conElCambio, cumpleLoEsperado: cumple }
      },
    })),
    ...reales.map((r) => {
      const muestra: Muestra = { origen: 'real', mensaje: r.mensaje }
      return {
        muestra,
        async correr(): Promise<Ensayo> {
          const [deHoy, conElCambio] = await Promise.all([ensayar(hoy, r.conversacion), ensayar(borrador, r.conversacion)])
          return { muestra, hoy: deHoy, conElCambio, cumpleLoEsperado: null }
        },
      }
    }),
  ]
  const ensayos = await aLaVez(trabajos, async ({ muestra, correr }): Promise<Ensayo> => {
    try {
      const r = await conReloj(correr())
      return r === 'reloj' ? { muestra, fallo: 'reloj' } : r
    } catch (e) {
      console.warn('[ensayar] una muestra falló', e instanceof Error ? e.message : e)
      return { muestra, fallo: 'error' }
    }
  })
  const conversaciones: VistaPreviaDeConversaciones = {
    ensayos,
    probadas: ensayos.filter((e) => !('fallo' in e)).length,
    cambiaron: ensayos.filter((e) => !('fallo' in e) && e.hoy !== null && distinto(e.hoy, e.conElCambio)).length,
    frenadasPorElNucleo: ensayos.filter((e) => !('fallo' in e) && e.conElCambio.corregido === 'respaldo').length,
    fallaron: ensayos.filter((e) => 'fallo' in e).length,
  }
  const textoDe = (m: Extract<Muestra, { origen: 'escenario' }>) => (borrador.vigente(m.regla)?.elemento as ElementoDe<'regla'> | undefined)?.escenarios[m.lista][m.indice]?.mensajeDelCliente ?? ''
  const palabras = enPalabras(conversaciones, textoDe)
  return {
    guardada: { lineas: [...lineas, ...palabras.lineas], advertencias: palabras.advertencias, conversaciones },
    gasto: { llamadas, usd: costoUsd(entrada, salida), ms: Date.now() - inicio },
  }
}

type Es<A extends true> = A
/** Ninguna hoja de lo guardado de un ensayo es un `string` sin marca: no hay por dónde guardar texto de un Cliente. */
type SinTextoLibre<T> = T extends Marca<string, string>
  ? true
  : T extends string
    ? string extends T
      ? false
      : true
    : T extends readonly (infer U)[]
      ? SinTextoLibre<U>
      : T extends object
        ? { [K in keyof T]-?: SinTextoLibre<T[K]> }[keyof T] extends true
          ? true
          : false
        : true
type _ConversacionesSinTexto = Es<SinTextoLibre<VistaPreviaDeConversaciones>>
export type ComprobacionesDelEnsayo = [_ConversacionesSinTexto]
