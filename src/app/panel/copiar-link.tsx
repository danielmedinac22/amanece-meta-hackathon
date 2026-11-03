'use client'

import { CheckCircle, Copy } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function CopiarLink({ link }: { link: string }) {
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    if (!copiado) return
    const quitar = setTimeout(() => setCopiado(false), 1600)
    return () => clearTimeout(quitar)
  }, [copiado])
  return (
    <div className="flex items-center gap-2 rounded-(--radius) border border-border p-2 pl-3">
      <a href={link} target="_blank" className="min-w-0 flex-1 truncate font-mono text-[13px]">
        {link}
      </a>
      <Button
        size="sm"
        onClick={() => {
          navigator.clipboard
            ?.writeText(link)
            .then(() => setCopiado(true))
            .catch(() => {})
        }}
      >
        {copiado ? <CheckCircle weight="fill" className="size-3.5" /> : <Copy className="size-3.5" />}
        {copiado ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  )
}
