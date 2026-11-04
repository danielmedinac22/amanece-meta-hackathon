/**
 * Lo que la carta del armado sabe, derivado del estado del Negocio y de la tarjeta de lectura que espera. La pantalla
 * no sigue un guion: el agente conversa en cualquier orden y esto se vuelve a leer cada vez.
 */
import { NOMBRE_TEMPORAL } from '@/negocio/alta'
import { queFaltaParaAbrir } from './cambios'
import { linkDeWhatsapp } from './entrada'
import { conPropuesta, valorDelDato, type Escritura, type EstadoDelNegocio } from './estado'
import { pesos } from './estado/elementos'

export type DatoQueSe = 'Nombre' | 'Qué haces' | 'Ciudad' | 'Productos' | 'Envíos' | 'Horario' | 'Cómo cobras' | 'Tono'

/** `en_la_tarjeta`: lo leído de una página cuenta solo cuando el Dueño toca el botón. */
export type FilaQueYaSe = { readonly dato: DatoQueSe; readonly valor: string | null; readonly estado: 'sabido' | 'en_la_tarjeta' | 'falta' }

export type ProductoEnElPanel = { readonly nombre: string; readonly precio: string; readonly estado: 'Listo' | 'Por confirmar' }

export type DatosDelArmado = {
  readonly nombre: string | null
  readonly link: string | null
  readonly filas: readonly FilaQueYaSe[]
  /** La lectura que espera el botón. */
  readonly lectura: { readonly productos: number } | null
  /** Lo que bloquea abrir, en palabras. Vacío: el Negocio puede abrir. */
  readonly faltaParaAbrir: readonly string[]
  readonly productos: readonly ProductoEnElPanel[]
}

const conPrecio = (e: EstadoDelNegocio) => e.vigentes('producto').filter((v) => v.elemento.activo && v.elemento.precio > 0)
const nombreDe = (e: EstadoDelNegocio) => (e.identidad.nombre.trim() && e.identidad.nombre !== NOMBRE_TEMPORAL ? e.identidad.nombre : null)
const CUANTOS_PRODUCTOS_EN_EL_PANEL = 3

const FILAS: readonly { readonly dato: DatoQueSe; readonly valor: (e: EstadoDelNegocio) => string | null }[] = [
  { dato: 'Nombre', valor: nombreDe },
  { dato: 'Qué haces', valor: (e) => valorDelDato(e, 'descripcion') || null },
  { dato: 'Ciudad', valor: (e) => valorDelDato(e, 'ciudad') || null },
  { dato: 'Productos', valor: (e) => (conPrecio(e).length ? `${conPrecio(e).length} con precio` : null) },
  { dato: 'Envíos', valor: (e) => valorDelDato(e, 'envios') || null },
  { dato: 'Horario', valor: (e) => valorDelDato(e, 'horario') || null },
  { dato: 'Cómo cobras', valor: (e) => valorDelDato(e, 'pagos') || null },
  { dato: 'Tono', valor: (e) => e.vigentes('voz')[0]?.elemento.estilo || null },
]

export type PorCompletar = { readonly dato: DatoQueSe; readonly para: string; readonly empieza: string }

/**
 * Lo que no bloqueó abrir, primero lo que más le preguntan al agente. `empieza` pide un cambio porque, con el Negocio
 * abierto, el agente no prepara lo que solo le cuentan. Sin cifras: lo que envía el Dueño cuenta como escrito por él.
 */
const POR_COMPLETAR: readonly PorCompletar[] = [
  { dato: 'Cómo cobras', para: 'Para decirle a un Cliente cómo pagar', empieza: 'Agrega cómo me pagan mis clientes: ' },
  { dato: 'Envíos', para: 'Para responder a dónde llegas y cuánto cuesta', empieza: 'Agrega mis envíos: ' },
  { dato: 'Horario', para: 'Para decir cuándo atiendes', empieza: 'Agrega mi horario: ' },
  { dato: 'Ciudad', para: 'Para decir desde dónde vendes', empieza: 'Agrega la ciudad de mi negocio: ' },
  { dato: 'Tono', para: 'Para que hable como tú', empieza: 'Agrega cómo quiero que les hables a mis clientes: ' },
]

/** Pura. Lo que Inicio le sigue pidiendo al Dueño con el Negocio recién abierto. */
export const porCompletar = (e: EstadoDelNegocio): readonly PorCompletar[] => POR_COMPLETAR.filter((p) => !FILAS.find((f) => f.dato === p.dato)?.valor(e))

/** Pura. Lo que se confirmó manda; lo que solo está en la tarjeta se muestra sin marcar. */
export function armadoDe(estado: EstadoDelNegocio, pendiente: Escritura | null): DatosDelArmado {
  const conTarjeta = pendiente ? conPropuesta(estado, pendiente) : estado
  const nombre = nombreDe(estado)
  const confirmados = new Set(conPrecio(estado).map((v) => v.clave))
  return {
    nombre,
    link: nombre && linkDeWhatsapp(nombre, estado.identidad.codigo),
    filas: FILAS.map(({ dato, valor }): FilaQueYaSe => {
      const sabido = valor(estado)
      if (sabido) return { dato, valor: sabido, estado: 'sabido' }
      const leido = valor(conTarjeta)
      return leido ? { dato, valor: leido, estado: 'en_la_tarjeta' } : { dato, valor: null, estado: 'falta' }
    }),
    lectura: pendiente && { productos: pendiente.elementos.filter((c) => c.despues?.tipo === 'producto').length },
    faltaParaAbrir: queFaltaParaAbrir(estado, pendiente).bloquea.map((f) => f.enPalabras),
    productos: conPrecio(conTarjeta)
      .toSorted((a, b) => Number(confirmados.has(b.clave)) - Number(confirmados.has(a.clave)))
      .slice(0, CUANTOS_PRODUCTOS_EN_EL_PANEL)
      .map((v) => ({ nombre: v.elemento.nombre, precio: pesos(v.elemento.precio), estado: confirmados.has(v.clave) ? 'Listo' : 'Por confirmar' })),
  }
}

/** Un Dueño recién entrado: el primer sondeo del Hilo le crea el Negocio. */
export const ARMADO_SIN_NEGOCIO: DatosDelArmado = {
  nombre: null,
  link: null,
  filas: FILAS.map(({ dato }) => ({ dato, valor: null, estado: 'falta' })),
  lectura: null,
  faltaParaAbrir: ['el nombre del Negocio', 'al menos un producto con su precio'],
  productos: [],
}
