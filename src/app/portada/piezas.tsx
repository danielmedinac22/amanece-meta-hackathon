import { CheckCircle } from '@phosphor-icons/react/dist/ssr'
import type { ReactNode } from 'react'
import { TarjetaDeMuestra } from './tarjeta-de-muestra'
import type { Frase, Pieza } from './textos'
import { WhatsappDeMuestra } from './whatsapp'

function FraseConFuertes({ frase }: { frase: Frase }) {
  return (
    <p className="font-heading text-[19px] leading-[1.28] font-medium tracking-tight text-pretty">
      {frase.map((parte, i) => (typeof parte === 'string' ? parte : <b key={i} className="font-semibold">{parte.fuerte}</b>))}
    </p>
  )
}

const CAJA = 'rounded-(--radius) border border-border bg-card text-card-foreground shadow-alzada'

type PiezaDe<T extends Pieza['tipo']> = Extract<Pieza, { tipo: T }>

const PIEZAS: { [T in Pieza['tipo']]: (pieza: PiezaDe<T>, enLinea: string) => ReactNode } = {
  conversacion: (p, enLinea) => <WhatsappDeMuestra negocio={p.negocio} enLinea={enLinea} mensajes={p.mensajes} className={`${CAJA} bg-muted`} />,
  lista: (p) => (
    <ul className={`${CAJA} flex flex-col gap-1 px-4 py-3.5 text-[13.5px] text-muted-foreground`}>
      {p.filas.map((fila) => (
        <li key={fila} className="flex items-center gap-[7px]">
          <CheckCircle weight="fill" className="size-[15px] shrink-0 text-bien" />
          {fila}
        </li>
      ))}
    </ul>
  ),
  frase: (p) => (
    <div className={`${CAJA} flex flex-col gap-2.5 px-4 py-3.5`}>
      {p.encabezado && (
        <div className="flex items-center gap-2">
          <strong className="font-heading text-[13.5px] font-semibold">{p.encabezado.titulo}</strong>
          <span className="ml-auto inline-flex items-center gap-[5px] rounded-full bg-bien-suave px-2 py-0.5 text-[11.5px] font-semibold text-bien">
            <i aria-hidden className="size-1.5 rounded-full bg-current" />
            {p.encabezado.estado}
          </span>
        </div>
      )}
      <FraseConFuertes frase={p.frase} />
    </div>
  ),
  caso: (p) => (
    <TarjetaDeMuestra etiqueta={p.etiqueta} titulo={p.titulo} principal={p.principal} secundaria={p.secundaria} nota={p.nota}>
      <p>{p.escribio}</p>
      <p className="rounded-[calc(var(--radius)-4px)] bg-muted px-2.5 py-2">{p.respuesta}</p>
    </TarjetaDeMuestra>
  ),
  indicador: (p) => (
    <TarjetaDeMuestra etiqueta={p.etiqueta} titulo={p.titulo} principal={p.principal} secundaria={p.secundaria} nota={p.nota}>
      <div className="flex flex-col gap-[7px] rounded-[10px] border border-dashed border-ojo px-3 py-2.5">
        <span className="text-[11px] font-medium text-muted-foreground">{p.titulo}</span>
        <div aria-hidden className="flex h-[62px] items-end gap-[5px]">
          {p.barras.map((alto, i) => (
            <i key={i} className="flex-1 rounded-t-[4px] rounded-b-[1px] bg-primary opacity-85" style={{ height: `${alto}%` }} />
          ))}
        </div>
      </div>
    </TarjetaDeMuestra>
  ),
}

export function PiezaDelDia({ pieza, enLinea }: { pieza: Pieza; enLinea: string }) {
  const pintar = PIEZAS[pieza.tipo] as (p: Pieza, enLinea: string) => ReactNode
  return pintar(pieza, enLinea)
}
