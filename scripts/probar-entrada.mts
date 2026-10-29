/**
 * La entrada: la lectura del webhook, la ficha del link, la tabla de `elegirReparto` y el reparto contra Neon.
 * Sin modelo: los casos contra la base llaman a `repartir`, que no atiende, o a `recibirMensaje` con teléfonos
 * sin Negocio, un segundo código o un Negocio armando, que no llegan al Agente de clientes. Lo que la corrida
 * crea se borra al final.
 *
 *   pnpm tsx scripts/probar-entrada.mts
 */
import { config } from 'dotenv'
import { and, eq, gte, inArray, like } from 'drizzle-orm'
import { afirmar, capturarEnvios, capturarErrores, eventoDeKapso, terminar } from './afirmar.mjs'
import type { HechosDelReparto } from '../src/nucleo/entrada'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const errores = capturarErrores()

const { db, esquema } = await import('../src/db')
const { elegirReparto, FICHA_DE_ENRUTAMIENTO, leerMensajeEntrante, linkDeWhatsapp, recibirMensaje, repartir } = await import('../src/nucleo/entrada')
const { marcar } = await import('../src/nucleo/identidad')

const inicio = new Date()
const marca = String(Date.now()).slice(-8)
const prefijo = `wamid.ENTRADA.${marca}.`
const telConSesion = `5720${marca}`
const telNuevo = `5721${marca}`
const telSinNegocio = `5722${marca}`
const telDeBoton = `5723${marca}`
const telDelArmando = `5724${marca}`
const telefonos = [telConSesion, telNuevo, telSinNegocio, telDeBoton, telDelArmando]
const codigoArmando = `PR${marca}`
let armandoId: string | undefined

async function limpiar() {
  await db.delete(esquema.sesionesWhatsapp).where(inArray(esquema.sesionesWhatsapp.telefono, telefonos))
  await db.delete(esquema.mensajesSalientes).where(and(inArray(esquema.mensajesSalientes.telefono, telefonos), gte(esquema.mensajesSalientes.creado, inicio)))
  await db.delete(esquema.mensajesEntrantes).where(like(esquema.mensajesEntrantes.wamid, `${prefijo}%`))
  await db.delete(esquema.clientes).where(and(inArray(esquema.clientes.telefono, telefonos), gte(esquema.clientes.creado, inicio)))
  if (armandoId) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, armandoId))
}

try {
  console.log('\n=== 1. leerMensajeEntrante ===')
  const enviadoEn = new Date('2026-10-28T14:00:00Z')
  const recibidoEn = new Date('2026-10-28T14:00:07Z')
  const texto = leerMensajeEntrante(eventoDeKapso({ wamid: 'w.1', telefono: '+57 300 000 0001', texto: ' (LADERA) Hola ', nombre: 'Camila', enviadoEn }), recibidoEn)
  afirmar('lectura: un texto lleva el timestamp de Meta, no la hora de llegada', texto?.enviadoEn === enviadoEn.toISOString(), texto)
  afirmar('lectura: teléfono solo con dígitos, texto sin espacios a los lados, nombre, sin botón', texto?.telefono === '573000000001' && texto.texto === '(LADERA) Hola' && texto.nombre === 'Camila' && texto.boton === null, texto)
  const boton = leerMensajeEntrante(eventoDeKapso({ wamid: 'w.2', telefono: '573000000001', texto: 'Aplicar', boton: 'aprobar:p1:h1' }), recibidoEn)
  afirmar('lectura: un botón interactivo trae su id aparte del título', boton?.boton === 'aprobar:p1:h1' && boton.texto === 'Aplicar', boton)
  const plantilla = leerMensajeEntrante({ message: { id: 'w.3', from: '573000000001', timestamp: '1761663600', type: 'button', button: { text: 'Sí', payload: 'confirmar:9' } } }, recibidoEn)
  afirmar('lectura: el botón de una plantilla trae su payload, y la raíz sin data se lee igual', plantilla?.boton === 'confirmar:9' && plantilla.texto === 'Sí', plantilla)
  const sinHora = leerMensajeEntrante({ message: { id: 'w.4', from: '573000000001', type: 'text', text: { body: 'hola' } } }, recibidoEn)
  afirmar('lectura: sin timestamp de Meta usa la hora de llegada', sinHora?.enviadoEn === recibidoEn.toISOString(), sinHora)
  afirmar('lectura: un recibo de entrega no es un mensaje', leerMensajeEntrante({ message: { id: 'w.5', from: '573000000001', type: 'text', text: { body: 'x' }, kapso: { status: 'delivered' } } }) === null)
  afirmar('lectura: un mensaje a otro número no es de Amanece', leerMensajeEntrante({ phone_number_id: 'otro-numero', message: { id: 'w.6', from: '573000000001', type: 'text', text: { body: 'x' } } }) === null)
  afirmar('lectura: una imagen sin texto no es un mensaje', leerMensajeEntrante({ message: { id: 'w.7', from: '573000000001', type: 'image', image: { id: 'm1' } } }) === null)

  console.log('\n=== 2. La ficha ===')
  const textoDelLink = (url: string) => new URL(url).searchParams.get('text') ?? ''
  for (const codigo of ['LADERA', 'TRIGO', 'BCDFG', 'BCDFGH']) {
    const leido = FICHA_DE_ENRUTAMIENTO.exec(textoDelLink(linkDeWhatsapp('Un Negocio', codigo)))?.[1]
    afirmar(`ficha: el link de ${codigo} se lee de vuelta como ${codigo}`, leido === codigo, leido)
  }
  for (const t of ['quiero pan de trigo', 'Hola Café Ladera (LADERA)', 'hola (TRIGO)', '(trigo) hola', 'LADERA hola']) {
    afirmar(`ficha: "${t}" no enruta`, FICHA_DE_ENRUTAMIENTO.exec(t) === null)
  }

  console.log('\n=== 3. elegirReparto ===')
  const a = { id: marcar.negocio('00000000-0000-4000-8000-00000000000a'), nombre: 'Café Ladera' }
  const b = { id: marcar.negocio('00000000-0000-4000-8000-00000000000b'), nombre: 'Panadería Trigo y Leña' }
  const duenoDeA = { negocio: a.id, dueno: marcar.dueno('00000000-0000-4000-8000-0000000000d1'), medio: 'whatsapp' } as const
  const nada: HechosDelReparto = { dueno: null, ficha: null, actual: null }
  const TABLA: { caso: string; h: Partial<HechosDelReparto>; reparto: string; sesion: string }[] = [
    { caso: 'Dueño sin ficha → su Hilo', h: { dueno: duenoDeA }, reparto: 'dueno', sesion: 'igual' },
    { caso: 'Dueño con la ficha de su Negocio → su Hilo', h: { dueno: duenoDeA, ficha: a }, reparto: 'dueno', sesion: 'igual' },
    { caso: 'Dueño de A con la ficha de B y sin sesión → Cliente de B', h: { dueno: duenoDeA, ficha: b }, reparto: 'cliente:b', sesion: 'b' },
    { caso: 'Dueño de A que es Cliente de B, sin ficha → su Hilo, no B', h: { dueno: duenoDeA, actual: b }, reparto: 'dueno', sesion: 'igual' },
    { caso: 'ficha sin sesión → Cliente de la ficha', h: { ficha: b }, reparto: 'cliente:b', sesion: 'b' },
    { caso: 'ficha del Negocio actual → Cliente del actual', h: { ficha: a, actual: a }, reparto: 'cliente:a', sesion: 'igual' },
    { caso: 'segundo código → se pregunta y no se muda', h: { ficha: b, actual: a }, reparto: 'preguntar:otro_negocio:a→b', sesion: 'igual' },
    { caso: 'sin ficha con sesión → Cliente del actual', h: { actual: a }, reparto: 'cliente:a', sesion: 'igual' },
    { caso: 'sin ficha ni sesión → se pregunta', h: {}, reparto: 'preguntar:sin_negocio', sesion: 'igual' },
  ]
  const letra = (id: string) => (id === a.id ? 'a' : id === b.id ? 'b' : id)
  for (const f of TABLA) {
    const { reparto, sesion } = elegirReparto({ ...nada, ...f.h }, null)
    const r =
      reparto.tipo === 'cliente'
        ? `cliente:${letra(reparto.negocio)}`
        : reparto.tipo === 'preguntar'
          ? reparto.por === 'otro_negocio'
            ? `preguntar:otro_negocio:${letra(reparto.actual.id)}→${letra(reparto.nuevo.id)}`
            : 'preguntar:sin_negocio'
          : reparto.tipo
    const s = sesion === null ? 'igual' : letra(sesion)
    afirmar(`reparto · ${f.caso}`, r === f.reparto && s === f.sesion, { reparto: r, sesion: s })
  }
  const conBoton = elegirReparto({ ...nada, dueno: duenoDeA }, 'aprobar:p1:h1').reparto
  afirmar('reparto: el botón del Dueño viaja en su reparto', conBoton.tipo === 'dueno' && conBoton.boton === 'aprobar:p1:h1', conBoton)

  console.log('\n=== 4. repartir y recibirMensaje contra Neon (envío simulado) ===')
  const [ladera] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'LADERA'))
  const [trigo] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.codigo, 'TRIGO'))
  if (!ladera || !trigo) throw new Error('Falta sembrar LADERA y TRIGO: pnpm tsx scripts/sembrar.mts')
  const [armando] = await db.insert(esquema.negocios).values({ nombre: 'Negocio armando (prueba)', codigo: codigoArmando, estado: 'armando' }).returning()
  armandoId = armando.id

  let n = 0
  const entrante = (telefono: string, texto: string, extra: { wamid?: string; enviadoEn?: Date; boton?: string } = {}) =>
    leerMensajeEntrante(eventoDeKapso({ wamid: extra.wamid ?? `${prefijo}${++n}`, telefono, texto, enviadoEn: extra.enviadoEn, boton: extra.boton }))!
  const sesionDe = async (telefono: string) => (await db.select().from(esquema.sesionesWhatsapp).where(eq(esquema.sesionesWhatsapp.telefono, telefono)))[0]?.negocioId ?? null
  const enviosA = (tel: string, desde: number) => envios.slice(desde).filter((e) => e.telefono === tel)
  const fichasDe = (telefono: string) => db.$count(esquema.clientes, eq(esquema.clientes.telefono, telefono))

  await db.insert(esquema.sesionesWhatsapp).values({ telefono: telConSesion, negocioId: ladera.id })
  let r = await repartir(entrante(telConSesion, 'quiero pan de TRIGO'))
  afirmar('repartir: con sesión en LADERA, un código suelto en el texto no la muda', r.tipo === 'cliente' && r.negocio === ladera.id && (await sesionDe(telConSesion)) === ladera.id, r)
  r = await repartir(entrante(telConSesion, '(XXXXXX) hola'))
  afirmar('repartir: una ficha que no es de nadie cuenta como sin ficha', r.tipo === 'cliente' && r.negocio === ladera.id, r)

  r = await repartir(entrante(telNuevo, 'Hola Café Ladera (LADERA)'))
  afirmar('repartir: el link viejo, con el código al final, no enruta', r.tipo === 'preguntar' && r.por === 'sin_negocio' && (await sesionDe(telNuevo)) === null, r)
  r = await repartir(entrante(telNuevo, '(TRIGO) hola'))
  afirmar('repartir: la ficha sin sesión enruta y guarda la sesión', r.tipo === 'cliente' && r.negocio === trigo.id && (await sesionDe(telNuevo)) === trigo.id, r)
  for (const vez of ['primera', 'segunda']) {
    r = await repartir(entrante(telNuevo, '(LADERA) hola'))
    afirmar(
      `repartir: un segundo código, la ${vez} vez, pregunta y la sesión sigue en TRIGO`,
      r.tipo === 'preguntar' && r.por === 'otro_negocio' && r.actual.id === trigo.id && r.nuevo.id === ladera.id && (await sesionDe(telNuevo)) === trigo.id,
      r,
    )
  }

  let desde = envios.length
  const otro = entrante(telNuevo, '(LADERA) quiero café')
  await recibirMensaje(otro)
  const avisoOtro = enviosA(telNuevo, desde)
  afirmar('recibirMensaje: un segundo código recibe un aviso con los dos nombres', avisoOtro.length === 1 && avisoOtro[0].texto.includes(trigo.nombre) && avisoOtro[0].texto.includes(ladera.nombre), avisoOtro)
  const [filaOtro] = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, otro.wamid))
  afirmar('recibirMensaje: ese aviso queda a nombre del Negocio actual, sin ficha de Cliente nueva', filaOtro?.clase === 'aviso_del_nucleo' && filaOtro.negocioId === trigo.id && (await fichasDe(telNuevo)) === 0, filaOtro)

  const deMeta = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
  const sinNegocio = entrante(telSinNegocio, 'Hola', { enviadoEn: deMeta })
  desde = envios.length
  await recibirMensaje(sinNegocio)
  await recibirMensaje(sinNegocio)
  afirmar('recibirMensaje: sin Negocio, el mismo wamid dos veces da un solo aviso', enviosA(telSinNegocio, desde).length === 1, enviosA(telSinNegocio, desde))
  const entrantes = await db.select().from(esquema.mensajesEntrantes).where(eq(esquema.mensajesEntrantes.wamid, sinNegocio.wamid))
  const salientes = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, sinNegocio.wamid))
  afirmar('recibirMensaje: queda una fila en mensajes_entrantes y una en mensajes_salientes para ese wamid', entrantes.length === 1 && salientes.length === 1, { entrantes, salientes })
  afirmar('recibirMensaje: mensajes_entrantes guarda el timestamp de Meta como enviado_en', entrantes[0]?.enviadoEn.getTime() === deMeta.getTime(), entrantes[0])
  afirmar('recibirMensaje: sin Negocio no se crea ficha de Cliente ni sesión', (await fichasDe(telSinNegocio)) === 0 && (await sesionDe(telSinNegocio)) === null)

  const deBoton = entrante(telDeBoton, 'Aplicar', { boton: 'aprobar:p1:h1' })
  await recibirMensaje(deBoton)
  const [filaBoton] = await db.select().from(esquema.mensajesEntrantes).where(eq(esquema.mensajesEntrantes.wamid, deBoton.wamid))
  afirmar('recibirMensaje: el id del botón queda en mensajes_entrantes', filaBoton?.boton === 'aprobar:p1:h1', filaBoton)

  desde = envios.length
  const alArmando = entrante(telDelArmando, `(${codigoArmando}) hola`)
  await recibirMensaje(alArmando)
  const [filaArmando] = await db.select().from(esquema.mensajesSalientes).where(eq(esquema.mensajesSalientes.enRespuestaA, alArmando.wamid))
  afirmar('recibirMensaje: un Negocio armando manda su aviso, una vez', enviosA(telDelArmando, desde).length === 1, enviosA(telDelArmando, desde))
  afirmar('recibirMensaje: ese aviso queda a nombre del Negocio armando, sin ficha de Cliente', filaArmando?.clase === 'aviso_del_nucleo' && filaArmando.negocioId === armando.id && filaArmando.clienteId === null && (await fichasDe(telDelArmando)) === 0, filaArmando)
} catch (e) {
  afirmar('probar-entrada terminó sin error inesperado', false, e)
} finally {
  await limpiar().catch((e) => afirmar('probar-entrada borró lo que creó', false, e))
  afirmar('probar-entrada no registró errores', errores.length === 0, errores)
  terminar()
}
