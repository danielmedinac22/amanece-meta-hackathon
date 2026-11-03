import { and, eq, sql, type SQL } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { marcar, type ClienteId, type DuenoId, type NegocioId, type VezDeToma, type Wamid } from '../identidad'
import type { ClaseDeMensaje, Habla, MotivoDeSilencio } from './compuerta'

/**
 * Quién atiende a un Cliente. Todo cambio a las cuatro columnas de `clientes` sale de aquí, y pasa por el candado de esa
 * fila: una toma, un reclamo y un vencimiento quedan en un orden total sin tabla, cola ni cron.
 */
const c = esquema.clientes

export const TOMA_MS = 30 * 60_000
const VIGENCIA = sql.raw(`interval '${TOMA_MS} milliseconds'`)

export const TOMA_VIVA: SQL<boolean> = sql`(${c.tomadaPor} is not null and ${c.tomadaHasta} > now())`
export const QUIEN_LA_TIENE: SQL<string | null> = sql`case when ${TOMA_VIVA} then ${c.tomadaPor} end`

/** Lo que el upsert del webhook escribe: la deuda, salvo si el mensaje es más viejo, y una toma vencida queda suelta. */
export const alNacer = (wamid: Wamid) => ({ sinContestar: wamid })

export function alEntrar(wamid: Wamid) {
  return {
    sinContestar: sql`case when ${c.ultimoMensajeEntrante} is null or excluded.ultimo_mensaje_entrante >= ${c.ultimoMensajeEntrante} then ${wamid} else ${c.sinContestar} end`,
    tomadaPor: sql`case when ${TOMA_VIVA} then ${c.tomadaPor} end`,
    tomadaHasta: sql`case when ${TOMA_VIVA} then ${c.tomadaHasta} end`,
  }
}

export type FilaDeSaliente = {
  readonly clave: string
  readonly negocioId: NegocioId | null
  readonly clienteId: ClienteId
  readonly telefono: string
  readonly clase: ClaseDeMensaje
  readonly enRespuestaA: Wamid | null
  readonly veredicto: 'sale' | 'no_sale'
  readonly motivo: MotivoDeSilencio | null
}

/**
 * El reclamo de quien le habla a un Cliente, en un solo statement. `tomar` sube `veces_tomada` sobre la misma fila: si
 * este statement esperó su candado, Postgres vuelve a evaluar el WHERE y no devuelve fila. Sin filas: no entró, por la
 * cerca o por un choque en `mensajes_salientes`. El turno de lo debido además exige que siga debido: si el Cliente volvió a
 * escribir, o el Dueño le contestó mientras tanto, ya se encargó otro.
 */
export async function reclamarConCerca(f: FilaDeSaliente, habla: Habla): Promise<readonly { readonly id: string }[]> {
  const sigueDebido = habla.tipo === 'agente' && habla.debida ? sql`and sin_contestar = ${f.enRespuestaA}` : sql``
  const cerca =
    habla.tipo === 'agente'
      ? sql`update clientes set sin_contestar = case when sin_contestar = ${f.enRespuestaA} then null else sin_contestar end
            where id = ${f.clienteId} and veces_tomada = ${habla.vez} ${sigueDebido} returning id`
      : sql`update clientes set tomada_hasta = now() + ${VIGENCIA}
            where id = ${f.clienteId} and veces_tomada = ${habla.vez} and tomada_por = ${habla.dueno} and tomada_hasta > now() returning id`
  const { rows } = await db.execute<{ id: string }>(sql`
    with cerca as (${cerca})
    insert into mensajes_salientes (clave, negocio_id, cliente_id, telefono, clase, en_respuesta_a, veredicto, motivo, estado)
    select ${f.clave}, ${f.negocioId}::uuid, cerca.id, ${f.telefono}, ${f.clase}, ${f.enRespuestaA}, ${f.veredicto}, ${f.motivo}, 'por_enviar' from cerca
    on conflict do nothing
    returning id`)
  return rows
}

/** Va en el lote del envío: lo que escribió el Dueño salda la deuda solo si es la que él vio. */
export function saldarConMensajeDelDueno(cliente: ClienteId, visto: Wamid | null) {
  return db
    .update(c)
    .set({ sinContestar: sql`case when ${c.sinContestar} = ${visto} then null else ${c.sinContestar} end` })
    .where(eq(c.id, cliente))
}

/** `null`: ya está tomada, o no es de este Negocio. Una toma vencida sin soltar se pisa y su deuda sigue. */
export async function tomarFila(negocio: NegocioId, cliente: ClienteId, dueno: DuenoId): Promise<{ readonly vez: VezDeToma } | null> {
  const [fila] = await db
    .update(c)
    .set({ tomadaPor: dueno, tomadaHasta: sql`now() + ${VIGENCIA}`, vecesTomada: sql`${c.vecesTomada} + 1` })
    .where(and(eq(c.id, cliente), eq(c.negocioId, negocio), sql`not ${TOMA_VIVA}`))
    .returning({ vez: c.vecesTomada })
  return fila ? { vez: marcar.vez(fila.vez) } : null
}

export type Soltada = {
  readonly negocio: NegocioId
  readonly cliente: ClienteId
  readonly debe: Wamid | null
  readonly vez: VezDeToma
  readonly laTenia: DuenoId | null
  readonly ultimoEntrante: Date | null
}

/**
 * El único compare-and-set de soltar: quien recibe la fila cobra la deuda. `donde` se repite afuera del SELECT porque es
 * lo que vuelve a evaluar quien esperó el candado, así dos barridos a la vez no corren dos turnos.
 */
async function soltar(donde: SQL, limite: number): Promise<readonly Soltada[]> {
  const { rows } = await db.execute<{ id: string; negocio_id: string; sin_contestar: string | null; veces_tomada: number; ultimo_mensaje_entrante: string | null; tenia: string }>(sql`
    with sueltas as (select id, tomada_por from clientes where tomada_por is not null and ${donde} order by tomada_hasta limit ${limite})
    update clientes set tomada_por = null, tomada_hasta = null from sueltas s
    where clientes.id = s.id and clientes.tomada_por is not null and ${donde}
    returning clientes.id, clientes.negocio_id, clientes.sin_contestar, clientes.veces_tomada, clientes.ultimo_mensaje_entrante, s.tomada_por as tenia`)
  return rows.map((f) => ({
    negocio: marcar.negocio(f.negocio_id),
    cliente: marcar.cliente(f.id),
    debe: f.sin_contestar ? marcar.wamid(f.sin_contestar) : null,
    vez: marcar.vez(f.veces_tomada),
    laTenia: f.tenia ? marcar.dueno(f.tenia) : null,
    ultimoEntrante: f.ultimo_mensaje_entrante ? new Date(f.ultimo_mensaje_entrante) : null,
  }))
}

export async function soltarLaDeUnCliente(negocio: NegocioId, cliente: ClienteId, vez: number): Promise<Soltada | null> {
  const [s] = await soltar(sql`clientes.id = ${cliente} and clientes.negocio_id = ${negocio} and clientes.veces_tomada = ${vez}`, 1)
  return s ?? null
}

export const soltarLasVencidas = (negocio: NegocioId, limite: number) => soltar(sql`clientes.negocio_id = ${negocio} and clientes.tomada_hasta <= now()`, limite)

export async function vezActual(cliente: ClienteId): Promise<VezDeToma | null> {
  const [fila] = await db.select({ vez: c.vecesTomada }).from(c).where(eq(c.id, cliente))
  return fila ? marcar.vez(fila.vez) : null
}

/** A quién avisarle: el Dueño de la toma viva. */
export async function quienLaTiene(cliente: ClienteId): Promise<string | null> {
  const [fila] = await db.select({ tiene: QUIEN_LA_TIENE }).from(c).where(eq(c.id, cliente))
  return fila?.tiene ?? null
}

/** Lo que la pantalla necesita saber. El tiempo sale del reloj de la base, para que la pantalla no compare relojes. */
export async function leerAtencion(negocio: NegocioId, cliente: string) {
  const s = esquema.mensajesSalientes
  const [fila] = await db
    .select({
      tiene: QUIEN_LA_TIENE,
      quien: esquema.duenos.nombre,
      vez: c.vecesTomada,
      sinContestar: c.sinContestar,
      ultimoEntrante: c.ultimoMensajeEntrante,
      quedaMs: sql<number>`case when ${TOMA_VIVA} then ceil(extract(epoch from ${c.tomadaHasta} - now()) * 1000)::int else 0 end`,
      // Más que cualquier turno: `maxDuration` del webhook es 300 s. Antes de eso, el agente todavía puede estar contestando.
      esperaDeVerdad: sql<boolean>`${c.ultimoMensajeEntrante} < now() - interval '5 minutes'`,
      agenteTerminando: sql<boolean>`exists (select 1 from ${s} where ${s.clienteId} = ${c.id} and ${s.estado} = 'por_enviar' and ${s.clase} <> 'del_dueno' and ${s.creado} > now() - interval '30 seconds')`,
    })
    .from(c)
    .leftJoin(esquema.duenos, eq(esquema.duenos.id, c.tomadaPor))
    .where(and(eq(c.id, cliente), eq(c.negocioId, negocio)))
  return fila ?? null
}
