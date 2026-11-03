'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { LoPendiente, ResultadoDePublicar } from '@/nucleo/cambios'

const QUIEN_LO_NOTA = { clientes: 'Lo notan tus Clientes', equipo: 'Solo lo ven tú y tu equipo' } as const

/** La huella ata el clic a la lista que el Dueño tiene abierta. */
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
    <Popover>
      <PopoverTrigger render={<Button variant={cuantos ? 'default' : 'outline'} />}>
        {enCurso ? (
          'Publicando'
        ) : cuantos ? (
          <>
            Publicar <span className="rounded-full bg-primary-foreground/25 px-1.5 text-xs tabular-nums">{cuantos}</span>
          </>
        ) : (
          'Publicado'
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-32px))] text-sm">
        <div>
          {cuantos ? (
            <>
              <p className="text-xs font-medium">Sin publicar</p>
              {alguienAplico && <p className="mt-2 rounded-md bg-ojo-suave px-2 py-1 text-ojo">Alguien aplicó algo más. Revísalo y vuelve a tocar Publicar.</p>}
              <ul className="mt-2 space-y-2">
                {pendiente.items.map((i) => (
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
      </PopoverContent>
    </Popover>
  )
}
