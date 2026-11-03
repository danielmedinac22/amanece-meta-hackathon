import { and, desc, eq, inArray } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db, esquema } from '@/db'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import { leerAplicado, valorDelDato } from '@/nucleo/estado'
import { reglaEnPalabras } from '@/nucleo/estado/elementos'
import type { NegocioId } from '@/nucleo/identidad'
import { pintarPanel } from '@/nucleo/panel'
import { esDelEquipo } from '@/lib/equipo'
import { leerHiloConTarjetas } from '@/negocio/dueno-chat'
import { duenoActual } from '@/negocio/sesion'
import { Hilo } from './hilo'
import { type DatosDelNegocio, MarcoDelPanel, SinNegocio, VistaDelNegocio } from './vista'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function Panel() {
  const sesion = await duenoActual()
  if (!sesion) redirect('/entrar')
  const { negocio, ctx } = sesion
  const [hilo, equipo] = await Promise.all([ctx ? leerHiloConTarjetas(ctx) : { mensajes: [], tarjetas: {} }, esDelEquipo()])

  return (
    <MarcoDelPanel
      nombreDelNegocio={negocio?.nombre ?? null}
      equipo={equipo !== null}
      hilo={<Hilo inicial={hilo.mensajes} tarjetas={hilo.tarjetas} estado={negocio?.estado ?? null} />}
    >
      {negocio && ctx ? <Negocio negocio={negocio} id={ctx.negocio} /> : <SinNegocio />}
    </MarcoDelPanel>
  )
}

async function Negocio({ negocio, id }: { negocio: typeof esquema.negocios.$inferSelect; id: NegocioId }) {
  const [estado, casos] = await Promise.all([
    leerAplicado(id),
    db
      .select()
      .from(esquema.casos)
      .where(and(eq(esquema.casos.negocioId, negocio.id), inArray(esquema.casos.estado, ['abierto', 'esperando_dueno'])))
      .orderBy(desc(esquema.casos.creado))
      .limit(10),
  ])
  const productos = estado.vigentes('producto').filter((v) => v.elemento.activo)
  const pintadas = await pintarPanel(estado)

  const datos: DatosDelNegocio = {
    nombre: estado.identidad.nombre,
    detalle: `${[estado.identidad.rubro, valorDelDato(estado, 'ciudad')].filter(Boolean).join(' · ') || 'Armándose'} · ${productos.length} productos`,
    link: negocio.estado === 'listo' ? linkDeWhatsapp(negocio.nombre, negocio.codigo) : null,
    indicadores: pintadas.filter((p) => p.tipo === 'indicador'),
    secciones: pintadas.filter((p) => p.tipo === 'seccion'),
    casos: casos.map((c) => ({ id: c.id, titulo: c.titulo, propuesta: c.propuesta })),
    reglas: estado.vigentes('regla').map((r) => ({ clave: r.clave, texto: reglaEnPalabras(r.elemento, estado) })),
  }
  return <VistaDelNegocio datos={datos} />
}
