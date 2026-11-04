import type { OrigenDeCliente } from '@/db/esquema'
import { pesos } from './estado/elementos'
import { cambioContraLaAnterior, type Cifras, type Voz } from './hoy-palabras'
import { cifra, ETIQUETA_DE_PEDIDO } from './listas-palabras'
import type { DatosDelTablero, PorAtender } from './tablero'

export type TarjetaDelTablero = { clave: 'negocio' | 'citas' | 'conversaciones' | 'resueltas' | 'atencion'; dato: string; valor: string; nota: string; espera: boolean }

/** `Tu link`, no `Tu link en Instagram` como el prototipo: la ficha dice que usó el link, no dónde lo vio. */
export const ETIQUETA_DE_ORIGEN: Record<OrigenDeCliente, string> = { link: 'Tu link', anuncio: 'Anuncio de Meta', sin_dato: 'Sin dato' }

const pedidos = (n: number) => `${cifra(n)} ${n === 1 ? 'pedido' : 'pedidos'}`

/** La primera tarjeta dice lo que el Negocio registra: una agenda cuenta citas, y mostrarle `$0` no dice nada. */
const PRIMERA: Record<Voz, (c: Cifras) => Pick<TarjetaDelTablero, 'clave' | 'dato' | 'valor' | 'nota'>> = {
  tienda: (c) => ({
    clave: 'negocio',
    dato: 'Ventas de la semana',
    valor: pesos(c.semana.ventas),
    nota: c.semana.pedidos ? (cambioContraLaAnterior(c) ?? pedidos(c.semana.pedidos)) : 'Todavía sin ventas esta semana',
  }),
  agenda: ({ citas: { semana, hoy } }) => ({ clave: 'citas', dato: 'Citas de la semana', valor: cifra(semana), nota: semana ? (hoy ? `${cifra(hoy)} hoy` : 'Ninguna hoy') : 'Todavía sin citas esta semana' }),
}

function notaDeAtencion({ casos, novedad, pendiente }: PorAtender): string {
  const partes = [casos && `${cifra(casos)} ${casos === 1 ? 'Caso' : 'Casos'}`, novedad && `${cifra(novedad)} ${ETIQUETA_DE_PEDIDO.novedad.toLowerCase()}`, pendiente && `${cifra(pendiente)} ${ETIQUETA_DE_PEDIDO.pendiente.toLowerCase()}`].filter(Boolean)
  return partes.join(', ') || 'Nada espera por ti'
}

export function tarjetasDelTablero({ voz, cifras, porAtender }: Pick<DatosDelTablero, 'voz' | 'cifras' | 'porAtender'>): TarjetaDelTablero[] {
  const { total, resueltas } = cifras.conversaciones
  const atencion = porAtender.casos + porAtender.novedad + porAtender.pendiente
  return [
    { ...PRIMERA[voz](cifras), espera: false },
    { clave: 'conversaciones', dato: 'Conversaciones hoy', valor: cifra(total), nota: total ? 'Clientes que escribieron' : 'Hoy no ha escrito nadie', espera: false },
    {
      clave: 'resueltas',
      dato: 'Resueltas sin ti',
      // Sin conversaciones no hay porcentaje: un `0 %` diría que el agente falló.
      valor: total ? `${Math.round((resueltas / total) * 100)} %` : '—',
      nota: total ? `${cifra(resueltas)} de ${cifra(total)} ${total === 1 ? 'conversación' : 'conversaciones'}` : 'Hoy no ha escrito nadie',
      espera: false,
    },
    { clave: 'atencion', dato: 'Necesitan atención', valor: cifra(atencion), nota: notaDeAtencion(porAtender), espera: atencion > 0 },
  ]
}
