'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { LoPendiente, ResultadoDePublicar } from '@/nucleo/cambios'

const QUIEN_LO_NOTA = { clientes: 'Lo notan tus Clientes', equipo: 'Solo lo ven tú y tu equipo' } as const

/** Mandar al link lo que ya está en la vista previa. La huella ata el clic a la lista que el Dueño tiene abierta. */
export function BotonPublicar({ pendiente }: { pendiente: LoPendiente }) {
  const router = useRouter()
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Lo que volvió de un `cambio`: se ve de una, sin esperar a que el Panel se refresque.
  const [otraLista, setOtraLista] = useState<LoPendiente | null>(null)
  const lista = otraLista ?? pendiente
  const cuantos = lista.items.length

  async function publicar() {
    setEnCurso(true)
    setError(null)
    try {
      const r = await fetch('/api/publicar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ huella: lista.huella }) })
      const datos = (await r.json().catch(() => ({ error: 'No pude publicar. Intenta de nuevo.' }))) as ResultadoDePublicar | { error: string }
      if ('error' in datos) return setError(datos.error)
      setOtraLista(datos.tipo === 'cambio' ? datos.pendiente : null)
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
      <summary className={`flex cursor-pointer list-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium ${cuantos ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>
        {enCurso ? (
          'Publicando'
        ) : cuantos ? (
          <>
            Publicar <span className="rounded-full bg-primary-foreground/25 px-1.5 text-xs tabular-nums">{cuantos}</span>
          </>
        ) : (
          'Publicado'
        )}
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-[min(340px,calc(100vw-48px))] rounded-lg border border-border bg-card p-3 text-sm shadow-lg">
        {cuantos ? (
          <>
            <p className="text-xs font-medium">Sin publicar</p>
            {otraLista && <p className="mt-2 rounded-md bg-ojo-suave px-2 py-1 text-ojo">Alguien aplicó algo más. Revísalo y vuelve a tocar Publicar.</p>}
            <ul className="mt-2 space-y-2">
              {lista.items.map((i) => (
                <li key={i.clave}>
                  <span className="block whitespace-pre-wrap">{i.linea}</span>
                  <span className="block text-xs text-muted-foreground">
                    {QUIEN_LO_NOTA[i.loNotan]}
                    {i.aplicadoPor ? ` · Aplicada por ${i.aplicadoPor}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <Button disabled={enCurso} onClick={publicar} className="mt-3 w-full">
              {enCurso ? 'Publicando' : 'Publicar'}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Todo está en tu link. No hay nada sin publicar.</p>
        )}
      </div>
    </details>
  )
}
