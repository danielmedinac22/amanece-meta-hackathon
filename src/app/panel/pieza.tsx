/** Pinta una Sección o un Indicador ya calculados. La consulta da los datos; la forma de pintarlos es fija. */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { etiquetaLarga, graficaDe } from '@/nucleo/graficas'
import type { SeccionPintada } from '@/nucleo/panel'
import { advertenciaEnPalabras, conUnidad } from '@/nucleo/panel-palabras'
import { Barras, Reparto } from './graficas'
import { BordeDeCambio } from './sin-publicar'

/** `to_jsonb` da el instante ya en la zona del Negocio, porque el lote fija `TimeZone`: solo se recorta. */
const INSTANTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/

function formato(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString('es-CO')
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (v === null || v === undefined) return '—'
  const instante = INSTANTE.exec(String(v))
  return instante ? `${instante[1]} ${instante[2]}` : String(v)
}

function Advertencias({ p }: { p: SeccionPintada }) {
  if (!p.advertencias.length) return null
  return (
    <ul className="mb-2 space-y-1 text-xs text-ojo">
      {p.advertencias.map((a, i) => (
        <li key={i}>{advertenciaEnPalabras(a)}</li>
      ))}
    </ul>
  )
}

/** Lo mismo en el lienzo y en la tarjeta del Hilo: solo cambia quién le pone el recuadro. */
export function ResultadoDelIndicador({ p }: { p: SeccionPintada }) {
  const r = p.resultado
  const grafica = r.tipo === 'serie' && r.porTiempo ? graficaDe(r.puntos, r.unidad) : null
  const ranking = r.tipo === 'serie' && !r.porTiempo ? r.puntos : []
  const maximo = Math.max(1, ...ranking.map((s) => s.valor))
  return (
    <>
      <Advertencias p={p} />
      <p className="text-sm font-medium">{p.nombre}</p>
      {r.tipo === 'numero' && <p className="mt-1 font-heading text-2xl font-semibold tracking-tight tabular-nums wrap-anywhere">{conUnidad(r.valor, r.unidad)}</p>}
      {r.tipo === 'serie' && (
        <>
          {r.porTiempo && r.puntos.length > 0 && (
            <>
              <p className="mt-1 font-heading text-3xl font-semibold tracking-tight tabular-nums wrap-anywhere">{conUnidad(r.puntos.at(-1)!.valor, r.unidad)}</p>
              <p className="text-xs text-muted-foreground">{etiquetaLarga(r.puntos.at(-1)!.etiqueta)}</p>
            </>
          )}
          {grafica && <Barras grafica={grafica} titulo={p.nombre} />}
          {ranking.length > 0 && (
            <div className="mt-3 max-h-64 overflow-auto">
              <Reparto filas={ranking.map((s, i) => ({ clave: `${i}`, etiqueta: s.etiqueta, cifra: conUnidad(s.valor, r.unidad), parte: s.valor / maximo }))} />
            </div>
          )}
          {!grafica && !ranking.length && <p className="mt-2 text-sm text-muted-foreground">Nada por ahora.</p>}
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{p.enPalabras}</p>
    </>
  )
}

export function Indicador({ p }: { p: SeccionPintada }) {
  return (
    <BordeDeCambio clave={p.clave} className="rounded-(--radius) bg-card p-4" quieto="border border-border">
      <ResultadoDelIndicador p={p} />
    </BordeDeCambio>
  )
}

/** Las de una cifra van como las tarjetas de arriba; una gráfica o un ranking piden todo el ancho. */
export function Indicadores({ indicadores }: { indicadores: readonly SeccionPintada[] }) {
  return (
    <div className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
      {indicadores.map((p) =>
        p.resultado.tipo === 'no_se_pudo_calcular' ? (
          <Fallo key={p.clave} clave={p.clave} nombre={p.nombre} />
        ) : (
          <div key={p.clave} className={cn('min-w-0', p.resultado.tipo === 'serie' && 'col-span-full')}>
            <Indicador p={p} />
          </div>
        ),
      )}
    </div>
  )
}

/**
 * Las columnas de una Sección las pide el Dueño, así que no se sabe cuáles pesan. La primera y la última siempre se ven:
 * suelen ser el nombre y el estado. Las de en medio entran según el ancho y, mientras no caben, suben debajo del nombre.
 */
const COLUMNAS_POR_ANCHO = [
  { celda: 'hidden @xl:table-cell', debajo: '@xl:hidden' },
  { celda: 'hidden @3xl:table-cell', debajo: '@3xl:hidden' },
  { celda: 'hidden @5xl:table-cell', debajo: '@5xl:hidden' },
]
const COLUMNAS_EN_CADA_ANCHO = 2

const anchoDeLaColumna = (i: number) => COLUMNAS_POR_ANCHO[Math.min(COLUMNAS_POR_ANCHO.length - 1, Math.floor((i - 1) / COLUMNAS_EN_CADA_ANCHO))]

function TablaDeSeccion({ filas, columnas }: Extract<SeccionPintada['resultado'], { tipo: 'filas' }>) {
  if (!filas.length) return <p className="mt-2 text-sm text-muted-foreground">Nada por ahora.</p>
  const ultima = columnas.length - 1
  const enMedio = columnas.slice(1, ultima)
  const esNumerica = columnas.map((c) => filas.some((f) => typeof f[c.columna] === 'number') && filas.every((f) => typeof f[c.columna] === 'number' || f[c.columna] === null))
  const alinear = (i: number) => (i > 0 && esNumerica[i] ? 'text-right tabular-nums' : '')
  const ocultar = (i: number) => (i === 0 || i === ultima ? '' : anchoDeLaColumna(i).celda)
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          {columnas.map((c, i) => (
            <TableHead key={c.columna} className={cn(alinear(i), ocultar(i))}>
              {c.titulo}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((fila, f) => (
          <TableRow key={f}>
            {columnas.map((c, i) => (
              <TableCell key={c.columna} className={cn('align-top whitespace-normal wrap-anywhere', i === 0 ? 'font-medium' : 'text-muted-foreground', i > 0 && esNumerica[i] && 'text-foreground', alinear(i), ocultar(i))}>
                {formato(fila[c.columna])}
                {i === 0 &&
                  enMedio.map((m, j) => (
                    <span key={m.columna} className={cn('block text-xs font-normal text-muted-foreground', anchoDeLaColumna(j + 1).debajo)}>
                      {m.titulo}: {formato(fila[m.columna])}
                    </span>
                  ))}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** En una tarjeta, junto a otras: mientras el Negocio se arma, Inicio las pinta todas seguidas. */
export function Seccion({ p }: { p: SeccionPintada }) {
  if (p.resultado.tipo !== 'filas') return null
  return (
    <div className="rounded-(--radius) border border-border bg-card p-4">
      <Advertencias p={p} />
      <p className="font-heading font-medium">
        {p.nombre} <span className="text-sm font-normal text-muted-foreground">· {formato(p.total)}</span>
      </p>
      <p className="mb-2 text-xs text-muted-foreground">{p.enPalabras}</p>
      <TablaDeSeccion {...p.resultado} />
    </div>
  )
}

/** Sola en su ruta: el nombre ya va en el encabezado del lienzo. */
export function SeccionEntera({ p }: { p: SeccionPintada }) {
  if (p.resultado.tipo !== 'filas') return null
  return (
    <BordeDeCambio clave={p.clave} className="mx-auto max-w-4xl rounded-(--radius)" nuevo="p-4">
      <Advertencias p={p} />
      <p className="mb-3 text-sm text-muted-foreground">{p.enPalabras}</p>
      <TablaDeSeccion {...p.resultado} />
    </BordeDeCambio>
  )
}

export function Fallo({ clave, nombre }: { clave: string; nombre: string }) {
  return (
    <BordeDeCambio clave={clave} className="rounded-(--radius) bg-card p-4 text-sm" quieto="border border-border">
      <p className="font-heading font-medium">{nombre}</p>
      <p className="mt-1 text-muted-foreground">No se pudo calcular ahora. Pídele a tu agente que lo revise.</p>
    </BordeDeCambio>
  )
}
