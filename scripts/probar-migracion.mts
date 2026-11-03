/**
 * `a-elementos` contra la base real, sin modelo y sin las tablas viejas: lo que dicen se arma a mano y pasa por
 * `pasarAElementos`. También el orden de despliegue: un Negocio abierto sin Elementos no atiende. Crea Negocios
 * desechables y los borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-migracion.mts
 */
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { afirmar, capturarEnvios, capturarErrores, eventoDeKapso, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { leerEstado, ultimasDe, valorDelDato } = await import('../src/nucleo/estado')
const { escribir } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')
const { leerMensajeEntrante } = await import('../src/nucleo/entrada')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { elementosDeLasTablasViejas, pasarAElementos, migrarReglasViejas, piezasActivas } = await import('./a-elementos.mjs')

type Conocimiento = import('./a-elementos.mjs').Conocimiento
type Elemento = import('../src/nucleo/estado/elementos').Elemento
type NegocioId = import('../src/nucleo/identidad').NegocioId

const marca = String(Date.now()).slice(-7)
const creados: string[] = []

async function negocioDesechable(letra: string, estado: 'armando' | 'listo' = 'listo'): Promise<NegocioId> {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Prueba de migración ${letra}`, codigo: `PMG${marca}${letra}`, estado }).returning({ id: esquema.negocios.id })
  creados.push(n.id)
  return marcar.negocio(n.id)
}

const CONOCIMIENTO: Conocimiento = {
  descripcion: 'Café de Manizales',
  ciudad: 'Manizales',
  horario: 'De lunes a sábado',
  envios: 'A todo el país',
  pagos: 'Contra entrega',
  tono: 'Cercano, tuteamos',
  preguntas: [
    { pregunta: '¿Tienen descafeinado?', respuesta: 'No por ahora.' },
    { pregunta: '¿Venden por mayor?', respuesta: 'Sí, desde 10 bolsas.' },
  ],
}
const PRODUCTOS = [{ id: '00000000-0000-4000-8000-0000000000f1', nombre: 'Café 500 g', descripcion: 'Tueste medio', precio: 38000, activo: true }]

try {
  console.log('\n=== Lo que dicen las tablas viejas, sin base ===')
  const crudo = elementosDeLasTablasViejas(
    { descripcion: null, ciudad: 'Pasto', preguntas: [{ pregunta: '¿Envían?', respuesta: null }, null] } as never,
    [
      { id: '00000000-0000-4000-8000-0000000000f2', nombre: 'Gratis', descripcion: null, precio: 0, activo: true },
      { id: '00000000-0000-4000-8000-0000000000f3', nombre: 'Té verde', descripcion: 'Este té cura la gastritis', precio: 20000, activo: true },
    ],
  )
  afirmar('campos null y una pregunta sin respuesta no lanzan: queda solo la ciudad', JSON.stringify(crudo.deseados.map((d) => d.clave)) === JSON.stringify(['dato:ciudad']), crudo)
  afirmar('un precio de 0 y una descripción que no puede llegar a un Cliente se saltan y se reportan', crudo.saltados.length === 2 && crudo.saltados.some((s) => s.includes('Gratis')) && crudo.saltados.some((s) => s.includes('afirmacion_de_salud')), crudo.saltados)
  const largo = elementosDeLasTablasViejas({ tono: 'a'.repeat(el.LARGO_DEL_ESTILO + 50) } as never, []).deseados[0]?.elemento
  afirmar('un tono largo se corta al largo del estilo', largo?.tipo === 'voz' && largo.estilo.length === el.LARGO_DEL_ESTILO, largo)
  const tratos = ['Trátalos de usted', 'Cercano, nunca de usted', 'Tuteamos, sin usted', 'Hablamos de usted, no tuteamos'].map((t) => el.tratoDelTono(t))
  afirmar('el trato es usted solo si el tono lo pide sin negarlo', JSON.stringify(tratos) === JSON.stringify(['usted', 'tu', 'tu', 'usted']), tratos)

  console.log('\n=== pasarAElementos: idempotente, en seco, respeta y reconcilia ===')
  const N = await negocioDesechable('A')
  const deseados = elementosDeLasTablasViejas(CONOCIMIENTO, PRODUCTOS).deseados
  const primera = await pasarAElementos(N, deseados)
  const segunda = await pasarAElementos(N, deseados)
  afirmar('primera corrida: escribe todo en una versión', primera.escritas.length === deseados.length && primera.version === 1, primera)
  afirmar('segunda corrida: escribe 0 y no sube la versión', segunda.escritas.length === 0 && segunda.quitadas.length === 0 && segunda.version === 1 && (await leerEstado(N)).version === 1, segunda)

  const otraCiudad = deseados.map((d) => (d.clave === 'dato:ciudad' ? { ...d, elemento: { tipo: 'dato' as const, campo: 'ciudad' as const, valor: 'Pereira' } } : d))
  const enSeco = await pasarAElementos(N, otraCiudad, { enSeco: true })
  afirmar('en seco: dice lo que escribiría y no escribe', enSeco.escritas.length === 1 && valorDelDato(await leerEstado(N), 'ciudad') === 'Manizales' && (await leerEstado(N)).version === 1, enSeco)

  const [propuesta] = await db
    .insert(esquema.propuestas)
    .values({ negocioId: N, palabrasDelDueno: 'cambia los pagos', huella: 'f'.repeat(64), vence: new Date(Date.now() + 3600_000), vistaPrevia: { lineas: [] }, estado: 'aplicada' })
    .returning({ id: esquema.propuestas.id })
  const pagos = el.comoClave('dato:pagos')
  await conTransaccion((tx) =>
    escribir(tx, N, { tipo: 'propuesta', propuesta: marcar.propuesta(propuesta.id) }, { elementos: [{ clave: pagos, base: el.comoVersion(1), despues: { tipo: 'dato', campo: 'pagos', valor: 'Nequi' } }], filas: [] }),
  )
  const sinUnaPregunta = deseados.filter((d) => !(d.elemento.tipo === 'pregunta' && d.elemento.pregunta === '¿Venden por mayor?'))
  const borrada = deseados.find((d) => d.elemento.tipo === 'pregunta' && d.elemento.pregunta === '¿Venden por mayor?')!.clave
  const tercera = await pasarAElementos(N, sinUnaPregunta)
  const tras = await leerEstado(N)
  afirmar('no pisa una clave escrita por una propuesta', tercera.respetadas.includes(pagos) && valorDelDato(tras, 'pagos') === 'Nequi', tercera)
  afirmar('una pregunta que ya no está en la tabla vieja se quita', tercera.quitadas.length === 1 && tercera.quitadas[0] === borrada && tras.vigente(borrada) === null && tercera.escritas.length === 0, tercera)
  const cuarta = await pasarAElementos(N, sinUnaPregunta)
  afirmar('después de quitar, otra corrida escribe 0', cuarta.escritas.length === 0 && cuarta.quitadas.length === 0 && cuarta.version === tercera.version, cuarta)
  await db.delete(esquema.propuestas).where(eq(esquema.propuestas.id, propuesta.id))
  const huerfana = (await leerEstado(N)).vigente(pagos)
  afirmar('una propuesta borrada deja el origen sin id, no un id vacío', huerfana?.origen.tipo === 'propuesta' && huerfana.origen.propuesta === null, huerfana?.origen)

  console.log('\n=== Reglas viejas: Capacidad faltante y una línea en el Hilo de cada Dueño ===')
  const [ana] = await db.insert(esquema.duenos).values({ negocioId: N, usuarioId: `prueba-migracion-${marca}`, nombre: 'Ana' }).returning({ id: esquema.duenos.id })
  const reglas = ['Nunca prometas fechas', 'Si piden factura, pásamelo']
  const hiloDeAna = () => db.select({ mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, ana.id))
  const faltantes = () => db.$count(esquema.capacidadesFaltantes, and(eq(esquema.capacidadesFaltantes.negocioId, N), eq(esquema.capacidadesFaltantes.motivo, 'regla_vieja')))
  const r1 = await migrarReglasViejas(N, reglas)
  const hilo = await hiloDeAna()
  afirmar('reglas viejas: dos Capacidades faltantes y una línea en el Hilo de Ana que las nombra', r1.anotadas === 2 && (await faltantes()) === 2 && hilo.length === 1 && reglas.every((t) => JSON.stringify(hilo[0].mensaje).includes(t)), { r1, hilo })
  const r2 = await migrarReglasViejas(N, reglas)
  afirmar('reglas viejas: la segunda corrida no anota ni escribe en el Hilo', r2.anotadas === 0 && (await faltantes()) === 2 && (await hiloDeAna()).length === 1, r2)

  console.log('\n=== Orden de despliegue: abierto y sin Elementos no atiende ===')
  const V = await negocioDesechable('B')
  const telefono = `5730${marca}9`
  const desde = envios.length
  const erroresAntes = errores.length
  await atenderMensaje(leerMensajeEntrante(eventoDeKapso({ wamid: `wamid.MIGRACION.${marca}`, telefono, texto: 'Hola, ¿qué venden?' }))!, V)
  const suyos = envios.slice(desde).filter((e) => e.telefono === telefono)
  const delError = errores.slice(erroresAntes).map((e) => e.join(' '))
  afirmar('versión 0: sale el aviso de falla técnica y nada más', suyos.length === 1 && suyos[0].texto.includes('problema técnico'), suyos)
  afirmar('versión 0: el error nombra el Negocio, sin texto del Cliente', delError.some((e) => e.includes(V) && e.includes('a-elementos')) && !delError.some((e) => e.includes('qué venden')), delError)
  afirmar('versión 0: no guardó Cliente ni mensaje', (await db.$count(esquema.clientes, eq(esquema.clientes.negocioId, V))) === 0)
  errores.splice(erroresAntes)

  console.log('\n=== quitar-panel: la lápida antes de un rollback ===')
  const conPanel = await negocioDesechable('Q')
  const consulta = { sql: 'select count(*) as valor from pedidos', enPalabras: 'x', supuestos: [], catalogo: 1, usa: [], salida: { tipo: 'numero', unidad: { tipo: 'cantidad', nombre: 'pedidos' } } }
  const indicador = el.claveNueva('indicador')
  const seccion = el.claveNueva('seccion')
  const ciudad = el.comoClave('dato:ciudad')
  const delPanelVivo = [
    { clave: indicador, base: 'nueva' as const, despues: { tipo: 'indicador', nombre: `Pedidos ${marca}`, queQuiereVer: 'x', consulta } as unknown as Elemento },
    { clave: seccion, base: 'nueva' as const, despues: { tipo: 'seccion', nombre: `Lista ${marca}`, queQuiereVer: 'x', consulta: { ...consulta, salida: { tipo: 'filas', columnas: [{ columna: 'valor', titulo: 'Valor' }] } } } as unknown as Elemento },
    { clave: ciudad, base: 'nueva' as const, despues: { tipo: 'dato', campo: 'ciudad', valor: 'Pasto' } as Elemento },
  ]
  await conTransaccion((tx) => escribir(tx, conPanel, { tipo: 'entrevista' }, { elementos: delPanelVivo, filas: [] }))
  const quitar = (...argumentos: string[]) => spawnSync('tsx', ['scripts/quitar-panel.mts', `--negocio=${conPanel}`, ...argumentos], { encoding: 'utf8' })
  const versionAntes = (await leerEstado(conPanel)).version
  const enSecoPanel = quitar()
  const trasElSeco = await leerEstado(conPanel)
  afirmar('quitar-panel en seco: nombra las dos claves y no escribe', enSecoPanel.status === 0 && enSecoPanel.stdout.includes(indicador) && enSecoPanel.stdout.includes(seccion) && !enSecoPanel.stdout.includes('dato:') && trasElSeco.version === versionAntes && trasElSeco.vigente(indicador) !== null && trasElSeco.vigente(seccion) !== null, { status: enSecoPanel.status, stdout: enSecoPanel.stdout.slice(0, 300), stderr: enSecoPanel.stderr.slice(0, 300) })
  const deVerdad = quitar('--de-verdad')
  const trasLaLapida = await leerEstado(conPanel)
  const ultimasDelPanel = await ultimasDe(db, conPanel)
  const lapidas = ultimasDelPanel.filter((u) => u.clave === indicador || u.clave === seccion)
  afirmar('quitar-panel --de-verdad: la última fila de cada clave tiene contenido null y la versión siguiente', deVerdad.status === 0 && lapidas.length === 2 && lapidas.every((u) => u.contenido === null && u.version === versionAntes + 1), { status: deVerdad.status, stderr: deVerdad.stderr.slice(0, 300), lapidas })
  afirmar('quitar-panel --de-verdad: el estado ya no las ve, y lo demás sigue', trasLaLapida.version === versionAntes + 1 && trasLaLapida.vigente(indicador) === null && trasLaLapida.vigente(seccion) === null && valorDelDato(trasLaLapida, 'ciudad') === 'Pasto', trasLaLapida.version)
  const otraVez = quitar('--de-verdad')
  afirmar('quitar-panel otra vez: escribe 0 y no sube la versión', otraVez.status === 0 && otraVez.stdout.includes('Resumen: 0 claves') && (await leerEstado(conPanel)).version === versionAntes + 1, otraVez.stdout.slice(0, 200))

  console.log('\n=== Una pieza activa detiene a-elementos ===')
  const conPieza = await negocioDesechable('P')
  const viejo = await import('../src/db/viejo')
  await db.insert(viejo.piezas).values({ negocioId: conPieza, tipo: 'indicador', clave: '00000000-0000-4000-8000-0000000000f9', nombre: `Pieza vieja ${marca}`, codigo: 'function calcular(){ return { valor: 1 } }' })
  const activas = await piezasActivas()
  const corrida = spawnSync('tsx', ['scripts/a-elementos.mts', '--en-seco'], { encoding: 'utf8' })
  afirmar('pieza activa: a-elementos --en-seco la nombra y sale con 1 sin correr nada', activas.some((p) => p.nombre === `Pieza vieja ${marca}`) && corrida.status === 1 && corrida.stderr.includes(`Pieza vieja ${marca}`) && !corrida.stdout.includes('Resumen:'), { status: corrida.status, stderr: corrida.stderr.slice(0, 300) })
  await db.delete(viejo.piezas).where(eq(viejo.piezas.negocioId, conPieza))
} catch (e) {
  afirmar('probar-migracion terminó sin error inesperado', false, e)
} finally {
  if (creados.length) {
    await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
    afirmar('limpieza: no quedan Elementos de los Negocios desechables', (await db.$count(esquema.elementos, inArray(esquema.elementos.negocioId, creados))) === 0)
  }
  afirmar('probar-migracion no registró errores', errores.length === 0, errores)
  terminar()
}
