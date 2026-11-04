import { linkDeWhatsapp } from './entrada'
import { valorDelDato, type EstadoDelNegocio } from './estado'

/** Lo que el Dueño ve en Ajustes. `link` es `null` mientras se arma: ese link todavía no lleva a nadie. */
export type Ajustes = { readonly nombre: string; readonly ciudad: string; readonly link: string | null }

export function ajustesDe(estado: EstadoDelNegocio): Ajustes {
  const { nombre, codigo, modo } = estado.identidad
  return { nombre, ciudad: valorDelDato(estado, 'ciudad'), link: modo === 'atendiendo' ? linkDeWhatsapp(nombre, codigo) : null }
}
