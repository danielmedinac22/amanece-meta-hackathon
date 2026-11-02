/**
 * Aislamiento, prueba permanente de `pnpm probar`. Un mismo teléfono P es Dueño de Café Ladera y Cliente de
 * Panadería Trigo y Leña, y cada mensaje cae solo donde debe. Llama al modelo una vez, en el turno de P como
 * Cliente de TRIGO. Y las consultas del Panel: dos Negocios desechables, A y B, y ninguna consulta de A ve a B,
 * ni con el ataque de #8, ni con lo que otra petición fijó sin LOCAL, ni con un anillo quitado. Lo que la corrida
 * crea se borra al final.
 *
 *   pnpm tsx scripts/probar-aislamiento.mts
 */
import { config } from 'dotenv'
import { neon, Pool } from '@neondatabase/serverless'
import { and, eq, gte, inArray, like, sql } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { afirmar, capturarEnvios, capturarErrores, eventoDeKapso, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()

const { db, esquema } = await import('../src/db')
const { leerMensajeEntrante, recibirMensaje } = await import('../src/nucleo/entrada')
const { mensajeDelDueno } = await import('../src/negocio/dueno-chat')
const { leerEstado } = await import('../src/nucleo/estado')
const { marcar } = await import('../src/nucleo/identidad')
const { esErrorDeConsulta, validarConsulta } = await import('../src/nucleo/consultas/validar')
const { armarLote, ejecutar, firmaDe, PREAMBULO } = await import('../src/nucleo/consultas/ejecutar')
const { ataqueDe8, BUENAS_DE_M2, ESCAPES_DE_12, variantesDelAtaque } = await import('./consultas-de-prueba.mjs')
type ConsultaValidada = import('../src/nucleo/consultas/tipos').ConsultaValidada
type Sentencia = import('../src/nucleo/consultas/ejecutar').Sentencia

const inicio = new Date()
const marca = String(Date.now()).slice(-8)
const P = `5730${marca}`
const prefijo = `wamid.AISLAMIENTO.${marca}.`
const entrante = (n: string, texto: string) => leerMensajeEntrante(eventoDeKapso({ wamid: `${prefijo}${n}`, telefono: P, texto, nombre: 'Dueña de Ladera' }))!
let duenoId: string | undefined
let trigoId: string | undefined
const negociosDeConsultas: string[] = []

async function huellaDeLosDemas(negocio: string): Promise<string> {
  const { rows } = await db.execute(sql`select
    (select count(*) from clientes where negocio_id = ${negocio} and telefono <> ${P}) as clientes,
    (select count(*) from mensajes_cliente m join clientes c on c.id = m.cliente_id where m.negocio_id = ${negocio} and c.telefono <> ${P}) as mensajes,
    (select count(*) from pedidos p join clientes c on c.id = p.cliente_id where p.negocio_id = ${negocio} and c.telefono <> ${P}) as pedidos,
    (select count(*) from casos k left join clientes c on c.id = k.cliente_id where k.negocio_id = ${negocio} and c.telefono is distinct from ${P}) as casos,
    (select count(*) from mensajes_salientes where negocio_id = ${negocio} and telefono is distinct from ${P}) as salientes,
    (select count(*) from sesiones_whatsapp where negocio_id = ${negocio} and telefono <> ${P}) as sesiones,
    (select count(*) from mensajes_dueno where negocio_id = ${negocio}) as hilos`)
  return JSON.stringify(rows[0])
}

async function limpiar() {
  const fichas = (await db.select({ id: esquema.clientes.id }).from(esquema.clientes).where(and(eq(esquema.clientes.telefono, P), gte(esquema.clientes.creado, inicio)))).map((c) => c.id)
  if (fichas.length) {
    // Un Caso no se va con su Cliente (set null): se borra antes, con su aviso en los Hilos del Negocio.
    const casos = (await db.select({ id: esquema.casos.id }).from(esquema.casos).where(inArray(esquema.casos.clienteId, fichas))).map((c) => c.id)
    if (casos.length) {
      const hilo = await db.select({ id: esquema.mensajesDueno.id, mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(gte(esquema.mensajesDueno.creado, inicio))
      const avisos = hilo.filter((m) => casos.some((id) => JSON.stringify(m.mensaje).includes(id))).map((m) => m.id)
      if (avisos.length) await db.delete(esquema.mensajesDueno).where(inArray(esquema.mensajesDueno.id, avisos))
      await db.delete(esquema.casos).where(inArray(esquema.casos.id, casos))
    }
    await db.delete(esquema.clientes).where(inArray(esquema.clientes.id, fichas))
  }
  if (duenoId) await db.delete(esquema.duenos).where(eq(esquema.duenos.id, duenoId))
  if (trigoId) await db.delete(esquema.turnos).where(and(eq(esquema.turnos.negocioId, trigoId), eq(esquema.turnos.agente, 'clientes'), gte(esquema.turnos.creado, inicio)))
  await db.delete(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, P))
  await db.delete(esquema.mensajesSalientes).where(and(eq(esquema.mensajesSalientes.telefono, P), gte(esquema.mensajesSalientes.creado, inicio)))
  await db.delete(esquema.mensajesEntrantes).where(like(esquema.mensajesEntrantes.wamid, `${prefijo}%`))
  if (negociosDeConsultas.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, negociosDeConsultas))
}

/** Un Negocio desechable con Clientes, pedidos, Casos y mensajes. Sus ids, para buscarlos en lo que ve el otro. */
async function sembrarNegocio(letra: string, cuantos: number) {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Consultas ${letra} ${marca}`, codigo: `CONS${letra}${marca}` }).returning()
  negociosDeConsultas.push(n.id)
  const clientes = await db
    .insert(esquema.clientes)
    .values(Array.from({ length: cuantos }, (_, i) => ({ negocioId: n.id, telefono: `57${letra === 'A' ? 1 : 2}${marca}${i}`, nombre: `Cliente ${letra}${i}` })))
    .returning()
  const ahora = Date.now()
  const pedidos = await db
    .insert(esquema.pedidos)
    .values(
      Array.from({ length: cuantos + 2 }, (_, i) => ({
        negocioId: n.id,
        clienteId: clientes[i % cuantos].id,
        numero: i + 1,
        items: [{ productoId: `${letra}-prod-${i % 2}`, nombre: `Producto ${letra}${i % 2}`, cantidad: 1 + (i % 3), precio: 10000 }],
        total: 10000 * (1 + (i % 3)),
        ciudad: letra === 'A' ? 'Manizales' : 'Pasto',
        estado: (['confirmado', 'entregado', 'novedad', 'pendiente'] as const)[i % 4],
        creado: new Date(ahora - i * 3600_000),
      })),
    )
    .returning()
  const casos = await db
    .insert(esquema.casos)
    .values(clientes.slice(0, 2).map((c, i) => ({ negocioId: n.id, clienteId: c.id, pedidoId: pedidos[i].id, titulo: `Caso ${letra}${i}` })))
    .returning()
  await db.insert(esquema.mensajesCliente).values(
    clientes.flatMap((c, i) => [
      { negocioId: n.id, clienteId: c.id, rol: 'cliente' as const, texto: `hola ${letra}${i}`, creado: new Date(ahora - 120_000) },
      { negocioId: n.id, clienteId: c.id, rol: 'agente' as const, texto: `respuesta ${letra}${i}`, creado: new Date(ahora - 60_000) },
    ]),
  )
  return { id: n.id, ids: [n.id, ...clientes.map((c) => c.id), ...pedidos.map((p) => p.id), ...casos.map((k) => k.id)], pedidos: pedidos.length, clientes: clientes.length, casos: casos.length }
}

/** Una consulta que no pasó por el validador: para correr crudo dentro del lote lo que el validador frena. */
const cruda = (texto: string) => ({ sql: texto, fuentes: ['pedidos'], usa: ['pedidos.id'], columnas: [], orden: [] }) as unknown as ConsultaValidada

const delDueno = neon(process.env.DATABASE_URL!)
if (!process.env.DATABASE_URL_CONSULTAS) throw new Error('Falta DATABASE_URL_CONSULTAS: pnpm tsx scripts/rol-de-consultas.mts .env.local')
const comoRol = neon(process.env.DATABASE_URL_CONSULTAS)
/** El lote tal cual lo arma `armarLote`, o mutado, en una petición HTTP de solo lectura. Por la conexión real del rol, salvo el control. */
async function correrLote(lote: readonly Sentencia[], via = comoRol): Promise<{ readonly ok: true; readonly filas: Record<string, unknown>[] } | { readonly ok: false; readonly error: string; readonly codigo: unknown }> {
  try {
    const r = (await via.transaction((t) => lote.map((x) => t.query(x.texto, [...x.parametros])), { readOnly: true })) as unknown as Record<string, unknown>[][]
    return { ok: true, filas: r[lote.length - 1] ?? [] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e), codigo: (e as { code?: unknown }).code }
  }
}

try {
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  const [trigo] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
  if (!ladera || !trigo) throw new Error('Falta sembrar LADERA y TRIGO: pnpm tsx scripts/sembrar.mts')
  trigoId = trigo.id
  const [dueno] = await db.insert(esquema.duenos).values({ negocioId: ladera.id, usuarioId: `prueba-aislamiento-${marca}`, nombre: 'Dueña de prueba', telefono: P }).returning()
  duenoId = dueno.id

  const hilo = () => db.select().from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, dueno.id))
  const fichaEn = async (negocio: string) => (await db.select().from(esquema.clientes).where(and(eq(esquema.clientes.negocioId, negocio), eq(esquema.clientes.telefono, P))))[0]
  const sesionDeP = async () => (await db.select().from(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, P)))[0]?.negocioId ?? null
  const enviosAP = (desde: number) => envios.slice(desde).filter((e) => e.telefono === P)
  const textoDe = (m: unknown) => ((m as UIMessage).parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('')
  const antesDeTrigo = await huellaDeLosDemas(trigo.id)

  console.log('\n=== 1. P con la ficha de TRIGO es Cliente de TRIGO ===')
  let desde = envios.length
  const m1 = entrante('1', '(TRIGO) Hola, ¿tienen pan de masa madre?')
  await recibirMensaje(m1)
  const enTrigo = await fichaEn(trigo.id)
  const mensajesEnTrigo = enTrigo ? await db.select().from(esquema.mensajesCliente).where(eq(esquema.mensajesCliente.clienteId, enTrigo.id)) : []
  afirmar('1 Cliente de TRIGO: P tiene ficha en TRIGO y su mensaje quedó ahí', enTrigo !== undefined && mensajesEnTrigo.some((m) => m.wamid === m1.wamid && m.rol === 'cliente' && m.negocioId === trigo.id), mensajesEnTrigo)
  afirmar('1 Cliente de TRIGO: salió un solo envío a P y quedó como fila agente en TRIGO', enviosAP(desde).length === 1 && mensajesEnTrigo.some((m) => m.rol === 'agente' && m.texto === enviosAP(desde)[0]?.texto), enviosAP(desde))
  const [salida1] = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, m1.wamid))
  afirmar('1 Cliente de TRIGO: la fila de salida es de TRIGO y de su Cliente', salida1?.negocioId === trigo.id && salida1.clienteId === enTrigo?.id && salida1.veredicto === 'sale', salida1)
  afirmar('1 Cliente de TRIGO: P no tiene ficha de Cliente en LADERA', (await fichaEn(ladera.id)) === undefined)
  afirmar('1 Cliente de TRIGO: el Hilo del Dueño de LADERA sigue vacío', (await hilo()).length === 0)
  afirmar('1 Cliente de TRIGO: la sesión de P quedó en TRIGO', (await sesionDeP()) === trigo.id)

  console.log('\n=== 2. El mismo teléfono sin ficha es el Dueño de LADERA ===')
  const mensajesEnTrigoAntes = mensajesEnTrigo.length
  desde = envios.length
  const m2 = entrante('2', '¿Cómo van los pedidos de hoy?')
  await recibirMensaje(m2)
  const hilo2 = await hilo()
  afirmar('2 Dueño de LADERA: su Hilo tiene un mensaje, del Dueño, con ese texto', hilo2.length === 1 && hilo2[0].rol === 'dueno' && textoDe(hilo2[0].mensaje) === m2.texto && hilo2[0].negocioId === ladera.id, hilo2)
  afirmar('2 Dueño de LADERA: TRIGO no tiene ningún mensaje nuevo de P', enTrigo !== undefined && (await db.$count(esquema.mensajesCliente, eq(esquema.mensajesCliente.clienteId, enTrigo.id))) === mensajesEnTrigoAntes)
  afirmar('2 Dueño de LADERA: P sigue sin ficha de Cliente en LADERA', (await fichaEn(ladera.id)) === undefined)
  afirmar('2 Dueño de LADERA: no sale nada por WhatsApp ni queda fila de salida', enviosAP(desde).length === 0 && (await db.$count(esquema.mensajesSalientes, eq(esquema.mensajesSalientes.enRespuestaA, m2.wamid))) === 0, enviosAP(desde))
  afirmar('2 Dueño de LADERA: la sesión de P sigue en TRIGO', (await sesionDeP()) === trigo.id)

  console.log('\n=== 3. Con la ficha de su propio Negocio sigue siendo el Dueño ===')
  desde = envios.length
  await recibirMensaje(entrante('3', '(LADERA) hola'))
  afirmar('3 ficha propia: el Hilo tiene otro mensaje del Dueño y P sigue sin ficha en LADERA', (await hilo()).length === 2 && (await fichaEn(ladera.id)) === undefined)
  afirmar('3 ficha propia: no sale nada por WhatsApp', enviosAP(desde).length === 0, enviosAP(desde))

  console.log('\n=== 4. Un reintento de Kapso de un mensaje del Dueño ===')
  desde = envios.length
  await recibirMensaje(entrante('2', '¿Cómo van los pedidos de hoy?'))
  afirmar('4 repetido del Dueño: el Hilo no cambia y no sale nada', (await hilo()).length === 2 && enviosAP(desde).length === 0)
  afirmar('4 repetido del Dueño: queda una sola fila en mensajes_entrantes con ese wamid', (await db.$count(esquema.mensajesEntrantes, eq(esquema.mensajesEntrantes.wamid, m2.wamid))) === 1)

  console.log('\n=== 5. El texto del Dueño por WhatsApp lleva el tope de la web ===')
  const largo = `Un mensaje largo del Dueño ${'pan '.repeat(1500)}fin`
  await recibirMensaje(entrante('5', largo))
  const delWhatsapp = (await hilo()).map((m) => textoDe(m.mensaje)).find((t) => t.startsWith('Un mensaje largo'))
  const deLaWeb = textoDe(mensajeDelDueno({ parts: [{ type: 'text', text: largo }] }))
  afirmar(
    '5 tope: el texto del Dueño queda en su Hilo cortado en 4000 caracteres, igual que por la web',
    largo.length > 4000 && delWhatsapp === largo.slice(0, 4000) && deLaWeb === delWhatsapp,
    { largo: largo.length, whatsapp: delWhatsapp?.length, web: deLaWeb.length },
  )

  console.log('\n=== 6. TRIGO, menos lo de P, no se movió ===')
  const despuesDeTrigo = await huellaDeLosDemas(trigo.id)
  afirmar('6 TRIGO intacto: clientes, mensajes, pedidos, Casos, salidas, sesiones e Hilos de los demás', despuesDeTrigo === antesDeTrigo, { antesDeTrigo, despuesDeTrigo })

  console.log('\n=== 7. Consultas del Panel: A nunca ve a B ===')
  const A = await sembrarNegocio('A', 3)
  const B = await sembrarNegocio('B', 4)
  const estadoA = await leerEstado(marcar.negocio(A.id))
  const estadoB = await leerEstado(marcar.negocio(B.id))
  const ve = (filas: unknown, ids: readonly string[]) => ids.filter((id) => JSON.stringify(filas).includes(id))
  const LISTADOS: [string, string, number, number][] = [
    ['pedidos', 'select id, cliente_id, numero from pedidos', A.pedidos, B.pedidos],
    ['clientes', 'select id, nombre from clientes', A.clientes, B.clientes],
    ['casos', 'select id, cliente_id, pedido_id from casos', A.casos, B.casos],
    ['lineas_de_pedido', 'select pedido_id, cliente_id, producto_id from lineas_de_pedido', A.pedidos, B.pedidos],
    ['conversaciones', 'select cliente_id, dia_local, mensajes_cliente from conversaciones', A.clientes, B.clientes],
  ]
  for (const [nombre, texto, deA, deB] of LISTADOS) {
    const v = await validarConsulta(texto, 'filas')
    if (esErrorDeConsulta(v)) {
      afirmar(`7 ${nombre}: el listado valida`, false, v)
      continue
    }
    const [ra, rb] = await Promise.all([ejecutar(estadoA, v), ejecutar(estadoB, v)])
    afirmar(`7 ${nombre}: A ve exactamente sus ${deA} filas y ningún id de B`, ra.tipo === 'filas' && ra.total === deA && ve(ra.filas, B.ids).length === 0, ra)
    afirmar(`7 ${nombre}: B ve exactamente sus ${deB} filas y ningún id de A`, rb.tipo === 'filas' && rb.total === deB && ve(rb.filas, A.ids).length === 0, rb)
  }
  let validasDeA = 0
  const vieronAB: string[] = []
  for (const [id, salida, texto] of BUENAS_DE_M2) {
    const v = await validarConsulta(texto, salida)
    if (esErrorDeConsulta(v)) continue
    validasDeA++
    const r = await ejecutar(estadoA, v)
    if (r.tipo !== 'filas' || ve(r.filas, B.ids).length) vieronAB.push(`${id}: ${r.tipo === 'filas' ? ve(r.filas, B.ids).join(',') : JSON.stringify(r)}`)
  }
  afirmar(`7 las ${BUENAS_DE_M2.length} consultas de M2 corren desde A y ninguna trae un id de B`, validasDeA === BUENAS_DE_M2.length && vieronAB.length === 0, vieronAB)

  console.log('\n=== 8. La base frena el ataque de #8 y los escapes, por la conexión real ===')
  const firmaA = await firmaDe(A.id)
  const firmaB = await firmaDe(B.id)
  const listado = (await validarConsulta('select id from pedidos', 'filas')) as ConsultaValidada
  const hastaLaConsulta = (l: readonly Sentencia[]) => l.slice(0, PREAMBULO + 1)
  const crudas = (textos: readonly string[]): Sentencia[] => textos.map((texto) => ({ texto, parametros: [] }))
  const lote = hastaLaConsulta(armarLote(estadoA, listado, firmaA))
  const preambulo = lote.slice(0, PREAMBULO)
  const sondaDeEscape = { texto: `SELECT current_user AS usuario, (SELECT count(*) FROM public.pedidos WHERE negocio_id = '${B.id}')::int AS de_b`, parametros: [] }
  const sinCambios = (r: Awaited<ReturnType<typeof correrLote>>) => r.ok && r.filas[0]?.usuario === 'amanece_consultas' && r.filas[0]?.de_b === 0
  const es42501 = (r: Awaited<ReturnType<typeof correrLote>>) => !r.ok && r.codigo === '42501'
  // Con el rol LOGIN, SET ROLE a sí mismo es legal: no da error y no cambia nada.
  const SIN_ERROR = 'SET ROLE amanece_consultas'
  for (const [nombre, sentencias] of ESCAPES_DE_12) {
    const r = await correrLote([...preambulo, ...crudas(sentencias.map(([sentencia]) => sentencia)), sondaDeEscape])
    if (nombre === SIN_ERROR) afirmar(`8 escape ${nombre}: sigue siendo amanece_consultas y no aparece ninguna fila de B`, sinCambios(r), r)
    else afirmar(`8 escape ${nombre}: lo frena la base`, !r.ok && /permission denied|must be|read-only/.test(r.error), r)
  }
  const aNone = await correrLote([...preambulo, ...crudas(["select set_config('role', 'none', true)"]), sondaDeEscape])
  afirmar("8 set_config('role', 'none', true) no da error, sigue siendo amanece_consultas y no aparece ninguna fila de B", sinCambios(aNone), aNone)

  const ataqueEnElSelect = `select p.id from public.pedidos p, (select set_config('app.negocio_id', '${B.id}', true)) s`
  const ataqueAparte = `select set_config('app.negocio_id', '${B.id}', true)`
  const dentro = await correrLote(hastaLaConsulta(armarLote(estadoA, cruda(ataqueEnElSelect), firmaA)))
  afirmar('8 el ataque de #8 dentro del SELECT sobre public.pedidos falla con 42501', es42501(dentro), dentro)
  const aparte = await correrLote([...preambulo, ...crudas([ataqueAparte, 'select id from public.pedidos'])])
  afirmar('8 el ataque de #8 como sentencia aparte falla con 42501', es42501(aparte), aparte)
  const conLasCte = await correrLote(hastaLaConsulta(armarLote(estadoA, cruda(`select p.id from pedidos p, (select set_config('app.negocio_id', '${B.id}', true)) s`), firmaA)))
  afirmar('8 el ataque de #8 sobre las CTE no trae ninguna fila de B', !conLasCte.ok || ve(conLasCte.filas, B.ids).length === 0, conLasCte)
  const fijar = (negocio: string, firma: string) => preambulo.map((x) => (x.texto.includes('set_config') ? { ...x, parametros: [negocio, firma] } : x))
  const firmaAjena = await correrLote([...fijar(B.id, firmaA), ...crudas(['select id from public.pedidos'])])
  afirmar('8 la firma de A con el app.negocio_id de B falla con 42501', es42501(firmaAjena), firmaAjena)
  const firmaPropia = await correrLote([...fijar(B.id, firmaB), ...crudas(['select id from public.pedidos'])])
  afirmar('8 control: la firma de B con el app.negocio_id de B sí ve los pedidos de B', firmaPropia.ok && ve(firmaPropia.filas, B.ids).length === B.pedidos, firmaPropia.ok ? firmaPropia.filas.length : firmaPropia)

  const quienCorre = await ejecutar(estadoA, cruda('select current_user::text as usuario from hoy'))
  afirmar('8 ejecutar corre como amanece_consultas, no en sesión del dueño', quienCorre.tipo === 'filas' && quienCorre.filas[0]?.usuario === 'amanece_consultas', quienCorre)
  const porEjecutar = await ejecutar(estadoA, cruda(ataqueEnElSelect))
  afirmar('8 el ataque de #8 por ejecutar vuelve como error 42501 y sin filas', porEjecutar.tipo === 'error' && porEjecutar.error.tipo === 'postgres' && porEjecutar.error.codigo === '42501', porEjecutar)

  console.log('\n=== 8 bis. El validador es el segundo anillo: rechaza esos mismos textos ===')
  for (const [nombre, texto] of [['el ataque de #8', ataqueDe8(B.id)], ...variantesDelAtaque(B.id)] as const) {
    const v = await validarConsulta(texto, 'numero')
    afirmar(`8 bis el validador rechaza ${nombre} como no_permitido, por la función`, esErrorDeConsulta(v) && v.tipo === 'no_permitido' && /set_config|current_setting/.test(v.que), v)
  }
  for (const [nombre, sentencias] of ESCAPES_DE_12) {
    for (const [sentencia, que] of sentencias) {
      const v = await validarConsulta(sentencia, 'filas')
      afirmar(`8 bis el validador rechaza ${sentencia}, del escape ${nombre}, como no_permitido, por ${que.source}`, esErrorDeConsulta(v) && v.tipo === 'no_permitido' && que.test(v.que), v)
    }
  }
  const OTROS_TEXTOS = ["select set_config('role', 'none', true)", ataqueEnElSelect, ataqueAparte, `select set_config('app.negocio_id', '${B.id}', false)`, `select set_config('app.firma', '0', true)`]
  for (const texto of OTROS_TEXTOS) {
    const v = await validarConsulta(texto, 'filas')
    afirmar(`8 bis el validador rechaza ${texto.replace(B.id, 'B')} como no_permitido`, esErrorDeConsulta(v) && v.tipo === 'no_permitido' && /set_config|public\.pedidos/.test(v.que), v)
  }

  console.log('\n=== 9. Un anillo quitado, y los controles que deben dar lo contrario ===')
  const sinWhere = lote.map((x) => ({ ...x, texto: x.texto.replace(/\w+\.negocio_id = \$1::uuid/g, '($1::uuid IS NOT NULL)') }))
  const rls = await correrLote(sinWhere)
  afirmar('9 sin el WHERE de la CTE, la RLS frena: A ve sus pedidos y ninguno de B', rls.ok && ve(rls.filas, A.ids).length === A.pedidos && ve(rls.filas, B.ids).length === 0, rls)
  /**
   * El lote con otra política, sin confirmarla. Un ALTER POLICY abierto solo se ve en su propia transacción, y ahí el dueño
   * necesita SET sobre el rol: tiene ADMIN, se lo da y el ROLLBACK se lo quita.
   */
  const conPolitica = async (usando: string, l: readonly Sentencia[]) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const cliente = await pool.connect()
    try {
      await cliente.query('BEGIN')
      await cliente.query('GRANT amanece_consultas TO CURRENT_USER WITH INHERIT FALSE, SET TRUE')
      for (const t of ['pedidos', 'clientes', 'casos', 'mensajes_cliente']) await cliente.query(`ALTER POLICY consultas_del_negocio ON public.${t} USING (${usando})`)
      await cliente.query('SET LOCAL ROLE amanece_consultas')
      let ultima: Record<string, unknown>[] = []
      for (const x of l.filter((x) => !x.texto.startsWith('RESET'))) ultima = (await cliente.query(x.texto, [...x.parametros])).rows
      return ultima
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined)
      cliente.release()
      await pool.end()
    }
  }
  const cte = await conPolitica('true', lote)
  afirmar('9 sin la política (ALTER POLICY dentro de una transacción con ROLLBACK), la CTE frena', ve(cte, A.ids).length === A.pedidos && ve(cte, B.ids).length === 0, cte)
  const fuga = await conPolitica('true', sinWhere)
  afirmar('9 control: sin WHERE y sin política sí aparecen los pedidos de B, así que la prueba ve una fuga', ve(fuga, B.ids).length === B.pedidos, ve(fuga, B.ids).length)
  const conGuc = await conPolitica(`negocio_id = current_setting('app.negocio_id')::uuid`, hastaLaConsulta(armarLote(estadoA, cruda(ataqueEnElSelect), firmaA)))
  afirmar('9 control: con la política vuelta al GUC simple, el ataque de #8 fuga los pedidos de B', ve(conGuc, B.ids).length === B.pedidos, ve(conGuc, B.ids).length)
  const enSesionDelDueno = await correrLote([...preambulo, ...crudas(['SET ROLE neondb_owner']), sondaDeEscape], delDueno)
  afirmar('9 control: un lote en sesión del dueño deja pasar SET ROLE neondb_owner y ve a B', enSesionDelDueno.ok && enSesionDelDueno.filas[0]?.usuario === 'neondb_owner' && enSesionDelDueno.filas[0]?.de_b === B.pedidos, enSesionDelDueno)
  const [despues] = (await db.execute(sql`select (select qual from pg_policies where tablename = 'pedidos' and policyname = 'consultas_del_negocio') as qual, pg_has_role(current_user, 'amanece_consultas', 'SET') as puede`)).rows as { qual: string; puede: boolean }[]
  afirmar('9 el ROLLBACK dejó la política con la firma y al dueño sin SET', despues?.qual.includes('consultas_negocio()') && !despues.puede, despues)

  console.log('\n=== 10. Lo que se fijó sin LOCAL antes del lote ===')
  const sinSetConfig = preambulo.filter((x) => !x.texto.includes('set_config'))
  const sonda = { texto: "SELECT current_setting('app.negocio_id', true) AS negocio, coalesce(current_setting('app.firma', true), '') <> '' AS hay_firma, current_user AS usuario", parametros: [] }
  const contagio = { texto: "SELECT set_config('app.negocio_id', $1, false), set_config('app.firma', $2, false)", parametros: [B.id, firmaB] }
  const contagiada = await correrLote([contagio, ...sinSetConfig, sonda])
  afirmar(
    '10 en la misma conexión, el Negocio y la firma fijados sin LOCAL antes del lote no llegan después de los RESET',
    contagiada.ok && !contagiada.filas[0]?.negocio && contagiada.filas[0]?.hay_firma === false && contagiada.filas[0]?.usuario === 'amanece_consultas',
    contagiada,
  )
  const cruzada = await correrLote([contagio, ...sinSetConfig, ...crudas(['SELECT p.id FROM public.pedidos p'])])
  afirmar('10 un lote sin set_config después del contagio falla con 42501: no trae filas de nadie', es42501(cruzada), cruzada.ok ? ve(cruzada.filas, B.ids).length : cruzada)

  const VECES = 60
  for (let i = 0; i < VECES; i++) await comoRol.query(contagio.texto, [...contagio.parametros])
  const vistas = await Promise.all(Array.from({ length: VECES }, () => correrLote([...sinSetConfig, sonda])))
  afirmar(`10 con RESET ALL, ninguna de ${VECES} sondas ve el Negocio ni la firma que fijó sin LOCAL otra petición`, vistas.every((r) => r.ok && !r.filas[0]?.negocio && r.filas[0]?.hay_firma === false), vistas.find((r) => !r.ok || r.filas[0]?.negocio || r.filas[0]?.hay_firma))
  // Las sondas de arriba confirman su RESET ALL y limpian lo que tocan: el control necesita contagiar otra vez.
  await Promise.all(Array.from({ length: VECES }, () => comoRol.query(contagio.texto, [...contagio.parametros])))
  const sinReset = await Promise.all(Array.from({ length: VECES }, () => correrLote([...sinSetConfig.filter((x) => x.texto !== 'RESET ALL'), sonda])))
  const contagiadas = sinReset.filter((r) => r.ok && r.filas[0]?.negocio === B.id).length
  afirmar(`10 control: sin RESET ALL, alguna de ${VECES} sondas ve el Negocio que fijó otra petición (hoy ${contagiadas}; 80 de 120 en #28)`, contagiadas > 0, contagiadas)
  const reales = await Promise.all(Array.from({ length: 20 }, () => ejecutar(estadoA, listado)))
  afirmar('10 ejecutar después de esas peticiones: 20 de 20 traen solo los pedidos de A', reales.every((r) => r.tipo === 'filas' && r.total === A.pedidos && ve(r.filas, B.ids).length === 0), reales.find((r) => r.tipo !== 'filas' || r.total !== A.pedidos))
  for (let i = 0; i < VECES; i++) await comoRol.query('RESET ALL')
} catch (e) {
  afirmar('probar-aislamiento terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-aislamiento borró lo que creó', false, e))
  afirmar('probar-aislamiento no registró errores', errores.length === 0, errores)
  terminar()
}
