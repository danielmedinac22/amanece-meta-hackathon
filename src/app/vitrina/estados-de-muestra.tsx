'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import type { MotivoDeEntrada } from '@/app/entrar/errores'
import { PantallaDeEntrada, type ModoDeEntrada } from '@/app/entrar/formulario'
import { ErrorDeLaPantalla } from '@/app/panel/estados'

// `--clic` espera 600 ms antes de su siguiente paso: el recorrido tiene que alcanzar a ver `Entrando…` aunque la máquina vaya lenta.
const ENTRAR_TARDA_MS = 2000

/** Entrar sin proveedor: cada intento responde lo que sigue en la lista, y `null` es que entró. */
export function EntradaDeMuestra({ modoInicial, responde }: { modoInicial: ModoDeEntrada; responde: readonly (MotivoDeEntrada | null)[] }) {
  const intento = useRef(0)
  const [entro, setEntro] = useState(false)
  if (entro) return <p className="p-5">Ya entraste.</p>
  return (
    <PantallaDeEntrada
      modoInicial={modoInicial}
      entrar={async () => {
        await new Promise((r) => setTimeout(r, ENTRAR_TARDA_MS))
        return responde[intento.current++] ?? null
      }}
      alEntrar={() => setEntro(true)}
    />
  )
}

/** El error de una Sección: al volver a intentar, en la vitrina sigue fallando. */
export function ErrorDeMuestra({ titulo }: { titulo: string }) {
  const [veces, setVeces] = useState(0)
  return (
    <div data-reintentos={veces}>
      <ErrorDeLaPantalla titulo={titulo} alReintentar={() => setVeces((v) => v + 1)} />
    </div>
  )
}

/** Falla al pintar hasta que la prueba lo deja pasar: así se recorre el `error.tsx` de verdad y su `retry`. */
export function QueFallaDeVerdad() {
  // Solo en el navegador: en el servidor, Next respondería 500 en vez de pintar `error.tsx`.
  const montada = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  if (montada && !('yaNoFalla' in window)) throw new Error('Falla de muestra')
  return <p>Ya cargó.</p>
}
