/**
 * Lo puro de una cita: pasar de la hora de pared del Negocio a un instante, decirla en palabras y escribir la constancia.
 * Sin base, para que una vista y el ensayo lo importen. El modelo manda fecha y hora tal como las lee en el calendario;
 * ninguna cuenta de zona pasa por él.
 */
import type { EstadoDeCita } from '@/db/esquema'
import { aceptoUnaHora, plano, type CitaEnRevision, type MomentoDeCita } from './salida/revisar'

/** Nada guarda cuánto dura un servicio: dos citas chocan solo en el mismo cupo. Se cambia aquí, sin migración. */
export const MINUTOS_DE_UN_CUPO = 30
export const DIAS_QUE_SE_PUEDE_AGENDAR = 60
export const DIAS_DEL_CALENDARIO = 14

export type HoraPedida = { readonly fecha: string; readonly hora: string }
export type NegativaDeHora = 'mal_escrita' | 'fuera_de_cupo' | 'inexistente' | 'pasada' | 'muy_lejos'

export const POR_QUE_NO_ESA_HORA: Record<NegativaDeHora, string> = {
  mal_escrita: 'Esa fecha u hora no existe. Copia la fecha del calendario y escribe la hora como HH:mm, en 24 horas.',
  fuera_de_cupo: `Las citas van cada ${MINUTOS_DE_UN_CUPO} minutos. Propón la hora en punto o y media más cercana.`,
  inexistente: 'Esa hora no existe ese día por el cambio de horario. Propón otra.',
  pasada: 'Esa hora ya pasó. Propón una que todavía no haya pasado.',
  muy_lejos: `Solo se agenda hasta ${DIAS_QUE_SE_PUEDE_AGENDAR} días hacia adelante.`,
}

const relojEn = (zona: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

function deParedEn(instante: Date, zona: string): { fecha: string; hora: string } {
  const p = Object.fromEntries(relojEn(zona).formatToParts(instante).map((x) => [x.type, x.value]))
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }
}

const desfase = (instante: number, zona: string) => {
  const { fecha, hora } = deParedEn(new Date(instante), zona)
  return Date.parse(`${fecha}T${hora}:00Z`) - Math.floor(instante / 60_000) * 60_000
}

/**
 * `null` si esa hora no existe ese día. Una hora que se repite al atrasar el reloj es la primera. Prueba con el desfase de
 * un día antes y el de un día después porque el cambio de horario pudo caer en medio.
 */
export function instanteLocal({ fecha, hora }: HoraPedida, zona: string): Date | null {
  const comoUtc = Date.parse(`${fecha}T${hora}:00Z`)
  if (Number.isNaN(comoUtc)) return null
  const candidatos = [comoUtc - 86_400_000, comoUtc + 86_400_000].map((t) => comoUtc - desfase(t, zona))
  const validos = candidatos.filter((t) => {
    const pared = deParedEn(new Date(t), zona)
    return pared.fecha === fecha && pared.hora === hora
  })
  return validos.length ? new Date(Math.min(...validos)) : null
}

export function resolverHora(p: HoraPedida, zona: string, ahora: Date): { readonly inicio: Date } | { readonly negada: NegativaDeHora } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha) || !/^\d{2}:\d{2}$/.test(p.hora)) return { negada: 'mal_escrita' }
  // `2026-02-30` también se lee, como 2 de marzo: si la fecha no vuelve igual, no existía.
  const comoUtc = new Date(`${p.fecha}T${p.hora}:00Z`)
  if (Number.isNaN(comoUtc.getTime()) || !comoUtc.toISOString().startsWith(`${p.fecha}T${p.hora}`)) return { negada: 'mal_escrita' }
  if (Number(p.hora.slice(3)) % MINUTOS_DE_UN_CUPO !== 0) return { negada: 'fuera_de_cupo' }
  const inicio = instanteLocal(p, zona)
  if (!inicio) return { negada: 'inexistente' }
  if (inicio.getTime() <= ahora.getTime()) return { negada: 'pasada' }
  if (inicio.getTime() > ahora.getTime() + DIAS_QUE_SE_PUEDE_AGENDAR * 86_400_000) return { negada: 'muy_lejos' }
  return { inicio }
}

const sinEspacioFijo = (t: string) => t.replace(/ | /g, ' ')

const diaEnPalabras = (d: Date, zona: string) => sinEspacioFijo(d.toLocaleDateString('es-CO', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long' })).replace(',', '')
const horaEnPalabras = (d: Date, zona: string) => sinEspacioFijo(d.toLocaleTimeString('es-CO', { timeZone: zona, hour: 'numeric', minute: '2-digit', hour12: true }))

/** `jueves 5 de noviembre, 3:00 p. m.` */
export const enPalabras = (d: Date, zona: string) => `${diaEnPalabras(d, zona)}, ${horaEnPalabras(d, zona)}`

/** `3:00 p. m.`, o `jue 5 nov, 3:00 p. m.` si no es hoy. */
export function enUnaFila(d: Date, zona: string, ahora: Date): string {
  if (deParedEn(d, zona).fecha === deParedEn(ahora, zona).fecha) return horaEnPalabras(d, zona)
  const dia = sinEspacioFijo(d.toLocaleDateString('es-CO', { timeZone: zona, weekday: 'short', day: 'numeric', month: 'short' })).replace(/,| de /g, ' ').replace(/\s+/g, ' ').replace(/\./g, '')
  return `${dia}, ${horaEnPalabras(d, zona)}`
}

export const horaDeCalendario = (d: Date, zona: string) => deParedEn(d, zona).hora
export const fechaDeCalendario = (d: Date, zona: string) => deParedEn(d, zona).fecha

/** Una línea por día, con la fecha que el modelo copia y lo ocupado. Sin nombres: es lo único que un Cliente llega a saber de otro. */
export function calendarioParaElPrompt(ocupadas: readonly Date[], zona: string, ahora: Date): string {
  const hoy = instanteLocal({ fecha: fechaDeCalendario(ahora, zona), hora: '12:00' }, zona) ?? ahora
  return Array.from({ length: DIAS_DEL_CALENDARIO }, (_, i) => {
    const dia = new Date(hoy.getTime() + i * 86_400_000)
    const fecha = fechaDeCalendario(dia, zona)
    const tomadas = ocupadas.filter((o) => fechaDeCalendario(o, zona) === fecha).map((o) => horaDeCalendario(o, zona)).sort()
    return `- ${diaEnPalabras(dia, zona)} (${fecha}): ${tomadas.length ? `ocupadas ${tomadas.join(', ')}` : 'nada ocupado'}`
  }).join('\n')
}

export type EscrituraDeCita = { readonly tipo: 'agendada' | 'movida' | 'cancelada'; readonly inicio: Date; readonly antes: Date | null }

/** Lo único que le dice a un Cliente que algo quedó. Sale de la fila, nunca del modelo. */
export function constanciaDe(e: EscrituraDeCita, zona: string): string {
  if (e.tipo === 'agendada') return `Cita agendada: ${enPalabras(e.inicio, zona)}`
  if (e.tipo === 'cancelada') return `Cita cancelada: ${enPalabras(e.inicio, zona)}`
  return `Cita movida: ${enPalabras(e.inicio, zona)}${e.antes ? ` (antes ${enPalabras(e.antes, zona)})` : ''}.`
}

/** Cierta aunque el modelo haya dicho otra cosa, porque sale de la fila. La agrega el núcleo cuando un turno sin escritura habló de una hora. */
export const lineaDeLaVerdad = (cita: AgendaDelTurno['cita'], zona: string) => (cita ? `Tu cita guardada sigue siendo: ${enPalabras(cita.inicio, zona)}` : 'Por ahora no tienes una cita guardada.')

export function momentoDeCita(inicio: Date, zona: string, ahora: Date): MomentoDeCita {
  const { fecha, hora } = deParedEn(inicio, zona)
  const [h, m] = hora.split(':').map(Number)
  const dias = (Date.parse(fecha) - Date.parse(deParedEn(ahora, zona).fecha)) / 86_400_000
  return {
    diaDeSemana: plano(inicio.toLocaleDateString('es-CO', { timeZone: zona, weekday: 'long' })),
    diaDelMes: Number(fecha.slice(8)),
    relativo: dias === 0 ? 'hoy' : dias === 1 ? 'manana' : null,
    minutos: ((h % 12) * 60 + m) % 720,
  }
}

export type AgendaDelTurno = { readonly ocupadas: readonly Date[]; readonly cita: { readonly inicio: Date; readonly asunto: string } | null }

/** Lo que `revisar` necesita saber de la agenda. La cita vigente es la que había, con lo que se escribió en este turno encima. */
export function citaEnRevision(agenda: AgendaDelTurno | null, escrita: EscrituraDeCita | null, conversacion: { readonly historial: readonly { readonly rol: string; readonly texto: string }[]; readonly mensaje: string }, zona: string, ahora: Date): CitaEnRevision {
  if (!agenda) return { tipo: 'sin_agenda' }
  const inicio = escrita ? (escrita.tipo === 'cancelada' ? null : escrita.inicio) : (agenda.cita?.inicio ?? null)
  return { tipo: 'con_agenda', vigente: inicio && momentoDeCita(inicio, zona, ahora), antes: escrita?.antes ? momentoDeCita(escrita.antes, zona, ahora) : null, escritaEnElTurno: escrita !== null, aceptoUnaHora: aceptoUnaHora(conversacion.historial, conversacion.mensaje) }
}

/** Lo que el Dueño ve. Una `agendada` cuya hora ya pasó no dice si vino: nada lo guarda. */
export type EstadoVisibleDeCita = 'Agendada' | 'Movida' | 'Cancelada' | 'Ya pasó'

export function estadoVisibleDeCita(c: { readonly estado: EstadoDeCita; readonly inicio: Date; readonly movidaDe: Date | null }, ahora: Date): EstadoVisibleDeCita {
  if (c.estado === 'cancelada') return 'Cancelada'
  if (c.estado === 'pasada' || c.inicio.getTime() <= ahora.getTime()) return 'Ya pasó'
  return c.movidaDe ? 'Movida' : 'Agendada'
}
