'use client'

import { ErrorDeLaPantalla } from './panel/estados'

/** Lo que falla por fuera de una Sección, como la lectura de la cáscara del Panel: ahí no queda ni el sidebar. */
export default function ErrorDeLaPagina({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col justify-center p-5">
      <ErrorDeLaPantalla titulo="No pude abrir esta página." alReintentar={retry} />
    </main>
  )
}
