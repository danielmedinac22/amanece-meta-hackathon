import { EntradaConClerk } from './con-clerk'

export default async function Entrar({ searchParams }: PageProps<'/entrar'>) {
  const { modo } = await searchParams
  return <EntradaConClerk modoInicial={modo === 'registro' ? 'registro' : 'entrar'} />
}
