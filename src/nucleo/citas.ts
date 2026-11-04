/**
 * El único que escribe en `citas`, y lo que el Panel lee de ellas. El conflicto lo decide la base con sus dos índices
 * únicos: después de cada escritura que no entró se vuelve a leer, y lo leído decide, no el error.
 */
import { and, asc, desc, eq, gt, inArray, lte, ne, or, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { EstadoDeCita } from '@/db/esquema'
import { enPalabras, enUnaFila, estadoVisibleDeCita, DIAS_DEL_CALENDARIO, type AgendaDelTurno, type EscrituraDeCita, type EstadoVisibleDeCita } from './citas-palabras'
import type { ClienteId, NegocioId } from './identidad'
import { nombreDelCliente } from './listas-palabras'

const { citas } = esquema

export type PedidoDeCita = { readonly inicio: Date; readonly asunto: string; readonly cambiaLaQueTiene: boolean }
export type NegativaDeCita = { readonly negada: 'ocupada'; readonly ocupadasDelDia: readonly Date[] } | { readonly negada: 'ya_tiene_cita'; readonly tiene: Date }

const vivaDelCliente = (negocio: NegocioId, cliente: ClienteId) => and(eq(citas.negocioId, negocio), eq(citas.clienteId, cliente), eq(citas.estado, 'agendada'))

async function ocupadasAlrededor(negocio: NegocioId, inicio: Date): Promise<readonly Date[]> {
  const filas = await db
    .select({ inicio: citas.inicio })
    .from(citas)
    .where(and(eq(citas.negocioId, negocio), eq(citas.estado, 'agendada'), gt(citas.inicio, new Date(inicio.getTime() - 86_400_000)), lte(citas.inicio, new Date(inicio.getTime() + 86_400_000))))
    .orderBy(asc(citas.inicio))
  return filas.map((f) => f.inicio)
}

const ocupadaPorOtro = async (negocio: NegocioId, cliente: ClienteId, inicio: Date) => {
  const [otra] = await db
    .select({ id: citas.id })
    .from(citas)
    .where(and(eq(citas.negocioId, negocio), eq(citas.estado, 'agendada'), eq(citas.inicio, inicio), ne(citas.clienteId, cliente)))
  return Boolean(otra)
}

/**
 * Converge: repetirla con la misma hora devuelve lo mismo, y es lo que pasa si el Cliente repite el sí porque el primer
 * mensaje no le llegó. Lo que perdió la carrera contra otro mensaje del mismo Cliente se vuelve a mirar una vez.
 */
export async function guardarCita(negocio: NegocioId, cliente: ClienteId, e: PedidoDeCita, intento = 0): Promise<EscrituraDeCita | NegativaDeCita> {
  const ahora = new Date()
  const [tiene] = await db.select({ id: citas.id, inicio: citas.inicio, movidaDe: citas.movidaDe }).from(citas).where(vivaDelCliente(negocio, cliente))
  const sigueViva = tiene && tiene.inicio.getTime() > ahora.getTime()

  if (sigueViva && tiene.inicio.getTime() === e.inicio.getTime()) return { tipo: tiene.movidaDe ? 'movida' : 'agendada', inicio: tiene.inicio, antes: tiene.movidaDe }
  if (sigueViva && !e.cambiaLaQueTiene) return { negada: 'ya_tiene_cita', tiene: tiene.inicio }

  if (sigueViva) {
    try {
      const [movida] = await db
        .update(citas)
        .set({ inicio: e.inicio, movidaDe: tiene.inicio, actualizado: sql`now()`, ...(e.asunto ? { asunto: e.asunto } : {}) })
        .where(and(eq(citas.id, tiene.id), eq(citas.estado, 'agendada'), eq(citas.inicio, tiene.inicio)))
        .returning({ inicio: citas.inicio })
      if (movida) return { tipo: 'movida', inicio: movida.inicio, antes: tiene.inicio }
    } catch (error) {
      if (await ocupadaPorOtro(negocio, cliente, e.inicio)) return { negada: 'ocupada', ocupadasDelDia: await ocupadasAlrededor(negocio, e.inicio) }
      // Quien la tenía la soltó justo después del choque: otra vuelta la puede tomar. Si era otro error, ahí se repite.
      if (intento >= 1) throw error
    }
  } else {
    // La vieja suelta `citas_una_por_cliente` en el mismo batch. Si la inserción no entra, soltarla no daña nada: ya pasó.
    const [, nueva] = await db.batch([
      db
        .update(citas)
        .set({ estado: 'pasada', actualizado: sql`now()` })
        .where(and(vivaDelCliente(negocio, cliente), lte(citas.inicio, ahora))),
      db.insert(citas).values({ negocioId: negocio, clienteId: cliente, inicio: e.inicio, asunto: e.asunto }).onConflictDoNothing().returning({ inicio: citas.inicio }),
    ])
    if (nueva[0]) return { tipo: 'agendada', inicio: nueva[0].inicio, antes: null }
    if (await ocupadaPorOtro(negocio, cliente, e.inicio)) return { negada: 'ocupada', ocupadasDelDia: await ocupadasAlrededor(negocio, e.inicio) }
  }
  if (intento >= 1) throw new Error('La cita cambió dos veces mientras se guardaba')
  return guardarCita(negocio, cliente, e, intento + 1)
}

/** Una cita que ya pasó no se cancela. Sin cita viva, `null`. */
export async function cancelarCita(negocio: NegocioId, cliente: ClienteId): Promise<EscrituraDeCita | null> {
  const [cancelada] = await db
    .update(citas)
    .set({ estado: 'cancelada', actualizado: sql`now()` })
    .where(and(vivaDelCliente(negocio, cliente), gt(citas.inicio, sql`now()`)))
    .returning({ inicio: citas.inicio })
  return cancelada ? { tipo: 'cancelada', inicio: cancelada.inicio, antes: null } : null
}

/** Las horas ocupadas no llevan de quién son: esto entra al prompt del turno de otro Cliente. */
export async function leerAgendaDelTurno(negocio: NegocioId, cliente: ClienteId): Promise<AgendaDelTurno> {
  const hasta = new Date(Date.now() + (DIAS_DEL_CALENDARIO + 1) * 86_400_000)
  const filas = await db
    .select({ inicio: citas.inicio, asunto: citas.asunto, clienteId: citas.clienteId })
    .from(citas)
    .where(and(eq(citas.negocioId, negocio), eq(citas.estado, 'agendada'), gt(citas.inicio, sql`now()`), or(lte(citas.inicio, hasta), eq(citas.clienteId, cliente))))
    .orderBy(asc(citas.inicio))
  const suya = filas.find((f) => f.clienteId === cliente)
  return { ocupadas: filas.map((f) => f.inicio), cita: suya ? { inicio: suya.inicio, asunto: suya.asunto } : null }
}

export type FilaDeCita = { id: string; clienteId: string; cliente: string; cuando: string; asunto: string; estado: EstadoVisibleDeCita; antes: string | null }
export type GrupoDeCitas = { clave: 'hoy' | 'proximas' | 'anteriores'; nombre: string; cuenta: number; filas: FilaDeCita[] }
export type DatosDeAgenda = { grupos: GrupoDeCitas[] }

const CUANTAS_POR_GRUPO = 50

const filaDeCita = (zona: string, ahora: Date) => (f: { id: string; clienteId: string; nombre: string; telefono: string; inicio: Date; asunto: string; estado: EstadoDeCita; movidaDe: Date | null }): FilaDeCita => ({
  id: f.id,
  clienteId: f.clienteId,
  cliente: nombreDelCliente(f.nombre, f.telefono),
  cuando: enUnaFila(f.inicio, zona, ahora),
  asunto: f.asunto,
  estado: estadoVisibleDeCita(f, ahora),
  antes: f.movidaDe && f.estado === 'agendada' ? enPalabras(f.movidaDe, zona) : null,
})

const consultaDeFilas = (negocio: NegocioId) =>
  db
    .select({ id: citas.id, clienteId: citas.clienteId, nombre: esquema.clientes.nombre, telefono: esquema.clientes.telefono, inicio: citas.inicio, asunto: citas.asunto, estado: citas.estado, movidaDe: citas.movidaDe })
    .from(citas)
    .innerJoin(esquema.clientes, and(eq(esquema.clientes.id, citas.clienteId), eq(esquema.clientes.negocioId, negocio)))

/** Hoy y lo que viene, de lo más cercano a lo más lejano. Lo que ya pasó y lo cancelado va al final, lo más reciente primero. */
export async function leerAgenda(negocio: NegocioId, zona: string): Promise<DatosDeAgenda> {
  const ahora = new Date()
  const z = sql`${zona}::text`
  const esDeHoy = sql`(${citas.inicio} at time zone ${z})::date = (now() at time zone ${z})::date`
  const viva = and(eq(citas.negocioId, negocio), eq(citas.estado, 'agendada'), gt(citas.inicio, sql`now()`))
  const anterior = and(eq(citas.negocioId, negocio), or(inArray(citas.estado, ['cancelada', 'pasada']), lte(citas.inicio, sql`now()`)))
  const cuantas = (donde: ReturnType<typeof and>) => db.$count(citas, donde)
  const [deHoy, proximas, anteriores, nHoy, nProximas, nAnteriores] = await Promise.all([
    consultaDeFilas(negocio).where(and(viva, esDeHoy)).orderBy(asc(citas.inicio)).limit(CUANTAS_POR_GRUPO),
    consultaDeFilas(negocio).where(and(viva, sql`not ${esDeHoy}`)).orderBy(asc(citas.inicio)).limit(CUANTAS_POR_GRUPO),
    consultaDeFilas(negocio).where(anterior).orderBy(desc(citas.inicio)).limit(CUANTAS_POR_GRUPO),
    cuantas(and(viva, esDeHoy)),
    cuantas(and(viva, sql`not ${esDeHoy}`)),
    cuantas(anterior),
  ])
  const aFila = filaDeCita(zona, ahora)
  const grupos: GrupoDeCitas[] = [
    { clave: 'hoy', nombre: 'Hoy', cuenta: nHoy, filas: deHoy.map(aFila) },
    { clave: 'proximas', nombre: 'Próximas', cuenta: nProximas, filas: proximas.map(aFila) },
    { clave: 'anteriores', nombre: 'Ya pasaron o se cancelaron', cuenta: nAnteriores, filas: anteriores.map(aFila) },
  ]
  return { grupos: grupos.filter((g) => g.cuenta > 0) }
}

export type CitasDelTablero = { porDia: { dia: string; citas: number }[]; proximas: FilaDeCita[] }

const CUANTAS_EN_EL_TABLERO = 5

/** `porDia` es la semana entera de lunes a domingo, para que sume lo mismo que `Citas de la semana`. Una cancelada no cuenta. */
export async function leerCitasDelTablero(negocio: NegocioId, zona: string): Promise<CitasDelTablero> {
  const ahora = new Date()
  const z = sql`${zona}::text`
  const [dias, proximas] = await Promise.all([
    db.execute(sql`
      with t as (select date_trunc('week', now() at time zone ${z}) as lunes)
      select to_char(d, 'YYYY-MM-DD') as dia, count(c.id)::int as citas
      from t cross join generate_series(t.lunes, t.lunes + interval '6 days', interval '1 day') as d
      left join citas c on c.negocio_id = ${negocio} and c.estado <> 'cancelada' and (c.inicio at time zone ${z})::date = d::date
      group by d
      order by d
    `),
    consultaDeFilas(negocio)
      .where(and(eq(citas.negocioId, negocio), eq(citas.estado, 'agendada'), gt(citas.inicio, sql`now()`)))
      .orderBy(asc(citas.inicio))
      .limit(CUANTAS_EN_EL_TABLERO),
  ])
  return { porDia: dias.rows as CitasDelTablero['porDia'], proximas: proximas.map(filaDeCita(zona, ahora)) }
}
