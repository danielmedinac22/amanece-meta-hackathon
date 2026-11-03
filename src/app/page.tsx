import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { linkDeWhatsapp } from '@/nucleo/entrada'

export default function Portada() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:px-8">
      <header className="flex items-center justify-between">
        <span className="font-heading text-lg font-semibold tracking-tight">
          <span className="text-primary">●</span> Amanece
        </span>
        <Button variant="ghost" render={<Link href="/entrar" />} nativeButton={false}>
          Entrar
        </Button>
      </header>

      <section className="mt-16 max-w-3xl sm:mt-24">
        <h1 className="font-heading text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Arma conversando el agente que atiende a tus clientes por WhatsApp.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
          Le cuentas a tu agente qué vendes y cómo trabajas. Él arma el que atiende a tus clientes, te trae cada caso
          resuelto y deja funcionando en tu negocio cada cosa que le pides: una regla, una sección o un indicador.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button size="lg" className="h-11 px-5 text-base" render={<Link href="/entrar?modo=registro" />} nativeButton={false}>
            Arma tu negocio gratis
          </Button>
          <Button variant="outline" size="lg" className="h-11 px-5 text-base" render={<a href={linkDeWhatsapp('Café Ladera', 'LADERA')} />} nativeButton={false}>
            Escríbele a Café Ladera por WhatsApp
          </Button>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {[
          ['Lo armas tú, conversando', 'Sin formularios ni integraciones: tu agente te pregunta y arma tu catálogo, tus envíos y tu forma de atender.'],
          ['Cada Cambio queda funcionando', 'Pides una regla, una sección o un indicador; ves cómo queda antes de aplicarlo, y solo afecta a tu negocio.'],
          ['Te trae los casos resueltos', 'Cuando un cliente necesita algo que el agente no resuelve, tu agente te trae el caso con una propuesta.'],
        ].map(([titulo, texto]) => (
          <div key={titulo} className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-heading font-semibold">{titulo}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{texto}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-16 text-xs text-muted-foreground">Hecho con Muse Spark de Meta · Colombia</footer>
    </main>
  )
}
