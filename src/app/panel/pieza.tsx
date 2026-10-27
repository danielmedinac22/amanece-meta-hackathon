/** Pinta el resultado de una Sección o un Indicador. El código generado da los datos; la forma de pintarlos es fija. */
import type { Vista } from '@/db/esquema'

type Serie = { etiqueta: string; valor: number }[]
type ResultadoIndicador = { valor?: number | string; unidad?: string; serie?: Serie; nota?: string }

const formato = (v: unknown) =>
  typeof v === 'number' ? v.toLocaleString('es-CO') : v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)

export function Indicador({ nombre, valor }: { nombre: string; valor: unknown }) {
  const r = (valor ?? {}) as ResultadoIndicador
  const serie = Array.isArray(r.serie) ? r.serie.slice(-14) : []
  const maximo = Math.max(1, ...serie.map((s) => Number(s.valor) || 0))
  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4">
      <p className="text-sm text-suave">{nombre}</p>
      <p className="mt-1 text-3xl font-semibold">
        {formato(r.valor)} {r.unidad && <span className="text-base font-normal text-suave">{r.unidad}</span>}
      </p>
      {serie.length > 0 && (
        <div className="mt-3 flex h-16 items-end gap-1">
          {serie.map((s) => (
            <div key={s.etiqueta} title={`${s.etiqueta}: ${formato(s.valor)}`} className="flex-1 rounded-t bg-sol/80" style={{ height: `${((Number(s.valor) || 0) / maximo) * 100}%`, minHeight: 2 }} />
          ))}
        </div>
      )}
      {r.nota && <p className="mt-2 text-xs text-suave">{r.nota}</p>}
    </div>
  )
}

export function Seccion({ nombre, vista, filas }: { nombre: string; vista: Vista | null; filas: unknown }) {
  const lista = Array.isArray(filas) ? (filas as Record<string, unknown>[]) : []
  const columnas = vista?.columnas?.length ? vista.columnas : Object.keys(lista[0] ?? {}).map((clave) => ({ clave, titulo: clave }))
  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4">
      <p className="font-medium">
        {nombre} <span className="text-sm font-normal text-suave">· {lista.length}</span>
      </p>
      {lista.length === 0 ? (
        <p className="mt-2 text-sm text-suave">Nada por ahora.</p>
      ) : vista?.tipo === 'tarjetas' ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {lista.slice(0, 12).map((fila, i) => (
            <div key={i} className="rounded-xl bg-fondo p-3 text-sm">
              {columnas.map((c) => (
                <p key={c.clave}>
                  <span className="text-suave">{c.titulo}: </span>
                  {formato(fila[c.clave])}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-suave">
              <tr>{columnas.map((c) => <th key={c.clave} className="py-1 pr-3 font-normal">{c.titulo}</th>)}</tr>
            </thead>
            <tbody>
              {lista.slice(0, 20).map((fila, i) => (
                <tr key={i} className="border-t border-borde">
                  {columnas.map((c) => <td key={c.clave} className="py-1.5 pr-3">{formato(fila[c.clave])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
