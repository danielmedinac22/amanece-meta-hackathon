/**
 * La fila de una propuesta: su huella y lo que se inserta. La usan `proponerComo` y `rearmarLectura`, que inserta
 * dentro de la transacción de la entrevista.
 */
import { createHash, randomUUID } from 'node:crypto'
import { esquema } from '@/db'
import { canonico } from '@/lib/canonico'
import type { Escritura } from '../estado'
import type { VersionDelNegocio } from '../estado/elementos'
import { marcar, type DuenoId, type Instante, type Marca, type NegocioId, type PropuestaId } from '../identidad'
import type { VistaPreviaGuardada } from './ensayar'
import type { Acto } from './traducir'

export type Huella = Marca<string, 'Huella'>

export const VIGENCIA_DE_UNA_PROPUESTA_HORAS = 24

/** De dónde sale lo que se propone. `lectura`: lo que se leyó de un enlace; solo lo arma el código y espera el botón siempre. */
export type OrigenDelPedido = 'hilo' | 'panel' | 'lectura'


/**
 * El botón. En la web, una tarjeta; en la semana 5, el botón de WhatsApp `aprobar:<propuesta>:<huella>`. `accion` es
 * el verbo del botón: una tarjeta recién llegada en el stream todavía no tiene historial. `advertencias` las escribe el
 * código y se pintan arriba de las líneas.
 */
export type TarjetaDeAprobacion = {
  readonly propuesta: PropuestaId
  readonly huella: Huella
  readonly vence: Instante
  readonly advertencias: readonly string[]
  readonly lineas: readonly string[]
  readonly accion: 'aplicar' | 'enviar' | 'confirmar'
}

/**
 * sha256 del contenido canónico (claves ordenadas). Ata el botón a exactamente lo que se mostró: la fila no se edita
 * después de insertarse. Sin azar: el mismo texto para el mismo Caso da la misma clave de salida y no sale dos veces.
 */
export function huellaDe(contenido: {
  readonly negocio: NegocioId
  readonly cambio: string | null
  readonly revierte: PropuestaId | null
  readonly actos: readonly Acto[]
  readonly escritura: Escritura
  readonly version: VersionDelNegocio | null
}): Huella {
  return createHash('sha256').update(canonico(contenido)).digest('hex') as Huella
}

export function filaNueva(p: {
  readonly negocio: NegocioId
  readonly palabrasDelDueno: string
  readonly pedidoPor: DuenoId | null
  readonly origen: OrigenDelPedido
  readonly escritura: Escritura
  readonly actos: readonly Acto[]
  readonly revierte: PropuestaId | null
  readonly cambio: string | null
  readonly version: VersionDelNegocio | null
  readonly vistaPrevia: VistaPreviaGuardada
}): { readonly valores: typeof esquema.propuestas.$inferInsert; readonly tarjeta: TarjetaDeAprobacion } {
  const id = marcar.propuesta(randomUUID())
  const huella = huellaDe({ negocio: p.negocio, cambio: p.cambio, revierte: p.revierte, actos: p.actos, escritura: p.escritura, version: p.version })
  const vence = new Date(Date.now() + VIGENCIA_DE_UNA_PROPUESTA_HORAS * 3600_000)
  return {
    valores: { id, negocioId: p.negocio, palabrasDelDueno: p.palabrasDelDueno, pedidoPor: p.pedidoPor, origen: p.origen, escritura: p.escritura, actos: p.actos, revierte: p.revierte, huella, vence, vistaPrevia: p.vistaPrevia },
    tarjeta: { propuesta: id, huella, vence: marcar.instante(vence), advertencias: p.vistaPrevia.advertencias ?? [], lineas: p.vistaPrevia.lineas, accion: accionDe(p.origen, p.actos) },
  }
}

export const accionDe = (origen: OrigenDelPedido, actos: readonly Acto[]): TarjetaDeAprobacion['accion'] => (actos.length ? 'enviar' : origen === 'lectura' ? 'confirmar' : 'aplicar')
