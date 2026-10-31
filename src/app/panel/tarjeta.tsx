'use client'

import { useState } from 'react'
import type { ResultadoDeAprobar, TarjetaDeAprobacion } from '@/nucleo/cambios'
import type { EstadoDeTarjeta } from '@/negocio/dueno-chat'

type Respuesta = ResultadoDeAprobar | { readonly tipo: 'descartada' } | { readonly tipo: 'error'; readonly mensaje: string }

/** Una propuesta dentro del Hilo: sus líneas y el botón. Después de un clic muestra lo que respondió la ruta. */
export function Tarjeta({ tarjeta, estado, alCambiar }: { tarjeta: TarjetaDeAprobacion; estado: EstadoDeTarjeta | undefined; alCambiar: () => void }) {
  const [enCurso, setEnCurso] = useState(false)
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null)

  // Recién llegada en el stream todavía no tiene estado: se deja tocar si no venció, y la ruta decide.
  const [vigente] = useState(() => Date.parse(tarjeta.vence) > Date.now())
  const esperando = (!respuesta || respuesta.tipo === 'error') && (estado ? estado.estado === 'espera_al_dueno' : vigente)
  const verbo = tarjeta.accion === 'enviar' ? 'Enviar' : 'Aplicar'

  async function tocar(accion: 'aprobar' | 'descartar') {
    setEnCurso(true)
    try {
      const r = await fetch(`/api/propuestas/${tarjeta.propuesta}/${accion}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ huella: tarjeta.huella }),
      })
      const datos = (await r.json().catch(() => ({ error: 'No pude hacerlo. Intenta de nuevo.' }))) as Respuesta | { error: string }
      setRespuesta('error' in datos ? { tipo: 'error', mensaje: datos.error } : datos)
      alCambiar()
    } catch {
      setRespuesta({ tipo: 'error', mensaje: 'No me pude conectar. Intenta de nuevo.' })
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-borde bg-tarjeta p-3 text-sm">
      {tarjeta.lineas.map((l, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {l}
        </p>
      ))}
      {respuesta?.tipo === 'error' && <p className="mt-2 text-xs text-red-700">{respuesta.mensaje}</p>}
      {esperando ? (
        <div className="mt-3 flex gap-2">
          <button disabled={enCurso} onClick={() => tocar('aprobar')} className="rounded-full bg-sol px-4 py-1.5 font-medium text-white disabled:opacity-50">
            {verbo}
          </button>
          <button disabled={enCurso} onClick={() => tocar('descartar')} className="rounded-full border border-borde px-4 py-1.5 text-suave disabled:opacity-50">
            Descartar
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-suave">{textoDelEstado(verbo, estado, respuesta)}</p>
      )}
    </div>
  )
}

/** Lo que dice la tarjeta cuando ya no espera: primero lo que acaba de pasar con este clic, después lo guardado. */
function textoDelEstado(verbo: 'Aplicar' | 'Enviar', estado: EstadoDeTarjeta | undefined, r: Respuesta | null): string {
  const hecha = verbo === 'Enviar' ? 'Enviada' : 'Aplicada'
  switch (r?.tipo) {
    case 'aplicado':
      // Si el envío no salió como debía, el desenlace que armó el núcleo lo dice.
      return r.envio && r.envio.tipo !== 'simulado' && r.envio.tipo !== 'enviado' ? r.resumen : hecha
    case 'ya_no_cabe':
      return r.problemas.some((p) => p.tipo === 'fuera_de_ventana')
        ? 'Pasaron más de 24 horas desde que el Cliente escribió: WhatsApp no deja escribirle hasta que vuelva a escribir.'
        : r.problemas.some((p) => p.tipo === 'caso_resuelto')
          ? 'Ese Caso ya tiene respuesta.'
          : 'Esto ya no se puede aplicar.'
    case 'vencido':
      return 'Venció sin aplicarse. Pídela de nuevo si todavía la quieres.'
    case 'no_existe':
      return 'Esta tarjeta ya no está disponible.'
    case 'descartada':
      return 'Descartada'
  }
  switch (estado?.estado) {
    case 'aplicada':
      return `${hecha}${estado.aprobadaPor ? ` por ${estado.aprobadaPor}` : ''}`
    case 'revertida':
      return `${hecha}${estado.aprobadaPor ? ` por ${estado.aprobadaPor}` : ''}, y revertida después`
    case 'descartada':
      return 'Descartada'
    default:
      return 'Venció sin aplicarse.'
  }
}
