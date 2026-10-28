/** Para cada corrida de JS que no salió bien: qué declaró, qué campos usó el código sin haberlos declarado, y si el resultado salió vacío. */
import { readFileSync, existsSync } from 'node:fs'
import { PETICIONES, comparar } from '../../src/medir-sql/peticiones'
const CAMPOS = ['id', 'nombre', 'precio', 'activo', 'telefonoEnmascarado', 'creado', 'numero', 'clienteId', 'items', 'total', 'ciudad', 'estado', 'titulo', 'pedidoId', 'resuelto', 'rol']
let sinDeclarar = 0, vacios = 0, malos = 0
const filas: string[] = []
for (const r of [1, 2, 3]) {
  const f = `scripts/medir-sql/resultados/js-rep${r}.json`
  if (!existsSync(f)) continue
  for (const x of JSON.parse(readFileSync(f, 'utf8')) as any[]) {
    const pet = PETICIONES.find((q) => q.id === x.id)!
    if (pet.esperado === 'respuesta' && x.filasFinales) { const c = comparar(x.filasDeLaVerdad, x.filasFinales, pet.comparador, pet.forma.tipo === 'serie'); x.veredicto = c.ok ? 'correcta' : 'mal_en_silencio'; x.razon = c.razon }
    if (x.veredicto !== 'mal_en_silencio' || x.esperado === 'declinar') continue
    malos++
    const decl = x.pasos.filter((p: any) => p.fase === 'declarar').at(-1)
    const declarados = new Set<string>()
    for (const t of decl.tablas as string[]) { const m = t.match(/^(\w+)\((.*)\)$/)!; for (const c of m[2].split(',')) declarados.add(c) }
    const usados = CAMPOS.filter((c) => new RegExp(`[.\\[]['"]?${c}\\b`).test(x.codigoFinal))
    const faltan = usados.filter((c) => !declarados.has(c) && ['creado', 'estado', 'total', 'ciudad', 'clienteId', 'items', 'numero', 'resuelto', 'nombre', 'id', 'rol', 'pedidoId'].includes(c))
    const vacio = x.filas === 0
    if (vacio) vacios++
    if (faltan.length) sinDeclarar++
    filas.push(`| ${x.id} | ${r} | ${decl.tablas.join(' ')} | ${x.ventanaDeclarada} | ${faltan.join(', ') || '-'} | ${x.filas} (verdad ${x.filasDeLaVerdad?.length ?? '?'}) | ${x.razon.slice(0, 70)} |`)
  }
}
console.log('| Pedido | Rep | Lo que declaró | Ventana | Campos que el código usa y no declaró | Filas devueltas | Razón |\n|---|---|---|---|---|---|---|')
console.log(filas.join('\n'))
console.log(`\nMal en silencio (respondibles): ${malos}. Con resultado vacío: ${vacios}. Con campos usados sin declarar (heurística por texto): ${sinDeclarar}.`)
