/**
 * La salida: lo que el texto de `src` no puede tener (el grafo de imports lo cuida `pnpm lint`), la tabla de
 * `decidir`, la de `seCumple` en los dos modos y `despachar` contra Neon con el envío simulado y con Kapso caído,
 * sin red. Sin modelo. Los casos contra la base leen `MODO_DE_LA_COMPUERTA`, así que siguen verdes el día que la
 * compuerta haga cumplir. Lo que la corrida crea se borra al final.
 *
 *   pnpm tsx scripts/probar-salida.mts
 */
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { config } from 'dotenv'
import { and, eq, inArray, like } from 'drizzle-orm'
import { afirmar, capturarEnvios, capturarErrores, terminar } from './afirmar.mjs'
import type { Destinatario, HechosDeEnvio, IntencionDeEnvio, MotivoDeSilencio } from '../src/nucleo/salida/compuerta'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()

const { db, esquema } = await import('../src/db')
const { decidir, seCumple, ORDEN_DE_LA_COMPUERTA, MODO_DE_LA_COMPUERTA } = await import('../src/nucleo/salida/compuerta')
const { despachar, emergenciaDe, intencion } = await import('../src/nucleo/salida')
const { marcar } = await import('../src/nucleo/identidad')
const { enviarAlCliente, ErrorDeEnvio } = await import('../src/negocio/whatsapp')

const marca = String(Date.now()).slice(-8)
const prefijo = `wamid.SALIDA.${marca}.`
const w = (s: string) => marcar.wamid(`${prefijo}${s}`)
const telSinNegocio = `5710${marca}`
const telMudo = `5711${marca}`
const telEnVentana = `5712${marca}`
const telVencido = `5713${marca}`
const clientesCreados: string[] = []
const claves: string[] = []

async function limpiar() {
  delete process.env.SALIDA_EN_EMERGENCIA
  if (claves.length) await db.delete(esquema.mensajesSalientes).where(inArray(esquema.mensajesSalientes.clave, claves))
  if (clientesCreados.length) await db.delete(esquema.clientes).where(inArray(esquema.clientes.id, clientesCreados))
  await db.delete(esquema.mensajesEntrantes).where(like(esquema.mensajesEntrantes.wamid, `${prefijo}%`))
}

try {
  console.log('\n=== 1. Importaciones ===')
  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
    })
  const fuentes = archivos('src').map((p) => ({ ruta: relative('.', p), texto: readFileSync(p, 'utf8') }))
  const conTexto = (re: RegExp) => fuentes.filter((f) => re.test(f.texto)).map((f) => f.ruta).sort()
  const solo = (re: RegExp, rutas: string[]) => JSON.stringify(conTexto(re)) === JSON.stringify(rutas)

  afirmar('importaciones: solo salida/kapso.ts lee ENVIO_SIMULADO', solo(/process\.env\.ENVIO_SIMULADO/, ['src/nucleo/salida/kapso.ts']), conTexto(/process\.env\.ENVIO_SIMULADO/))
  afirmar('importaciones: api.kapso.ai aparece solo en salida/kapso.ts', solo(/api\.kapso\.ai/, ['src/nucleo/salida/kapso.ts']), conTexto(/api\.kapso\.ai/))
  afirmar('importaciones: src/lib/kapso.ts ya no existe y nadie lo importa', !fuentes.some((f) => f.ruta === 'src/lib/kapso.ts') && conTexto(/@\/lib\/kapso/).length === 0, conTexto(/@\/lib\/kapso/))
  afirmar('importaciones: la línea del envío simulado solo la imprime salida/kapso.ts', solo(/envío simulado a/, ['src/nucleo/salida/kapso.ts']), conTexto(/envío simulado a/))
  const PUEDEN_ARMAR_INTENCIONES = ['src/negocio/whatsapp.ts', 'src/nucleo/clientes/atender.ts', 'src/nucleo/entrada.ts']
  const arman = conTexto(/\bintencion\b[^\n]*from '(@\/nucleo\/salida|\.\/salida|\.\.\/salida)'/)
  afirmar('importaciones: solo entrada, atender y enviarAlCliente arman intenciones', arman.length > 0 && arman.every((r) => PUEDEN_ARMAR_INTENCIONES.includes(r)), arman)

  console.log('\n=== 2. decidir ===')
  const A = marcar.negocio('00000000-0000-4000-8000-00000000000a')
  const B = marcar.negocio('00000000-0000-4000-8000-00000000000b')
  const CAMILA = marcar.cliente('00000000-0000-4000-8000-0000000000c1')
  const W = marcar.wamid('wamid.TABLA.1')
  const ahora = new Date('2026-10-28T15:00:00Z')
  const haceHoras = (h: number) => marcar.instante(new Date(ahora.getTime() - h * 3600_000))

  const enOrden: HechosDeEnvio = {
    ahora: marcar.instante(ahora),
    emergenciaGlobal: false,
    numeroPermitido: true,
    negocio: { modo: 'atendiendo', emergencia: false },
    cliente: { negocio: A },
    ultimoEntrante: haceHoras(1),
    respuestasAlMismoMensaje: 0,
  }
  const alCliente = { tipo: 'cliente', negocio: A, cliente: CAMILA } as const
  const sinNegocio = { tipo: 'telefono', telefono: '573000000999', negocio: null } as const
  const intencionDe = (clase: IntencionDeEnvio['clase'], destinatario: Destinatario = alCliente) =>
    (clase === 'respuesta'
      ? { clase, destinatario: alCliente, texto: 't', clave: 'k', enRespuestaA: W }
      : clase === 'resolucion_de_caso'
        ? { clase, destinatario: alCliente, texto: 't', clave: 'k', caso: null }
        : { clase, destinatario, texto: 't', clave: 'k', enRespuestaA: W }) as IntencionDeEnvio

  const CLASES = ['respuesta', 'resolucion_de_caso', 'aviso_del_nucleo'] as const
  const masDe24h = marcar.instante(new Date(ahora.getTime() - 24 * 3600_000 - 1000))
  type Fila = { caso: string; clase: IntencionDeEnvio['clase']; destinatario?: Destinatario; hechos: Partial<HechosDeEnvio>; esperado: 'sale' | MotivoDeSilencio }
  const TABLA: Fila[] = [
    ...CLASES.map((clase): Fila => ({ caso: 'todo en orden', clase, hechos: {}, esperado: 'sale' })),
    { caso: 'aviso a un teléfono sin Negocio que acaba de escribir', clase: 'aviso_del_nucleo', destinatario: sinNegocio, hechos: { negocio: null, cliente: null }, esperado: 'sale' },
    { caso: 'aviso a un teléfono sin Negocio que nunca escribió', clase: 'aviso_del_nucleo', destinatario: sinNegocio, hechos: { negocio: null, cliente: null, ultimoEntrante: null }, esperado: 'fuera_de_ventana' },
    { caso: 'aviso de un Negocio armando a un teléfono', clase: 'aviso_del_nucleo', destinatario: { ...sinNegocio, negocio: A }, hechos: { negocio: { modo: 'armando', emergencia: false }, cliente: null }, esperado: 'sale' },
    ...CLASES.map((clase): Fila => ({ caso: 'emergencia global', clase, hechos: { emergenciaGlobal: true }, esperado: 'emergencia' })),
    { caso: 'emergencia global también a un teléfono sin Negocio', clase: 'aviso_del_nucleo', destinatario: sinNegocio, hechos: { negocio: null, cliente: null, emergenciaGlobal: true }, esperado: 'emergencia' },
    { caso: 'emergencia del Negocio', clase: 'resolucion_de_caso', hechos: { negocio: { modo: 'atendiendo', emergencia: true } }, esperado: 'emergencia' },
    ...CLASES.map((clase): Fila => ({ caso: 'un Negocio en sombra no le habla a nadie', clase, hechos: { negocio: { modo: 'en_sombra', emergencia: false } }, esperado: 'negocio_en_sombra' })),
    { caso: 'sin número de Amanece', clase: 'respuesta', hechos: { numeroPermitido: false }, esperado: 'numero_no_permitido' },
    { caso: 'el Cliente es de otro Negocio', clase: 'respuesta', hechos: { cliente: { negocio: B } }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'el Cliente es de otro Negocio', clase: 'resolucion_de_caso', hechos: { cliente: { negocio: B } }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'a un aviso no le aplica otro Negocio', clase: 'aviso_del_nucleo', hechos: { cliente: { negocio: B } }, esperado: 'sale' },
    { caso: 'el Cliente no existe', clase: 'respuesta', hechos: { cliente: null }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'ventana: 24 h justas todavía sale', clase: 'respuesta', hechos: { ultimoEntrante: haceHoras(24) }, esperado: 'sale' },
    ...CLASES.map((clase): Fila => ({ caso: 'ventana: 24 h y un segundo', clase, hechos: { ultimoEntrante: masDe24h }, esperado: 'fuera_de_ventana' })),
    { caso: 'un Cliente que nunca escribió', clase: 'resolucion_de_caso', hechos: { ultimoEntrante: null }, esperado: 'fuera_de_ventana' },
    { caso: 'segunda respuesta al mismo mensaje', clase: 'respuesta', hechos: { respuestasAlMismoMensaje: 1 }, esperado: 'una_respuesta_por_mensaje' },
    { caso: 'aviso después de una respuesta al mismo mensaje', clase: 'aviso_del_nucleo', hechos: { respuestasAlMismoMensaje: 1 }, esperado: 'una_respuesta_por_mensaje' },
    { caso: 'una resolución no responde a un mensaje', clase: 'resolucion_de_caso', hechos: { respuestasAlMismoMensaje: 3 }, esperado: 'sale' },
    { caso: 'orden: todo mal, gana emergencia', clase: 'respuesta', hechos: { emergenciaGlobal: true, numeroPermitido: false, negocio: { modo: 'en_sombra', emergencia: true }, cliente: { negocio: B }, ultimoEntrante: null, respuestasAlMismoMensaje: 2 }, esperado: 'emergencia' },
    { caso: 'orden: sombra antes que número', clase: 'respuesta', hechos: { negocio: { modo: 'en_sombra', emergencia: false }, numeroPermitido: false }, esperado: 'negocio_en_sombra' },
    { caso: 'orden: otro Negocio antes que ventana', clase: 'respuesta', hechos: { cliente: { negocio: B }, ultimoEntrante: null }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'orden: ventana antes que una respuesta por mensaje', clase: 'respuesta', hechos: { ultimoEntrante: null, respuestasAlMismoMensaje: 1 }, esperado: 'fuera_de_ventana' },
  ]
  for (const f of TABLA) {
    const v = decidir(intencionDe(f.clase, f.destinatario), { ...enOrden, ...f.hechos })
    const dio = v.tipo === 'sale' ? 'sale' : v.motivo
    afirmar(`decidir · ${f.clase} · ${f.caso} → ${f.esperado}`, dio === f.esperado, dio)
  }

  console.log('\n=== 3. seCumple y emergenciaDe ===')
  const noSale = (motivo: MotivoDeSilencio) => ({ tipo: 'no_sale', motivo }) as const
  afirmar('seCumple: un sale nunca frena', !seCumple({ tipo: 'sale' }, 'observa') && !seCumple({ tipo: 'sale' }, 'hace_cumplir'))
  afirmar('seCumple observa: ningún no_sale frena', ORDEN_DE_LA_COMPUERTA.every((m) => !seCumple(noSale(m), 'observa')))
  afirmar('seCumple hace_cumplir: todo no_sale frena', ORDEN_DE_LA_COMPUERTA.every((m) => seCumple(noSale(m), 'hace_cumplir')))
  const emergencias = [emergenciaDe(undefined, A), emergenciaDe('*', null), emergenciaDe(` ${B} ,x`, B), emergenciaDe(B, A)]
  afirmar(
    'emergenciaDe: vacía no frena; * frena todo; por id frena solo ese Negocio',
    JSON.stringify(emergencias) === JSON.stringify([{ global: false, delNegocio: false }, { global: true, delNegocio: false }, { global: false, delNegocio: true }, { global: false, delNegocio: false }]),
    emergencias,
  )

  const observa = MODO_DE_LA_COMPUERTA === 'observa'
  console.log(`\n=== 4. despachar contra Neon (compuerta: ${MODO_DE_LA_COMPUERTA}, envío simulado) ===`)
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  const [trigo] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
  if (!ladera || !trigo) throw new Error('Falta sembrar LADERA y TRIGO: pnpm tsx scripts/sembrar.mts')
  const LADERA = marcar.negocio(ladera.id)
  const TRIGO = marcar.negocio(trigo.id)
  const [enVentana, vencido] = await db
    .insert(esquema.clientes)
    .values([
      { negocioId: ladera.id, telefono: telEnVentana, nombre: 'Prueba de salida en ventana', ultimoMensajeEntrante: new Date() },
      { negocioId: ladera.id, telefono: telVencido, nombre: 'Prueba de salida vencida', ultimoMensajeEntrante: new Date(Date.now() - 25 * 3600_000) },
    ])
    .returning()
  clientesCreados.push(enVentana.id, vencido.id)
  const aEnVentana = { tipo: 'cliente', negocio: LADERA, cliente: marcar.cliente(enVentana.id) } as const
  const aVencido = { tipo: 'cliente', negocio: LADERA, cliente: marcar.cliente(vencido.id) } as const

  const enviosA = (tel: string, desde: number) => envios.slice(desde).filter((e) => e.telefono === tel)
  const filaDe = async (clave: string) => (await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.clave, clave)))[0]
  const agentesDe = (clienteId: string) =>
    db.select().from(esquema.mensajesCliente).where(and(eq(esquema.mensajesCliente.clienteId, clienteId), eq(esquema.mensajesCliente.rol, 'agente')))
  const despacharAnotada = (i: IntencionDeEnvio) => {
    claves.push(i.clave)
    return despachar(i)
  }

  await db.insert(esquema.mensajesEntrantes).values({ wamid: w('a'), telefono: telSinNegocio, enviadoEn: new Date() })
  const aviso = intencion.aviso({ destinatario: { tipo: 'telefono', telefono: telSinNegocio, negocio: null }, aviso: { cual: 'sin_negocio' }, enRespuestaA: w('a') })
  let desde = envios.length
  const r1 = await despacharAnotada(aviso)
  afirmar('despachar: un aviso a un teléfono sin Negocio que acaba de escribir sale una vez, simulado', r1.tipo === 'simulado' && enviosA(telSinNegocio, desde).length === 1, { r1, envios: enviosA(telSinNegocio, desde) })
  const fila1 = await filaDe(aviso.clave)
  afirmar(
    'despachar: el aviso dejó su fila (aviso_del_nucleo, sin Negocio ni Cliente, sale, simulado)',
    fila1?.clase === 'aviso_del_nucleo' && fila1.negocioId === null && fila1.clienteId === null && fila1.telefono === telSinNegocio && fila1.veredicto === 'sale' && fila1.estado === 'simulado',
    fila1,
  )

  desde = envios.length
  const r2 = await despacharAnotada(aviso)
  afirmar('despachar: la misma intención otra vez devuelve lo guardado y no sale nada', r2.tipo === 'simulado' && envios.length === desde, { r2, envios: envios.slice(desde) })
  afirmar('despachar: sigue habiendo una sola fila con esa clave', (await db.$count(esquema.mensajesSalientes, eq(esquema.mensajesSalientes.clave, aviso.clave))) === 1)

  const mudo = intencion.aviso({ destinatario: { tipo: 'telefono', telefono: telMudo, negocio: null }, aviso: { cual: 'sin_negocio' }, enRespuestaA: w('c') })
  desde = envios.length
  const r3 = await despacharAnotada(mudo)
  const fila3 = await filaDe(mudo.clave)
  afirmar('despachar: un teléfono que nunca escribió queda no_sale fuera_de_ventana', fila3?.veredicto === 'no_sale' && fila3.motivo === 'fuera_de_ventana', fila3)
  afirmar(
    `despachar: ese aviso ${observa ? 'sale igual (observa)' : 'no sale (hace cumplir)'}`,
    observa ? r3.tipo === 'simulado' && enviosA(telMudo, desde).length === 1 && fila3?.estado === 'simulado' : r3.tipo === 'no_salio' && enviosA(telMudo, desde).length === 0 && fila3?.estado === 'no_salio',
    { r3, fila3 },
  )

  const largo = `Respuesta de prueba ${'larga '.repeat(900)}fin`
  const respuesta = intencion.respuesta({ destinatario: aEnVentana, texto: largo, enRespuestaA: w('d') })
  desde = envios.length
  const r4 = await despacharAnotada(respuesta)
  const salidos4 = enviosA(telEnVentana, desde)
  afirmar('despachar: una respuesta a un Cliente en ventana sale una vez, simulada', r4.tipo === 'simulado' && salidos4.length === 1, { r4, salidos4 })
  afirmar('despachar: la línea del envío trae el texto entero, más largo que el corte de Kapso', largo.length > 4096 && salidos4[0]?.texto === largo, salidos4[0]?.texto.length)
  const agentes4 = await agentesDe(enVentana.id)
  afirmar('despachar: la respuesta dejó su fila agente en mensajes_cliente con el texto que salió', agentes4.length === 1 && agentes4[0].texto === largo && agentes4[0].negocioId === ladera.id, agentes4.map((m) => m.texto.length))
  const fila4 = await filaDe(respuesta.clave)
  afirmar(
    'despachar: la respuesta dejó su fila (respuesta, del Cliente en LADERA, sale, simulado)',
    fila4?.clase === 'respuesta' && fila4.clienteId === enVentana.id && fila4.negocioId === ladera.id && fila4.enRespuestaA === w('d') && fila4.veredicto === 'sale' && fila4.estado === 'simulado',
    fila4,
  )

  const disculpa = intencion.aviso({ destinatario: aEnVentana, aviso: { cual: 'falla_tecnica' }, enRespuestaA: w('d') })
  desde = envios.length
  const r5 = await despacharAnotada(disculpa)
  const fila5 = await filaDe(disculpa.clave)
  afirmar('despachar: un aviso después de la respuesta al mismo mensaje queda no_sale una_respuesta_por_mensaje', fila5?.veredicto === 'no_sale' && fila5.motivo === 'una_respuesta_por_mensaje', fila5)
  afirmar(`despachar: ese aviso ${observa ? 'sale igual (observa)' : 'no sale (hace cumplir)'}`, observa ? r5.tipo === 'simulado' && enviosA(telEnVentana, desde).length === 1 : r5.tipo === 'no_salio' && enviosA(telEnVentana, desde).length === 0, r5)

  desde = envios.length
  const aLaVez = [
    intencion.respuesta({ destinatario: aEnVentana, texto: 'Respuesta a la vez', enRespuestaA: w('f') }),
    intencion.aviso({ destinatario: aEnVentana, aviso: { cual: 'falla_tecnica' }, enRespuestaA: w('f') }),
  ]
  await Promise.all(aLaVez.map(despacharAnotada))
  const filasF = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, w('f')))
  afirmar('despachar: respuesta y aviso al mismo mensaje a la vez dejan una sola fila sale', filasF.length === 2 && filasF.filter((f) => f.veredicto === 'sale').length === 1, filasF.map((f) => [f.clase, f.veredicto, f.motivo]))
  afirmar(`despachar: de esos dos salen ${observa ? 2 : 1}`, enviosA(telEnVentana, desde).length === (observa ? 2 : 1), enviosA(telEnVentana, desde))

  const aDestiempo = intencion.respuesta({ destinatario: aVencido, texto: 'Esto llega fuera de la ventana', enRespuestaA: w('g') })
  desde = envios.length
  const r6 = await despacharAnotada(aDestiempo)
  const fila6 = await filaDe(aDestiempo.clave)
  const agentes6 = await agentesDe(vencido.id)
  afirmar('despachar: un Cliente fuera de la ventana queda no_sale fuera_de_ventana', fila6?.veredicto === 'no_sale' && fila6.motivo === 'fuera_de_ventana', fila6)
  afirmar(
    `despachar: a ese Cliente ${observa ? 'le sale igual y queda su fila agente (observa)' : 'no le sale nada ni queda fila agente (hace cumplir)'}`,
    observa
      ? r6.tipo === 'simulado' && enviosA(telVencido, desde).length === 1 && agentes6.length === 1
      : r6.tipo === 'no_salio' && enviosA(telVencido, desde).length === 0 && agentes6.length === 0,
    { r6, agentes6 },
  )

  const fantasma = intencion.respuesta({ destinatario: { tipo: 'cliente', negocio: LADERA, cliente: marcar.cliente(randomUUID()) }, texto: 'A nadie', enRespuestaA: w('h') })
  desde = envios.length
  const r7 = await despacharAnotada(fantasma)
  const fila7 = await filaDe(fantasma.clave)
  afirmar('despachar: un Cliente que no existe no recibe nada, en los dos modos', r7.tipo === 'no_salio' && r7.motivo === 'destinatario_de_otro_negocio' && envios.length === desde, r7)
  afirmar('despachar: su fila queda no_salio, sin teléfono ni Cliente', fila7?.estado === 'no_salio' && fila7.telefono === null && fila7.clienteId === null && fila7.motivo === 'destinatario_de_otro_negocio', fila7)

  process.env.SALIDA_EN_EMERGENCIA = '*'
  const enEmergencia = intencion.respuesta({ destinatario: aEnVentana, texto: 'En emergencia', enRespuestaA: w('i') })
  desde = envios.length
  const r8 = await despacharAnotada(enEmergencia).finally(() => delete process.env.SALIDA_EN_EMERGENCIA)
  const fila8 = await filaDe(enEmergencia.clave)
  afirmar('despachar: con SALIDA_EN_EMERGENCIA=* la fila queda no_sale emergencia', fila8?.veredicto === 'no_sale' && fila8.motivo === 'emergencia', fila8)
  afirmar(`despachar: en emergencia ${observa ? 'sale igual (observa)' : 'no sale (hace cumplir)'}`, observa ? r8.tipo === 'simulado' && enviosA(telEnVentana, desde).length === 1 : r8.tipo === 'no_salio' && enviosA(telEnVentana, desde).length === 0, r8)

  const ajena = intencion.resolucionDeCaso({ destinatario: { tipo: 'cliente', negocio: TRIGO, cliente: marcar.cliente(enVentana.id) }, texto: 'Resolución ajena', caso: null, vez: randomUUID() })
  desde = envios.length
  const agentesAntes = (await agentesDe(enVentana.id)).length
  const r9 = await despacharAnotada(ajena)
  const fila9 = await filaDe(ajena.clave)
  afirmar(
    'despachar: un Cliente de LADERA nombrado por TRIGO queda no_sale destinatario_de_otro_negocio',
    fila9?.veredicto === 'no_sale' && fila9.motivo === 'destinatario_de_otro_negocio' && fila9.clase === 'resolucion_de_caso' && fila9.negocioId === trigo.id && fila9.enRespuestaA === null,
    fila9,
  )
  const agentes9 = await agentesDe(enVentana.id)
  afirmar(
    `despachar: ${observa ? 'sale igual y su fila agente queda en LADERA, el Negocio del Cliente (observa)' : 'no sale ni deja fila agente (hace cumplir)'}`,
    observa
      ? r9.tipo === 'simulado' && enviosA(telEnVentana, desde).length === 1 && agentes9.length === agentesAntes + 1 && agentes9.every((m) => m.negocioId === ladera.id)
      : r9.tipo === 'no_salio' && enviosA(telEnVentana, desde).length === 0 && agentes9.length === agentesAntes,
    { r9, agentes9: agentes9.map((m) => m.negocioId) },
  )

  console.log('\n=== 5. Kapso caído, sin red ===')
  const aKapso: string[] = []
  const conKapsoCaido = async <T,>(f: () => Promise<T>): Promise<T> => {
    const fetchDeVerdad = globalThis.fetch
    const numero = process.env.KAPSO_PHONE_NUMBER_ID
    globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = entrada instanceof Request ? entrada.url : String(entrada)
      if (url.includes('api.kapso.ai')) {
        aKapso.push(url)
        throw new Error('probar-salida no llama a Kapso')
      }
      return fetchDeVerdad(entrada, init)
    }) as typeof fetch
    try {
      process.env.KAPSO_PHONE_NUMBER_ID = ''
      delete process.env.ENVIO_SIMULADO
      return await f()
    } finally {
      globalThis.fetch = fetchDeVerdad
      process.env.ENVIO_SIMULADO = '1'
      if (numero === undefined) delete process.env.KAPSO_PHONE_NUMBER_ID
      else process.env.KAPSO_PHONE_NUMBER_ID = numero
    }
  }
  const caida = intencion.respuesta({ destinatario: aEnVentana, texto: 'Con Kapso caído', enRespuestaA: w('k') })
  const agentesAntesDeLaCaida = (await agentesDe(enVentana.id)).length
  const erroresAntes = errores.length
  const r10 = await conKapsoCaido(() => despacharAnotada(caida))
  const fila10 = await filaDe(caida.clave)
  const errorDeLaCaida = errores.slice(erroresAntes).findIndex((e) => e.includes(caida.clave))
  if (errorDeLaCaida >= 0) errores.splice(erroresAntes + errorDeLaCaida, 1)
  afirmar('Kapso caído: nadie llamó a api.kapso.ai', aKapso.length === 0, aKapso)
  afirmar('Kapso caído: no quedó fila agente en mensajes_cliente', (await agentesDe(enVentana.id)).length === agentesAntesDeLaCaida)
  if (observa) {
    afirmar('Kapso caído: despachar devuelve por_enviar y la fila queda por_enviar con el error', r10.tipo === 'por_enviar' && fila10?.estado === 'por_enviar' && !!fila10.error && fila10.error === r10.error, { r10, fila10 })
    afirmar('Kapso caído: despachar escribió un console.error con la clave', errorDeLaCaida >= 0, errores.slice(erroresAntes))
  } else {
    afirmar('Kapso caído: sin número, la compuerta frena con numero_no_permitido', r10.tipo === 'no_salio' && r10.motivo === 'numero_no_permitido' && fila10?.estado === 'no_salio', { r10, fila10 })
  }
  desde = envios.length
  const r11 = await despacharAnotada(caida)
  afirmar(
    `Kapso caído: la misma intención otra vez devuelve ${observa ? 'por_enviar' : 'no_salio'} desde lo guardado y no sale nada`,
    (observa ? r11.tipo === 'por_enviar' && r11.error === fila10?.error : r11.tipo === 'no_salio') && enviosA(telEnVentana, desde).length === 0,
    { r11, envios: enviosA(telEnVentana, desde) },
  )

  console.log('\n=== 6. enviarAlCliente sobre despachar ===')
  desde = envios.length
  const agentesAntesDelCaso = (await agentesDe(enVentana.id)).length
  const salio = await enviarAlCliente(enVentana.id, 'Respuesta del Dueño a un Caso')
  const resoluciones = await db
    .select()
    .from(esquema.mensajesSalientes)
    .where(and(eq(esquema.mensajesSalientes.clienteId, enVentana.id), eq(esquema.mensajesSalientes.negocioId, ladera.id), eq(esquema.mensajesSalientes.clase, 'resolucion_de_caso')))
  afirmar('enviarAlCliente: en ventana sale una vez y deja su fila agente', salio.wamid === null && enviosA(telEnVentana, desde).length === 1 && (await agentesDe(enVentana.id)).length === agentesAntesDelCaso + 1, salio)
  afirmar('enviarAlCliente: queda como resolucion_de_caso sin Caso, con veredicto sale', resoluciones.length === 1 && resoluciones[0].veredicto === 'sale' && resoluciones[0].casoId === null, resoluciones)
  desde = envios.length
  const rechazo = await enviarAlCliente(vencido.id, 'Esto no debe salir').then(
    () => undefined,
    (e: unknown) => e,
  )
  afirmar('enviarAlCliente: fuera de la ventana lanza ErrorDeEnvio fuera_de_ventana y no sale nada', rechazo instanceof ErrorDeEnvio && rechazo.codigo === 'fuera_de_ventana' && enviosA(telVencido, desde).length === 0, rechazo)
  const sinCliente = await enviarAlCliente(randomUUID(), 'A nadie').then(
    () => undefined,
    (e: unknown) => e,
  )
  afirmar('enviarAlCliente: un Cliente que no existe lanza ErrorDeEnvio sin_cliente', sinCliente instanceof ErrorDeEnvio && sinCliente.codigo === 'sin_cliente', sinCliente)
} catch (e) {
  afirmar('probar-salida terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-salida borró lo que creó', false, e))
  afirmar('probar-salida no registró errores', errores.length === 0, errores)
  terminar()
}
