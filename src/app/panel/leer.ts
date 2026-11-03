import { and, desc, eq, inArray } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { db, esquema } from '@/db'
import { leerLoPendiente } from '@/nucleo/cambios'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import { leerAplicado, valorDelDato } from '@/nucleo/estado'
import { reglaEnPalabras } from '@/nucleo/estado/elementos'
import { pintarPanel, pintarUna } from '@/nucleo/panel'
import { duenoActual } from '@/negocio/sesion'
import type { DatosDeLaOperacion } from './operacion'
import type { DatosDelNegocio } from './vista'

/**
 * La puerta de cada página del Panel, no solo del layout: navegar entre Secciones no vuelve a correr el layout.
 * Con `cache`, el layout y la página de una misma petición leen una sola vez.
 */
export const duenoDelPanel = cache(async () => {
  const sesion = await duenoActual()
  if (!sesion) redirect('/entrar')
  return sesion
})

const negocioDelPanel = cache(async () => {
  const { negocio, ctx } = await duenoDelPanel()
  return negocio && ctx ? { negocio, estado: await leerAplicado(ctx.negocio) } : null
})

const pendienteDelPanel = cache(async () => {
  const leido = await negocioDelPanel()
  return leido && leerLoPendiente(leido.estado)
})

export const leerCasos = cache(async () => {
  const leido = await negocioDelPanel()
  if (!leido) return null
  return db
    .select({ id: esquema.casos.id, titulo: esquema.casos.titulo, propuesta: esquema.casos.propuesta })
    .from(esquema.casos)
    .where(and(eq(esquema.casos.negocioId, leido.negocio.id), inArray(esquema.casos.estado, ['abierto', 'esperando_dueno'])))
    .orderBy(desc(esquema.casos.creado))
})

export async function leerOperacion(): Promise<DatosDeLaOperacion> {
  const { usuario, dueno } = await duenoDelPanel()
  const [leido, pendiente, casos] = await Promise.all([negocioDelPanel(), pendienteDelPanel(), leerCasos()])
  return {
    dueno: dueno?.nombre || usuario.name || usuario.email,
    negocio:
      leido && pendiente && casos
        ? {
            nombre: leido.estado.identidad.nombre,
            ciudad: valorDelDato(leido.estado, 'ciudad'),
            casosAbiertos: casos.length,
            propias: leido.estado.vigentes('seccion').map((s) => ({ clave: s.clave, nombre: s.elemento.nombre })),
            publicar: leido.negocio.estado === 'listo' ? pendiente : null,
          }
        : null,
  }
}

export async function leerInicio(): Promise<DatosDelNegocio | null> {
  const [leido, pendiente, casos] = await Promise.all([negocioDelPanel(), pendienteDelPanel(), leerCasos()])
  if (!leido || !pendiente || !casos) return null
  const { negocio, estado } = leido
  const productos = estado.vigentes('producto').filter((v) => v.elemento.activo)
  const pintadas = await pintarPanel(estado)
  return {
    nombre: estado.identidad.nombre,
    detalle: `${[estado.identidad.rubro, valorDelDato(estado, 'ciudad')].filter(Boolean).join(' · ') || 'Armándose'} · ${productos.length} productos`,
    link: negocio.estado === 'listo' ? linkDeWhatsapp(negocio.nombre, negocio.codigo) : null,
    pendiente,
    indicadores: pintadas.filter((p) => p.tipo === 'indicador'),
    secciones: pintadas.filter((p) => p.tipo === 'seccion'),
    casos: casos.slice(0, 10),
    reglas: estado.vigentes('regla').map((r) => ({ clave: r.clave, texto: reglaEnPalabras(r.elemento, estado) })),
  }
}

export async function leerIndicadores() {
  const leido = await negocioDelPanel()
  return leido && Promise.all(leido.estado.vigentes('indicador').map((v) => pintarUna(leido.estado, v.clave, v.elemento)))
}

/** `undefined` si el Negocio no tiene esa Sección, también cuando es de otro Negocio: las claves se buscan solo en el suyo. */
export async function leerUnaSeccion(clave: string) {
  const leido = await negocioDelPanel()
  const seccion = leido?.estado.vigentes('seccion').find((v) => v.clave === clave)
  return leido && seccion ? pintarUna(leido.estado, seccion.clave, seccion.elemento) : undefined
}
