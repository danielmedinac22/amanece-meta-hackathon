import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db, esquema } from '@/db'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import { piezasActivas } from '@/negocio/cambios'
import { leerHiloConTarjetas } from '@/negocio/dueno-chat'
import { duenoActual } from '@/negocio/sesion'
import { Hilo } from './hilo'
import { Indicador, Seccion } from './pieza'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function Panel() {
  const sesion = await duenoActual()
  if (!sesion) redirect('/entrar')
  const { negocio, ctx } = sesion
  const hilo = ctx ? await leerHiloConTarjetas(ctx) : { mensajes: [], tarjetas: {} }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-col px-4 py-4 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          <span className="text-sol">●</span> Amanece
        </Link>
        <div className="flex items-center gap-4 text-sm text-suave">
          {negocio && <span className="hidden sm:inline">{negocio.nombre}</span>}
          <Link href="/medicion" className="hover:text-tinta">
            Medición
          </Link>
        </div>
      </header>

      <div className="mt-4 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="flex min-h-[60vh] flex-col rounded-3xl border border-borde bg-fondo p-4 lg:min-h-0">
          <h2 className="mb-3 text-sm font-medium text-suave">Tu agente</h2>
          <Hilo inicial={hilo.mensajes} tarjetas={hilo.tarjetas} estado={negocio?.estado ?? null} />
        </section>

        <section className="min-h-0 overflow-y-auto pb-8">
          {negocio ? <Negocio negocio={negocio} /> : <p className="text-suave">Cuando le cuentes a tu agente de tu negocio, aquí lo vas a ver tomar forma.</p>}
        </section>
      </div>
    </main>
  )
}

async function Negocio({ negocio }: { negocio: typeof esquema.negocios.$inferSelect }) {
  const [piezas, casos, reglas, productos] = await Promise.all([
    piezasActivas(negocio.id),
    db
      .select()
      .from(esquema.casos)
      .where(and(eq(esquema.casos.negocioId, negocio.id), inArray(esquema.casos.estado, ['abierto', 'esperando_dueno'])))
      .orderBy(desc(esquema.casos.creado))
      .limit(10),
    db.select().from(esquema.reglas).where(and(eq(esquema.reglas.negocioId, negocio.id), eq(esquema.reglas.activa, true))).orderBy(asc(esquema.reglas.creado)),
    db.select().from(esquema.productos).where(and(eq(esquema.productos.negocioId, negocio.id), eq(esquema.productos.activo, true))),
  ])
  const indicadores = piezas.filter((p) => p.pieza.tipo === 'indicador')
  const secciones = piezas.filter((p) => p.pieza.tipo === 'seccion')

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-borde bg-tarjeta p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{negocio.nombre}</h1>
            <p className="text-sm text-suave">
              {[negocio.rubro, negocio.conocimiento.ciudad].filter(Boolean).join(' · ') || 'Armándose'} · {productos.length} productos
            </p>
          </div>
          {negocio.estado === 'listo' ? (
            <a href={linkDeWhatsapp(negocio.nombre, negocio.codigo)} target="_blank" className="rounded-full bg-verde px-4 py-2 text-sm font-medium text-white">
              Escríbele por WhatsApp
            </a>
          ) : (
            <span className="rounded-full bg-sol-claro px-3 py-1 text-xs text-sol">Armándose</span>
          )}
        </div>
        {negocio.estado === 'listo' && (
          <p className="mt-3 text-xs text-suave">
            Comparte este link con tus clientes: <span className="break-all font-mono">{linkDeWhatsapp(negocio.nombre, negocio.codigo)}</span>
          </p>
        )}
      </div>

      {indicadores.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {indicadores.map(({ pieza, resultado }) =>
            resultado.ok ? (
              <Indicador key={pieza.id} nombre={pieza.nombre} valor={resultado.valor} />
            ) : (
              <Fallo key={pieza.id} nombre={pieza.nombre} />
            ),
          )}
        </div>
      )}

      {casos.length > 0 && (
        <div className="rounded-2xl border border-sol/40 bg-sol-claro p-4">
          <p className="font-medium">Casos para ti</p>
          <ul className="mt-2 space-y-2 text-sm">
            {casos.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.titulo}</span>
                {c.propuesta && <span className="text-suave"> · {c.propuesta}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {secciones.map(({ pieza, resultado }) =>
        resultado.ok ? <Seccion key={pieza.id} nombre={pieza.nombre} vista={pieza.vista} filas={resultado.valor} /> : <Fallo key={pieza.id} nombre={pieza.nombre} />,
      )}

      {reglas.length > 0 && (
        <div className="rounded-2xl border border-borde bg-tarjeta p-4">
          <p className="font-medium">Reglas de tu agente de clientes</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {reglas.map((r) => (
              <li key={r.id}>{r.texto}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function Fallo({ nombre }: { nombre: string }) {
  return (
    <div className="rounded-2xl border border-borde bg-tarjeta p-4 text-sm">
      <p className="font-medium">{nombre}</p>
      <p className="mt-1 text-suave">No se pudo calcular ahora. Pídele a tu agente que lo revise.</p>
    </div>
  )
}
