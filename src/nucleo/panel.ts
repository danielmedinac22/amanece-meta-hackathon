/**
 * Lo que comparten la vista previa (al proponer) y el Panel (al pintar): correr la consulta de una Sección o un
 * Indicador y contar sus advertencias. Nunca lanza: una consulta que ya no valida o que Postgres rechaza se pinta
 * como `no_se_pudo_calcular`.
 */
import { codigoDe, ejecutar, formaDelResultado, numero, type ResultadoDeEjecutar } from './consultas/ejecutar'
import type { ConsultaGuardada, ErrorDeConsulta, Filas, Supuesto, Unidad } from './consultas/tipos'
import { esErrorDeConsulta, validarConsulta } from './consultas/validar'
import type { EstadoDelNegocio } from './estado'
import type { Clave, ElementoDe } from './estado/elementos'

export type Advertencia =
  | { readonly tipo: 'supuesto'; readonly clave: Clave; readonly supuesto: Supuesto }
  | { readonly tipo: 'resultado_vacio_con_datos'; readonly clave: Clave; readonly filasEnLasFuentes: number }
  | { readonly tipo: 'filas_recortadas'; readonly clave: Clave; readonly total: number; readonly mostradas: number }

/** Por qué una Sección o un Indicador dicen que no se pudo calcular. */
export type PorQueNoSePudo = ErrorDeConsulta['tipo'] | 'sin_configurar' | 'no_disponible'

export type ElementoDelPanel = ElementoDe<'seccion' | 'indicador'>

export type PuntoDeSerie = { readonly etiqueta: string; readonly valor: number }

/** Toda forma trae `total` y `mostradas`: un recorte se ve en cualquiera. */
export type SeccionPintada = {
  readonly clave: Clave
  readonly tipo: 'seccion' | 'indicador'
  readonly nombre: string
  readonly enPalabras: string
  readonly total: number
  readonly mostradas: number
  readonly resultado:
    | { readonly tipo: 'numero'; readonly valor: number | null; readonly unidad: Unidad }
    | { readonly tipo: 'serie'; readonly puntos: readonly PuntoDeSerie[]; readonly unidad: Unidad; readonly porTiempo: boolean }
    | { readonly tipo: 'filas'; readonly filas: Filas; readonly columnas: readonly { readonly columna: string; readonly titulo: string }[] }
    | { readonly tipo: 'no_se_pudo_calcular'; readonly porQue: PorQueNoSePudo }
  readonly advertencias: readonly Advertencia[]
}

/** Pura. La única cuenta de advertencias. Los supuestos van primero. */
export function advertenciasDe(clave: Clave, consulta: ConsultaGuardada, r: Extract<ResultadoDeEjecutar, { tipo: 'filas' }>): readonly Advertencia[] {
  const enLasFuentes = Object.values(r.filasPorFuente).reduce<number>((s, n) => s + (n ?? 0), 0)
  return [
    ...consulta.supuestos.map((supuesto): Advertencia => ({ tipo: 'supuesto', clave, supuesto })),
    ...(r.total === 0 && enLasFuentes > 0 ? [{ tipo: 'resultado_vacio_con_datos', clave, filasEnLasFuentes: enLasFuentes } as const] : []),
    ...(r.total > r.filas.length ? [{ tipo: 'filas_recortadas', clave, total: r.total, mostradas: r.filas.length } as const] : []),
  ]
}

const FECHA = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/

/** Pura. Fechas en orden: el último punto es lo de hoy y sirve de cifra grande. En un ranking sería el menor; sin orden, cualquiera. */
export const vaPorTiempo = (puntos: readonly PuntoDeSerie[]) => puntos.length > 0 && puntos.every((p, i) => FECHA.test(p.etiqueta) && (i === 0 || puntos[i - 1].etiqueta < p.etiqueta))

/** Revalida la consulta con el catálogo de hoy y la corre. */
export async function pintarUna(estado: EstadoDelNegocio, clave: Clave, e: ElementoDelPanel): Promise<SeccionPintada> {
  const base = { clave, tipo: e.tipo, nombre: e.nombre, enPalabras: e.consulta.enPalabras }
  const fallo = (porQue: PorQueNoSePudo): SeccionPintada => ({ ...base, total: 0, mostradas: 0, resultado: { tipo: 'no_se_pudo_calcular', porQue }, advertencias: [] })
  try {
    const salida = e.consulta.salida
    const validada = await validarConsulta(e.consulta.sql, salida.tipo)
    if (esErrorDeConsulta(validada)) return fallo(validada.tipo)
    const r = await ejecutar(estado, validada)
    if (r.tipo === 'sin_configurar') return fallo('sin_configurar')
    if (r.tipo === 'no_disponible') {
      console.error('[panel] no se pudo pintar', clave, r.codigo)
      return fallo('no_disponible')
    }
    if (r.tipo === 'error') {
      console.error('[panel] no se pudo pintar', clave, r.error.tipo === 'postgres' ? r.error.codigo : '42703')
      return fallo(r.error.tipo)
    }
    const forma = formaDelResultado(salida.tipo, r)
    if (forma) {
      console.error('[panel] no se pudo pintar', clave, forma.tipo)
      return fallo(forma.tipo)
    }
    const puntos = r.filas.map((f) => ({ etiqueta: String(f.etiqueta ?? ''), valor: numero(f.valor) ?? 0 }))
    const resultado: SeccionPintada['resultado'] =
      salida.tipo === 'filas'
        ? { tipo: 'filas', filas: r.filas, columnas: salida.columnas }
        : salida.tipo === 'numero'
          ? { tipo: 'numero', valor: numero(r.filas[0]?.valor), unidad: salida.unidad }
          : { tipo: 'serie', puntos, unidad: salida.unidad, porTiempo: vaPorTiempo(puntos) }
    return { ...base, total: r.total, mostradas: r.filas.length, resultado, advertencias: advertenciasDe(clave, e.consulta, r) }
  } catch (error) {
    console.error('[panel] no se pudo pintar', clave, codigoDe(error))
    return fallo('postgres')
  }
}

/** Las Secciones y los Indicadores vigentes, de `leerEstado`, en paralelo. */
export function pintarPanel(estado: EstadoDelNegocio): Promise<readonly SeccionPintada[]> {
  const delPanel: readonly { readonly clave: Clave; readonly elemento: ElementoDelPanel }[] = [...estado.vigentes('indicador'), ...estado.vigentes('seccion')]
  return Promise.all(delPanel.map((v) => pintarUna(estado, v.clave, v.elemento)))
}

const cifra = (n: number) => n.toLocaleString('es-CO')

/** La unidad en palabras, después de una cifra. */
export function conUnidad(valor: number | null, unidad: Unidad): string {
  if (valor === null) return 'sin datos'
  switch (unidad.tipo) {
    case 'dinero':
      return `$${cifra(Math.round(valor))}`
    case 'porcentaje':
      return `${cifra(Math.round(valor * 10) / 10)} %`
    case 'cantidad':
      return `${cifra(valor)}${unidad.nombre ? ` ${unidad.nombre}` : ''}`
  }
}

/** Lo que lee el Dueño de una advertencia, arriba de la tarjeta y del Panel. Lo escribe el código. */
export function advertenciaEnPalabras(a: Advertencia): string {
  switch (a.tipo) {
    case 'supuesto':
      return a.supuesto
    case 'resultado_vacio_con_datos':
      return `No salió nada, aunque hay ${cifra(a.filasEnLasFuentes)} filas en tus datos: revisa que sea lo que querías ver.`
    case 'filas_recortadas':
      return `Hay ${cifra(a.total)} y el Panel muestra ${cifra(a.mostradas)}.`
  }
}
