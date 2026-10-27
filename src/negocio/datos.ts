import { desc, eq } from 'drizzle-orm'
import { db, esquema } from '@/db'

/**
 * Los datos de un solo Negocio que ve el código generado (Secciones e Indicadores). Se arman en el
 * servidor a partir del Negocio de la sesión; los teléfonos van enmascarados.
 */
export type DatosDelNegocio = Awaited<ReturnType<typeof datosDelNegocio>>

export async function datosDelNegocio(negocioId: string) {
  const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocioId))
  const [productos, clientes, pedidos, casos, mensajes] = await Promise.all([
    db.select().from(esquema.productos).where(eq(esquema.productos.negocioId, negocioId)),
    db.select().from(esquema.clientes).where(eq(esquema.clientes.negocioId, negocioId)),
    db.select().from(esquema.pedidos).where(eq(esquema.pedidos.negocioId, negocioId)).orderBy(desc(esquema.pedidos.creado)).limit(2000),
    db.select().from(esquema.casos).where(eq(esquema.casos.negocioId, negocioId)).orderBy(desc(esquema.casos.creado)).limit(500),
    db
      .select({ clienteId: esquema.mensajesCliente.clienteId, rol: esquema.mensajesCliente.rol, creado: esquema.mensajesCliente.creado })
      .from(esquema.mensajesCliente)
      .where(eq(esquema.mensajesCliente.negocioId, negocioId))
      .orderBy(desc(esquema.mensajesCliente.creado))
      .limit(5000),
  ])
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return {
    hoy: new Date().toISOString(),
    zonaHoraria: 'America/Bogota',
    negocio: { nombre: negocio?.nombre ?? '', rubro: negocio?.rubro ?? '', ciudad: negocio?.conocimiento.ciudad ?? '' },
    productos: productos.map((p) => ({ id: p.id, nombre: p.nombre, precio: p.precio, activo: p.activo })),
    clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, telefono: `***${c.telefono.slice(-4)}`, creado: iso(c.creado) })),
    pedidos: pedidos.map((p) => ({ id: p.id, numero: p.numero, clienteId: p.clienteId, items: p.items, total: p.total, ciudad: p.ciudad, estado: p.estado, creado: iso(p.creado) })),
    casos: casos.map((c) => ({ id: c.id, titulo: c.titulo, estado: c.estado, clienteId: c.clienteId, pedidoId: c.pedidoId, creado: iso(c.creado), resuelto: iso(c.resuelto) })),
    mensajes: mensajes.map((m) => ({ clienteId: m.clienteId, rol: m.rol, creado: iso(m.creado) })),
  }
}

/** La forma de `datos`, para que el generador sepa qué puede leer. */
export const FORMA_DE_LOS_DATOS = `datos = {
  hoy: string ISO, zonaHoraria: "America/Bogota",
  negocio: { nombre, rubro, ciudad },
  productos: [{ id, nombre, precio (COP entero), activo }],
  clientes: [{ id, nombre, telefono (enmascarado), creado (ISO) }],
  pedidos: [{ id, numero, clienteId, items: [{ productoId, nombre, cantidad, precio }], total (COP), ciudad, estado: "pendiente"|"confirmado"|"enviado"|"entregado"|"novedad"|"cancelado", creado (ISO) }],
  casos: [{ id, titulo, estado: "abierto"|"esperando_dueno"|"resuelto", clienteId, pedidoId, creado (ISO), resuelto (ISO|null) }],
  mensajes: [{ clienteId, rol: "cliente"|"agente", creado (ISO) }]
}`
