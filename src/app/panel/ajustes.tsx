'use client'

import { useContext, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { Ajustes } from '@/nucleo/ajustes'
import { CopiarLink } from './copiar-link'
import { EscribirleAlAgente } from './disposicion'

function Fila({ etiqueta, children, accion }: { etiqueta: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b border-border py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{etiqueta}</p>
        <div className="mt-0.5 text-sm wrap-anywhere">{children}</div>
      </div>
      {accion}
    </li>
  )
}

function Cambiar({ que, empieza }: { que: string; empieza: string }) {
  const escribir = useContext(EscribirleAlAgente)
  return (
    <Button variant="outline" size="sm" aria-label={`Cambiar ${que}`} className="shrink-0" onClick={() => escribir(empieza)}>
      Cambiar
    </Button>
  )
}

const Tenue = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>

/**
 * Solo lo que el Negocio ya tiene. Aquí no se guarda nada: nombre y ciudad les llegan a los Clientes, así que
 * `Cambiar` lleva al Hilo, donde sale la tarjeta para aplicarlo y después Publicar.
 */
export function VistaDeAjustes({ nombre, ciudad, link }: Ajustes) {
  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <p className="mb-4 text-sm text-pretty text-muted-foreground">Lo que cambies pasa por tu agente: te muestra cómo queda y tú lo aplicas.</p>
      <ul>
        <Fila etiqueta="Nombre" accion={link ? undefined : <Cambiar que="el nombre" empieza="Mi negocio se llama " />}>
          {nombre}
          {link && <p className="mt-0.5 text-xs text-pretty text-muted-foreground">Con tu negocio abierto, el nombre todavía no se puede cambiar.</p>}
        </Fila>
        <Fila etiqueta="Ciudad" accion={<Cambiar que="la ciudad" empieza={ciudad ? 'Quiero cambiar la ciudad de mi negocio a ' : 'Mi negocio está en '} />}>
          {ciudad || <Tenue>Tu agente todavía no la sabe.</Tenue>}
        </Fila>
        <Fila etiqueta="Tus Clientes te escriben aquí">
          {link ? (
            <div className="mt-1.5">
              <CopiarLink link={link} />
            </div>
          ) : (
            <Tenue>Tu link sale cuando abras tu negocio.</Tenue>
          )}
        </Fila>
        <Fila etiqueta="Modo oscuro">
          <Tenue>Sigue el de tu teléfono o tu computador.</Tenue>
        </Fila>
      </ul>
    </div>
  )
}
