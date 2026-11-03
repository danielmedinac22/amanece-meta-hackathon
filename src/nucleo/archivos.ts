import type { UIMessage } from 'ai'

/**
 * Lo que el Dueño adjunta en el Hilo. Pura y sin `import` de servidor: el navegador y el servidor leen de aquí los
 * mismos topes y las mismas palabras. Los bytes viven en `src/negocio/archivos.ts`.
 */

/**
 * `bytes` queda por debajo de los 4,5 MB que Vercel documenta para el cuerpo de una función. `paginasPdf` y las lecturas son
 * el tope de costo: un PDF cuesta por página, no por peso, de 2.510 a 4.017 tokens medidos según el tamaño de la página.
 */
export const TOPES_DE_ARCHIVO = {
  bytes: 4_000_000,
  porMensaje: 3,
  porDia: 20,
  paginasPdf: 20,
  largoNombre: 120,
  bytesPorNegocio: 100_000_000,
  lecturasPorArchivo: 3,
  lecturasPorDia: 30,
  lecturasPorTurno: 3,
  horasSinEnviar: 24,
} as const

/** Desde este lado el modelo cobra lo mismo: 4.017 tokens medidos a 2400 y a 4000 px. */
export const LADO_MAXIMO_DE_LA_FOTO = 2400

export const TIPOS_DE_ARCHIVO = { 'image/jpeg': 'foto', 'image/png': 'foto', 'application/pdf': 'pdf' } as const
export type TipoDeArchivo = keyof typeof TIPOS_DE_ARCHIVO
export type ClaseDeArchivo = (typeof TIPOS_DE_ARCHIVO)[TipoDeArchivo]

/** Lo que guarda el Hilo de un archivo. Lo arma el servidor desde la fila y no es una parte de texto, así que `numerosDelDueno` no lo cuenta. */
export type Adjunto = {
  readonly id: string
  readonly clase: ClaseDeArchivo
  readonly nombre: string
  readonly paginas: number | null
  /** Solo si el PDF traía más páginas de las que se guardaron. */
  readonly paginasDelOriginal: number | null
}

export const PARTE_DE_ARCHIVO = 'data-archivo'

export const RECHAZO_EN_PALABRAS = {
  no_permitido: 'Solo puedo recibir fotos y PDF.',
  muy_grande: 'Pesa más de 4 MB. Prueba con uno más liviano.',
  pdf_protegido: 'Ese PDF tiene clave. Quítasela y vuélvelo a subir.',
  pdf_ilegible: 'No pude abrir ese PDF. Mándame fotos de las páginas.',
  cupo_del_dia: 'Hoy ya subiste 20 archivos. Mañana puedes subir más.',
  cupo_del_negocio: 'Ya no caben más archivos en tu negocio.',
  muchos: 'Puedes mandar hasta 3 archivos en un mensaje.',
} as const
export type Rechazo = keyof typeof RECHAZO_EN_PALABRAS

export const SIN_CONEXION = 'No se subió. Revisa tu conexión y vuelve a intentarlo.'

/** El tipo se reconoce por los primeros bytes: lo que dice el navegador o el nombre del archivo no cuenta. */
export function reconocerTipo(bytes: Uint8Array): TipoDeArchivo | null {
  const empieza = (...firma: number[]) => firma.every((b, i) => bytes[i] === b)
  if (empieza(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (empieza(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const pareceId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id)

export function adjuntosDelMensaje(m: Pick<UIMessage, 'parts'>): Adjunto[] {
  return m.parts.flatMap((p) => (p.type === PARTE_DE_ARCHIVO ? [p.data as Adjunto] : []))
}

export function adjuntoEnPalabras({ clase, paginas }: Pick<Adjunto, 'clase' | 'paginas'>): string {
  if (clase === 'foto') return 'foto'
  return paginas === 1 ? 'PDF de 1 página' : `PDF de ${paginas} páginas`
}

export const FUENTES_DE_ARCHIVO = { foto: 'tu foto', pdf: 'tu PDF', varios: 'tus archivos' } as const
const FUENTES = new Set<string>(Object.values(FUENTES_DE_ARCHIVO))

/** De dónde dice la tarjeta que salió lo leído. Nunca el nombre del archivo: lo escribió quien lo creó y llegaría al modelo. */
export function fuenteDeArchivos(clases: readonly ClaseDeArchivo[]): string {
  const [primera] = clases
  return clases.length === 1 && primera ? FUENTES_DE_ARCHIVO[primera] : FUENTES_DE_ARCHIVO.varios
}

export const esFuenteDeArchivo = (fuente: string) => FUENTES.has(fuente)
