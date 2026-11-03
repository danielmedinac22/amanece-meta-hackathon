'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { LoPendiente, ResultadoDePublicar } from '@/nucleo/cambios'

const QUIEN_LO_NOTA = { clientes: 'Lo notan tus Clientes', equipo: 'Solo lo ven tú y tu equipo' } as const

/** Mandar al link lo que ya está en la vista previa. La huella ata el clic a la lista que el Dueño tiene abierta. */
export function BotonPublicar({ pendiente }: { pendiente: LoPendiente }) {
  const router = useRouter()
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alguienAplico, setAlguienAplico] = useState(false)
  const cuantos = pendiente.items.length

  async function publicar() {
    setEnCurso(true)
    setError(null)
    try {
      const r = await fetch('/api/publicar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ huella: pendiente.huella }) })
      const datos = (await r.json().catch(() => ({ error: 'No pude publicar. Intenta de nuevo.' }))) as ResultadoDePublicar | { error: string }
      if ('error' in datos) return setError(datos.error)
      setAlguienAplico(datos.tipo === 'cambio')
      if (datos.tipo === 'no_existe') setError('No pude publicar. Intenta de nuevo.')
      router.refresh()
    } catch {
      setError('No me pude conectar. Intenta de nuevo.')
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <details className="relative">
      <summary className={`flex cursor-pointer list-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium ${cuantos ? 'bg-sol text-white' : 'border border-borde text-suave'}`}>
        {enCurso ? (
          'Publicando'
        ) : cuantos ? (
          <>
            Publicar <span className="rounded-full bg-white/25 px-1.5 text-xs tabular-nums">{cuantos}</span>
          </>
        ) : (
          'Publicado'
        )}
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-[min(340px,calc(100vw-48px))] rounded-2xl border border-borde bg-tarjeta p-3 text-sm shadow-lg">
        {cuantos ? (
          <>
            <p className="text-xs font-medium">Sin publicar</p>
            {alguienAplico && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-amber-900">Alguien aplicó algo más. Revísalo y vuelve a tocar Publicar.</p>}
            <ul className="mt-2 space-y-2">
              {pendiente.items.map((i) => (
                <li key={i.clave}>
                  <span className="block whitespace-pre-wrap">{i.linea}</span>
                  <span className="block text-xs text-suave">
                    {QUIEN_LO_NOTA[i.loNotan]}
                    {i.aplicadoPor ? ` · Aplicada por ${i.aplicadoPor}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <button disabled={enCurso} onClick={publicar} className="mt-3 w-full rounded-full bg-sol px-4 py-1.5 font-medium text-white disabled:opacity-50">
              {enCurso ? 'Publicando' : 'Publicar'}
            </button>
          </>
        ) : (
          <p className="text-suave">Todo está en tu link. No hay nada sin publicar.</p>
        )}
      </div>
    </details>
  )
}
