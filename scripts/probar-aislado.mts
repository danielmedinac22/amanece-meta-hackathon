import { correrAislado } from '../src/lib/aislado'
console.log(await correrAislado('function calcular(d){ return d.pedidos.filter(p => p.estado === "confirmado").length }', 'calcular', { pedidos: [{ estado: 'confirmado' }, { estado: 'pendiente' }] }))
console.log(await correrAislado('function calcular(d){ while(true){} }', 'calcular', {}))
console.log(await correrAislado('function calcular(d){ return typeof fetch + "/" + typeof process + "/" + typeof require }', 'calcular', {}))
