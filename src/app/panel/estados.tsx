'use client'

import { Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

/** Qué pasó y qué hacer, sin disculpas. Quien la usa decide qué es volver a intentar. */
export function ErrorDeLaPantalla({ titulo, alReintentar }: { titulo: string; alReintentar: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-start gap-2 pt-8">
      <Warning weight="fill" className="size-5 text-destructive" />
      <p className="font-heading text-xl font-semibold tracking-tight text-balance">{titulo}</p>
      <p className="text-sm text-muted-foreground">Vuelve a intentar en un momento.</p>
      <Button variant="outline" className="mt-2" onClick={alReintentar}>
        Volver a intentar
      </Button>
    </div>
  )
}
