import { and, desc, eq, inArray } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { db, esquema } from '@/db'
import { ajustesDe } from '@/nucleo/ajustes'
import { ARMADO_SIN_NEGOCIO, armadoDe } from '@/nucleo/armado'
import { lecturaPendiente, leerLoPendiente } from '@/nucleo/cambios'
import { linkDeWhatsapp } from '@/nucleo/entrada'
import { leerAplicado, valorDelDato } from '@/nucleo/estado'
import { reglaEnPalabras } from '@/nucleo/estado/elementos'
import { leerAgenda } from '@/nucleo/citas'
import { atencionDe } from '@/nucleo/clientes/toma'
import { leerHoy } from '@/nucleo/hoy'
import { vozDelRubro } from '@/nucleo/hoy-palabras'
import { leerCliente as clienteDe, leerClientes as clientesDe, leerConversaciones as conversacionesDe, leerGruposDePedidos as gruposDe, leerPedido as pedidoDe, leerPedidos as pedidosDe } from '@/nucleo/listas'
import { pintarUna } from '@/nucleo/panel'
import { leerTablero as tableroDe } from '@/nucleo/tablero'
import { casosDe } from '@/negocio/casos'
import { duenoActual } from '@/negocio/sesion'
import type { DatosDeHoy } from './inicio-hoy'
import type { DatosDeLaOperacion } from './operacion'

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
  const { dueno } = await duenoDelPanel()
  const [leido, pendiente, casos] = await Promise.all([negocioDelPanel(), pendienteDelPanel(), leerCasos()])
  const sinPublicar = new Set<string>(pendiente?.items.map((i) => i.clave))
  // Solo corre consultas mientras hay algo sin publicar: lo pintan la tarjeta del Hilo, Inicio y Pedidos.
  const nuevos = leido ? await Promise.all(leido.estado.vigentes('indicador').filter((v) => sinPublicar.has(v.clave)).map((v) => pintarUna(leido.estado, v.clave, v.elemento))) : []
  return {
    dueno: dueno?.nombre || dueno?.email || '',
    negocio:
      leido && pendiente && casos
        ? {
            nombre: leido.estado.identidad.nombre,
            ciudad: valorDelDato(leido.estado, 'ciudad'),
            voz: vozDelRubro(leido.estado.identidad.rubro),
            casosAbiertos: casos.length,
            propias: leido.estado.vigentes('seccion').map((s) => ({ clave: s.clave, nombre: s.elemento.nombre })),
            publicar: { ...pendiente, link: linkDeWhatsapp(leido.negocio.nombre, leido.negocio.codigo), nuevos },
          }
        : null,
  }
}

/** Solo un Negocio abierto tiene Inicio: uno armándose ve la carta en toda ruta del Panel. */
export async function leerInicio(): Promise<DatosDeHoy | null> {
  const leido = await negocioDelPanel()
  if (!leido || leido.negocio.estado !== 'listo') return null
  const { negocio, id, estado } = leido
  const reglas = estado.vigentes('regla').map((r) => ({ clave: r.clave, texto: reglaEnPalabras(r.elemento, estado) }))
  const hoy = await leerHoy(id, negocio.zonaHoraria, estado.identidad.rubro)
  return { hoy, link: linkDeWhatsapp(negocio.nombre, negocio.codigo), reglas }
}

export async function leerArmado() {
  const leido = await negocioDelPanel()
  return leido ? armadoDe(leido.estado, (await lecturaPendiente(leido.id))?.escritura ?? null) : ARMADO_SIN_NEGOCIO
}

export async function leerPedidos() {
  const leido = await negocioDelPanel()
  return leido && pedidosDe(leido.id, leido.negocio.zonaHoraria)
}

export async function leerLaAgenda() {
  const leido = await negocioDelPanel()
  return leido && leerAgenda(leido.id, leido.negocio.zonaHoraria)
}

export async function leerClientes() {
  const leido = await negocioDelPanel()
  return leido && clientesDe(leido.id, leido.negocio.zonaHoraria)
}

/** `pedido` es null si el id de la URL no es de este Negocio. La lista viene con él porque el detalle va a su lado. */
export async function leerUnPedido(id: string) {
  const leido = await negocioDelPanel()
  if (!leido) return null
  const [grupos, pedido] = await Promise.all([gruposDe(leido.id, leido.negocio.zonaHoraria), pedidoDe(leido.id, leido.negocio.zonaHoraria, id)])
  return { grupos, pedido }
}

/** `cliente` es null si el id de la URL no es de este Negocio. La lista viene con él porque el detalle va a su lado. */
export async function leerUnCliente(id: string) {
  const leido = await negocioDelPanel()
  if (!leido) return null
  const [lista, cliente] = await Promise.all([clientesDe(leido.id, leido.negocio.zonaHoraria), clienteDe(leido.id, leido.negocio.zonaHoraria, id)])
  return { lista, cliente }
}

export async function leerLosCasos() {
  const [{ ctx }, leido] = await Promise.all([duenoDelPanel(), negocioDelPanel()])
  return ctx && leido && casosDe(ctx, leido.negocio.zonaHoraria)
}

export async function leerConversaciones(elegido: string | undefined) {
  const [{ ctx }, leido] = await Promise.all([duenoDelPanel(), negocioDelPanel()])
  if (!ctx || !leido) return null
  const datos = await conversacionesDe(leido.id, leido.negocio.zonaHoraria, elegido)
  return { ...datos, atencion: datos.detalle ? await atencionDe(ctx, datos.detalle.cliente) : null }
}

export async function leerAjustes() {
  const leido = await negocioDelPanel()
  return leido && ajustesDe(leido.estado)
}

/** Solo un Negocio abierto tiene Tablero: uno armándose ve la carta en toda ruta del Panel. */
export async function leerTablero() {
  const leido = await negocioDelPanel()
  if (!leido || leido.negocio.estado !== 'listo') return null
  const { negocio, id, estado } = leido
  const [indicadores, tablero] = await Promise.all([Promise.all(estado.vigentes('indicador').map((v) => pintarUna(estado, v.clave, v.elemento))), tableroDe(id, negocio.zonaHoraria, estado.identidad.rubro)])
  return { indicadores, tablero }
}

/** `undefined` si el Negocio no tiene esa Sección, también cuando es de otro Negocio: las claves se buscan solo en el suyo. */
export async function leerUnaSeccion(clave: string) {
  const leido = await negocioDelPanel()
  const seccion = leido?.estado.vigentes('seccion').find((v) => v.clave === clave)
  return leido && seccion ? pintarUna(leido.estado, seccion.clave, seccion.elemento) : undefined
}
