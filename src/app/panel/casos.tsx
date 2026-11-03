'use client'

import { CheckCircle, Warning } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import type { CasoQueEspera, CasoResuelto, DatosDeCasos } from '@/negocio/casos'
import { cifra } from '@/nucleo/listas-palabras'
import { Tarjeta } from './tarjeta'
import { tocarTarjeta, type TocarTarjeta } from './tocar-tarjeta'

const DILE = 'Dile a tu agente cómo quieres responderle.'

function CasoSinTarjeta({ caso }: { caso: CasoQueEspera }) {
  return (
    <div className="rounded-(--radius) border border-border bg-card px-4 py-3.5 text-card-foreground">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Warning weight="fill" className="size-3.5 shrink-0 text-ojo" />
        <span className="min-w-0">{caso.titulo}</span>
        <span className="ml-auto shrink-0 font-normal">{caso.hace}</span>
      </div>
      {caso.quien && <p className="mt-1 text-xs text-muted-foreground">{caso.quien}</p>}
      {caso.detalle && <p className="mt-3 text-sm whitespace-pre-wrap">{caso.detalle}</p>}
      {caso.propuesta && <p className="mt-3 rounded-[calc(var(--radius)-4px)] bg-muted px-3 py-2.5 text-sm whitespace-pre-wrap">{caso.propuesta}</p>}
      <p className="mt-3 text-xs text-muted-foreground">Todavía no hay una respuesta lista para enviar. {DILE}</p>
    </div>
  )
}

function FilaResuelta({ caso }: { caso: CasoResuelto }) {
  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      {caso.noSalio ? <Warning weight="fill" className="mt-0.5 size-4 shrink-0 text-ojo" /> : <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{caso.titulo}</p>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{caso.resolucion}</p>
        {caso.noSalio && <p className="mt-1 text-sm text-ojo">Esta respuesta no le llegó. Escríbele tú directamente.</p>}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{caso.hace}</span>
    </li>
  )
}

const Cuantos = ({ ves, de }: { ves: number; de: number }) =>
  de > ves ? (
    <p className="py-2 text-xs text-muted-foreground">
      Ves los {cifra(ves)} más recientes de {cifra(de)}.
    </p>
  ) : null

export function VistaDeCasos({ cuentaQueEspera, esperan, cuentaDeResueltos, resueltos, alTocar, alCambiar }: DatosDeCasos & { alTocar: TocarTarjeta; alCambiar: () => void }) {
  if (!esperan.length && !resueltos.length) return <p className="text-muted-foreground">Nada espera tu decisión. Cuando algo la necesite, aparece aquí y tu agente te avisa.</p>
  return (
    <div className="mx-auto flex max-w-156 flex-col gap-6">
      {esperan.length > 0 && (
        <section>
          <p className="mb-2 text-sm font-medium">Espera tu decisión</p>
          <div className="flex flex-col gap-3">
            {esperan.map((c) =>
              c.decision ? (
                <div key={c.id}>
                  <Tarjeta tarjeta={c.decision.tarjeta} estado={c.decision.estado} alTocar={alTocar} alCambiar={alCambiar} />
                  {c.decision.estado.estado !== 'espera_al_dueno' && <p className="mt-1.5 px-1 text-xs text-muted-foreground">Sigue sin resolver. {DILE}</p>}
                </div>
              ) : (
                <CasoSinTarjeta key={c.id} caso={c} />
              ),
            )}
          </div>
          <Cuantos ves={esperan.length} de={cuentaQueEspera} />
        </section>
      )}
      {resueltos.length > 0 && (
        <section>
          <p className="mb-1 text-sm font-medium">Resueltos</p>
          <ul>
            {resueltos.map((c) => (
              <FilaResuelta key={c.id} caso={c} />
            ))}
          </ul>
          <Cuantos ves={resueltos.length} de={cuentaDeResueltos} />
        </section>
      )}
    </div>
  )
}

/** La Sección de verdad: el botón va a las mismas rutas del Hilo y el refresh le lleva el desenlace al Hilo y al sidebar. */
export function CasosEnLaRuta(datos: DatosDeCasos) {
  const router = useRouter()
  return <VistaDeCasos {...datos} alTocar={tocarTarjeta} alCambiar={() => router.refresh()} />
}
