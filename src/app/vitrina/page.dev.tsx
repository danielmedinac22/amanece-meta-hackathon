import Link from 'next/link'
import { ESCENAS } from './escenas'

export default function Vitrina() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold">Vitrina</h1>
      <p className="mt-2 text-sm text-muted-foreground">Pantallas pintadas con datos inventados. Solo existe en desarrollo.</p>
      <ul className="mt-6 space-y-2">
        {ESCENAS.map((e) => (
          <li key={e.id}>
            <Link href={`/vitrina/${e.id}`} className="text-primary underline underline-offset-4">
              {e.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
