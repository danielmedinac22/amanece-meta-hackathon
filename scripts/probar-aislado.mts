import { correrAislado } from '../src/lib/aislado'
import { afirmar, terminar } from './afirmar.mjs'

try {
  const confirmados = await correrAislado('function calcular(d){ return d.pedidos.filter(p => p.estado === "confirmado").length }', 'calcular', { pedidos: [{ estado: 'confirmado' }, { estado: 'pendiente' }] })
  console.log(confirmados)
  afirmar('filtra y cuenta solo los pedidos confirmados', confirmados.ok && confirmados.valor === 1, confirmados)

  const bucle = await correrAislado('function calcular(d){ while(true){} }', 'calcular', {})
  console.log(bucle)
  afirmar('un bucle infinito se interrumpe con ok:false y en pocos segundos', !bucle.ok && bucle.ms < 3000, bucle)

  const globales = await correrAislado('function calcular(d){ return typeof fetch + "/" + typeof process + "/" + typeof require }', 'calcular', {})
  console.log(globales)
  afirmar('fetch, process y require no existen dentro del aislado', globales.ok && globales.valor === 'undefined/undefined/undefined', globales)
} catch (e) {
  afirmar('probar-aislado terminó sin error inesperado', false, e)
} finally {
  terminar()
}
