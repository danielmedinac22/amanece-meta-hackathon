/**
 * El estado de un Negocio contra la base real, sin modelo: `escribir`, `leerAplicado` y `cotizar`. Crea tres Negocios
 * desechables y los borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-elementos.mts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { armarEstado, leerAplicado, EstadoIlegible } = await import('../src/nucleo/estado')
const { ESQUEMA_DEL_PEDIDO, queFaltaParaAbrir } = await import('../src/nucleo/cambios')
const { politicaDeAprobacion } = await import('../src/nucleo/cambios/politica')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { cotizar } = await import('../src/nucleo/precios/cotizar')
const { marcar } = await import('../src/nucleo/identidad')
const { canonico } = await import('../src/lib/canonico')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type CambioDeElemento = import('../src/nucleo/estado').CambioDeElemento
type NegocioId = import('../src/nucleo/identidad').NegocioId
type ConsultaGuardada = import('../src/nucleo/consultas/tipos').ConsultaGuardada

/** Los niveles de un JSON Schema como los cuenta Muse Spark: cada esquema anidado en propiedades, ítems o variantes. */
const niveles = (s: unknown): number => {
  if (!s || typeof s !== 'object') return 0
  const e = s as { properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; oneOf?: unknown[]; allOf?: unknown[] }
  const hijos = [...Object.values(e.properties ?? {}), ...(e.items ? [e.items] : []), ...(e.anyOf ?? []), ...(e.oneOf ?? []), ...(e.allOf ?? [])]
  return 1 + Math.max(0, ...hijos.map(niveles))
}

const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const { clave, version, monto } = { clave: el.comoClave, version: el.comoVersion, monto: el.comoMonto }

async function negocioDesechable(letra: string): Promise<NegocioId> {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Prueba de elementos ${letra}`, codigo: `PEL${marca}${letra}`, estado: 'listo' }).returning({ id: esquema.negocios.id })
  creados.push(n.id)
  return marcar.negocio(n.id)
}

const escribirEn = (negocio: NegocioId, elementos: readonly CambioDeElemento[]) =>
  conTransaccion((tx) => escribir(tx, negocio, { tipo: 'entrevista' }, { elementos, filas: [] }, null))
const filasDe = async (negocio: NegocioId, c?: string) =>
  db.$count(esquema.elementos, c ? and(eq(esquema.elementos.negocioId, negocio), eq(esquema.elementos.clave, c)) : eq(esquema.elementos.negocioId, negocio))
const foto = async (negocio: NegocioId) => {
  const e = await leerAplicado(negocio)
  return JSON.stringify({ version: e.version, todos: e.todos() })
}
const horario = (valor: string): Elemento => ({ tipo: 'dato', campo: 'horario', valor })
const regla = (cuando: Extract<Elemento, { tipo: 'regla' }>['cuando'], efectos: Extract<Elemento, { tipo: 'regla' }>['efectos'], nombre = 'Regla de prueba'): Elemento => ({
  tipo: 'regla',
  nombre,
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
  const e1 = await leerAplicado(A)
  const vigente = e1.vigente(h)
  afirmar('E1: las tres escrituras quedan, con versiones 1, 2 y 3', v1.tipo === 'escrito' && v1.version === 1 && v2.tipo === 'escrito' && v2.version === 2 && v3.tipo === 'escrito' && v3.version === 3, { v1, v2, v3 })
  afirmar('E1: vale la última', vigente?.elemento.tipo === 'dato' && vigente.elemento.valor === 'tres' && vigente.version === 3 && e1.version === 3, vigente)
  afirmar('E1: la tabla guarda las tres versiones', (await filasDe(A, h)) === 3)

  console.log('\n=== E2. Quitar: desaparece y la versión anterior sigue en la tabla ===')
  const q = await escribirEn(A, [{ clave: h, base: version(3), despues: null }])
  const e2 = await leerAplicado(A)
  afirmar('E2: quitar sube la versión y el dato ya no está vigente', q.tipo === 'escrito' && q.version === 4 && e2.vigente(h) === null && e2.vigentes('dato').length === 0, { q, todos: e2.todos() })
  afirmar('E2: las versiones anteriores siguen en la tabla', (await filasDe(A, h)) === 4)
  const deNuevo = await escribirEn(A, [{ clave: h, base: 'nueva', despues: horario('cinco') }])
  afirmar('E2: una clave quitada se vuelve a poner con base nueva', deNuevo.tipo === 'escrito' && (await leerAplicado(A)).vigente(h)?.version === 5, deNuevo)

  console.log('\n=== E3. Dos propuestas sobre la misma clave: la segunda da conflicto ===')
  const base = (await leerAplicado(A)).vigente(h)!.version
  const primera = await escribirEn(A, [{ clave: h, base, despues: horario('de Juan') }])
  const filasAntes = await filasDe(A)
  const segunda = await escribirEn(A, [
    { clave: h, base, despues: horario('de Ana') },
    { clave: clave('dato:pagos'), base: 'nueva', despues: { tipo: 'dato', campo: 'pagos', valor: 'Nequi' } },
  ])
  const e3 = await leerAplicado(A)
  afirmar('E3: la primera escribe', primera.tipo === 'escrito', primera)
  afirmar('E3: la segunda da conflicto en dato:horario, con quién y cuándo', segunda.tipo === 'conflicto' && segunda.claves.length === 1 && segunda.claves[0].clave === h && segunda.claves[0].tocadaPor?.tipo === 'entrevista' && segunda.claves[0].resumen.includes('de Juan'), segunda)
  afirmar('E3: la segunda no escribe nada, ni la clave que no chocaba', (await filasDe(A)) === filasAntes && e3.vigente(clave('dato:pagos')) === null && e3.version === 6, { version: e3.version })
  const nuevaQueYaExiste = await escribirEn(A, [{ clave: h, base: 'nueva', despues: horario('otra') }])
  afirmar('E3: base nueva sobre una clave que existe es conflicto', nuevaQueYaExiste.tipo === 'conflicto', nuevaQueYaExiste)

  console.log('\n=== E4. Doble clic simultáneo: una sola versión y una sola fila ===')
  const ciudad = (valor: string): CambioDeElemento => ({ clave: clave('dato:ciudad'), base: 'nueva', despues: { tipo: 'dato', campo: 'ciudad', valor } })
  const aLaVez = await Promise.allSettled([escribirEn(A, [ciudad('Manizales')]), escribirEn(A, [ciudad('Pereira')])])
  const desenlaces = aLaVez.map((r) => (r.status === 'fulfilled' ? r.value.tipo : `lanzó: ${r.reason}`)).sort()
  afirmar('E4: uno escribe y el otro da conflicto, sin excepción', JSON.stringify(desenlaces) === JSON.stringify(['conflicto', 'escrito']), desenlaces)
  afirmar('E4: una sola fila de dato:ciudad y la versión subió una vez', (await filasDe(A, 'dato:ciudad')) === 1 && (await leerAplicado(A)).version === 7)

  console.log('\n=== E5. Una escritura vacía no sube la versión ===')
  const vacia = await escribirEn(A, [])
  afirmar('E5: escrito con la misma versión', vacia.tipo === 'escrito' && vacia.version === 7 && (await leerAplicado(A)).version === 7, vacia)

  console.log('\n=== E6. Contratos ===')
  const viejo = clave('dato:envios')
  await db.insert(esquema.elementos).values({ negocioId: C, clave: viejo, version: 1, tipo: 'dato', contrato: 0, contenido: { tipo: 'dato', campo: 'envios', valor: 'Todo el país' }, origen: 'tablas_viejas', sinPublicar: false })
  await db.update(esquema.negocios).set({ version: 1 }).where(eq(esquema.negocios.id, C))
  const conViejo = await leerAplicado(C)
  afirmar('E6: un contrato viejo se lee con el esquema de hoy', conViejo.vigente(viejo)?.elemento.tipo === 'dato', conViejo.todos())
  await db.insert(esquema.elementos).values({ negocioId: C, clave: viejo, version: 2, tipo: 'dato', contrato: 99, contenido: { tipo: 'dato', campo: 'envios', valor: 'Del futuro' }, origen: 'tablas_viejas', sinPublicar: false })
  const futuro = await leerAplicado(C).then(
    () => 'se leyó',
    (e: unknown) => e,
  )
  afirmar('E6: un contrato del futuro es EstadoIlegible', futuro instanceof EstadoIlegible, futuro)
  await db.delete(esquema.elementos).where(and(eq(esquema.elementos.negocioId, C), eq(esquema.elementos.version, 2)))
  await db.insert(esquema.elementos).values({ negocioId: C, clave: viejo, version: 2, tipo: 'dato', contrato: 1, contenido: { tipo: 'dato', campo: 'envios' }, origen: 'tablas_viejas', sinPublicar: false })
  const roto = await leerAplicado(C).then(
    () => 'se leyó',
    (e: unknown) => e,
  )
  afirmar('E6: un contenido que no parsea es EstadoIlegible', roto instanceof EstadoIlegible, roto)

  console.log('\n=== E7. Escribir en A no toca B ===')
  afirmar('E7: leerAplicado(B) quedó idéntico', (await foto(B)) === fotoDeB)

  console.log('\n=== E9. escribir no deja entrar lo que hoy nada hace cumplir ===')
  const antesDeE9 = await filasDe(A)
  const pasarConPedido = regla({ tipo: 'pedido', condicion: { tipo: 'ciudad_fuera_de', ciudades: ['Manizales'] } }, [{ tipo: 'pasar_al_dueno', avisoAlCliente: 'Ya le aviso a Ana.' }])
  const conNoVender = regla({ tipo: 'siempre' }, [{ tipo: 'no_vender', explicacionAlCliente: 'Hoy no vendemos' }])
  const conTema = regla({ tipo: 'tema', tema: 'envíos' }, [{ tipo: 'abrir_caso', titulo: 'Envíos' }])
  for (const [nombre, r] of [['cuando: pedido y pasar_al_dueno, que se cumpliría antes de saberse', pasarConPedido], ['efecto no_vender', conNoVender], ['cuando: tema', conTema]] as const) {
    const intento = await escribirEn(A, [{ clave: el.claveNueva('regla'), base: 'nueva', despues: r }])
    afirmar(`E9: una regla con ${nombre} no se escribe: invalida`, intento.tipo === 'invalida', intento)
  }
  const sinForma = await escribirEn(A, [{ clave: clave('dato:pagos'), base: 'nueva', despues: { tipo: 'dato', campo: 'pagos' } as unknown as Elemento }])
  afirmar('E9: un Elemento sin la forma de su tipo no se escribe: invalida', sinForma.tipo === 'invalida', sinForma)
  for (const efecto of [{ tipo: 'pasar_al_dueno', avisoAlCliente: 'Ya le aviso a Ana.' }, { tipo: 'abrir_caso', titulo: 'Un Cliente escribió' }] as const) {
    const siempre = await escribirEn(A, [{ clave: el.claveNueva('regla'), base: 'nueva', despues: regla({ tipo: 'siempre' }, [efecto]) }])
    afirmar(`E9: una regla siempre con ${efecto.tipo} es invalida`, siempre.tipo === 'invalida' && siempre.problemas.some((p) => p.tipo === 'valor_invalido' && p.campo === 'efectos'), siempre)
  }
  afirmar('E9: nada de lo invalido dejó filas', (await filasDe(A)) === antesDeE9)
  const permitida = await escribirEn(A, [{ clave: el.claveNueva('regla'), base: 'nueva', despues: regla({ tipo: 'siempre' }, [{ tipo: 'no_prometer', que: 'plazo' }]) }])
  afirmar('E9: una regla siempre con no_prometer sí se escribe', permitida.tipo === 'escrito' && (await filasDe(A)) === antesDeE9 + 1, permitida)
  const deManizales = await escribirEn(A, [
    { clave: el.claveNueva('regla'), base: 'nueva', despues: regla({ tipo: 'pedido', condicion: { tipo: 'ciudad_fuera_de', ciudades: ['Manizales'] } }, [{ tipo: 'abrir_caso', titulo: 'Pedido fuera de Manizales' }, { tipo: 'no_prometer', que: 'plazo' }], 'Fuera de Manizales') },
  ])
  afirmar('E9: la regla de Manizales, cuando pedido con abrir_caso y no_prometer, sí se escribe', deManizales.tipo === 'escrito', deManizales)

  console.log('\n=== E10. La validación corre dentro de la transacción, después del FOR UPDATE ===')
  const torta = (): CambioDeElemento => ({ clave: el.claveNueva('producto'), base: 'nueva', despues: { tipo: 'producto', nombre: 'Torta', descripcion: '', precio: monto(30000), activo: true } })
  const dosTortas = await Promise.all([escribirEn(B, [torta()]), escribirEn(B, [torta()])])
  afirmar('E10: dos Torta nuevas a la vez: una se escribe y la otra no cabe', JSON.stringify(dosTortas.map((r) => r.tipo).sort()) === JSON.stringify(['escrito', 'invalida']), dosTortas)
  afirmar('E10: queda una sola Torta activa', (await leerAplicado(B)).vigentes('producto').filter((v) => v.elemento.nombre === 'Torta').length === 1)

  console.log('\n=== E11. Lo que escribir revisa de cada clave ===')
  const antesDeE11 = await filasDe(A)
  const sinFilas = await escribirEn(A, [{ clave: clave('dato:descripcion'), base: version(3), despues: { tipo: 'dato', campo: 'descripcion', valor: 'Café' } }])
  afirmar('E11: una base numérica sobre una clave sin filas es conflicto', sinFilas.tipo === 'conflicto' && sinFilas.claves[0].tocadaPor === null, sinFilas)
  const quitarMuerta = await escribirEn(A, [{ clave: clave('dato:descripcion'), base: 'nueva', despues: null }])
  afirmar('E11: quitar lo que no está vigente es invalida', quitarMuerta.tipo === 'invalida', quitarMuerta)
  const otraClave = await escribirEn(A, [{ clave: clave('dato:ciudad'), base: (await leerAplicado(A)).vigente(clave('dato:ciudad'))!.version, despues: { tipo: 'dato', campo: 'pagos', valor: 'Nequi' } }])
  const productoEnVoz = await escribirEn(A, [{ clave: clave('voz'), base: 'nueva', despues: { tipo: 'producto', nombre: 'Café', descripcion: '', precio: monto(1000), activo: true } }])
  afirmar('E11: un dato bajo la clave de otro campo y un producto bajo voz son invalida', otraClave.tipo === 'invalida' && productoEnVoz.tipo === 'invalida', { otraClave, productoEnVoz })
  afirmar('E11: nada de eso dejó filas', (await filasDe(A)) === antesDeE11)
  const crudo = el.claveNueva('producto')
  const conDefectos = await escribirEn(A, [{ clave: crudo, base: 'nueva', despues: { tipo: 'producto', nombre: 'Molido', precio: 20000 } as unknown as Elemento }])
  const [fila] = await db.select({ contenido: esquema.elementos.contenido }).from(esquema.elementos).where(and(eq(esquema.elementos.negocioId, A), eq(esquema.elementos.clave, crudo)))
  afirmar('E11: se guarda el Elemento parseado, con sus valores por defecto', conDefectos.tipo === 'escrito' && (fila?.contenido as { descripcion?: string })?.descripcion === '' && (fila?.contenido as { activo?: boolean })?.activo === true, fila)

  console.log('\n=== E12. Sección e Indicador son Elementos ===')
  const consulta = (sql: string, usa: string[], salida: ConsultaGuardada['salida'], catalogo = 1) =>
    ({ sql, enPalabras: 'pedidos confirmados por día de los últimos 30 días', supuestos: [], catalogo, usa, salida }) as unknown as ConsultaGuardada
  const indicador = (nombre: string, c = consulta('select dia_local::text as etiqueta, count(*) as valor from pedidos group by 1', ['pedidos.dia_local'], { tipo: 'serie', unidad: { tipo: 'cantidad', nombre: 'pedidos' } })): Elemento =>
    ({ tipo: 'indicador', nombre, queQuiereVer: 'pedidos por día', consulta: c }) as Elemento
  const seccion: Elemento = { tipo: 'seccion', nombre: 'Con novedad', queQuiereVer: 'pedidos con novedad', consulta: consulta("select numero from pedidos where estado = 'novedad'", ['pedidos.numero', 'pedidos.estado'], { tipo: 'filas', columnas: [{ columna: 'numero', titulo: 'Pedido' }] }) as never }
  const D = await negocioDesechable('D')
  const ki = el.claveNueva('indicador')
  const ks = el.claveNueva('seccion')
  const puestos = await escribirEn(D, [
    { clave: ki, base: 'nueva', despues: indicador('Confirmados por día') },
    { clave: ks, base: 'nueva', despues: seccion },
  ])
  const eD = await leerAplicado(D)
  afirmar('E12: una Sección y un Indicador se escriben y leerAplicado los devuelve iguales', puestos.tipo === 'escrito' && canonico(eD.vigente(ki)?.elemento) === canonico(indicador('Confirmados por día')) && canonico(eD.vigente(ks)?.elemento) === canonico(seccion), eD.todos())
  const repetido = await escribirEn(D, [{ clave: el.claveNueva('indicador'), base: 'nueva', despues: indicador('confirmados  por DÍA') }])
  afirmar('E12: dos con el mismo nombre en el Panel no caben', repetido.tipo === 'invalida' && repetido.problemas.some((p) => p.tipo === 'valor_invalido' && p.campo === 'nombre'), repetido)
  const rota = await escribirEn(D, [{ clave: el.claveNueva('indicador'), base: 'nueva', despues: indicador('Teléfonos', consulta('select count(*) as valor from clientes', ['clientes.telefono'], { tipo: 'numero', unidad: { tipo: 'cantidad', nombre: 'clientes' } })) }])
  afirmar('E12: un campo que no está en el catálogo es referencia_rota', rota.tipo === 'invalida' && rota.problemas.some((p) => p.tipo === 'referencia_rota' && p.clave === 'clientes.telefono'), rota)
  const deOtroCatalogo = await escribirEn(D, [{ clave: el.claveNueva('indicador'), base: 'nueva', despues: indicador('Viejo', consulta('select count(*) as valor from pedidos', [], { tipo: 'numero', unidad: { tipo: 'cantidad', nombre: 'pedidos' } }, 0)) }])
  afirmar('E12: una consulta de otro catálogo no cabe', deOtroCatalogo.tipo === 'invalida', deOtroCatalogo)
  const quitada = await escribirEn(D, [{ clave: ks, base: eD.vigente(ks)!.version, despues: null }])
  const vuelta = await escribirEn(D, [{ clave: ks, base: 'nueva', despues: seccion }])
  afirmar('E12: quitar la Sección la saca del estado y se puede volver a poner', quitada.tipo === 'escrito' && vuelta.tipo === 'escrito' && (await leerAplicado(D)).vigentes('seccion').length === 1, { quitada, vuelta })
  afirmar('E12: lo del Panel no lleva texto que llegue a un Cliente', el.definicionDe('seccion').textos(seccion).length === 0 && el.definicionDe('indicador').textos(indicador('x')).length === 0)
  afirmar(
    'E12: Sección e Indicador tienen alcance panel y con el Negocio atendiendo se aplican sin botón',
    el.DEFINICIONES.seccion.alcance === 'panel' && el.DEFINICIONES.indicador.alcance === 'panel' && politicaDeAprobacion('atendiendo', 'panel', 'hilo', false) === 'se_aplica',
  )
  const profundidad = niveles(z.toJSONSchema(ESQUEMA_DEL_PEDIDO, { io: 'input' }))
  afirmar('E12: el esquema de proponer sigue en 10 niveles o menos (Muse Spark rechaza más)', profundidad <= 10, profundidad)

  console.log('\n=== queFaltaParaAbrir ===')
  {
    const identidad = { id: marcar.negocio('00000000-0000-4000-8000-0000000000f1'), nombre: 'Café Trigo', rubro: 'café', codigo: 'FALTA', pais: 'CO', moneda: 'COP', zonaHoraria: 'America/Bogota', modo: 'armando' } as const
    const estadoCon = (...elementos: [string, Elemento][]) =>
      armarEstado(identidad, version(1), elementos.map(([c, e]) => ({ clave: clave(c), version: version(1), origen: { tipo: 'entrevista' as const }, elemento: e }) as never))
    const molido: Elemento = { tipo: 'producto', nombre: 'Molido 500 g', descripcion: '', precio: monto(32000), activo: true }
    const sinProductos = queFaltaParaAbrir(estadoCon(), null)
    afirmar('abrir: sin productos bloquea producto_con_precio, sin nada en la tarjeta', sinProductos.bloquea.some((f) => f.que === 'producto_con_precio' && !f.enLaTarjeta), sinProductos)
    const pendiente = { elementos: [{ clave: el.claveNueva('producto'), base: 'nueva' as const, despues: molido }], filas: [] }
    const conTarjeta = queFaltaParaAbrir(estadoCon(), pendiente)
    afirmar('abrir: un producto que espera en la tarjeta sigue bloqueando, con enLaTarjeta', conTarjeta.bloquea.some((f) => f.que === 'producto_con_precio' && f.enLaTarjeta), conTarjeta)
    const todoElPais = queFaltaParaAbrir(estadoCon(['producto:1', molido], ['dato:envios', { tipo: 'dato', campo: 'envios', valor: 'Enviamos a todo el país' }]), null)
    afirmar('abrir: «Enviamos a todo el país» avisa envios_sin_detalle y no bloquea', todoElPais.bloquea.length === 0 && todoElPais.avisa.some((f) => f.que === 'envios_sin_detalle'), todoElPais)
    const conDetalle = queFaltaParaAbrir(estadoCon(['producto:1', molido], ['dato:envios', { tipo: 'dato', campo: 'envios', valor: 'A todo el país, de 2 a 4 días hábiles; el envío cuesta $12.000' }]), null)
    afirmar('abrir: con costo y plazo los envíos no avisan; ciudad, pagos y horario solo avisan', conDetalle.bloquea.length === 0 && JSON.stringify(conDetalle.avisa.map((f) => f.que)) === JSON.stringify(['ciudad', 'pagos', 'horario']), conDetalle)
  }

  console.log('\n=== cotizar ===')
  const cafe = el.claveDeProducto.deId('00000000-0000-4000-8000-0000000000a1')
  const molino = el.claveDeProducto.deId('00000000-0000-4000-8000-0000000000a2')
  await escribirEn(B, [
    { clave: cafe, base: 'nueva', despues: { tipo: 'producto', nombre: 'Café 500 g', descripcion: '', precio: monto(38000), activo: true } },
    { clave: molino, base: 'nueva', despues: { tipo: 'producto', nombre: 'Molino', descripcion: '', precio: monto(119000), activo: false } },
  ])
  const eB = await leerAplicado(B)
  const c1 = cotizar({ items: [{ producto: cafe, cantidad: 1 }, { producto: cafe, cantidad: 1 }], ciudad: 'Pasto' }, eB)
  afirmar('cotizar: un producto repetido se suma y el total sale del precio', 'total' in c1 && c1.total === 76000 && c1.lineas.length === 1 && c1.lineas[0].cantidad === 2, c1)
  afirmar('cotizar: un producto que no se vende no cubre', 'noCubre' in cotizar({ items: [{ producto: molino, cantidad: 1 }], ciudad: 'Pasto' }, eB))
  afirmar('cotizar: una clave que no existe no cubre', 'noCubre' in cotizar({ items: [{ producto: clave('producto:nada'), cantidad: 1 }], ciudad: 'Pasto' }, eB))
  afirmar('claveDeProducto: ida y vuelta al id de pedidos.items', el.claveDeProducto.aId(cafe) === '00000000-0000-4000-8000-0000000000a1')

  console.log('\n=== Las líneas concuerdan con su etiqueta ===')
  {
    const vacio = armarEstado({ id: marcar.negocio('00000000-0000-4000-8000-0000000000f3'), nombre: 'X', rubro: 'x', codigo: 'X', pais: 'CO', moneda: 'COP', zonaHoraria: 'America/Bogota', modo: 'atendiendo' }, version(1), [])
    const regla: Elemento = { tipo: 'regla', nombre: 'Sin fechas', cuando: { tipo: 'siempre' }, efectos: [{ tipo: 'no_prometer', que: 'plazo' }], escenarios: { activan: [{ mensajeDelCliente: '¿Cuándo llega?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] } }
    const lineas = [el.describirCambio(null, regla, vacio), el.describirCambio(null, { tipo: 'dato', campo: 'ciudad', valor: 'Manizales' }, vacio), el.describirCambio(null, { tipo: 'dato', campo: 'envios', valor: 'A todo el país' }, vacio)]
    afirmar('«Regla nueva», «Ciudad nueva» y «Envíos nuevos»', lineas[0].startsWith('Regla nueva:') && lineas[1].startsWith('Ciudad nueva:') && lineas[2].startsWith('Envíos nuevos:'), lineas)
  }

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
  const delSrc = (rutas: string[]) => rutas.filter((r) => r.startsWith('src/')).sort()
  const bajanElBit = delSrc(con(/\.update\(esquema\.elementos\)/))
  afirmar('E8: el bit solo lo baja estado/escribir', JSON.stringify(bajanElBit) === JSON.stringify(['src/nucleo/estado/escribir.ts']), bajanElBit)
  const dicenElBit = delSrc(con(/\bsinPublicar: (?!ultimas\.|boolean\(|pendiente\.)/))
  afirmar('E8: el bit de una fila solo lo dice estado/escribir', JSON.stringify(dicenElBit) === JSON.stringify(['src/nucleo/estado/escribir.ts']), dicenElBit)
  const nombranElBit = delSrc(con(/\.sinPublicar\b|sin_publicar/))
  afirmar('E8: fuera de estado/ nadie lee el bit', nombranElBit.every((r) => r.startsWith('src/nucleo/estado/') || r === 'src/db/esquema.ts'), nombranElBit)
  const escribenViejas = delSrc(con(/\{ tipo: 'tablas_viejas' \}/))
  afirmar('E8: tablas_viejas como origen solo en scripts/', escribenViejas.length === 0, escribenViejas)
  const ladoCliente = con(/\bleerAplicado\b/).filter((r) => r.startsWith('src/nucleo/clientes/') || r === 'src/agentes/avisos.ts')
  afirmar('E8: leerAplicado no aparece en el lado Cliente', ladoCliente.length === 0, ladoCliente)
  const leenPublicado = con(/\bleerPublicado\(/).filter((r) => r.startsWith('src/nucleo/clientes/') || r === 'src/agentes/avisos.ts').sort()
  afirmar('E8: el lado Cliente lee lo publicado', JSON.stringify(leenPublicado) === JSON.stringify(['src/agentes/avisos.ts', 'src/nucleo/clientes/atender.ts']), leenPublicado)
  const leenViejo = con(/db\/viejo['"]/)
  afirmar('E8: las tablas viejas solo las importan a-elementos y su prueba', JSON.stringify(leenViejo.sort()) === JSON.stringify(['scripts/a-elementos.mts', 'scripts/probar-migracion.mts']), leenViejo)
  const parsean = con(/from ['"]libpg-query['"]/)
  afirmar('E8: libpg-query solo lo importa src/nucleo/consultas/validar.ts', JSON.stringify(parsean) === JSON.stringify(['src/nucleo/consultas/validar.ts']), parsean)
  const quickjs = con(/quickjs-emscripten/).filter((r) => r !== 'scripts/probar-elementos.mts')
  afirmar('E8: nadie importa quickjs-emscripten', quickjs.length === 0, quickjs)
  const piezasViejas = ['src/nucleo/cambios/puente.ts', 'src/negocio/cambios.ts', 'src/agentes/generador.ts', 'src/negocio/datos.ts', 'src/lib/aislado.ts']
  afirmar('E8: el puente, las piezas en JS y el intérprete aislado ya no existen', piezasViejas.every((b) => !fuentes.some((f) => f.ruta === b)))
  const conocimiento = con(/\.conocimientoSinLector\b|\bconocimientoSinLector: jsonb/).filter((r) => r !== 'scripts/probar-elementos.mts')
  afirmar('E8: negocios.conocimiento solo lo nombran esquema.ts y a-elementos', JSON.stringify(conocimiento.sort()) === JSON.stringify(['scripts/a-elementos.mts', 'src/db/esquema.ts']), conocimiento)
  const borrados = ['src/agentes/clientes.ts', 'src/agentes/contratos.ts', 'src/negocio/dueno-catalogo.ts']
  afirmar('E8: agentes/clientes, agentes/contratos y negocio/dueno-catalogo ya no existen', borrados.every((b) => !fuentes.some((f) => f.ruta === b)))
} catch (e) {
  afirmar('probar-elementos terminó sin error inesperado', false, e)
} finally {
  if (creados.length) {
    await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
    afirmar('limpieza: no quedan Elementos de los Negocios desechables', (await db.$count(esquema.elementos, inArray(esquema.elementos.negocioId, creados))) === 0)
  }
  terminar()
}
