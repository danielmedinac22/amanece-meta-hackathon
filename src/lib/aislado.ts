import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'

/**
 * Corre código generado para un Negocio en QuickJS (WebAssembly): sin red, sin disco, sin acceso al
 * proceso, con tiempo y memoria limitados. La función solo ve los `datos` que le pasa el servidor, que
 * son los de un solo Negocio, así que no tiene cómo leer los de otro.
 */
export type ResultadoAislado = { ok: true; valor: unknown; ms: number } | { ok: false; error: string; ms: number }

const LIMITE_MS = 1000
const LIMITE_MEMORIA = 32 * 1024 * 1024

export async function correrAislado(codigo: string, funcion: 'calcular' | 'consultar', datos: unknown): Promise<ResultadoAislado> {
  const inicio = Date.now()
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(LIMITE_MEMORIA)
  runtime.setMaxStackSize(1024 * 1024)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + LIMITE_MS))
  const vm = runtime.newContext()
  try {
    const programa = `
      "use strict";
      const datos = JSON.parse(${JSON.stringify(JSON.stringify(datos))});
      ${codigo}
      ;JSON.stringify(${funcion}(datos));
    `
    const resultado = vm.evalCode(programa, 'pieza.js')
    if (resultado.error) {
      const error = vm.dump(resultado.error)
      resultado.error.dispose()
      return { ok: false, error: typeof error === 'object' ? `${error?.name ?? 'Error'}: ${error?.message ?? JSON.stringify(error)}` : String(error), ms: Date.now() - inicio }
    }
    const texto = vm.getString(resultado.value)
    resultado.value.dispose()
    return { ok: true, valor: texto === undefined ? null : JSON.parse(texto), ms: Date.now() - inicio }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - inicio }
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}
