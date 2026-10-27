import { Suspense } from 'react'
import { FormularioDeEntrada } from './formulario'

export default function Entrar() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <Suspense>
        <FormularioDeEntrada />
      </Suspense>
    </main>
  )
}
