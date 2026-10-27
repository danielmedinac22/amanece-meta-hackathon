/** La vista previa de un Cambio dentro del Hilo: cómo queda antes de aplicarlo. */
import { Indicador, Seccion } from './pieza'
import type { Vista } from '@/db/esquema'

// La salida de cada herramienta tiene su propia forma; se lee con cuidado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Salida = Record<string, any>

export function VistaPrevia({ salida }: { salida: unknown }) {
  const s = (salida ?? {}) as Salida
  const vista = (s.vistaPrevia ?? s.vista_previa ?? s.preview) as Salida | undefined
  if (!vista || typeof vista !== 'object') return null
  const nombre = s.nombre ?? s.resumen ?? 'Vista previa'

  if ('antes' in vista || 'despues' in vista) {
    return (
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-fondo p-3 text-sm">
          <p className="text-xs text-suave">Hoy respondería</p>
          <p className="mt-1 whitespace-pre-wrap">{String(vista.antes ?? '—')}</p>
        </div>
        <div className="rounded-xl bg-sol-claro p-3 text-sm">
          <p className="text-xs text-suave">Con el Cambio respondería</p>
          <p className="mt-1 whitespace-pre-wrap">{String(vista.despues ?? '—')}</p>
        </div>
      </div>
    )
  }
  const resultado = vista.resultado ?? vista.valor ?? vista
  if (s.tipo === 'seccion' || Array.isArray(resultado) || Array.isArray(resultado?.valor)) {
    return (
      <div className="mt-2">
        <Seccion nombre={nombre} vista={(s.vista ?? vista.vista ?? null) as Vista | null} filas={Array.isArray(resultado) ? resultado : resultado?.valor} />
      </div>
    )
  }
  return (
    <div className="mt-2">
      <Indicador nombre={nombre} valor={resultado?.valor !== undefined && typeof resultado.valor === 'object' ? resultado.valor : resultado} />
    </div>
  )
}
