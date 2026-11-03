/** Cómo se lee una cifra o una advertencia del Panel. Puro: lo importa la pantalla sin cargar la base de datos. */
import type { Unidad } from './consultas/tipos'
import type { Advertencia } from './panel'

const cifra = (n: number) => n.toLocaleString('es-CO')

/** La unidad en palabras, después de una cifra. */
export function conUnidad(valor: number | null, unidad: Unidad): string {
  if (valor === null) return 'sin datos'
  switch (unidad.tipo) {
    case 'dinero':
      return `$${cifra(Math.round(valor))}`
    case 'porcentaje':
      return `${cifra(Math.round(valor * 10) / 10)} %`
    case 'cantidad':
      return `${cifra(valor)}${unidad.nombre ? ` ${unidad.nombre}` : ''}`
  }
}

/** Lo que lee el Dueño de una advertencia, arriba de la tarjeta y del Panel. Lo escribe el código. */
export function advertenciaEnPalabras(a: Advertencia): string {
  switch (a.tipo) {
    case 'supuesto':
      return a.supuesto
    case 'resultado_vacio_con_datos':
      return `No salió nada, aunque hay ${cifra(a.filasEnLasFuentes)} filas en tus datos: revisa que sea lo que querías ver.`
    case 'filas_recortadas':
      return `Hay ${cifra(a.total)} y el Panel muestra ${cifra(a.mostradas)}.`
  }
}
