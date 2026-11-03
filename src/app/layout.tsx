import type { Metadata } from 'next'
import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google'
import { Movimiento } from './movimiento'
import './globals.css'

const hanken = Hanken_Grotesk({ variable: '--fuente', subsets: ['latin'] })
const bricolage = Bricolage_Grotesque({ variable: '--fuente-titulo', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Amanece',
  description: 'Arma conversando el agente que atiende a tus clientes por WhatsApp.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className={`${hanken.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Movimiento>{children}</Movimiento>
      </body>
    </html>
  )
}
