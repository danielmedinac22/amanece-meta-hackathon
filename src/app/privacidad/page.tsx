import type { Metadata } from 'next'
import { PoliticaDePrivacidad } from './politica'

export const metadata: Metadata = { title: 'Política de privacidad · Amanece', alternates: { canonical: '/privacidad' } }

export default function Page() {
  return <PoliticaDePrivacidad />
}
