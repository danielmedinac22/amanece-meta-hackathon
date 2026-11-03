'use client'

import { useState } from 'react'
import { Alba } from '@/app/alba'
import { ArmadoDeMuestra } from './armado-de-muestra'
import { ARMADO_VACIO } from './datos-armado'

/** Sin sesión, la vitrina salta la cuenta: lo que viaja de la caja al armado es lo mismo que en la ruta de verdad. */
export function AlbaHastaElArmado() {
  const [entro, setEntro] = useState(false)
  return entro ? <ArmadoDeMuestra datos={ARMADO_VACIO} messages={[]} /> : <Alba alSeguir={() => setEntro(true)} />
}
