import type { Metadata } from 'next'
import './globals.css'


export const metadata: Metadata = {
  title: 'Amanece',
  description: 'Arma conversando el agente que atiende a tus clientes por WhatsApp.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  )
}
