/** Pinta una Sección o un Indicador ya calculados. La consulta da los datos; la forma de pintarlos es fija. */
import type { SeccionPintada } from '@/nucleo/panel'
import { advertenciaEnPalabras, conUnidad } from '@/nucleo/panel-palabras'

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

export function Indicador({ p }: { p: SeccionPintada }) {
  const r = p.resultado
  const maximo = r.tipo === 'serie' ? Math.max(1, ...r.puntos.map((s) => s.valor)) : 1
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Advertencias p={p} />
      <p className="text-sm text-muted-foreground">{p.nombre}</p>
      {r.tipo === 'numero' && <p className="mt-1 text-3xl font-semibold">{conUnidad(r.valor, r.unidad)}</p>}
      {r.tipo === 'serie' && (
        <>
          {r.porTiempo && <p className="mt-1 text-3xl font-semibold">{conUnidad(r.puntos.at(-1)?.valor ?? null, r.unidad)}</p>}
          {r.puntos.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nada por ahora.</p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-sm">
              {r.puntos.map((s, i) => (
                <li key={i} className="relative flex justify-between gap-3 rounded-md px-2 py-0.5">
                  <span className="absolute inset-y-0 left-0 rounded-md bg-primary/15" style={{ width: `${(Math.max(0, s.valor) / maximo) * 100}%` }} />
                  <span className="relative">{s.etiqueta}</span>
                  <span className="relative whitespace-nowrap font-medium">{conUnidad(s.valor, r.unidad)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{p.enPalabras}</p>
    </div>
  )
}

export function Seccion({ p }: { p: SeccionPintada }) {
  if (p.resultado.tipo !== 'filas') return null
  const { filas, columnas } = p.resultado
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Advertencias p={p} />
      <p className="font-heading font-medium">
        {p.nombre} <span className="text-sm font-normal text-muted-foreground">· {p.total > p.mostradas ? `muestro ${formato(p.mostradas)} de ${formato(p.total)}` : formato(p.total)}</span>
      </p>
      <p className="text-xs text-muted-foreground">{p.enPalabras}</p>
      {filas.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nada por ahora.</p>
      ) : (
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
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
                <tr key={i} className="border-t border-border">
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
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <p className="font-heading font-medium">{nombre}</p>
      <p className="mt-1 text-muted-foreground">No se pudo calcular ahora. Pídele a tu agente que lo revise.</p>
    </div>
  )
}
