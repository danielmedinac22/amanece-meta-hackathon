/**
 * ¿Cambia algo en el Negocio B cuando se aplica un Cambio en el Negocio A? Se responde consultando:
 * huella (conteo y md5) de todas las filas de B por tabla, antes y después; el prompt que de verdad
 * recibe el modelo del Agente de clientes de B, antes y después; lo que ve el Agente del dueño de B;
 * y lo que pasa si B intenta aplicar o revertir un Cambio de A.
 *
 *   tsx scripts/medir/aislamiento.mts [salida.json]
 */
import { capturarCuerposDelModelo, eventos, quietud } from './entorno.mts'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const { db, esquema } = await import('../../src/db')
const { eq, sql } = await import('drizzle-orm')
const cambios = await import('../../src/negocio/cambios')
const { responderComoAgenteDeClientes } = await import('../../src/agentes/clientes')
const { crearAgenteDelDueno } = await import('../../src/agentes/dueno')
const { datosDelNegocio } = await import('../../src/negocio/datos')

const SALIDA = process.argv[2] ?? 'scripts/medir/resultados/aislamiento.json'
const md5 = (s: string) => createHash('md5').update(s).digest('hex').slice(0, 12)
const titulo = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
const salida: Record<string, unknown> = {}

const [A] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
const [B] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
console.log(`A = ${A.nombre} (${A.id})\nB = ${B.nombre} (${B.id})`)

const TABLAS: [string, string][] = [
  ['negocios', 'id'],
  ['duenos', 'negocio_id'],
  ['productos', 'negocio_id'],
  ['clientes', 'negocio_id'],
  ['mensajes_cliente', 'negocio_id'],
  ['pedidos', 'negocio_id'],
  ['casos', 'negocio_id'],
  ['cambios', 'negocio_id'],
  ['reglas', 'negocio_id'],
  ['piezas', 'negocio_id'],
  ['mensajes_dueno', 'negocio_id'],
  ['capacidades_faltantes', 'negocio_id'],
  ['turnos', 'negocio_id'],
  ['sesiones_whatsapp', 'negocio_id'],
]

/** Conteo y md5 de todas las filas de un Negocio, tabla por tabla. */
async function huella(negocioId: string) {
  const out: Record<string, { n: number; md5: string }> = {}
  for (const [tabla, columna] of TABLAS) {
    const r = await db.execute(sql.raw(`select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from ${tabla} t where ${columna} = '${negocioId}'`))
    const fila = r.rows[0] as { n: number; h: string }
    out[tabla] = { n: fila.n, md5: fila.h.slice(0, 12) }
  }
  return out
}
const tablaDeHuellas = (antes: Record<string, { n: number; md5: string }>, despues: Record<string, { n: number; md5: string }>) =>
  Object.keys(antes).map((t) => ({ tabla: t, antes: `${antes[t].n} filas ${antes[t].md5}`, despues: `${despues[t].n} filas ${despues[t].md5}`, igual: antes[t].md5 === despues[t].md5 && antes[t].n === despues[t].n }))

/** El prompt de sistema que recibió el modelo del Agente de clientes, tomado de la petición HTTP, sin la línea del reloj. */
async function promptDelAgenteDeClientes(negocioId: string, pregunta: string) {
  capturarCuerposDelModelo(true)
  const desde = eventos.length
  const r = await responderComoAgenteDeClientes({ negocioId, clienteId: null, historial: [], texto: pregunta, modo: 'simulacion' })
  await quietud()
  capturarCuerposDelModelo(false)
  const peticion = eventos.slice(desde).find((e) => e.rol === 'clientes' && e.cuerpo)!.cuerpo as { messages: { role: string; content: string }[] }
  const sistema = peticion.messages.find((m) => m.role === 'system')!.content
  const sinReloj = sistema
    .split('\n')
    .filter((l) => !l.startsWith('Fecha y hora en Colombia:'))
    .join('\n')
  return { sistema: sinReloj, md5: md5(sinReloj), lineas: sinReloj.split('\n').length, respuesta: r.texto, herramientas: r.herramientas }
}

const diffDeLineas = (antes: string, despues: string) => {
  const a = antes.split('\n')
  const d = despues.split('\n')
  return { quitadas: a.filter((l) => !d.includes(l)), agregadas: d.filter((l) => !a.includes(l)) }
}

const verNegocio = async (negocio: typeof A) => {
  const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.negocioId, negocio.id)).limit(1)
  const duenoFalso = dueno ?? ({ id: 'sin-dueno', negocioId: negocio.id, usuarioId: 'x', nombre: '', email: '', creado: new Date() } as never)
  const { tools } = crearAgenteDelDueno({ negocio: (await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocio.id)))[0], dueno: duenoFalso })
  const run = async (n: string) => (tools[n] as unknown as { execute: (i: unknown, o: unknown) => Promise<any> }).execute({}, { toolCallId: 'x', messages: [] })
  return { ver: await run('ver_negocio'), cambios: await run('listar_cambios') }
}

const PREGUNTA = '¿Me pueden enviar a Cali y cuánto demora?'

// --- 1. B antes -------------------------------------------------------------------------------------------
titulo('1. Negocio B (Trigo y Leña) ANTES de que A haga ningún Cambio')
const bHuellaAntes = await huella(B.id)
const aHuellaAntes = await huella(A.id)
const bDatosAntes = await datosDelNegocio(B.id)
const bDatosMd5Antes = md5(JSON.stringify({ ...bDatosAntes, hoy: '' }))
const bPromptAntes = await promptDelAgenteDeClientes(B.id, PREGUNTA)
const aPromptAntes = await promptDelAgenteDeClientes(A.id, PREGUNTA)
const bVerAntes = await verNegocio(B)
console.log('Huella de B por tabla:', JSON.stringify(bHuellaAntes))
console.log(`datosDelNegocio(B) md5 ${bDatosMd5Antes}; prompt del Agente de clientes de B md5 ${bPromptAntes.md5} (${bPromptAntes.lineas} líneas); de A md5 ${aPromptAntes.md5}`)
console.log(`Pregunta "${PREGUNTA}" -> A: herramientas [${aPromptAntes.herramientas}]; B: herramientas [${bPromptAntes.herramientas}]`)
console.log(`A dice: ${aPromptAntes.respuesta.slice(0, 200)}\nB dice: ${bPromptAntes.respuesta.slice(0, 200)}`)

// --- 2. Cambios en A --------------------------------------------------------------------------------------
titulo('2. Cambios en A: una regla, un Indicador, una Sección y un cambio de conocimiento (propuestos y aplicados)')
const [dueno] = await db.insert(esquema.duenos).values({ negocioId: A.id, usuarioId: `medir-aislamiento-${Date.now()}`, nombre: 'Dueño de A (medición)' }).returning()
const TEXTO_REGLA = 'Si un Cliente pregunta por envíos fuera de Manizales, no prometas fecha de entrega y abre un Caso para que el Dueño responda.'
const regla = await cambios.proponerRegla(A.id, dueno.id, 'Si preguntan por envíos fuera de la ciudad, no prometas fecha y abre un Caso', TEXTO_REGLA, '¿Cuánto demora un envío a Cali? ¿Me llega para el viernes?')
const indicador = await cambios.proponerPieza(A.id, dueno.id, 'Quiero ver los pedidos confirmados por día', 'indicador', 'Pedidos confirmados por día')
const seccion = await cambios.proponerPieza(A.id, dueno.id, 'Quiero ver una lista de los pedidos con novedad', 'seccion', 'Pedidos con novedad')
const conocimiento = await cambios.proponerConocimiento(A.id, dueno.id, 'Abrimos los domingos y vendemos un café nuevo', { horario: 'Lunes a domingo de 7 a 7' }, { agregar: [{ nombre: 'Café de aislamiento 250 g', precio: 23000 }] })
const propuestos = [regla, indicador, seccion, conocimiento]
console.log(propuestos.map((c) => `${c.tipo}: ${c.estado}`).join(' | '))
for (const c of propuestos) if (c.estado === 'propuesto') await cambios.aplicarCambio(A.id, c.id)
console.log('Reglas activas de A:', (await cambios.reglasActivas(A.id)).map((r) => r.texto.slice(0, 70)))
const panelA = await cambios.piezasActivas(A.id)
console.log('Panel de A:', panelA.map((p) => `${p.pieza.tipo} "${p.pieza.nombre}" ${p.resultado.ok ? `ok ${p.resultado.ms} ms` : p.resultado.error}`))

// --- 3. B después -----------------------------------------------------------------------------------------
titulo('3. Negocio B DESPUÉS')
const bHuellaDespues = await huella(B.id)
const aHuellaDespues = await huella(A.id)
const bDatosMd5Despues = md5(JSON.stringify({ ...(await datosDelNegocio(B.id)), hoy: '' }))
const bPromptDespues = await promptDelAgenteDeClientes(B.id, PREGUNTA)
const aPromptDespues = await promptDelAgenteDeClientes(A.id, PREGUNTA)
const bVerDespues = await verNegocio(B)
const aVerDespues = await verNegocio(A)
const reglasB = await cambios.reglasActivas(B.id)
const panelB = await cambios.piezasActivas(B.id)

console.log('\nHuellas de B (conteo y md5 de sus filas) por tabla:')
console.table(tablaDeHuellas(bHuellaAntes, bHuellaDespues))
console.log('Huellas de A, para ver que la huella SÍ detecta cambios:')
console.table(tablaDeHuellas(aHuellaAntes, aHuellaDespues))
console.log(`datosDelNegocio(B): md5 antes ${bDatosMd5Antes}, después ${bDatosMd5Despues}, igual: ${bDatosMd5Antes === bDatosMd5Despues}`)
console.log(`Prompt del Agente de clientes de B: md5 antes ${bPromptAntes.md5}, después ${bPromptDespues.md5}, igual: ${bPromptAntes.md5 === bPromptDespues.md5}`)
console.log('Diff del prompt de B:', JSON.stringify(diffDeLineas(bPromptAntes.sistema, bPromptDespues.sistema)))
const dA = diffDeLineas(aPromptAntes.sistema, aPromptDespues.sistema)
console.log('Diff del prompt de A (debe cambiar):', JSON.stringify({ quitadas: dA.quitadas.map((l) => l.slice(0, 110)), agregadas: dA.agregadas.map((l) => l.slice(0, 110)) }))
console.log(`¿El texto de la regla de A aparece en el prompt de B? ${bPromptDespues.sistema.includes(TEXTO_REGLA)}; en el de A: ${aPromptDespues.sistema.includes(TEXTO_REGLA)}`)
console.log(`¿"Café de aislamiento" aparece en el prompt de B? ${bPromptDespues.sistema.includes('Café de aislamiento')}; en el de A: ${aPromptDespues.sistema.includes('Café de aislamiento')}`)
console.log(`reglasActivas(B): ${reglasB.length}; piezasActivas(B) (lo que pinta el Panel de B): ${panelB.length}; piezasActivas(A): ${panelA.length}`)
console.log(`Agente del dueño de B, ver_negocio: reglas ${bVerDespues.ver.reglas.length}, piezas ${bVerDespues.ver.piezas.length}, productos ${bVerDespues.ver.productos.length}, horario "${bVerDespues.ver.conocimiento.horario.slice(0, 40)}"; igual que antes: ${md5(JSON.stringify(bVerAntes.ver)) === md5(JSON.stringify(bVerDespues.ver))}`)
console.log(`Agente del dueño de B, listar_cambios: ${JSON.stringify(bVerDespues.cambios)}`)
console.log(`Agente del dueño de A, ver_negocio: reglas ${aVerDespues.ver.reglas.length}, piezas ${aVerDespues.ver.piezas.length}, horario "${aVerDespues.ver.conocimiento.horario}"`)
console.log(`Pregunta "${PREGUNTA}" -> A (con la regla): herramientas [${aPromptDespues.herramientas}]; B: herramientas [${bPromptDespues.herramientas}]`)
console.log(`A dice: ${aPromptDespues.respuesta.slice(0, 220)}\nB dice: ${bPromptDespues.respuesta.slice(0, 220)}`)

// --- 4. B intenta tocar los Cambios de A ------------------------------------------------------------------
titulo('4. Desde B se intenta ver, aplicar o revertir Cambios de A')
const intentos: Record<string, string> = {}
const nuevoEnA = await cambios.proponerConocimiento(A.id, dueno.id, 'prueba de aislamiento', { tono: 'tono de prueba' })
intentos['obtenerCambio(B, cambio propuesto de A)'] = String(await cambios.obtenerCambio(B.id, nuevoEnA.id))
intentos['aplicarCambio(B, cambio propuesto de A)'] = await cambios.aplicarCambio(B.id, nuevoEnA.id).then(() => 'SE APLICÓ (mal)', (e: Error) => `rechazado: ${e.message}`)
intentos['revertirCambio(B, cambio aplicado de A)'] = await cambios.revertirCambio(B.id, regla.id).then(() => 'SE REVIRTIÓ (mal)', (e: Error) => `rechazado: ${e.message}`)
intentos['listarCambios(B)'] = String((await cambios.listarCambios(B.id)).length)
const [sigue] = await db.select({ estado: esquema.cambios.estado }).from(esquema.cambios).where(eq(esquema.cambios.id, nuevoEnA.id))
intentos['estado del cambio de A tras el intento'] = sigue.estado
const [reglaSigue] = await db.select({ estado: esquema.cambios.estado }).from(esquema.cambios).where(eq(esquema.cambios.id, regla.id))
intentos['estado de la regla de A tras el intento de revertir'] = reglaSigue.estado
console.log(JSON.stringify(intentos, null, 1))
const bHuellaFinal = await huella(B.id)

// --- limpieza: se deshace lo de A -------------------------------------------------------------------------
for (const c of [nuevoEnA, ...propuestos]) {
  const [fila] = await db.select().from(esquema.cambios).where(eq(esquema.cambios.id, c.id))
  if (fila.estado === 'aplicado') await cambios.revertirCambio(A.id, c.id).catch((e: Error) => console.warn('no pude revertir', e.message))
}

salida.huellaB = tablaDeHuellas(bHuellaAntes, bHuellaDespues)
salida.huellaBTrasLosIntentos = tablaDeHuellas(bHuellaAntes, bHuellaFinal)
salida.huellaA = tablaDeHuellas(aHuellaAntes, aHuellaDespues)
salida.datosBIguales = bDatosMd5Antes === bDatosMd5Despues
salida.promptB = { antes: bPromptAntes.md5, despues: bPromptDespues.md5, igual: bPromptAntes.md5 === bPromptDespues.md5, diff: diffDeLineas(bPromptAntes.sistema, bPromptDespues.sistema) }
salida.promptA = { antes: aPromptAntes.md5, despues: aPromptDespues.md5, diff: dA }
salida.reglasB = reglasB.length
salida.panelB = panelB.length
salida.panelA = panelA.map((p) => ({ nombre: p.pieza.nombre, tipo: p.pieza.tipo, ok: p.resultado.ok, ms: p.resultado.ms }))
salida.respuestas = { pregunta: PREGUNTA, aAntes: aPromptAntes, bAntes: { ...bPromptAntes, sistema: undefined }, aDespues: { ...aPromptDespues, sistema: undefined }, bDespues: { ...bPromptDespues, sistema: undefined } }
;(salida.respuestas as any).aAntes.sistema = undefined
salida.intentosDesdeB = intentos
writeFileSync(SALIDA, JSON.stringify(salida, null, 1))
console.log(`\nListo: ${SALIDA}`)
process.exit(0)
