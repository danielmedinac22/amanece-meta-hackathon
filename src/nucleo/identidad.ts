import { eq } from 'drizzle-orm'
import { db, esquema } from '@/db'

declare const marca: unique symbol
/** Un valor que solo produce el núcleo: un `string` cualquiera no compila donde va un `NegocioId`. */
export type Marca<T, M extends string> = T & { readonly [marca]: M }

export type NegocioId = Marca<string, 'NegocioId'>
export type DuenoId = Marca<string, 'DuenoId'>
export type ClienteId = Marca<string, 'ClienteId'>
export type CasoId = Marca<string, 'CasoId'>
/** Lo que espera el botón del Dueño: un Cambio, su reversión o la respuesta a un Caso. */
export type PropuestaId = Marca<string, 'PropuestaId'>
export type CapacidadFaltanteId = Marca<string, 'CapacidadFaltanteId'>
export type Wamid = Marca<string, 'Wamid'>
/** UTC, ISO 8601. */
export type Instante = Marca<string, 'Instante'>

/** Las únicas puertas de un `string` a una marca. `probar-salida` afirma quién las importa. */
export const marcar = {
  negocio: (id: string) => id as NegocioId,
  dueno: (id: string) => id as DuenoId,
  cliente: (id: string) => id as ClienteId,
  caso: (id: string) => id as CasoId,
  wamid: (id: string) => id as Wamid,
  instante: (d: Date) => d.toISOString() as Instante,
  propuesta: (id: string) => id as PropuestaId,
  capacidadFaltante: (id: string) => id as CapacidadFaltanteId,
} as const

/** `en_sombra` no tiene productor a propósito: mientras la compuerta observa, un Negocio en sombra le hablaría a sus Clientes. */
export type ModoDelNegocio = 'armando' | 'atendiendo' | 'en_sombra'

export function modoDelNegocio(estado: 'armando' | 'listo'): ModoDelNegocio {
  return estado === 'armando' ? 'armando' : 'atendiendo'
}

export type Medio = 'web' | 'whatsapp'

/** Sale de la sesión o del teléfono de un Dueño registrado, nunca del modelo. */
export type ContextoDelDueno = {
  readonly negocio: NegocioId
  readonly dueno: DuenoId
  readonly medio: Medio
}

export async function contextoDelTelefonoDelDueno(telefono: string): Promise<ContextoDelDueno | null> {
  const [fila] = await db
    .select({ dueno: esquema.duenos.id, negocio: esquema.duenos.negocioId })
    .from(esquema.duenos)
    .where(eq(esquema.duenos.telefono, telefono))
  return fila ? { negocio: marcar.negocio(fila.negocio), dueno: marcar.dueno(fila.dueno), medio: 'whatsapp' } : null
}

/**
 * El proyecto de Kapso también tiene números de otros negocios: se envía solo desde `id` y se descarta lo
 * que llega a otro. `telefono` es el de los links `wa.me`.
 */
export const NUMERO_DE_AMANECE = {
  /** Se lee al enviar y no al importar: `probar-salida` lo vacía para ver a Kapso caído sin red. */
  get id(): string {
    return process.env.KAPSO_PHONE_NUMBER_ID ?? ''
  },
  telefono: process.env.NEXT_PUBLIC_TELEFONO_DE_AMANECE ?? '12058633828',
} as const
