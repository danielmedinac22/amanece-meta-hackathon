/** Pinta una Sección o un Indicador ya calculados. La consulta da los datos; la forma de pintarlos es fija. */
import { advertenciaEnPalabras, conUnidad, type SeccionPintada } from '@/nucleo/panel'

const formato = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-CO') : v === null || v === undefined ? '—' : String(v))

function Advertencias({ p }: { p: SeccionPintada }) {
  if (!p.advertencias.length) return null
  return (
    <ul className="mb-2 space-y-1 text-xs text-sol">
      {p.advertencias.map((a, i) => (
        <li key={i}>{advertenciaEnPalabras(a)}</li>
      ))}
    </ul>
  )
}

export function Indicador({ p }: { p: SeccionPintada }) {
  const r = p.resultado
  const puntos = r.tipo === 'serie' ? r.puntos.slice(-14) : []
  const maximo = Math.max(1, ...puntos.map((s) => s.valor))
  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4">
      <Advertencias p={p} />
      <p className="text-sm text-suave">{p.nombre}</p>
      {r.tipo === 'numero' && <p className="mt-1 text-3xl font-semibold">{conUnidad(r.valor, r.unidad)}</p>}
      {r.tipo === 'serie' && (
        <>
          <p className="mt-1 text-3xl font-semibold">{puntos.length ? conUnidad(puntos.at(-1)!.valor, r.unidad) : '—'}</p>
          {puntos.length > 0 && (
            <div className="mt-3 flex h-16 items-end gap-1">
              {puntos.map((s) => (
                <div key={s.etiqueta} title={`${s.etiqueta}: ${conUnidad(s.valor, r.unidad)}`} className="flex-1 rounded-t bg-sol/80" style={{ height: `${(Math.max(0, s.valor) / maximo) * 100}%`, minHeight: 2 }} />
              ))}
            </div>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-suave">{p.enPalabras}</p>
    </div>
  )
}

export function Seccion({ p }: { p: SeccionPintada }) {
  if (p.resultado.tipo !== 'filas') return null
  const { filas, columnas } = p.resultado
  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4">
      <Advertencias p={p} />
      <p className="font-medium">
        {p.nombre} <span className="text-sm font-normal text-suave">· {p.total > p.mostradas ? `muestro ${formato(p.mostradas)} de ${formato(p.total)}` : formato(p.total)}</span>
      </p>
      <p className="text-xs text-suave">{p.enPalabras}</p>
      {filas.length === 0 ? (
        <p className="mt-2 text-sm text-suave">Nada por ahora.</p>
      ) : (
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-suave">
              <tr>
                {columnas.map((c) => (
                  <th key={c.columna} className="py-1 pr-3 font-normal">
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={i} className="border-t border-borde">
                  {columnas.map((c) => (
                    <td key={c.columna} className="py-1.5 pr-3">
                      {formato(fila[c.columna])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Fallo({ nombre }: { nombre: string }) {
  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4 text-sm">
      <p className="font-medium">{nombre}</p>
      <p className="mt-1 text-suave">No se pudo calcular ahora. Pídele a tu agente que lo revise.</p>
    </div>
  )
}
