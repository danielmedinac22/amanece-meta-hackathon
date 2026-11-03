import { notFound } from 'next/navigation'
import { ESCENAS } from '../escenas'

export default async function Escena({ params }: { params: Promise<{ escena: string }> }) {
  const { escena } = await params
  const encontrada = ESCENAS.find((e) => e.id === escena)
  if (!encontrada) notFound()
  return encontrada.pinta()
}
