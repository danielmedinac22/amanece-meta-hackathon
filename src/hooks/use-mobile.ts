import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const CONSULTA = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function suscribir(alCambiar: () => void) {
  const mql = window.matchMedia(CONSULTA)
  mql.addEventListener('change', alCambiar)
  return () => mql.removeEventListener('change', alCambiar)
}

export function useIsMobile() {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  )
}
