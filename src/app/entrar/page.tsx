import { EntradaConNeonAuth } from './con-neon-auth'

export default async function Entrar({ searchParams }: PageProps<'/entrar'>) {
  const { modo } = await searchParams
  return <EntradaConNeonAuth modoInicial={modo === 'registro' ? 'registro' : 'entrar'} />
}
