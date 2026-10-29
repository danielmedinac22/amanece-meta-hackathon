import Link from 'next/link'
import { linkDeWhatsapp } from '@/nucleo/entrada'

export default function Portada() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:px-8">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">
          <span className="text-sol">●</span> Amanece
        </span>
        <Link href="/entrar" className="text-sm text-suave hover:text-tinta">
          Entrar
        </Link>
      </header>

      <section className="mt-16 max-w-3xl sm:mt-24">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Arma conversando el agente que atiende a tus clientes por WhatsApp.
        </h1>
        <p className="mt-6 text-lg text-suave sm:text-xl">
          Le cuentas a tu agente qué vendes y cómo trabajas. Él arma el que atiende a tus clientes, te trae cada caso
          resuelto y deja funcionando en tu negocio cada cosa que le pides: una regla, una sección o un indicador.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/entrar?modo=registro" className="rounded-full bg-sol px-6 py-3 font-medium text-white hover:opacity-90">
            Arma tu negocio gratis
          </Link>
          <a
            href={linkDeWhatsapp('Café Ladera', 'LADERA')}
            className="rounded-full border border-borde bg-tarjeta px-6 py-3 font-medium hover:border-sol"
          >
            Escríbele a Café Ladera por WhatsApp
          </a>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {[
          ['Lo armas tú, conversando', 'Sin formularios ni integraciones: tu agente te pregunta y arma tu catálogo, tus envíos y tu forma de atender.'],
          ['Cada Cambio queda funcionando', 'Pides una regla, una sección o un indicador; ves cómo queda antes de aplicarlo, y solo afecta a tu negocio.'],
          ['Te trae los casos resueltos', 'Cuando un cliente necesita algo que el agente no resuelve, tu agente te trae el caso con una propuesta.'],
        ].map(([titulo, texto]) => (
          <div key={titulo} className="rounded-2xl border border-borde bg-tarjeta p-5">
            <h2 className="font-semibold">{titulo}</h2>
            <p className="mt-2 text-sm text-suave">{texto}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-16 text-xs text-suave">Hecho con Muse Spark de Meta · Colombia</footer>
    </main>
  )
}
