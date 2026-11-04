/** Hora del día, color de arriba y color de abajo. Aquí y no en un token: es de la hora, y no cambia con el tema. */
const CIELO = [
  [0, '#0a0f2a', '#151a3a'],
  [0.2, '#12173a', '#2a2a5c'],
  [0.34, '#2a2a5c', '#a85f62'],
  [0.47, '#7f9fd6', '#ffd2b4'],
  [0.62, '#a9c7f2', '#e9f1fb'],
  [0.84, '#b9cdec', '#fbdcc0'],
  [1, '#d7b6c4', '#ffcf9e'],
] as const

export const PARADAS_DEL_CIELO = CIELO.map((c) => c[0])
export const CIELO_ARRIBA = CIELO.map((c) => c[1])
export const CIELO_ABAJO = CIELO.map((c) => c[2])
