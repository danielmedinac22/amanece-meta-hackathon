import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, esquema } from '@/db'
import { marcar } from '@/nucleo/identidad'
import { despachar, intencion } from '@/nucleo/salida'
import { VENTANA_MS } from '@/nucleo/salida/compuerta'

/** `no_salio`: otra regla de la compuerta frenó el mensaje, cuando haga cumplir. */
export class ErrorDeEnvio extends Error {
  constructor(
    public codigo: 'fuera_de_ventana' | 'sin_cliente' | 'no_salio',
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeEnvio'
  }
}

/**
 * La respuesta del Dueño a un Caso (`resolver_caso`), hasta la demo. Revisa la ventana por su cuenta antes de
 * despachar para que, mientras la compuerta observa, `resolver_caso` siga recibiendo `fuera_de_ventana` y no
 * salga nada, como antes.
 */
export async function enviarAlCliente(clienteId: string, texto: string): Promise<{ wamid: string | null }> {
  const [cliente] = await db
    .select({ negocioId: esquema.clientes.negocioId, ultimo: esquema.clientes.ultimoMensajeEntrante })
    .from(esquema.clientes)
    .where(eq(esquema.clientes.id, clienteId))
  if (!cliente) throw new ErrorDeEnvio('sin_cliente', 'El Cliente no existe')
  if (Date.now() - (cliente.ultimo?.getTime() ?? 0) > VENTANA_MS) {
    throw new ErrorDeEnvio('fuera_de_ventana', 'Han pasado más de 24 horas desde el último mensaje del Cliente')
  }

  const r = await despachar(
    intencion.resolucionDeCaso({
      destinatario: { tipo: 'cliente', negocio: marcar.negocio(cliente.negocioId), cliente: marcar.cliente(clienteId) },
      texto,
      caso: null,
      vez: randomUUID(),
    }),
  )
  switch (r.tipo) {
    case 'enviado':
      return { wamid: r.wamid }
    case 'simulado':
      return { wamid: null }
    case 'no_salio':
      if (r.motivo === 'fuera_de_ventana') throw new ErrorDeEnvio('fuera_de_ventana', 'Han pasado más de 24 horas desde el último mensaje del Cliente')
      throw new ErrorDeEnvio('no_salio', `La compuerta no lo dejó salir: ${r.motivo}`)
    case 'por_enviar':
      throw new Error(`Kapso no tomó el mensaje: ${r.error}`)
  }
}
