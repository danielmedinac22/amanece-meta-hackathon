/**
 * Los tipos del SQL acotado, el lenguaje de las Secciones y los Indicadores. Solo tipos: los importan
 * `estado/elementos.ts` y el resto de `consultas/` sin ciclo.
 */
import type { Marca } from '../identidad'

export type NombreDeFuente = 'hoy' | 'pedidos' | 'lineas_de_pedido' | 'productos' | 'clientes' | 'casos' | 'conversaciones'
export type TipoDeCampo = 'texto' | 'entero' | 'numero' | 'si_no' | 'fecha' | 'instante' | 'id'
export type Valor = string | number | boolean | null
export type Filas = readonly Readonly<Record<string, Valor>>[]
export type Usa = `${NombreDeFuente}.${string}`

export type Unidad = { readonly tipo: 'cantidad'; readonly nombre: string } | { readonly tipo: 'dinero' } | { readonly tipo: 'porcentaje' }

export type FormaDeSalida =
  /** Una fila con la columna `valor`. */
  | { readonly tipo: 'numero'; readonly unidad: Unidad }
  /** Filas (`etiqueta`, `valor`). */
  | { readonly tipo: 'serie'; readonly unidad: Unidad }
  | { readonly tipo: 'filas'; readonly columnas: readonly { readonly columna: string; readonly titulo: string }[] }
export type TipoDeSalida = FormaDeSalida['tipo']

/** Sube cuando `FUENTES` cambia algo que una consulta guardada usa. El Panel revalida igual cada consulta al pintarla. */
export type VersionDelCatalogo = Marca<number, 'VersionDelCatalogo'>

/** Lo eligió el redactor o el código (la ventana por defecto), nunca un Cliente. */
export type Supuesto = Marca<string, 'Supuesto'>

/** Lo que una Sección o un Indicador guarda. Solo lo produce `redactarConsulta`: el Agente del dueño no escribe SQL. */
export type ConsultaGuardada<S extends TipoDeSalida = TipoDeSalida> = Marca<
  {
    readonly sql: string
    /** Lo que cuenta, en palabras del redactor; es lo que lee el Dueño bajo el número. */
    readonly enPalabras: string
    readonly supuestos: readonly Supuesto[]
    readonly catalogo: VersionDelCatalogo
    readonly usa: readonly Usa[]
    readonly salida: Extract<FormaDeSalida, { tipo: S }>
  },
  'ConsultaGuardada'
>

export type ErrorDeConsulta =
  | { readonly tipo: 'sintaxis'; readonly mensaje: string }
  /** `hay`: los campos de la fuente, o las fuentes si la que falta es la fuente. */
  | { readonly tipo: 'dato_inexistente'; readonly fuente: string; readonly campo: string | null; readonly hay: readonly string[] }
  /** `permitidas`: lo que sí se puede usar en ese lugar. En M2, sin esa lista el modelo agotó los tres intentos. */
  | { readonly tipo: 'no_permitido'; readonly que: string; readonly permitidas: readonly string[] }
  | { readonly tipo: 'forma'; readonly esperada: TipoDeSalida; readonly hay: readonly string[] }
  | { readonly tipo: 'sin_datos'; readonly columna: string }
  /** Una zona horaria, o sumarle o restarle un intervalo a una columna que no es `hoy.ahora`. */
  | { readonly tipo: 'definicion_del_nucleo'; readonly que: 'zona_horaria' | 'desplazamiento'; readonly fragmento: string }
  /** Postgres la rechazó al correrla. Saneado: el SQLSTATE, su clase en palabras y solo nombres del SQL del redactor. */
  | { readonly tipo: 'postgres'; readonly codigo: string; readonly mensaje: string }

/** Solo la produce `validarConsulta`. `ejecutar` no recibe un string. */
export type ConsultaValidada = Marca<
  {
    readonly sql: string
    /** Las fuentes del catálogo que nombra, aunque no use ninguna columna (`count(*)`). */
    readonly fuentes: readonly NombreDeFuente[]
    readonly usa: readonly Usa[]
    readonly columnas: readonly string[]
    /** El `ORDER BY` de arriba cuando nombra columnas de salida: el envoltorio lo repite afuera. */
    readonly orden: readonly { readonly columna: string; readonly descendente: boolean }[]
  },
  'ConsultaValidada'
>
