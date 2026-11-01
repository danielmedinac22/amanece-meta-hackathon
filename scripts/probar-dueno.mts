/**
 * Prueba el lado del Dueño contra la base real y el modelo real, sin mandar nada por WhatsApp:
 * Cambios (indicador, sección, regla, datos y productos), aislamiento, aviso de un Caso y conversaciones
 * con el Agente del dueño. Usa el Negocio sembrado Café Ladera.
 * Todo lo que crea lo borra al final, también si falla. Cada caso se afirma contra lo que quedó en la base o
 * lo que se habría enviado, nunca contra el texto del modelo, y el script sale con 1 si alguno falla.
 *
 *   pnpm tsx scripts/probar-dueno.mts [cambios] [aislamiento] [casos] [agente]
 *
 * Sin argumentos corre todo.
 */
import { randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import { convertToModelMessages } from 'ai'
import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
// La respuesta a un Caso sale por `despachar`: con esto solo escribe en el log.
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()

const { db, esquema } = await import('../src/db')
const { altaDeDueno } = await import('../src/negocio/alta')
const { guardarEnElHilo, leerHilo, mensajeDelDuenoEnTexto } = await import('../src/negocio/dueno-hilo')
const { mensajeDelDueno, responderEnElHilo, tarjetasDe } = await import('../src/negocio/dueno-chat')
const { crearAgenteDelDueno, parteDeDatosParaElModelo } = await import('../src/agentes/dueno')
const { aprobar, proponer, guardarEnElAlta, abrirEnElAlta } = await import('../src/nucleo/cambios')
const { marcar } = await import('../src/nucleo/identidad')
const { leerEstado, valorDelDato } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Ctx = import('../src/nucleo/identidad').ContextoDelDueno
const { pintarPanel } = await import('../src/nucleo/panel')
const { VENTANA_POR_DEFECTO } = await import('../src/nucleo/consultas/catalogo')
const { conTransaccion } = await import('../src/db/pool')
const { escribir } = await import('../src/nucleo/estado/escribir')
type SalidaDelRedactor = import('../src/nucleo/cambios').SalidaDelRedactor
type MotorDelRedactor = import('../src/nucleo/cambios').MotorDelRedactor
const { traerCasoAlDueno } = await import('../src/agentes/avisos')

const inicioDeLaPrueba = new Date()
/** El `ContextoDelDueno` que acuña la sesión, para un Dueño de prueba. */
const ctxDe = (negocio: string, dueno: string) => ({ negocio: marcar.negocio(negocio), dueno: marcar.dueno(dueno), medio: 'web' as const })
const seccionesPedidas = process.argv.slice(2)
const quiero = (nombre: string) => seccionesPedidas.length === 0 || seccionesPedidas.includes(nombre)

const titulo = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
// --- Preparación ------------------------------------------------------------------------------------

const creadosNegocios: string[] = []
const creadosDuenos: string[] = []
const creadosCasos: string[] = []
const creadosClientes: string[] = []
let negocioDeLaPrueba: string | undefined
let versionAlEmpezar: number | undefined

/** El otro Negocio sembrado, para probar que uno no ve ni toca lo del otro. */
async function negocioAjeno(codigoDelPropio: string) {
  const [ajeno] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, codigoDelPropio === 'TRIGO' ? 'LADERA' : 'TRIGO'))
  return ajeno ?? null
}

async function negocioDePrueba() {
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  if (!ladera) throw new Error('Falta sembrar Café Ladera: pnpm tsx scripts/sembrar.mts')
  return ladera
}

async function aplicar(ctx: Ctx, palabras: string, quiere: Parameters<typeof proponer>[1]['quiere']) {
  const p = await proponer(ctx, { palabrasDelDueno: palabras, origen: 'hilo', quiere })
  if (p.desenlace !== 'espera_al_dueno') throw new Error(`proponer dio ${p.desenlace}: ${p.resumen}`)
  const r = await aprobar(ctx, p.tarjeta.propuesta, p.tarjeta.huella)
  if (r.tipo !== 'aplicado') throw new Error(`aprobar dio ${r.tipo}`)
  return p.propuesta
}

const poner = (elemento: Elemento) => ({ tipo: 'poner' as const, elemento, reemplaza: null })

async function limpiar() {
  titulo('Limpieza')
  if (negocioDeLaPrueba && versionAlEmpezar !== undefined) {
    await db.delete(esquema.elementos).where(and(eq(esquema.elementos.negocioId, negocioDeLaPrueba), gt(esquema.elementos.version, versionAlEmpezar)))
    await db.update(esquema.negocios).set({ version: versionAlEmpezar }).where(eq(esquema.negocios.id, negocioDeLaPrueba))
  }
  // Las propuestas de esta corrida, también las de la respuesta a un Caso, que no tienen Cambio, y las líneas que
  // dejó su aprobación en el Hilo de cada Dueño del Negocio.
  if (negocioDeLaPrueba) {
    const propuestas = await db
      .delete(esquema.propuestas)
      .where(and(eq(esquema.propuestas.negocioId, negocioDeLaPrueba), gte(esquema.propuestas.creado, inicioDeLaPrueba)))
      .returning({ id: esquema.propuestas.id })
    const hilo = propuestas.length ? await db.select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.negocioId, negocioDeLaPrueba)) : []
    const lineas = hilo.filter((m) => propuestas.some((p) => JSON.stringify(m.mensaje).includes(p.id))).map((m) => m.id)
    if (lineas.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, lineas))
  }
  if (negocioDeLaPrueba) await db.delete(esquema.capacidadesFaltantes).where(and(eq(esquema.capacidadesFaltantes.negocioId, negocioDeLaPrueba), gte(esquema.capacidadesFaltantes.creado, inicioDeLaPrueba)))
  if (creadosCasos.length && negocioDeLaPrueba) {
    // El aviso de un Caso llega al Hilo de cada Dueño del Negocio, no solo al de la prueba.
    const hilo = await db
      .select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje })
      .from(esquema.mensajesDueno)
      .where(and(eq(esquema.mensajesDueno.negocioId, negocioDeLaPrueba), gte(esquema.mensajesDueno.creado, inicioDeLaPrueba)))
    const avisos = hilo.filter((m) => creadosCasos.some((id) => JSON.stringify(m.mensaje).includes(id))).map((m) => m.id)
    if (avisos.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, avisos))
  }
  if (creadosCasos.length) await db.delete(esquema.casos).where(inArray(esquema.casos.id, creadosCasos))
  if (creadosClientes.length) await db.delete(esquema.clientes).where(inArray(esquema.clientes.id, creadosClientes))
  if (creadosDuenos.length) await db.delete(esquema.duenos).where(inArray(esquema.duenos.id, creadosDuenos))
  if (creadosNegocios.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creadosNegocios))
  // Los turnos del generador y del Agente del dueño de esta corrida son de prueba: no van a la medición real.
  const borrados = negocioDeLaPrueba
    ? await db
        .delete(esquema.turnos)
        .where(and(eq(esquema.turnos.negocioId, negocioDeLaPrueba), inArray(esquema.turnos.agente, ['generador', 'dueno']), gte(esquema.turnos.creado, inicioDeLaPrueba)))
        .returning({ id: esquema.turnos.id })
    : []
  console.log(`Borrado lo que creó la prueba (y ${borrados.length} turnos de prueba).`)
}

function textoDe(m: { parts: { type: string; text?: string }[] }) {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
}
function herramientasDe(m: { parts: { type: string }[] }) {
  return m.parts.filter((p) => p.type.startsWith('tool-')).map((p) => p.type.replace('tool-', ''))
}

/** Un turno completo contra el Hilo: manda el mensaje, espera la respuesta y la imprime. */
async function turno(negocioId: string, duenoId: string, texto: string) {
  const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, negocioId))
  const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, duenoId))
  const mensaje = mensajeDelDueno({ parts: [{ type: 'text', text: texto }] })!
  const inicio = Date.now()
  const respuesta = await responderEnElHilo({ ctx: ctxDe(negocioId, duenoId), negocio, dueno, mensaje })
  await respuesta.text() // lee el stream hasta el final: ahí se guarda la respuesta
  await new Promise((r) => setTimeout(r, 400))
  const hilo = await leerHilo(duenoId)
  const ultimo = hilo.at(-1)!
  console.log(`\nDueño: ${texto}`)
  console.log(`Agente (${Date.now() - inicio} ms, herramientas: ${herramientasDe(ultimo).join(', ') || 'ninguna'}):\n${textoDe(ultimo as never)}`)
  return ultimo
}

// --- Programa ---------------------------------------------------------------------------------------

try {
  const negocio = await negocioDePrueba()
  negocioDeLaPrueba = negocio.id
  versionAlEmpezar = negocio.version
  const N = marcar.negocio(negocio.id)
  console.log(`Negocio: ${negocio.nombre} (${negocio.codigo})`)
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: negocio.id, usuarioId: `prueba-dueno-${Date.now()}`, nombre: 'Dueño de prueba' }).returning()
  creadosDuenos.push(dueno.id)

  if (quiero('cambios')) {
    const ctx = ctxDe(negocio.id, dueno.id)
    const salida = (sql: string, extra: Partial<SalidaDelRedactor> = {}): SalidaDelRedactor => ({
      decision: 'consulta',
      sql,
      enPalabras: 'pedidos confirmados por día de los últimos 30 días',
      ventana: 'la_que_pidio',
      supuestos: [],
      unidad: 'cantidad',
      nombreDeLaUnidad: 'pedidos',
      titulos: [],
      faltaEn: 'ninguna',
      falta: '',
      ...extra,
    })
    /** El redactor con un guion en vez de Muse Spark: devuelve las salidas en orden y guarda cada prompt. */
    const guion = (salidas: readonly (SalidaDelRedactor | 'cortada')[]) => {
      const prompts: string[] = []
      const motor: MotorDelRedactor = async (p) => {
        prompts.push(p)
        return { salida: salidas[prompts.length - 1] ?? 'cortada', uso: { inputTokens: 0, outputTokens: 0 } }
      }
      return { prompts, motor }
    }
    const pedirIndicador = (nombre: string, g: ReturnType<typeof guion>) =>
      proponer(ctx, { palabrasDelDueno: `Quiero ver ${nombre}`, origen: 'hilo', quiere: [{ tipo: 'panel', que: 'indicador', nombre, queQuiereVer: nombre, salida: 'serie', reemplaza: null }] }, undefined, g.motor)
    const BUENA = 'select dia_local::text as etiqueta, count(*) as valor from pedidos where cuenta_como_venta group by dia_local order by dia_local'
    const faltanteDe = async (id: string) => (await db.select().from(esquema.capacidadesFaltantes).where(eq(esquema.capacidadesFaltantes.id, id)))[0]

    const pedirSeccion = (nombre: string, g: ReturnType<typeof guion>) =>
      proponer(ctx, { palabrasDelDueno: `Quiero ver ${nombre}`, origen: 'hilo', quiere: [{ tipo: 'panel', que: 'seccion', nombre, queQuiereVer: nombre, salida: 'filas', reemplaza: null }] }, undefined, g.motor)
    const pedirNumero = (nombre: string, g: ReturnType<typeof guion>) =>
      proponer(ctx, { palabrasDelDueno: `Quiero ver ${nombre}`, origen: 'hilo', quiere: [{ tipo: 'panel', que: 'indicador', nombre, queQuiereVer: nombre, salida: 'numero', reemplaza: null }] }, undefined, g.motor)
    const pintadaDe = async (nombre: string) => (await pintarPanel(await leerEstado(N))).find((p) => p.nombre === nombre)
    const vistaDe = async (r: Awaited<ReturnType<typeof proponer>>) => ('propuesta' in r ? (await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, r.propuesta)))[0]?.vistaPrevia : undefined)

    titulo('1. Indicador con una consulta fija: queda aplicado sin botón y el Panel da la misma cifra')
    const r1 = await pedirNumero('Confirmados (prueba 1)', guion([salida('select count(*) as valor from pedidos where cuenta_como_venta')]))
    const [verdad1] = (await db.execute(sql`select count(*)::int as n from pedidos where negocio_id = ${negocio.id} and estado in ('confirmado', 'enviado', 'entregado', 'novedad')`)).rows as { n: number }[]
    const p1 = await pintadaDe('Confirmados (prueba 1)')
    afirmar('1: queda aplicado sin botón', r1.desenlace === 'aplicado', r1.resumen)
    afirmar('1: la línea de la tarjeta trae la cifra de hoy', 'vistaPrevia' in r1 && r1.vistaPrevia.lineas.some((l) => l.includes(`hoy: ${verdad1.n.toLocaleString('es-CO')} pedidos`)), 'vistaPrevia' in r1 ? r1.vistaPrevia.lineas : r1)
    afirmar('1: pintarPanel da la misma cifra que la base', p1?.resultado.tipo === 'numero' && p1.resultado.valor === verdad1.n, { p1, verdad: verdad1.n })
    const deshecho = 'propuesta' in r1 ? await proponer(ctx, { palabrasDelDueno: 'Quita ese indicador', origen: 'hilo', quiere: [{ tipo: 'revertir', propuesta: r1.propuesta }] }) : null
    afirmar('1: revertirlo también va sin botón y lo saca del Panel', deshecho?.desenlace === 'aplicado' && !(await pintadaDe('Confirmados (prueba 1)')), deshecho?.resumen)

    titulo('2. Sección con una consulta fija')
    const r2 = await pedirSeccion('Con novedad (prueba 2)', guion([salida("select numero, ciudad from pedidos where estado = 'novedad' order by numero", { titulos: [{ columna: 'numero', titulo: 'Pedido' }] })]))
    const [verdad2] = (await db.execute(sql`select count(*)::int as n from pedidos where negocio_id = ${negocio.id} and estado = 'novedad'`)).rows as { n: number }[]
    const p2 = await pintadaDe('Con novedad (prueba 2)')
    afirmar('2: queda aplicada sin botón y la línea dice cuántas filas', r2.desenlace === 'aplicado' && r2.vistaPrevia.lineas.some((l) => l.includes(`hoy: ${verdad2.n} fila`)), 'vistaPrevia' in r2 ? r2.vistaPrevia.lineas : r2)
    afirmar('2: pintarPanel trae esas filas con el título que puso el redactor', p2?.resultado.tipo === 'filas' && p2.total === verdad2.n && p2.resultado.columnas[0]?.titulo === 'Pedido' && p2.resultado.columnas[1]?.titulo === 'ciudad', p2)

    titulo('3. 600 filas: filas_recortadas al proponer y otra vez al pintar')
    const r3 = await pedirSeccion('Seiscientas (prueba 3)', guion([salida('select n as numero from hoy, generate_series(1, 600) as g(n)')]))
    const recorte = (a: readonly { tipo: string }[] | undefined) => a?.find((x) => x.tipo === 'filas_recortadas') as { total: number; mostradas: number } | undefined
    const p3 = await pintadaDe('Seiscientas (prueba 3)')
    afirmar('3: la vista previa guarda filas_recortadas con 600 y 500', recorte((await vistaDe(r3))?.panel?.[0]?.advertencias)?.total === 600 && recorte((await vistaDe(r3))?.panel?.[0]?.advertencias)?.mostradas === 500, (await vistaDe(r3))?.panel)
    afirmar('3: pintarPanel también la trae, con 500 filas mostradas', recorte(p3?.advertencias)?.total === 600 && p3?.mostradas === 500 && p3.total === 600, p3 && { total: p3.total, mostradas: p3.mostradas, advertencias: p3.advertencias })

    titulo('4. La ventana por defecto es la primera advertencia')
    const r4 = await pedirNumero('Ventas sin periodo (prueba 4)', guion([salida('select sum(total) as valor from pedidos, hoy where cuenta_como_venta and dia_local > hoy.hoy_local - 30', { ventana: 'por_defecto', unidad: 'dinero' })]))
    const p4 = await pintadaDe('Ventas sin periodo (prueba 4)')
    afirmar('4: la primera advertencia, al proponer y al pintar, es el supuesto de la ventana', 'vistaPrevia' in r4 && r4.vistaPrevia.advertencias?.[0] === VENTANA_POR_DEFECTO.supuesto && p4?.advertencias[0]?.tipo === 'supuesto', { r4: 'vistaPrevia' in r4 ? r4.vistaPrevia.advertencias : r4, p4: p4?.advertencias })

    titulo('5. Un día sin pedidos en un Negocio con pedidos: resultado_vacio_con_datos')
    const r5 = await pedirSeccion('Un día vacío (prueba 5)', guion([salida("select numero from pedidos where dia_local = '1999-01-01'::date")]))
    const p5 = await pintadaDe('Un día vacío (prueba 5)')
    afirmar('5: la vista previa y el Panel avisan que salió vacío habiendo datos', (await vistaDe(r5))?.panel?.[0]?.advertencias.some((a) => a.tipo === 'resultado_vacio_con_datos') === true && p5?.advertencias.some((a) => a.tipo === 'resultado_vacio_con_datos') === true, p5?.advertencias)

    titulo('6. Lo que se guarda de la vista previa no trae nombres de Clientes')
    const nombres = (await db.select({ nombre: esquema.clientes.nombre }).from(esquema.clientes).where(eq(esquema.clientes.negocioId, negocio.id))).map((c) => c.nombre).filter((n) => n.trim().length > 2)
    const r6 = await pedirSeccion('Mis clientes (prueba 6)', guion([salida('select nombre, creado from clientes order by creado desc')]))
    const guardada6 = JSON.stringify(await vistaDe(r6))
    afirmar('6: propuestas.vista_previa no contiene ningún nombre de Cliente', r6.desenlace === 'aplicado' && nombres.length > 0 && !nombres.some((n) => guardada6.includes(n)), { nombres: nombres.length, guardada6: guardada6.slice(0, 300) })

    titulo('7. Una consulta guardada que ya no valida: no_se_pudo_calcular y el Panel no se cae')
    const rota = el.claveNueva('indicador')
    const indicadorRoto = { tipo: 'indicador', nombre: 'Roto (prueba 7)', queQuiereVer: 'x', consulta: { sql: 'select now() as valor', enPalabras: 'x', supuestos: [], catalogo: 1, usa: [], salida: { tipo: 'numero', unidad: { tipo: 'dinero' } } } } as unknown as Elemento
    await conTransaccion((tx) => escribir(tx, N, { tipo: 'entrevista' }, { elementos: [{ clave: rota, base: 'nueva', despues: indicadorRoto }], filas: [] }))
    const conRota = await pintarPanel(await leerEstado(N))
    afirmar('7: la rota sale como no_se_pudo_calcular y las demás se pintan', conRota.find((p) => p.clave === rota)?.resultado.tipo === 'no_se_pudo_calcular' && conRota.some((p) => p.nombre === 'Con novedad (prueba 2)' && p.resultado.tipo === 'filas'), conRota.map((p) => [p.nombre, p.resultado.tipo]))

    titulo('3b. El error vuelve al redactor: dos consultas malas y una buena')
    const g3b = guion([salida("select count(*) as valor from pedidos p, (select set_config('app.negocio_id', 'x', true)) s"), salida('select telefono as etiqueta, count(*) as valor from clientes group by 1'), salida(BUENA)])
    const r3b = await pedirIndicador('Confirmados por día (prueba 3b)', g3b)
    const vigente3b = (await leerEstado(N)).vigentes('indicador').find((v) => v.elemento.nombre === 'Confirmados por día (prueba 3b)')
    afirmar('3b: el redactor corrió exactamente 3 veces', g3b.prompts.length === 3, g3b.prompts.length)
    afirmar('3b: el 2.º intento recibió la consulta anterior y por qué no sirvió', g3b.prompts[1]?.includes('set_config') && g3b.prompts[1].includes('No se permite set_config()'), g3b.prompts[1]?.slice(-400))
    afirmar('3b: el 3.º intento recibió el dato que no existe y los campos que sí', g3b.prompts[2]?.includes('telefono no existe') && g3b.prompts[2].includes('Campos:'), g3b.prompts[2]?.slice(-400))
    afirmar('3b: queda un Indicador vigente con la consulta buena, aplicado sin botón', r3b.desenlace === 'aplicado' && vigente3b?.elemento.consulta.sql === BUENA, { r3b, vigente3b })

    titulo('3c. El redactor declina: Capacidad faltante con motivo tipado')
    const g3c = guion([salida('', { decision: 'no_se_puede', faltaEn: 'pedidos', falta: 'la fecha de entrega' })])
    const r3c = await pedirIndicador('Días hasta la entrega (prueba 3c)', g3c)
    const fila3c = r3c.desenlace === 'capacidad_faltante' ? await faltanteDe(r3c.capacidadFaltante) : undefined
    afirmar('3c: termina en una Capacidad faltante no_se_puede:pedidos, sin Elemento', r3c.desenlace === 'capacidad_faltante' && fila3c?.tipo === 'no_se_puede' && fila3c.claveDeAgrupacion === 'no_se_puede:pedidos' && (fila3c.detalle as { falta?: string })?.falta === 'la fecha de entrega' && !(await leerEstado(N)).vigentes('indicador').some((v) => v.elemento.nombre.includes('3c')), fila3c)

    titulo('3d. Tres consultas malas: sin_converger con el tipo del último error')
    const mala = salida('select now() as etiqueta, count(*) as valor from pedidos group by 1')
    const g3d = guion([mala, mala, mala])
    const r3d = await pedirIndicador('Nunca converge (prueba 3d)', g3d)
    const fila3d = r3d.desenlace === 'capacidad_faltante' ? await faltanteDe(r3d.capacidadFaltante) : undefined
    afirmar('3d: tres intentos y una Capacidad faltante sin_converger:no_permitido', g3d.prompts.length === 3 && fila3d?.tipo === 'sin_converger' && fila3d.claveDeAgrupacion === 'sin_converger:no_permitido', fila3d)

    titulo('3e. Una respuesta cortada cuenta como intento')
    const g3e = guion(['cortada', 'cortada', salida(BUENA)])
    const r3e = await pedirIndicador('Confirmados (prueba 3e)', g3e)
    afirmar('3e: dos cortadas y la tercera sirve: 3 intentos y queda aplicado', g3e.prompts.length === 3 && r3e.desenlace === 'aplicado' && g3e.prompts[1].includes('se cortó'), { intentos: g3e.prompts.length, desenlace: r3e.desenlace })

    titulo('4. Regla: no prometer fechas, por Elementos')
    const reglasDe = async () => (await leerEstado(N)).vigentes('regla')
    const reglasAntes = (await reglasDe()).length
    const regla = await aplicar(ctx, 'No prometas fechas de entrega', [
      poner({
        tipo: 'regla',
        nombre: 'Sin fechas de entrega (prueba)',
        cuando: { tipo: 'siempre' },
        efectos: [{ tipo: 'no_prometer', que: 'plazo' }],
        escenarios: { activan: [{ mensajeDelCliente: '¿Cuánto demora un envío a Cali?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] },
      }),
    ])
    const conLaNueva = await reglasDe()
    const estadoTras = await leerEstado(N)
    console.log('Reglas vigentes tras aplicar:', conLaNueva.map((v) => el.reglaEnPalabras(v.elemento, estadoTras)))
    afirmar('4 regla: tras aplicar aparece entre las reglas vigentes', conLaNueva.length === reglasAntes + 1 && conLaNueva.some((v) => v.origen.tipo === 'propuesta' && v.origen.propuesta === regla), conLaNueva)
    await aplicar(ctx, 'Quita esa regla', [{ tipo: 'revertir', propuesta: regla }])
    const reglasTras = await reglasDe()
    afirmar('4 regla: tras revertir ya no está y quedan las de antes', reglasTras.length === reglasAntes && reglasTras.every((v) => v.origen.tipo !== 'propuesta' || v.origen.propuesta !== regla), reglasTras)

    titulo('5. Datos y productos: horario y un producto nuevo')
    const antes = valorDelDato(await leerEstado(N), 'horario')
    const conocimiento = await aplicar(ctx, 'Ahora abrimos también los domingos y vendemos un café de prueba', [
      poner({ tipo: 'dato', campo: 'horario', valor: `${antes} y domingos de 9 a 1` }),
      poner({ tipo: 'producto', nombre: 'Café de prueba 250 g', descripcion: '', precio: el.comoMonto(21000), activo: true }),
    ])
    const aplicado = await leerEstado(N)
    const nuevos = aplicado.vigentes('producto').filter((v) => v.elemento.nombre.startsWith('Café de prueba'))
    console.log(`Horario aplicado: "${valorDelDato(aplicado, 'horario')}"; productos de prueba: ${nuevos.length}`)
    afirmar('5 datos: tras aplicar el horario es el nuevo', valorDelDato(aplicado, 'horario') === `${antes} y domingos de 9 a 1`, valorDelDato(aplicado, 'horario'))
    afirmar('5 datos: tras aplicar el producto nuevo está activo con su precio', nuevos.length === 1 && nuevos[0].elemento.activo && nuevos[0].elemento.precio === 21000, nuevos)
    await aplicar(ctx, 'Deshaz eso', [{ tipo: 'revertir', propuesta: conocimiento }])
    const revertido = await leerEstado(N)
    afirmar('5 datos: tras revertir el horario vuelve al de antes', valorDelDato(revertido, 'horario') === antes, valorDelDato(revertido, 'horario'))
    afirmar('5 datos: tras revertir no queda el producto de prueba', revertido.vigentes('producto').every((v) => !v.elemento.nombre.startsWith('Café de prueba')))
  }

  if (quiero('aislamiento')) {
    titulo('6. Aislamiento')
    const otroNegocio = await negocioAjeno(negocio.codigo)
    afirmar('6 aislamiento: hay otro Negocio sembrado para compararlo', otroNegocio !== null, 'Falta sembrar TRIGO y LADERA: pnpm tsx scripts/sembrar.mts')
    if (otroNegocio) {
      const propuesta = await proponer(ctxDe(negocio.id, dueno.id), { palabrasDelDueno: 'prueba de aislamiento', origen: 'hilo', quiere: [poner({ tipo: 'dato', campo: 'pagos', valor: 'prueba de aislamiento' })] })
      const intento = propuesta.tarjeta ? await aprobar(ctxDe(otroNegocio.id, dueno.id), propuesta.tarjeta.propuesta, propuesta.tarjeta.huella) : null
      const [sigue] = propuesta.tarjeta ? await db.select({ estado: esquema.propuestas.estado }).from(esquema.propuestas).where(eq(esquema.propuestas.id, propuesta.tarjeta.propuesta)) : []
      console.log(`- aprobar una propuesta de ${negocio.nombre} desde ${otroNegocio.nombre}: ${intento?.tipo}`)
      afirmar('6 aislamiento: otro Negocio no puede aprobar la propuesta', intento?.tipo === 'no_existe', intento)
      afirmar('6 aislamiento: la propuesta sigue esperando', sigue?.estado === 'espera_al_dueno', sigue)
    }
  }

  if (quiero('cambios')) {
    titulo('6b. Una pieza del puente que quedó esperando el botón ya no cabe')
    const huella = randomBytes(32).toString('hex')
    const [vieja] = await db
      .insert(esquema.propuestas)
      .values({ negocioId: negocio.id, palabrasDelDueno: 'una pieza de antes del 2-nov', pedidoPor: dueno.id, huella, vence: new Date(Date.now() + 3600_000), vistaPrevia: { lineas: ['Indicador «Viejo»: 3'] } })
      .returning()
    const r = await aprobar(ctxDe(negocio.id, dueno.id), vieja.id, huella)
    const [sigue] = await db.select({ estado: esquema.propuestas.estado }).from(esquema.propuestas).where(eq(esquema.propuestas.id, vieja.id))
    afirmar('6b: aprobarla da ya_no_cabe, pídelo de nuevo, y no se aplica', r.tipo === 'ya_no_cabe' && r.resumen.includes('pídelo de nuevo') && sigue?.estado === 'espera_al_dueno', { r, sigue })
  }

  if (quiero('casos')) {
    titulo('7. Aviso de un Caso al Hilo del Dueño: la respuesta espera el botón (envío simulado)')
    const [cliente] = await db
      .insert(esquema.clientes)
      .values({ negocioId: negocio.id, telefono: '570000000099', nombre: 'Cliente de Prueba', ultimoMensajeEntrante: new Date() })
      .returning()
    creadosClientes.push(cliente.id)
    await db.insert(esquema.mensajesCliente).values([
      { negocioId: negocio.id, clienteId: cliente.id, rol: 'cliente', texto: 'Hola, quiero 2 bolsas de café para Cali, ¿me llegan el viernes?' },
      { negocioId: negocio.id, clienteId: cliente.id, rol: 'agente', texto: 'Con gusto. Déjame confirmar con el equipo la fecha de envío a Cali y te cuento.' },
    ])
    const [caso] = await db
      .insert(esquema.casos)
      .values({ negocioId: negocio.id, clienteId: cliente.id, titulo: 'Envío a Cali para el viernes', detalle: 'El Cliente pide la fecha de entrega en Cali y quiere recibirlo el viernes.' })
      .returning()
    creadosCasos.push(caso.id)
    const hiloAntes = (await leerHilo(dueno.id)).length
    const inicio = Date.now()
    await traerCasoAlDueno(N, caso.id)
    console.log(`traerCasoAlDueno: ${Date.now() - inicio} ms`)
    const [conPropuesta] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
    afirmar('7 Caso: tras traerlo al Dueño espera su respuesta con una propuesta', conPropuesta.estado === 'esperando_dueno' && conPropuesta.propuesta.trim().length > 0, conPropuesta)
    const delCaso = await db
      .select()
      .from(esquema.propuestas)
      .where(and(eq(esquema.propuestas.negocioId, negocio.id), sql`${esquema.propuestas.actos} @> ${JSON.stringify([{ caso: caso.id }])}::jsonb`))
    afirmar('7 Caso: una sola propuesta para el Caso, del núcleo y en espera', delCaso.length === 1 && delCaso[0].pedidoPor === null && delCaso[0].estado === 'espera_al_dueno', delCaso)
    const hilo = await leerHilo(dueno.id)
    const aviso = hilo.at(-1)!
    const tarjeta = (aviso.parts.find((p) => p.type === 'data-tarjeta') as { data: { propuesta: string; huella: string } } | undefined)?.data
    console.log(`\nMensaje en el Hilo del Dueño (${hilo.length} en total):\n${textoDe(aviso as never)}\npartes: ${aviso.parts.map((p) => p.type).join(', ')}`)
    afirmar('7 Caso: el Hilo recibió un solo mensaje, con el id del Caso y la tarjeta de esa propuesta', hilo.length === hiloAntes + 1 && aviso.parts.some((p) => p.type === 'data-caso' && (p as { data?: { casoId?: string } }).data?.casoId === caso.id) && tarjeta?.propuesta === delCaso[0]?.id, { antes: hiloAntes, ahora: hilo.length, partes: aviso.parts.map((p) => p.type) })
    const texto = delCaso[0]?.actos[0]?.texto ?? ''
    afirmar('7 Caso: el aviso muestra el mismo texto que saldría', texto.length > 0 && textoDe(aviso as never).includes(texto), texto)
    afirmar('7 Caso: traerlo al Dueño no le escribe al Cliente', envios.every((e) => e.telefono !== cliente.telefono), envios)

    const ajeno = await negocioAjeno(negocio.codigo)
    afirmar('7 Caso: hay otro Negocio sembrado desde el cual intentar aprobarlo', ajeno !== null, 'Falta sembrar TRIGO y LADERA: pnpm tsx scripts/sembrar.mts')
    if (ajeno && tarjeta) {
      const desdeOtro = await aprobar(ctxDe(ajeno.id, dueno.id), tarjeta.propuesta, tarjeta.huella)
      const [intacto] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
      afirmar('7 Caso: aprobar desde otro Negocio no existe, no cambia el Caso ni manda nada', desdeOtro.tipo === 'no_existe' && intacto.estado === 'esperando_dueno' && envios.every((e) => e.telefono !== cliente.telefono), { desdeOtro, caso: intacto })
    }
    if (tarjeta) {
      const r = await aprobar(ctxDe(negocio.id, dueno.id), tarjeta.propuesta, tarjeta.huella)
      const [resuelto] = await db.select().from(esquema.casos).where(eq(esquema.casos.id, caso.id))
      const salidos = envios.filter((e) => e.telefono === cliente.telefono)
      afirmar('7 Caso: aprobar por la ruta deja el Caso resuelto', r.tipo === 'aplicado' && resuelto.estado === 'resuelto', { r, estado: resuelto.estado })
      afirmar('7 Caso: un solo envío simulado, con el texto de la tarjeta', salidos.length === 1 && salidos[0].texto === texto, salidos)
    }
  }

  if (quiero('agente')) {
    titulo('8. Agente del dueño, Negocio abierto: proponer y el botón')
    const ctx = ctxDe(negocio.id, dueno.id)
    const propuestasDelDueno = () => db.select().from(esquema.propuestas).where(and(eq(esquema.propuestas.negocioId, negocio.id), eq(esquema.propuestas.pedidoPor, dueno.id)))

    const antesDeContar = (await propuestasDelDueno()).length
    const cuenta = await turno(negocio.id, dueno.id, 'Hoy vendimos 40 bolsas en la feria y la gente preguntó mucho por envíos a Cali.')
    afirmar('8 solo cuenta: no sale ninguna tarjeta ni propuesta', (await propuestasDelDueno()).length === antesDeContar && !herramientasDe(cuenta).includes('proponer'), herramientasDe(cuenta))

    const panel = await turno(negocio.id, dueno.id, 'Quiero ver cuántos pedidos tengo con novedad, en una lista.')
    const aplicadas = (await propuestasDelDueno()).filter((p) => p.estado === 'aplicada' && p.aprobadoPor === null)
    afirmar('8 Panel: lo que solo ve el Dueño queda aplicado sin botón', aplicadas.length > 0 && tarjetasDe([panel]).length === 0, { aplicadas, herramientas: herramientasDe(panel) })

    const reglasDe = async () => (await leerEstado(N)).vigentes('regla').length
    const reglasAntes = await reglasDe()
    const pedida = await turno(negocio.id, dueno.id, 'Nunca les prometas a los clientes una fecha de entrega.')
    const [tarjeta] = tarjetasDe([pedida])
    afirmar('8 regla: queda en una tarjeta que espera el botón', tarjeta !== undefined && (await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, tarjeta.propuesta)))[0]?.estado === 'espera_al_dueno', herramientasDe(pedida))
    if (tarjeta) {
      const { tools } = crearAgenteDelDueno(ctx, { negocio, dueno })
      const loQueVeElModelo = JSON.stringify(await convertToModelMessages(await leerHilo(dueno.id), { tools, convertDataPart: parteDeDatosParaElModelo, ignoreIncompleteToolCalls: true }))
      afirmar('8 regla: al modelo no le llega la huella', !loQueVeElModelo.includes(tarjeta.huella))
      await turno(negocio.id, dueno.id, 'Sí, aplícala.')
      const [sigue] = await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, tarjeta.propuesta))
      afirmar('8 regla: decir "sí" por escrito no la aplica', sigue.estado === 'espera_al_dueno' && (await reglasDe()) === reglasAntes, sigue.estado)
      const r = await aprobar(ctx, tarjeta.propuesta, tarjeta.huella)
      afirmar('8 regla: el botón la aplica y queda entre las reglas vigentes', r.tipo === 'aplicado' && (await reglasDe()) === reglasAntes + 1, r)
    }

    titulo('8b. La regla de Manizales, cuando pedido, propuesta por el Agente del dueño')
    const deManizales = async () => (await leerEstado(N)).vigentes('regla').filter((v) => v.elemento.cuando.tipo === 'pedido').length
    const deManizalesAntes = await deManizales()
    const pide = await turno(negocio.id, dueno.id, 'Cuando un pedido sea para fuera de Manizales, ábreme un Caso y no le prometas fecha de entrega al cliente.')
    const mensajesDeLaRegla = tarjetasDe([pide]).length ? [pide] : [pide, await turno(negocio.id, dueno.id, 'Sí, prepáralo así.')]
    const tarjetaDePedido = tarjetasDe(mensajesDeLaRegla).at(-1)
    const [filaDePedido] = tarjetaDePedido ? await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, tarjetaDePedido.propuesta)) : []
    const reglaPropuesta = filaDePedido?.escritura.elementos.find((c) => c.despues?.tipo === 'regla')?.despues
    console.log('Regla propuesta:', JSON.stringify(reglaPropuesta), '\nVista previa:', JSON.stringify(filaDePedido?.vistaPrevia))
    afirmar(
      '8b regla de pedido: espera el botón, es cuando pedido con abrir_caso y trae la vista previa de conversaciones',
      filaDePedido?.estado === 'espera_al_dueno' && reglaPropuesta?.tipo === 'regla' && reglaPropuesta.cuando.tipo === 'pedido' && reglaPropuesta.efectos.some((e) => e.tipo === 'abrir_caso') && (filaDePedido.vistaPrevia.conversaciones?.ensayos.length ?? 0) > 0,
      { estado: filaDePedido?.estado, reglaPropuesta, herramientas: mensajesDeLaRegla.flatMap(herramientasDe) },
    )
    if (tarjetaDePedido) {
      const r = await aprobar(ctx, tarjetaDePedido.propuesta, tarjetaDePedido.huella)
      afirmar('8b regla de pedido: el botón la aplica y queda vigente', r.tipo === 'aplicado' && (await deManizales()) === deManizalesAntes + 1, r)
    }

    const faltantesAntes = await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    await turno(negocio.id, dueno.id, '¿Me puedes mandar una factura electrónica a cada cliente?')
    const faltantes = await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    console.log(`Capacidades faltantes registradas en ese turno: ${faltantes - faltantesAntes}`)
    afirmar('8 agente: pedir facturación registra una capacidad faltante', faltantes > faltantesAntes, { antes: faltantesAntes, despues: faltantes })

    titulo('9. Agente del dueño, Negocio nuevo (modo armando): alta + entrevista')
    const { negocio: nuevo, dueno: duenoNuevo } = await altaDeDueno({ id: `prueba-alta-${Date.now()}`, name: 'Marta', email: 'marta@example.com' })
    creadosNegocios.push(nuevo.id)
    const hiloInicial = (await leerHilo(duenoNuevo.id)).length
    console.log(`Alta: Negocio "${nuevo.nombre}" código ${nuevo.codigo} estado ${nuevo.estado}; Hilo inicial: ${hiloInicial} mensaje`)
    afirmar('9 alta: el Negocio nuevo nace armando con un solo mensaje en el Hilo', nuevo.estado === 'armando' && hiloInicial === 1, { estado: nuevo.estado, hilo: hiloInicial })
    const guion = [
      'Hola, mi negocio se llama Dulces de la Abuela, vendemos arequipe y brevas caladas, en Popayán.',
      'El arequipe de 500 g vale 18000 y las brevas caladas de 400 g valen 25000. Enviamos a todo el país con Servientrega, entre 3 y 5 días y el envío cuesta 12000. Pagan por transferencia o Nequi.',
      'Atendemos de lunes a sábado de 8 a 6. Hablamos con mucho cariño y cercanía, de tú.',
      'Sí, está bien así, ábrelo.',
    ]
    for (const texto of guion) {
      await turno(nuevo.id, duenoNuevo.id, texto)
      const [actual] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, nuevo.id))
      if (actual.estado === 'listo') break
    }
    // Ya abierto, el mismo Hilo sigue con las herramientas del modo `listo` (y los mensajes del modo `armando` en su historia).
    const precio = await turno(nuevo.id, duenoNuevo.id, 'Sube el precio del arequipe de 500 g a 19000.')
    const si = await turno(nuevo.id, duenoNuevo.id, 'Sí, aplícalo.')
    const NUEVO = marcar.negocio(nuevo.id)
    const productosDe = async () => (await leerEstado(NUEVO)).vigentes('producto').map((v) => v.elemento)
    const arequipesDe = async () => (await productosDe()).filter((p) => /requipe/i.test(p.nombre))
    const antesDelBoton = (await arequipesDe()).filter((p) => p.activo)
    afirmar('9 precio: decir "sí" por escrito no cambia el precio', antesDelBoton.length > 0 && antesDelBoton.every((p) => p.precio === 18000), antesDelBoton)
    // El modelo puede preguntar antes de proponer: la tarjeta sale de cualquiera de los dos turnos.
    const tarjetaDelPrecio = tarjetasDe([precio, si]).at(-1)
    const r = tarjetaDelPrecio ? await aprobar(ctxDe(nuevo.id, duenoNuevo.id), tarjetaDelPrecio.propuesta, tarjetaDelPrecio.huella) : null
    const arequipes = await arequipesDe()
    console.log(`Precio del arequipe tras el botón: ${arequipes[0]?.precio}`)
    const [final] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, nuevo.id))
    const productos = await productosDe()
    const ciudad = valorDelDato(await leerEstado(NUEVO), 'ciudad')
    console.log(`\nNegocio tras la entrevista: "${final.nombre}", estado ${final.estado}, rubro "${final.rubro}", ciudad "${ciudad}", ${productos.length} productos`)
    afirmar('9 alta: tras la entrevista el Negocio está listo', final.estado === 'listo', final.estado)
    afirmar('9 alta: guardó al menos 2 productos', productos.length >= 2, productos.map((p) => p.nombre))
    afirmar('9 alta: guardó la ciudad Popayán', ciudad.toLowerCase().includes('popay'), ciudad)
    const deLaEntrevista = (await leerEstado(NUEVO)).todos().filter((v) => v.origen.tipo === 'entrevista')
    afirmar('9 alta: lo de la entrevista quedó como Elementos con origen entrevista', deLaEntrevista.length >= 3, deLaEntrevista.map((v) => v.clave))

    titulo('9b. Abrir en el alta: sin producto se bloquea; sin horario solo avisa')
    const { negocio: otro, dueno: duenoOtro } = await altaDeDueno({ id: `prueba-alta-b-${Date.now()}`, name: 'Rosa', email: 'rosa@example.com' })
    creadosNegocios.push(otro.id)
    const ctxOtro = ctxDe(otro.id, duenoOtro.id)
    const sinNada = await abrirEnElAlta(ctxOtro)
    afirmar('9b: sin nombre ni producto no abre, y dice qué falta', !sinNada.abierto && sinNada.falta.length === 2, sinNada)
    const { tools: deRosa } = crearAgenteDelDueno(ctxOtro, { negocio: otro, dueno: duenoOtro })
    const guardarConocimiento = (entrada: Record<string, string>) =>
      (deRosa.guardar_conocimiento as unknown as { execute: (e: unknown, o: unknown) => Promise<{ resumen: string }> }).execute(entrada, { toolCallId: 'prueba', messages: [] })
    const conMalTono = await guardarConocimiento({ ciudad: 'Medellín', tono: 'Decimos que la arepa cura la gastritis' })
    const trasMalTono = await leerEstado(marcar.negocio(otro.id))
    afirmar('9b tono: uno que no puede llegar a un Cliente se omite y se dice, y la ciudad se guarda', conMalTono.resumen.includes('tono') && valorDelDato(trasMalTono, 'ciudad') === 'Medellín' && trasMalTono.vigentes('voz').length === 0, conMalTono)
    await guardarConocimiento({ tono: `Cercanos, nunca de usted. ${'Hablamos sencillo. '.repeat(30)}` })
    const [vozDeRosa] = (await leerEstado(marcar.negocio(otro.id))).vigentes('voz')
    afirmar('9b tono: uno largo se corta al largo del estilo y "nunca de usted" tutea', vozDeRosa?.elemento.estilo.length === el.LARGO_DEL_ESTILO && vozDeRosa.elemento.trato === 'tu', vozDeRosa)
    await guardarEnElHilo(otro.id, duenoOtro.id, 'dueno', mensajeDelDuenoEnTexto('Se llama Arepas de Rosa y la arepa de choclo vale 6000')!)
    const guardado = await guardarEnElAlta(ctxOtro, { nombre: 'Arepas de Rosa', rubro: 'arepas', quiere: [poner({ tipo: 'producto', nombre: 'Arepa de choclo', descripcion: '', precio: el.comoMonto(6000), activo: true }), poner({ tipo: 'dato', campo: 'ciudad', valor: 'Medellín' })] })
    const abre = await abrirEnElAlta(ctxOtro)
    const [abierto] = await db.select({ estado: esquema.negocios.estado }).from(esquema.negocios).where(eq(esquema.negocios.id, otro.id))
    afirmar('9b: con nombre y un producto abre, y el horario, los envíos y los pagos solo avisan', 'guardado' in guardado && abre.abierto && abierto.estado === 'listo' && abre.avisos.some((f) => f.que === 'horario') && !abre.avisos.some((f) => f.que === 'ciudad'), { guardado, abre })
    const tarde = await guardarEnElAlta(ctxOtro, { nombre: null, rubro: null, quiere: [poner({ tipo: 'dato', campo: 'horario', valor: '8 a 5' })] })
    afirmar('9b: abierto, la entrevista ya no escribe', 'problemas' in tarde && tarde.problemas[0]?.tipo === 'solo_mientras_se_arma', tarde)
    const arequipesActivos = arequipes.filter((p) => p.activo)
    afirmar('9 precio: con el botón de la tarjeta el arequipe cuesta 19000', r?.tipo === 'aplicado' && arequipesActivos.length > 0 && arequipesActivos.every((p) => p.precio === 19000), { r, arequipes })
  }

  if (quiero('agente')) {
    titulo('10. Una regla de horario que hoy nada cumple queda anotada, sin propuesta')
    const propuestasAntes = await db.$count(esquema.propuestas, and(eq(esquema.propuestas.negocioId, negocio.id), eq(esquema.propuestas.pedidoPor, dueno.id)))
    const versionAntes = (await leerEstado(N)).version
    const faltantesAntes = await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    await turno(negocio.id, dueno.id, 'Fuera de horario no contestes nada a los clientes.')
    const propuestasDespues = await db.$count(esquema.propuestas, and(eq(esquema.propuestas.negocioId, negocio.id), eq(esquema.propuestas.pedidoPor, dueno.id), sql`${esquema.propuestas.estado} <> 'capacidad_faltante'`))
    const faltantes = await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))
    afirmar('10 horario: queda una Capacidad faltante, sin propuesta y con la versión igual', faltantes > faltantesAntes && propuestasDespues === propuestasAntes && (await leerEstado(N)).version === versionAntes, { faltantesAntes, faltantes, propuestasAntes, propuestasDespues })

    titulo('10b. "Pásamelo" queda anotado: ni regla ni propuesta')
    const reglasAntes = (await leerEstado(N)).vigentes('regla').length
    await turno(negocio.id, dueno.id, 'Cuando un cliente pregunte por ventas al por mayor, pásamelo a mí.')
    const conPasar = await db.$count(esquema.propuestas, and(eq(esquema.propuestas.negocioId, negocio.id), eq(esquema.propuestas.pedidoPor, dueno.id), sql`${esquema.propuestas.estado} <> 'capacidad_faltante'`))
    afirmar('10b pásamelo: queda otra Capacidad faltante, sin propuesta, sin regla y con la versión igual', (await db.$count(esquema.capacidadesFaltantes, eq(esquema.capacidadesFaltantes.negocioId, negocio.id))) > faltantes && conPasar === propuestasAntes && (await leerEstado(N)).vigentes('regla').length === reglasAntes && (await leerEstado(N)).version === versionAntes, { conPasar, propuestasAntes })
  }

  const turnos = await db.select().from(esquema.turnos).where(eq(esquema.turnos.negocioId, negocio.id))
  const porAgente = Object.groupBy(turnos, (t) => t.agente)
  console.log('\nTurnos registrados en el Negocio de prueba:', Object.entries(porAgente).map(([a, t]) => `${a}: ${t!.length}`).join(', '))
} catch (e) {
  afirmar('probar-dueno terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-dueno borró lo que creó', false, e))
  terminar()
}
