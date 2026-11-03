import { and, desc, eq, inArray } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { db, esquema } from '@/db'
import { ajustesDe } from '@/nucleo/ajustes'
import { leerLoPendiente } from '@/nucleo/cambios'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import { leerAplicado, valorDelDato } from '@/nucleo/estado'
import { reglaEnPalabras } from '@/nucleo/estado/elementos'
import { leerHoy } from '@/nucleo/hoy'
import { leerClientes as clientesDe, leerConversaciones as conversacionesDe, leerPedidos as pedidosDe } from '@/nucleo/listas'
import { pintarPanel, pintarUna } from '@/nucleo/panel'
import { leerTablero as tableroDe } from '@/nucleo/tablero'
import { casosDe } from '@/negocio/casos'
import { duenoActual } from '@/negocio/sesion'
import type { DatosDeHoy } from './inicio-hoy'
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
  return negocio && ctx ? { negocio, id: ctx.negocio, estado: await leerAplicado(ctx.negocio) } : null
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
  const listo = leido?.negocio.estado === 'listo'
  const sinPublicar = new Set<string>(pendiente?.items.map((i) => i.clave))
  // Solo corre consultas mientras hay algo sin publicar: lo pintan la tarjeta del Hilo, Inicio y Pedidos.
  const nuevos = listo ? await Promise.all(leido.estado.vigentes('indicador').filter((v) => sinPublicar.has(v.clave)).map((v) => pintarUna(leido.estado, v.clave, v.elemento))) : []
  return {
    dueno: dueno?.nombre || usuario.name || usuario.email,
    negocio:
      leido && pendiente && casos
        ? {
            nombre: leido.estado.identidad.nombre,
            ciudad: valorDelDato(leido.estado, 'ciudad'),
            casosAbiertos: casos.length,
            propias: leido.estado.vigentes('seccion').map((s) => ({ clave: s.clave, nombre: s.elemento.nombre })),
            publicar: listo ? { ...pendiente, link: linkDeWhatsapp(leido.negocio.nombre, leido.negocio.codigo), nuevos } : null,
          }
        : null,
  }
}

export type Inicio = { tipo: 'hoy'; datos: DatosDeHoy } | { tipo: 'armando'; datos: DatosDelNegocio }

export async function leerInicio(): Promise<Inicio | null> {
  const [leido, casos] = await Promise.all([negocioDelPanel(), leerCasos()])
  if (!leido || !casos) return null
  const { negocio, id, estado } = leido
  const reglas = estado.vigentes('regla').map((r) => ({ clave: r.clave, texto: reglaEnPalabras(r.elemento, estado) }))
  if (negocio.estado === 'listo') {
    const hoy = await leerHoy(id, negocio.zonaHoraria, estado.identidad.rubro)
    return { tipo: 'hoy', datos: { hoy, link: linkDeWhatsapp(negocio.nombre, negocio.codigo), reglas } }
  }
  const productos = estado.vigentes('producto').filter((v) => v.elemento.activo)
  const pintadas = await pintarPanel(estado)
  return {
    tipo: 'armando',
    datos: {
      nombre: estado.identidad.nombre,
      detalle: `${[estado.identidad.rubro, valorDelDato(estado, 'ciudad')].filter(Boolean).join(' · ') || 'Armándose'} · ${productos.length} productos`,
      indicadores: pintadas.filter((p) => p.tipo === 'indicador'),
      secciones: pintadas.filter((p) => p.tipo === 'seccion'),
      casos: casos.slice(0, 10),
      reglas,
    },
  }
}

export async function leerPedidos() {
  const leido = await negocioDelPanel()
  return leido && pedidosDe(leido.id, leido.negocio.zonaHoraria)
}

export async function leerClientes() {
  const leido = await negocioDelPanel()
  return leido && clientesDe(leido.id, leido.negocio.zonaHoraria)
}

export async function leerLosCasos() {
  const [{ ctx }, leido] = await Promise.all([duenoDelPanel(), negocioDelPanel()])
  return ctx && leido && casosDe(ctx, leido.negocio.zonaHoraria)
}

export async function leerConversaciones(elegido: string | undefined) {
  const leido = await negocioDelPanel()
  return leido && conversacionesDe(leido.id, leido.negocio.zonaHoraria, elegido)
}

export async function leerAjustes() {
  const leido = await negocioDelPanel()
  return leido && ajustesDe(leido.estado)
}

/** `tablero` es `null` mientras el Negocio se arma: todavía no hay nada que contar, solo los Indicadores que pidió. */
export async function leerTablero() {
  const leido = await negocioDelPanel()
  if (!leido) return null
  const { negocio, id, estado } = leido
  const [indicadores, tablero] = await Promise.all([Promise.all(estado.vigentes('indicador').map((v) => pintarUna(estado, v.clave, v.elemento))), negocio.estado === 'listo' ? tableroDe(id, negocio.zonaHoraria, estado.identidad.rubro) : null])
  return { indicadores, tablero }
}

/** `undefined` si el Negocio no tiene esa Sección, también cuando es de otro Negocio: las claves se buscan solo en el suyo. */
export async function leerUnaSeccion(clave: string) {
  const leido = await negocioDelPanel()
  const seccion = leido?.estado.vigentes('seccion').find((v) => v.clave === clave)
  return leido && seccion ? pintarUna(leido.estado, seccion.clave, seccion.elemento) : undefined
}
