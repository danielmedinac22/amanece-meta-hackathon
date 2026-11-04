const CIELO = [
  { parada: 0, arriba: '#0a0f2a', abajo: '#151a3a' },
  { parada: 0.2, arriba: '#12173a', abajo: '#2a2a5c' },
  { parada: 0.34, arriba: '#2a2a5c', abajo: '#a85f62' },
  { parada: 0.47, arriba: '#7f9fd6', abajo: '#ffd2b4' },
  { parada: 0.62, arriba: '#a9c7f2', abajo: '#e9f1fb' },
  { parada: 0.84, arriba: '#b9cdec', abajo: '#fbdcc0' },
  { parada: 1, arriba: '#d7b6c4', abajo: '#ffcf9e' },
] as const

export const PARADAS_DEL_CIELO = CIELO.map((c) => c.parada)
export const CIELO_ARRIBA = CIELO.map((c) => c.arriba)
export const CIELO_ABAJO = CIELO.map((c) => c.abajo)
