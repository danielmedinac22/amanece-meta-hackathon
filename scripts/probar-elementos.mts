/**
 * El estado de un Negocio contra la base real, sin modelo: `escribir`, `leerEstado` y `cotizar`. Crea tres Negocios
 * desechables y los borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-elementos.mts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { leerEstado, EstadoIlegible } = await import('../src/nucleo/estado')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { cotizar } = await import('../src/nucleo/precios/cotizar')
const { marcar } = await import('../src/nucleo/identidad')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type CambioDeElemento = import('../src/nucleo/estado').CambioDeElemento
type NegocioId = import('../src/nucleo/identidad').NegocioId

const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const { clave, version, monto } = { clave: el.comoClave, version: el.comoVersion, monto: el.comoMonto }

async function negocioDesechable(letra: string): Promise<NegocioId> {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Prueba de elementos ${letra}`, codigo: `PEL${marca}${letra}`, estado: 'listo' }).returning({ id: esquema.negocios.id })
  creados.push(n.id)
  return marcar.negocio(n.id)
}

const escribirEn = (negocio: NegocioId, elementos: readonly CambioDeElemento[]) =>
  conTransaccion((tx) => escribir(tx, negocio, { tipo: 'entrevista' }, { elementos, filas: [] }))
const filasDe = async (negocio: NegocioId, c?: string) =>
  db.$count(esquema.elementos, c ? and(eq(esquema.elementos.negocioId, negocio), eq(esquema.elementos.clave, c)) : eq(esquema.elementos.negocioId, negocio))
const foto = async (negocio: NegocioId) => {
  const e = await leerEstado(negocio)
  return JSON.stringify({ version: e.version, todos: e.todos() })
}
const horario = (valor: string): Elemento => ({ tipo: 'dato', campo: 'horario', valor })
const regla = (cuando: Extract<Elemento, { tipo: 'regla' }>['cuando'], efectos: Extract<Elemento, { tipo: 'regla' }>['efectos']): Elemento => ({
  tipo: 'regla',
  nombre: 'Regla de prueba',
  cuando,
  efectos,
  escenarios: { activan: [{ mensajeDelCliente: '¿Cuándo llega?', momento: null, pedido: null, esperado: { hace: ['abrir_caso'], noHace: [] } }], noActivan: [] },
})

try {
  const A = await negocioDesechable('A')
  const B = await negocioDesechable('B')
  const C = await negocioDesechable('C')
  await escribirEn(B, [{ clave: clave('dato:ciudad'), base: 'nueva', despues: { tipo: 'dato', campo: 'ciudad', valor: 'Pasto' } }])
  const fotoDeB = await foto(B)

  console.log('\n=== E1. Tres versiones de dato:horario: vale la última ===')
  const h = clave('dato:horario')
  const v1 = await escribirEn(A, [{ clave: h, base: 'nueva', despues: horario('uno') }])
  const v2 = v1.tipo === 'escrito' ? await escribirEn(A, [{ clave: h, base: v1.version, despues: horario('dos') }]) : v1
  const v3 = v2.tipo === 'escrito' ? await escribirEn(A, [{ clave: h, base: v2.version, despues: horario('tres') }]) : v2
  const e1 = await leerEstado(A)
  const vigente = e1.vigente(h)
  afirmar('E1: las tres escrituras quedan, con versiones 1, 2 y 3', v1.tipo === 'escrito' && v1.version === 1 && v2.tipo === 'escrito' && v2.version === 2 && v3.tipo === 'escrito' && v3.version === 3, { v1, v2, v3 })
  afirmar('E1: vale la última', vigente?.elemento.tipo === 'dato' && vigente.elemento.valor === 'tres' && vigente.version === 3 && e1.version === 3, vigente)
  afirmar('E1: la tabla guarda las tres versiones', (await filasDe(A, h)) === 3)

  console.log('\n=== E2. Quitar: desaparece y la versión anterior sigue en la tabla ===')
  const q = await escribirEn(A, [{ clave: h, base: version(3), despues: null }])
  const e2 = await leerEstado(A)
  afirmar('E2: quitar sube la versión y el dato ya no está vigente', q.tipo === 'escrito' && q.version === 4 && e2.vigente(h) === null && e2.vigentes('dato').length === 0, { q, todos: e2.todos() })
  afirmar('E2: las versiones anteriores siguen en la tabla', (await filasDe(A, h)) === 4)
  const deNuevo = await escribirEn(A, [{ clave: h, base: 'nueva', despues: horario('cinco') }])
  afirmar('E2: una clave quitada se vuelve a poner con base nueva', deNuevo.tipo === 'escrito' && (await leerEstado(A)).vigente(h)?.version === 5, deNuevo)

  console.log('\n=== E3. Dos propuestas sobre la misma clave: la segunda da conflicto ===')
  const base = (await leerEstado(A)).vigente(h)!.version
  const primera = await escribirEn(A, [{ clave: h, base, despues: horario('de Juan') }])
  const filasAntes = await filasDe(A)
  const segunda = await escribirEn(A, [
    { clave: h, base, despues: horario('de Ana') },
    { clave: clave('dato:pagos'), base: 'nueva', despues: { tipo: 'dato', campo: 'pagos', valor: 'Nequi' } },
  ])
  const e3 = await leerEstado(A)
  afirmar('E3: la primera escribe', primera.tipo === 'escrito', primera)
  afirmar('E3: la segunda da conflicto en dato:horario, con quién y cuándo', segunda.tipo === 'conflicto' && segunda.claves.length === 1 && segunda.claves[0].clave === h && segunda.claves[0].tocadaPor.tipo === 'entrevista' && segunda.claves[0].resumen.includes('de Juan'), segunda)
  afirmar('E3: la segunda no escribe nada, ni la clave que no chocaba', (await filasDe(A)) === filasAntes && e3.vigente(clave('dato:pagos')) === null && e3.version === 6, { version: e3.version })
  const nuevaQueYaExiste = await escribirEn(A, [{ clave: h, base: 'nueva', despues: horario('otra') }])
  afirmar('E3: base nueva sobre una clave que existe es conflicto', nuevaQueYaExiste.tipo === 'conflicto', nuevaQueYaExiste)

  console.log('\n=== E4. Doble clic simultáneo: una sola versión y una sola fila ===')
  const ciudad = (valor: string): CambioDeElemento => ({ clave: clave('dato:ciudad'), base: 'nueva', despues: { tipo: 'dato', campo: 'ciudad', valor } })
  const aLaVez = await Promise.allSettled([escribirEn(A, [ciudad('Manizales')]), escribirEn(A, [ciudad('Pereira')])])
  const desenlaces = aLaVez.map((r) => (r.status === 'fulfilled' ? r.value.tipo : `lanzó: ${r.reason}`)).sort()
  afirmar('E4: uno escribe y el otro da conflicto, sin excepción', JSON.stringify(desenlaces) === JSON.stringify(['conflicto', 'escrito']), desenlaces)
  afirmar('E4: una sola fila de dato:ciudad y la versión subió una vez', (await filasDe(A, 'dato:ciudad')) === 1 && (await leerEstado(A)).version === 7)

  console.log('\n=== E5. Una escritura vacía no sube la versión ===')
  const vacia = await escribirEn(A, [])
  afirmar('E5: escrito con la misma versión', vacia.tipo === 'escrito' && vacia.version === 7 && (await leerEstado(A)).version === 7, vacia)

  console.log('\n=== E6. Contratos ===')
  const viejo = clave('dato:envios')
  await db.insert(esquema.elementos).values({ negocioId: C, clave: viejo, version: 1, tipo: 'dato', contrato: 0, contenido: { tipo: 'dato', campo: 'envios', valor: 'Todo el país' }, origen: 'tablas_viejas' })
  await db.update(esquema.negocios).set({ version: 1 }).where(eq(esquema.negocios.id, C))
  const conViejo = await leerEstado(C)
  afirmar('E6: un contrato viejo se lee con el esquema de hoy', conViejo.vigente(viejo)?.elemento.tipo === 'dato', conViejo.todos())
  await db.insert(esquema.elementos).values({ negocioId: C, clave: viejo, version: 2, tipo: 'dato', contrato: 99, contenido: { tipo: 'dato', campo: 'envios', valor: 'Del futuro' }, origen: 'tablas_viejas' })
  const futuro = await leerEstado(C).then(
    () => 'se leyó',
    (e: unknown) => e,
  )
  afirmar('E6: un contrato del futuro es EstadoIlegible', futuro instanceof EstadoIlegible, futuro)
  await db.delete(esquema.elementos).where(and(eq(esquema.elementos.negocioId, C), eq(esquema.elementos.version, 2)))
  await db.insert(esquema.elementos).values({ negocioId: C, clave: viejo, version: 2, tipo: 'dato', contrato: 1, contenido: { tipo: 'dato', campo: 'envios' }, origen: 'tablas_viejas' })
  const roto = await leerEstado(C).then(
    () => 'se leyó',
    (e: unknown) => e,
  )
  afirmar('E6: un contenido que no parsea es EstadoIlegible', roto instanceof EstadoIlegible, roto)

  console.log('\n=== E7. Escribir en A no toca B ===')
  afirmar('E7: leerEstado(B) quedó idéntico', (await foto(B)) === fotoDeB)

  console.log('\n=== E9. escribir lanza con lo que hoy nada hace cumplir ===')
  const antesDeE9 = await filasDe(A)
  const conPedido = regla({ tipo: 'pedido', condicion: { tipo: 'total_desde', monto: monto(100000) } }, [{ tipo: 'abrir_caso', titulo: 'Pedido grande' }])
  const conNoVender = regla({ tipo: 'siempre' }, [{ tipo: 'no_vender', explicacionAlCliente: 'Hoy no vendemos' }])
  const conTema = regla({ tipo: 'tema', tema: 'envíos' }, [{ tipo: 'abrir_caso', titulo: 'Envíos' }])
  for (const [nombre, r] of [['cuando: pedido', conPedido], ['efecto no_vender', conNoVender], ['cuando: tema', conTema]] as const) {
    const intento = await escribirEn(A, [{ clave: el.claveNueva('regla'), base: 'nueva', despues: r }]).then(
      () => 'escribió',
      (e: Error) => e.message,
    )
    afirmar(`E9: una regla con ${nombre} no se escribe`, intento !== 'escribió', intento)
  }
  const sinForma = await escribirEn(A, [{ clave: clave('dato:pagos'), base: 'nueva', despues: { tipo: 'dato', campo: 'pagos' } as unknown as Elemento }]).then(
    () => 'escribió',
    (e: Error) => e.message,
  )
  afirmar('E9: un Elemento sin la forma de su tipo no se escribe', sinForma !== 'escribió', sinForma)
  const permitida = await escribirEn(A, [{ clave: el.claveNueva('regla'), base: 'nueva', despues: regla({ tipo: 'siempre' }, [{ tipo: 'no_prometer', que: 'plazo' }]) }])
  afirmar('E9: una regla siempre con no_prometer sí se escribe', permitida.tipo === 'escrito' && (await filasDe(A)) === antesDeE9 + 1, permitida)

  console.log('\n=== cotizar ===')
  const cafe = el.claveDeProducto.deId('00000000-0000-4000-8000-0000000000a1')
  const molino = el.claveDeProducto.deId('00000000-0000-4000-8000-0000000000a2')
  await escribirEn(B, [
    { clave: cafe, base: 'nueva', despues: { tipo: 'producto', nombre: 'Café 500 g', descripcion: '', precio: monto(38000), activo: true } },
    { clave: molino, base: 'nueva', despues: { tipo: 'producto', nombre: 'Molino', descripcion: '', precio: monto(119000), activo: false } },
  ])
  const eB = await leerEstado(B)
  const c1 = cotizar({ items: [{ producto: cafe, cantidad: 1 }, { producto: cafe, cantidad: 1 }], ciudad: 'Pasto' }, eB)
  afirmar('cotizar: un producto repetido se suma y el total sale del precio', 'total' in c1 && c1.total === 76000 && c1.lineas.length === 1 && c1.lineas[0].cantidad === 2, c1)
  afirmar('cotizar: un producto que no se vende no cubre', 'noCubre' in cotizar({ items: [{ producto: molino, cantidad: 1 }], ciudad: 'Pasto' }, eB))
  afirmar('cotizar: una clave que no existe no cubre', 'noCubre' in cotizar({ items: [{ producto: clave('producto:nada'), cantidad: 1 }], ciudad: 'Pasto' }, eB))
  afirmar('claveDeProducto: ida y vuelta al id de pedidos.items', el.claveDeProducto.aId(cafe) === '00000000-0000-4000-8000-0000000000a1')

  console.log('\n=== E8. Importaciones ===')
  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx|mts)$/.test(n) ? [p] : []
    })
  const fuentes = [...archivos('src'), ...archivos('scripts')].map((p) => ({ ruta: relative('.', p), texto: readFileSync(p, 'utf8') }))
  const con = (re: RegExp) => fuentes.filter((f) => re.test(f.texto)).map((f) => f.ruta)
  const leenElementos = con(/esquema\.elementos\b/).filter((r) => r.startsWith('src/'))
  afirmar('E8: esquema.elementos solo aparece en src/nucleo/estado/', leenElementos.length > 0 && leenElementos.every((r) => r.startsWith('src/nucleo/estado/')), leenElementos)
  const escriben = con(/from ['"][^'"]*estado\/escribir['"]|import\(['"][^'"]*estado\/escribir['"]\)/)
  afirmar('E8: estado/escribir solo lo importan src/nucleo/cambios/ y scripts/', escriben.every((r) => r.startsWith('src/nucleo/cambios/') || r.startsWith('scripts/')), escriben)
} catch (e) {
  afirmar('probar-elementos terminó sin error inesperado', false, e)
} finally {
  if (creados.length) {
    await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
    afirmar('limpieza: no quedan Elementos de los Negocios desechables', (await db.$count(esquema.elementos, inArray(esquema.elementos.negocioId, creados))) === 0)
  }
  terminar()
}
