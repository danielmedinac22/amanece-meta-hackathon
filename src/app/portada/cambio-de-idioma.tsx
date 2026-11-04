import Link from 'next/link'
import { cn } from '@/lib/utils'
import { RUTA_DE_IDIOMA, TEXTOS, type Idioma } from './textos'

const IDIOMAS: readonly { idioma: Idioma; rotulo: string }[] = [
  { idioma: 'es', rotulo: 'ES' },
  { idioma: 'en', rotulo: 'EN' },
]

export function CambioDeIdioma({ idioma }: { idioma: Idioma }) {
  return (
    <span role="group" aria-label={TEXTOS[idioma].idioma.grupo} className="inline-flex rounded-full p-0.5 text-[13px]">
      {IDIOMAS.map((i) => (
        <Link
          key={i.idioma}
          href={RUTA_DE_IDIOMA[i.idioma]}
          hrefLang={i.idioma}
          aria-current={i.idioma === idioma ? 'page' : undefined}
          className={cn('rounded-full px-2.5 py-1 font-medium', i.idioma === idioma ? 'bg-current/12' : 'hover:bg-current/8')}
        >
          {i.rotulo}
        </Link>
      ))}
    </span>
  )
}
