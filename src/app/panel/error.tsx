'use client'

import { usePathname } from 'next/navigation'
import { ErrorDeLaPantalla } from './estados'
import { loQueTrae } from './secciones'

export default function ErrorDeLaSeccion({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorDeLaPantalla titulo={`No pude traer ${loQueTrae(usePathname())}.`} alReintentar={retry} />
}
