/** Lo que una gráfica necesita saber para pintarse. Puro: lo importa la pantalla sin cargar la base de datos. */
import type { Unidad } from './consultas/tipos'
import { conUnidad } from './panel-palabras'

export type Barra = {
  /** Debajo de la barra. Vacía cuando no cabe: con más de `CUANTOS_ROTULOS` puntos solo se rotulan los extremos. */
  eje: string
  /** Lo que dice la barra al tocarla. */
  cuando: string
  /** La cifra entera, para tocarla y para un lector de pantalla. */
  cifra: string
  /** La cifra corta encima de la barra, solo en las que se rotulan. */
  rotulo: string | null
  /** De 0 a 100, sobre el tope del eje. */
  alto: number
}

export type Marca = { texto: string; altura: number }
export type Grafica = { barras: Barra[]; marcas: Marca[] }

export const CUANTOS_ROTULOS = 7
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const FECHA = /^(\d{4})-(\d{2})(?:-(\d{2}))?/
const DIA_MS = 86_400_000

const cifra = (n: number) => n.toLocaleString('es-CO')

/** `Intl` en `es-CO` da `12 k` y `1,3 M` sin criterio fijo: aquí mil se escribe `mil`, y bajo 10.000 va entera. */
function corta(n: number): string {
  if (n >= 1_000_000) return `${cifra(Math.round(n / 100_000) / 10)} M`
  if (n >= 10_000) return `${cifra(Math.round(n / 1_000))} mil`
  return cifra(n)
}

function cortaConUnidad(n: number, unidad: Unidad): string {
  if (unidad.tipo === 'dinero') return `$${corta(n)}`
  return unidad.tipo === 'porcentaje' ? `${corta(n)} %` : corta(n)
}

const instanteDe = (etiqueta: string) => {
  const m = FECHA.exec(etiqueta)
  return m && m[3] ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
}

/** `Lun 2 nov`, `oct 2026`, o la etiqueta tal cual si no es una fecha. */
export function etiquetaLarga(etiqueta: string): string {
  const instante = instanteDe(etiqueta)
  if (instante !== null) {
    const d = new Date(instante)
    return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
  }
  const m = FECHA.exec(etiqueta)
  return m ? `${MESES[+m[2] - 1]} ${m[1]}` : etiqueta
}

/** Una semana o menos se lee por día de la semana; más que eso, por fecha. */
function enElEje(etiqueta: string, cabeEnUnaSemana: boolean): string {
  const instante = instanteDe(etiqueta)
  if (instante !== null) {
    const d = new Date(instante)
    return cabeEnUnaSemana ? DIAS[d.getUTCDay()] : `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
  }
  const m = FECHA.exec(etiqueta)
  return m ? MESES[+m[2] - 1] : etiqueta
}

/** El número redondo más cercano por encima: se parte en dos sin decimales, salvo 1. */
function topeDelEje(maximo: number): number {
  const escala = 10 ** Math.floor(Math.log10(maximo))
  const redondo = [1, 2, 4, 6, 8, 10].find((n) => maximo / escala <= n + 1e-9) ?? 10
  return redondo * escala
}

/**
 * Se rotula el último punto, y el más alto si no le pisa el rótulo: un número en cada barra no se lee. Una cifra corta
 * mide cerca de 40 px, y a 320 px de ancho la gráfica deja unos 210: un rótulo ocupa cerca de una quinta parte.
 */
function rotuladas(puntos: readonly { valor: number }[]): ReadonlySet<number> {
  const ultimo = puntos.length - 1
  const mayor = puntos.reduce((m, p, i) => (p.valor > puntos[m].valor ? i : m), 0)
  const separados = ultimo - mayor >= Math.max(2, Math.ceil(puntos.length / 5))
  return new Set([...(puntos[ultimo].valor > 0 ? [ultimo] : []), ...(separados && puntos[mayor].valor > 0 ? [mayor] : [])])
}

/** `null` si no hay ni una cifra positiva: una gráfica vacía se dice con palabras. */
export function graficaDe(puntos: readonly { etiqueta: string; valor: number }[], unidad: Unidad): Grafica | null {
  const maximo = Math.max(0, ...puntos.map((p) => p.valor))
  if (maximo <= 0) return null
  const tope = topeDelEje(maximo)
  const instantes = [instanteDe(puntos[0].etiqueta), instanteDe(puntos.at(-1)!.etiqueta)]
  const cabeEnUnaSemana = instantes[0] !== null && instantes[1] !== null && instantes[1] - instantes[0] < 7 * DIA_MS
  const conRotulo = rotuladas(puntos)
  const todasEnElEje = puntos.length <= CUANTOS_ROTULOS
  return {
    marcas: (tope === 1 ? [0, 1] : [0, tope / 2, tope]).map((v) => ({ texto: cortaConUnidad(v, unidad), altura: (v / tope) * 100 })),
    barras: puntos.map((p, i) => ({
      eje: todasEnElEje || i === 0 || i === puntos.length - 1 ? enElEje(p.etiqueta, cabeEnUnaSemana) : '',
      cuando: etiquetaLarga(p.etiqueta),
      cifra: conUnidad(p.valor, unidad),
      rotulo: conRotulo.has(i) ? cortaConUnidad(p.valor, unidad) : null,
      alto: (Math.max(0, p.valor) / tope) * 100,
    })),
  }
}
