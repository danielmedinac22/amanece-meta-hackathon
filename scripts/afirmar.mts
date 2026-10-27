import { inspect } from 'node:util'

/**
 * Las aserciones de los `probar-*`. Cada script es su propio proceso, así que el estado vive en el módulo:
 * los casos se registran con `afirmar` y `terminar` sale con 1 si alguno falló.
 */
type Falla = { caso: string; detalle?: unknown }

const fallas: Falla[] = []
let casos = 0

const mostrar = (valor: unknown) => {
  const texto = valor instanceof Error ? (valor.stack ?? valor.message) : inspect(valor, { depth: 4, breakLength: 120 })
  return texto.length > 800 ? `${texto.slice(0, 800)}…` : texto
}

export function afirmar(caso: string, ok: boolean, detalle?: unknown) {
  casos++
  if (ok) return void console.log(`  ✓ ${caso}`)
  fallas.push({ caso, detalle })
  console.log(`  ✗ ${caso}${detalle === undefined ? '' : `\n      ${mostrar(detalle).replace(/\n/g, '\n      ')}`}`)
}

export function terminar(): never {
  console.log(`\n${casos} casos, ${fallas.length} fallaron.`)
  for (const f of fallas) console.log(`  ✗ ${f.caso}`)
  process.exit(fallas.length ? 1 : 0)
}

export type Envio = { telefono: string; texto: string }

/**
 * Lo único que se ve de un envío con `ENVIO_SIMULADO=1` es su línea de log: se sigue imprimiendo y además
 * se junta aquí. El arreglo que devuelve se llena solo a medida que salen mensajes.
 */
export function capturarEnvios(): Envio[] {
  const envios: Envio[] = []
  const imprimir = console.log
  console.log = (...args: unknown[]) => {
    imprimir(...args)
    const linea = typeof args[0] === 'string' ? /^\[envío simulado a ([^\]]+)\] ([\s\S]*)$/.exec(args[0]) : null
    if (linea) envios.push({ telefono: linea[1], texto: linea[2] })
  }
  return envios
}

/**
 * `recibirMensaje` se traga los fallos del turno y le manda una disculpa al Cliente, así que un modelo caído
 * pasa por un envío normal. Todo `console.error` que sale mientras corre una prueba es un fallo escondido.
 */
export function capturarErrores(): unknown[][] {
  const errores: unknown[][] = []
  const imprimir = console.error
  console.error = (...args: unknown[]) => {
    imprimir(...args)
    errores.push(args)
  }
  return errores
}
