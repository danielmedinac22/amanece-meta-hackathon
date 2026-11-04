/**
 * Las citas, contra la base de pruebas y con el envío simulado. Afirma filas y lo que se habría enviado, nunca el texto
 * del modelo. Los turnos van con guion. Lo que la corrida crea se borra al final.
 *
 *   pnpm tsx scripts/probar-citas.mts
 *   pnpm tsx scripts/probar-citas.mts --modelo [vueltas]   mide a Muse Spark y dice sus números; no afirma su texto
 */
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { afirmar, capturarEnvios, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()

const { db, esquema } = await import('../src/db')
const { marcar } = await import('../src/nucleo/identidad')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { tomar } = await import('../src/nucleo/clientes/toma')
const { RESPALDO, entornoDeEnsayo, turno } = await import('../src/nucleo/clientes/turno')
const { cancelarCita, guardarCita, leerAgenda, leerCitasDelTablero } = await import('../src/nucleo/citas')
const { calendarioParaElPrompt, constanciaDe, enPalabras, estadoVisibleDeCita, fechaDeCalendario, instanteLocal, resolverHora } = await import('../src/nucleo/citas-palabras')
const { leerCifras, leerHoy } = await import('../src/nucleo/hoy')
const { fraseDeHoy, vozDelRubro } = await import('../src/nucleo/hoy-palabras')
const { leerPublicado } = await import('../src/nucleo/estado')
const { leerTablero } = await import('../src/nucleo/tablero')
const { tarjetasDelTablero } = await import('../src/nucleo/tablero-palabras')
const { comoClave, comoMonto } = await import('../src/nucleo/estado/elementos')
const { PARTIDAS } = await import('../src/nucleo/plantillas')
const { PLANTILLAS } = await import('../src/app/plantillas-datos')
const { aceptoUnaHora, hablaDeUnaHora, revisar, HECHOS_DE_PRUEBA } = await import('../src/nucleo/salida/revisar')
type Motores = import('../src/nucleo/clientes/turno').Motores
type Hechos = import('../src/nucleo/salida/revisar').HechosDeRevision
type CitaEnRevision = import('../src/nucleo/salida/revisar').CitaEnRevision
type PuertoParaElModelo = import('../src/nucleo/clientes/acciones').PuertoParaElModelo

const marca = String(Date.now()).slice(-8)
const SIN_USO = { inputTokens: 0, outputTokens: 0 }
const creados: string[] = []
let n = 0

const texto = (partes: ReturnType<typeof fraseDeHoy>) => partes.map((p) => (typeof p === 'string' ? p : p.cifra)).join('')

function probarElTiempo() {
  const hora = (fecha: string, h: string, zona: string) => instanteLocal({ fecha, hora: h }, zona)?.toISOString()
  afirmar('Zona: 15:00 en Bogotá son las 20:00 UTC', hora('2026-11-05', '15:00', 'America/Bogota') === '2026-11-05T20:00:00.000Z')
  afirmar('Zona: 15:00 en México son las 21:00 UTC', hora('2026-11-05', '15:00', 'America/Mexico_City') === '2026-11-05T21:00:00.000Z')
  afirmar('Zona: 15:00 en Santiago en noviembre son las 18:00 UTC', hora('2026-11-05', '15:00', 'America/Santiago') === '2026-11-05T18:00:00.000Z')
  afirmar('Zona: una hora que se salta el reloj en Santiago no existe', instanteLocal({ fecha: '2026-09-06', hora: '00:30' }, 'America/Santiago') === null)
  afirmar('Zona: una hora que se repite en Santiago es la primera', hora('2027-04-03', '23:30', 'America/Santiago') === '2027-04-04T02:30:00.000Z')

  const ahora = new Date('2026-11-05T20:00:00.000Z')
  const negada = (fecha: string, h: string, zona = 'America/Bogota') => {
    const r = resolverHora({ fecha, hora: h }, zona, ahora)
    return 'negada' in r ? r.negada : null
  }
  afirmar('Hora: pasada, también la de este mismo instante', negada('2026-11-05', '15:00') === 'pasada' && negada('2026-11-04', '15:00') === 'pasada')
  afirmar('Hora: la siguiente en el cupo vale', negada('2026-11-05', '15:30') === null)
  afirmar('Hora: fuera del cupo', negada('2026-11-06', '15:10') === 'fuera_de_cupo')
  afirmar('Hora: 30 de febrero no existe', negada('2027-02-30', '15:00') === 'mal_escrita')
  afirmar('Hora: 25:00 no existe', negada('2026-11-06', '25:00') === 'mal_escrita')
  afirmar('Hora: escrita de otra forma', negada('6 de noviembre', '3 pm') === 'mal_escrita')
  afirmar('Hora: más de 60 días', negada('2027-02-01', '15:00') === 'muy_lejos')
  afirmar('Hora: lo que se salta el reloj', negada('2026-09-06', '00:30', 'America/Santiago') === 'inexistente')

  const jueves = new Date('2026-11-05T20:00:00.000Z')
  afirmar('Palabras: jueves 5 de noviembre, 3:00 p. m.', enPalabras(jueves, 'America/Bogota') === 'jueves 5 de noviembre, 3:00 p. m.', enPalabras(jueves, 'America/Bogota'))
  afirmar('Palabras: la misma hora en otra zona dice otra cosa', enPalabras(jueves, 'Asia/Tokyo') === 'viernes 6 de noviembre, 5:00 a. m.', enPalabras(jueves, 'Asia/Tokyo'))
  afirmar('Constancia: agendada', constanciaDe({ tipo: 'agendada', inicio: jueves, antes: null }, 'America/Bogota') === 'Cita agendada: jueves 5 de noviembre, 3:00 p. m.')
  afirmar('Constancia: movida dice la de antes', constanciaDe({ tipo: 'movida', inicio: new Date('2026-11-06T14:00:00.000Z'), antes: jueves }, 'America/Bogota') === 'Cita movida: viernes 6 de noviembre, 9:00 a. m. (antes jueves 5 de noviembre, 3:00 p. m.).')
  afirmar('Constancia: cancelada', constanciaDe({ tipo: 'cancelada', inicio: jueves, antes: null }, 'America/Bogota') === 'Cita cancelada: jueves 5 de noviembre, 3:00 p. m.')

  const calendario = calendarioParaElPrompt([jueves], 'America/Bogota', new Date('2026-11-05T12:00:00.000Z'))
  afirmar('Calendario: catorce días', calendario.split('\n').length === 14)
  afirmar('Calendario: la fecha que se copia y lo ocupado, en la hora del Negocio', calendario.split('\n')[0] === '- jueves 5 de noviembre (2026-11-05): ocupadas 15:00', calendario.split('\n')[0])
  afirmar('Calendario: un día libre lo dice', calendario.split('\n')[1] === '- viernes 6 de noviembre (2026-11-06): nada ocupado', calendario.split('\n')[1])

  const pasada = new Date('2026-11-05T12:00:00.000Z')
  const futura = new Date('2026-11-07T12:00:00.000Z')
  afirmar('Estado: una agendada', estadoVisibleDeCita({ estado: 'agendada', inicio: futura, movidaDe: null }, ahora) === 'Agendada')
  afirmar('Estado: una movida', estadoVisibleDeCita({ estado: 'agendada', inicio: futura, movidaDe: pasada }, ahora) === 'Movida')
  afirmar('Estado: una agendada cuya hora pasó no dice agendada', estadoVisibleDeCita({ estado: 'agendada', inicio: pasada, movidaDe: null }, ahora) === 'Ya pasó')
  afirmar('Estado: una cancelada, aunque su hora venga', estadoVisibleDeCita({ estado: 'cancelada', inicio: futura, movidaDe: null }, ahora) === 'Cancelada')

  afirmar('Rubro: unas velas no son una agenda', vozDelRubro('Vendo unas velas') === 'tienda')
  afirmar('Rubro: salón de uñas sigue siendo agenda', vozDelRubro('Salón de uñas') === 'agenda' && vozDelRubro('uñas') === 'agenda')
  afirmar('Plantilla: no deja la regla que frenaría una respuesta honesta', PARTIDAS.agenda.reglas.length === 0)
  afirmar('Plantilla: dice que no manda recordatorios ni cobra', /no mando recordatorios ni cobro/i.test(PARTIDAS.agenda.primero), PARTIDAS.agenda.primero)
  afirmar('Plantilla: la tarjeta no promete lo que no existe', !/recuerd|cobr|calendario/i.test(PLANTILLAS.find((p) => p.id === 'agenda')!.promesa))
  afirmar('Rubro: lo que el Dueño dice de su agenda se reconoce', ['salón de belleza', 'terapia física', 'abogada', 'yoga', 'servicios con agenda'].every((r) => vozDelRubro(r) === 'agenda'))
}

function probarElDetector() {
  const JUEVES_3 = { diaDeSemana: 'jueves', diaDelMes: 5, relativo: null, minutos: 180 } as const
  const sin = (acepto = false): CitaEnRevision => ({ tipo: 'con_agenda', vigente: null, antes: null, escritaEnElTurno: false, aceptoUnaHora: acepto })
  const tiene: CitaEnRevision = { tipo: 'con_agenda', vigente: JUEVES_3, antes: null, escritaEnElTurno: false, aceptoUnaHora: false }
  const recien: CitaEnRevision = { tipo: 'con_agenda', vigente: JUEVES_3, antes: null, escritaEnElTurno: true, aceptoUnaHora: false }
  const movida: CitaEnRevision = { tipo: 'con_agenda', vigente: { ...JUEVES_3, diaDeSemana: 'viernes', diaDelMes: 6, minutos: 240 }, antes: JUEVES_3, escritaEnElTurno: true, aceptoUnaHora: false }
  const cancelo: CitaEnRevision = { tipo: 'con_agenda', vigente: null, antes: null, escritaEnElTurno: true, aceptoUnaHora: false }
  const tienda: CitaEnRevision = { tipo: 'sin_agenda' }
  const frena = (frase: string, cita: CitaEnRevision) => {
    const h: Hechos = { ...HECHOS_DE_PRUEBA, cita }
    const r = revisar(frase, h)
    return r.tipo === 'corregir' && r.motivos.includes('cita_sin_respaldo')
  }
  const dispara: [string, CitaEnRevision][] = [
    ['Listo, te agendé para el viernes a las 3', sin()],
    ['Sí te agendé para el viernes', sin()],
    ['Te reservé el jueves a las 3', sin()],
    ['Le agendé la cita del jueves', sin()],
    ['Ya agendé tu cita para el jueves', sin()],
    ['Te guardé el cupo del jueves', sin()],
    ['Ya te cuadré el jueves', sin()],
    ['Ya estás anotada para el jueves', sin()],
    ['La esperamos el jueves', sin()],
    ['Dale, te espero mañana a las 9', sin()],
    ['Hágale, quedó para las 4', sin()],
    ['Listo, nos vemos el jueves', sin()],
    ['Todo listo, vente el jueves', sin()],
    ['Dale, el viernes a las 4', sin()],
    ['Te cambié la cita para el viernes', sin()],
    ['Te corrí la cita para el viernes', sin()],
    ['Listo, cancelada', tiene],
    ['Ya no tienes cita', tiene],
    ['Te pasé para el viernes a las 10', tiene],
    ['Quedó para el viernes a las 4', tiene],
    ['Listo, te agendé el jueves a las 5', recien],
    ['Ya quedó tu cita', tiene],
    ['Ya cancelé tu cita', tiene],
    ['No te preocupes, ya te agendé', sin()],
    ['Listo, te agendé, si quieres algo más me escribes', sin()],
    ['Listo, tu cita quedó agendada, ¿necesitas algo más?', sin()],
    ['Listo, te agendé para el jueves a las 3 ¿vale?', sin()],
    ['Listo, tu cita quedó agendada, ¿te sirve algo más?', sin(true)],
    ['Te agendé el jueves a las 3 y no pagas nada', sin()],
    ['Para que estés tranquila, te agendé el jueves a las 3', sin()],
    ['Te espero el jueves a las 3', tienda],
    ['Te reservé el jueves a las 3', tienda],
    ['Tu cita quedó confirmada', tienda],
  ]
  for (const [frase, cita] of dispara) afirmar(`Detector frena: ${frase}`, frena(frase, cita))
  const pasa: [string, CitaEnRevision][] = [
    ['¿Te sirve el jueves a las 3?', sin()],
    ['Tengo el jueves a las 3 o el viernes a las 10, me cuenta', sin()],
    ['Tengo libre el jueves a las 3 y a las 4. ¿Cuál prefieres?', sin()],
    ['El jueves a las 3 está libre. ¿Te sirve?', sin()],
    ['Atendemos de 8 a 5, de lunes a sábado', sin()],
    ['Estamos abiertos hasta las 6', sin()],
    ['Todavía no te he agendado nada', sin()],
    ['No alcancé a guardar la cita', sin()],
    ['Si me confirmas, te dejo agendada', sin()],
    ['Esa hora ya está ocupada, ¿te sirve a las 4?', sin(true)],
    ['Tu cita es el jueves a las 3', tiene],
    ['Te espero el jueves a las 3', tiene],
    ['Ya tienes cita el jueves a las 3. ¿Quieres cambiarla por esta?', tiene],
    ['Tuve un problema guardando la cita y ya se lo pasé al equipo', sin()],
    ['Listo, Felipe.', recien],
    ['Perfecto, nos vemos entonces', recien],
    ['Te esperamos el jueves en la mañana a las 3', recien],
    ['Te pasé del jueves a las 3 al viernes a las 4', movida],
    ['Listo, ya la cancelé', cancelo],
    ['Tu cita quedó cancelada', cancelo],
    ['Claro, ¿para qué servicio y qué día quieres venir?', sin()],
    ['El corte vale $38.000', sin()],
    ['Tu pedido quedó confirmado', sin()],
    ['Listo, tu pedido quedó confirmado', sin()],
    ['Pedido #12 confirmado', tiene],
    ['Tu pedido quedó cancelado', sin()],
    ['El consultorio cuenta con parqueadero', sin()],
    ['El local cuenta con parqueadero', tiene],
    ['Quedamos en el centro', sin()],
    ['Queda a la vuelta del parque', sin()],
    ['El consultorio queda en el Edificio Centro', sin()],
    ['Quedo atento para lo que necesites', sin()],
    ['Estamos en la 10, te esperamos', sin()],
    ['El doctor llega a las 3', sin()],
    ['Los domingos empezamos a las 9', sin()],
    ['Déjame confirmarlo con el equipo del negocio y te cuento por aquí.', sin(true)],
  ]
  for (const [frase, cita] of pasa) afirmar(`Detector deja pasar: ${frase}`, !frena(frase, cita))

  // La línea cierta: lo que el detector deja pasar y puede sonar a cita. Equivocarse aquí cuesta una línea de más.
  const agregaLinea: [string, CitaEnRevision][] = [
    ['Cuadrado, nos pillamos el viernes', sin()],
    ['Todo bien para el jueves a las 3', sin()],
    ['Cuenta con eso', sin(true)],
    ['Perfecto, gracias', sin(true)],
    ['Dale', sin(true)],
    ['Tu cita es el viernes a las 4', tiene],
    ['El doctor llega a las 3', sin()],
  ]
  for (const [frase, cita] of agregaLinea) afirmar(`Línea cierta se agrega: ${frase}`, hablaDeUnaHora(frase, cita))
  const sinLinea: [string, CitaEnRevision][] = [
    ['¿Te sirve el jueves a las 3?', sin()],
    ['Tengo el jueves a las 3 o el viernes a las 10, me cuenta', sin()],
    ['El jueves a las 3 está libre. ¿Te sirve?', sin()],
    ['Atendemos de 8 a 5, de lunes a sábado', sin()],
    ['El corte vale $38.000', sin()],
    ['Hola, ¿qué servicio buscas?', sin()],
    ['¿Te confirmo esa hora?', sin(true)],
    ['Esa hora ya está ocupada', sin(true)],
    ['Tu cita es el jueves a las 3', tiene],
    ['Listo, te agendé el jueves a las 3', recien],
    ['Nos vemos el jueves', tienda],
  ]
  for (const [frase, cita] of sinLinea) afirmar(`Línea cierta no hace falta: ${frase}`, !hablaDeUnaHora(frase, cita))

  const acepta = (dijo: string, antes = '¿Te sirve el jueves a las 3?') => aceptoUnaHora([{ rol: 'agente', texto: antes }], dijo)
  afirmar('Acepta: sí, dale, uy sí, sisas, está bien, melo', ['sí', 'Dale', 'uy sí', 'sisas', 'está bien', 'melo', 'De una'].every((d) => acepta(d)))
  afirmar('Acepta: un sí con otra pregunta no acepta la hora', !acepta('Sí, ¿y cuánto vale?'))
  afirmar('Acepta: un sí a algo que no era una hora no cuenta', !acepta('sí', '¿Quieres saber el precio?'))
}

const guion = (responder: Motores['responder'] | string, reescribir: string | null = null) => {
  const llamadas = { responder: 0, reescribir: 0 }
  const motores: Motores = {
    async responder(e) {
      llamadas.responder++
      return typeof responder === 'string' ? { texto: responder, uso: SIN_USO } : responder(e)
    },
    async reescribir() {
      llamadas.reescribir++
      if (reescribir === null) throw new Error('el guion no esperaba una corrección')
      return { texto: reescribir, uso: SIN_USO }
    },
  }
  return { motores, llamadas }
}

const claveDeServicio = comoClave('producto:corte')

async function negocioNuevo(sufijo: string, rubro = 'barbería', zonaHoraria = 'America/Bogota') {
  const [neg] = await db.insert(esquema.negocios).values({ nombre: `Barbería Cita ${sufijo}${marca}`, codigo: `CIT${sufijo}${marca}`, rubro, zonaHoraria, estado: 'listo', version: 1 }).returning()
  creados.push(neg.id)
  await db.insert(esquema.elementos).values({ negocioId: neg.id, clave: 'dato:horario', version: 1, tipo: 'dato', contrato: 1, contenido: { tipo: 'dato', campo: 'horario', valor: 'Todos los días de 8 a 18' }, origen: 'tablas_viejas', sinPublicar: false })
  await db.insert(esquema.elementos).values({ negocioId: neg.id, clave: claveDeServicio, version: 2, tipo: 'producto', contrato: 1, contenido: { tipo: 'producto', nombre: 'Corte', descripcion: 'Corte de cabello', precio: comoMonto(30_000), activo: true }, origen: 'tablas_viejas', sinPublicar: false })
  return { id: marcar.negocio(neg.id), zonaHoraria }
}

async function clienteNuevo(negocio: string, nombre = 'Camila') {
  const telefono = `59${marca}${String(++n).padStart(3, '0')}`
  const [c] = await db.insert(esquema.clientes).values({ negocioId: negocio, nombre, telefono, ultimoMensajeEntrante: new Date(Date.now() - 60_000) }).returning()
  return { ...c, id: marcar.cliente(c.id) }
}

const mensaje = (telefono: string, texto = 'Quiero una cita') => ({ wamid: marcar.wamid(`wamid.CITA.${marca}.${++n}`), telefono, nombre: 'Camila', texto, enviadoEn: marcar.instante(new Date()), boton: null, referido: 'ninguno' as const })
const enviosA = (telefono: string, desde = 0) => envios.slice(desde).filter((e) => e.telefono === telefono)
const citasDe = (negocio: string) => db.select().from(esquema.citas).where(eq(esquema.citas.negocioId, negocio))
const vivasDe = (negocio: string) => db.select().from(esquema.citas).where(and(eq(esquema.citas.negocioId, negocio), eq(esquema.citas.estado, 'agendada')))
const casosDe = (negocio: string) => db.select().from(esquema.casos).where(eq(esquema.casos.negocioId, negocio))

/** Una fecha en el cupo de 10 de la mañana, tantos días después de hoy en la zona del Negocio. */
const diaEn = (dias: number, zona: string) => fechaDeCalendario(new Date(Date.now() + dias * 86_400_000), zona)
const pedido = (dias: number, zona: string, hora = '10:00', cambiaLaQueTiene = false) => ({ fecha: diaEn(dias, zona), hora, asunto: 'Corte', cambiaLaQueTiene })
const elInstante = (dias: number, zona: string, hora = '10:00') => instanteLocal({ fecha: diaEn(dias, zona), hora }, zona)!
const llama = (accion: (p: PuertoParaElModelo) => Promise<unknown>, dice = 'Listo, Camila.') => async (e: Parameters<Motores['responder']>[0]) => {
  await accion(e.puerto)
  return { texto: dice, uso: SIN_USO }
}

async function probarAgendar() {
  const N = await negocioNuevo('A')
  const z = N.zonaHoraria
  const c = await clienteNuevo(N.id)
  // Ticket: una cita agendada queda en la base y la frase de Inicio la cuenta.
  const enUnaHora = new Date(Date.now() + 90 * 60_000)
  const hora = `${new Intl.DateTimeFormat('en-CA', { timeZone: z, hourCycle: 'h23', hour: '2-digit' }).format(enUnaHora)}:00`
  const fecha = fechaDeCalendario(enUnaHora, z)
  const antes = envios.length
  const respuesta = { ok: false } as { ok: boolean }
  await atenderMensaje(mensaje(c.telefono), N.id, guion(async (e) => {
    Object.assign(respuesta, await e.puerto.guardar_cita({ fecha, hora, asunto: 'Corte', cambiaLaQueTiene: false }))
    return { texto: 'Listo, Camila.', uso: SIN_USO }
  }).motores)
  const [fila] = await citasDe(N.id)
  const esperado = instanteLocal({ fecha, hora }, z)!
  afirmar('Agendar: queda una fila, con su Cliente, su hora y su asunto', fila?.clienteId === c.id && fila.inicio.getTime() === esperado.getTime() && fila.estado === 'agendada' && fila.asunto === 'Corte' && fila.movidaDe === null, fila)
  afirmar('Agendar: al modelo le dice ok', respuesta.ok)
  const salida = enviosA(c.telefono, antes)
  afirmar('Agendar: sale un solo mensaje, y termina en la constancia de la fila', salida.length === 1 && salida[0].texto.startsWith('Listo, Camila.') && salida[0].texto.endsWith(constanciaDe({ tipo: 'agendada', inicio: fila.inicio, antes: null }, z)), salida)

  const hoy = await leerHoy(N.id, z, 'barbería')
  const lunes = new Date(`${fechaDeCalendario(new Date(Date.now() - ((new Date(`${fechaDeCalendario(new Date(), z)}T12:00:00Z`).getUTCDay() + 6) % 7) * 86_400_000), z)}T00:00:00Z`)
  const estaSemana = Date.parse(`${fecha}T00:00:00Z`) < lunes.getTime() + 7 * 86_400_000
  const hoyLocal = fecha === fechaDeCalendario(new Date(), z)
  afirmar('Inicio: la voz es de agenda', hoy.voz === 'agenda')
  afirmar('Inicio: las cifras cuentan la fila', hoy.cifras.citas.semana === (estaSemana ? 1 : 0) && hoy.cifras.citas.hoy === (hoyLocal ? 1 : 0), hoy.cifras.citas)
  if (estaSemana) afirmar('Inicio: la frase cuenta la cita', texto(fraseDeHoy(hoy.voz, hoy.cifras)).startsWith(`Esta semana tienes 1 cita${hoyLocal ? ', 1 hoy' : ''}.`), texto(fraseDeHoy(hoy.voz, hoy.cifras)))
  afirmar('Inicio: lo último dice la cita, sin inventar', hoy.ultimo.some((u) => u.texto === `Tu agente le agendó una cita a Camila: ${enPalabras(fila.inicio, z)}`), hoy.ultimo)
  const agenda = await leerAgenda(N.id, z)
  afirmar('Agenda: el Dueño ve la cita y su estado', agenda.grupos.flatMap((g) => g.filas).some((f) => f.clienteId === c.id && f.estado === 'Agendada' && f.cliente === 'Camila' && f.asunto === 'Corte'), agenda)

  const repite = envios.length
  await atenderMensaje(mensaje(c.telefono, 'sí'), N.id, guion(async (e) => {
    await e.puerto.guardar_cita({ fecha, hora, asunto: 'Corte', cambiaLaQueTiene: false })
    return { texto: 'Listo.', uso: SIN_USO }
  }).motores)
  afirmar('Repetir el sí: sigue una sola fila y dice lo mismo', (await citasDe(N.id)).length === 1 && enviosA(c.telefono, repite).at(-1)?.texto.endsWith(constanciaDe({ tipo: 'agendada', inicio: fila.inicio, antes: null }, z)) === true)
}

async function probarDosClientes() {
  const N = await negocioNuevo('B')
  const z = N.zonaHoraria
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const [a, b] = [await clienteNuevo(N.id), await clienteNuevo(N.id)]
    const antes = envios.length
    const respuestas: unknown[] = []
    const reserva = guion(async (e) => {
      respuestas.push(await e.puerto.guardar_cita(pedido(3, z, `${String(9 + vuelta).padStart(2, '0')}:00`)))
      return { texto: 'Ya miré.', uso: SIN_USO }
    }).motores
    await Promise.all([atenderMensaje(mensaje(a.telefono), N.id, reserva), atenderMensaje(mensaje(b.telefono), N.id, reserva)])
    const dueno = (await vivasDe(N.id)).filter((f) => f.clienteId === a.id || f.clienteId === b.id)
    const conConstancia = [...enviosA(a.telefono, antes), ...enviosA(b.telefono, antes)].filter((e) => e.texto.includes('Cita agendada:'))
    afirmar(`Dos Clientes, misma hora (${vuelta + 1}): una sola fila`, dueno.length === 1, dueno)
    afirmar(`Dos Clientes, misma hora (${vuelta + 1}): una sola constancia, la de quien ganó`, conConstancia.length === 1 && conConstancia[0].telefono === (dueno[0]?.clienteId === a.id ? a.telefono : b.telefono), conConstancia)
    afirmar(`Dos Clientes, misma hora (${vuelta + 1}): quien perdió sabe que está ocupada y qué más lo está`, respuestas.filter((r) => (r as { ok: boolean }).ok === false && Array.isArray((r as { ocupadas?: unknown }).ocupadas)).length === 1, respuestas)
  }
  const muchos = await Promise.all(Array.from({ length: 6 }, () => clienteNuevo(N.id)))
  const inicio = elInstante(5, z)
  const resultados = await Promise.all(muchos.map((c) => guardarCita(N.id, c.id, { inicio, asunto: '', cambiaLaQueTiene: false })))
  afirmar('Seis a la vez por la misma hora: uno gana, cinco ocupada', resultados.filter((r) => 'tipo' in r).length === 1 && resultados.filter((r) => 'negada' in r && r.negada === 'ocupada').length === 5, resultados)
  afirmar('Seis a la vez: una fila', (await vivasDe(N.id)).filter((f) => f.inicio.getTime() === inicio.getTime()).length === 1)

  const otro = await negocioNuevo('C')
  const de = await clienteNuevo(otro.id)
  afirmar('Otro Negocio tiene su propia agenda: la misma hora le sirve', 'tipo' in (await guardarCita(otro.id, de.id, { inicio, asunto: '', cambiaLaQueTiene: false })))
  afirmar('Otro Negocio: no le aparece en la agenda de este', (await leerAgenda(N.id, z)).grupos.flatMap((g) => g.filas).every((f) => f.clienteId !== de.id))
  afirmar('Otro Negocio: cancelar en este no toca lo suyo', (await cancelarCita(N.id, de.id)) === null && (await vivasDe(otro.id)).length === 1)

  const quien = await clienteNuevo(N.id, 'Lucía Reservada')
  await guardarCita(N.id, quien.id, { inicio: elInstante(1, z, '16:30'), asunto: 'Secreto', cambiaLaQueTiene: false })
  const otraPersona = await clienteNuevo(N.id, 'Pedro')
  let system = ''
  await atenderMensaje(mensaje(otraPersona.telefono, 'Hola'), N.id, guion(async (e) => {
    system = e.system
    return { texto: 'Hola, ¿qué servicio buscas?', uso: SIN_USO }
  }).motores)
  afirmar('Prompt: otro Cliente ve la hora ocupada', system.includes('16:30'))
  afirmar('Prompt: y nada de quién es', !system.includes('Lucía Reservada') && !system.includes('Secreto'))
}

async function probarMover() {
  const N = await negocioNuevo('D')
  const z = N.zonaHoraria
  const c = await clienteNuevo(N.id)
  const otro = await clienteNuevo(N.id, 'Otro')
  await guardarCita(N.id, c.id, { inicio: elInstante(3, z), asunto: 'Corte', cambiaLaQueTiene: false })
  await guardarCita(N.id, otro.id, { inicio: elInstante(4, z), asunto: '', cambiaLaQueTiene: false })
  const fila = async () => (await citasDe(N.id)).find((f) => f.clienteId === c.id)!

  let antes = envios.length
  let r: unknown
  const prueba = (pide: ReturnType<typeof pedido>) => guion(async (e) => {
    r = await e.puerto.guardar_cita(pide)
    return { texto: 'Te cuento.', uso: SIN_USO }
  }).motores
  await atenderMensaje(mensaje(c.telefono), N.id, prueba(pedido(4, z, '10:00', true)))
  afirmar('Mover a una ocupada: la suya sigue igual', (await fila()).inicio.getTime() === elInstante(3, z).getTime() && (await fila()).movidaDe === null, await fila())
  afirmar('Mover a una ocupada: el modelo lo sabe y no sale constancia', (r as { ok: boolean }).ok === false && !enviosA(c.telefono, antes).some((e) => e.texto.includes('Cita ')), r)

  antes = envios.length
  await atenderMensaje(mensaje(c.telefono), N.id, prueba(pedido(5, z)))
  afirmar('Otra hora sin decir que cambia: no deja dos ni mueve', (await citasDe(N.id)).filter((f) => f.clienteId === c.id).length === 1 && (await fila()).inicio.getTime() === elInstante(3, z).getTime() && (r as { ok: boolean }).ok === false)

  antes = envios.length
  await atenderMensaje(mensaje(c.telefono), N.id, prueba(pedido(5, z, '10:00', true)))
  const movida = await fila()
  afirmar('Mover a una libre: sigue una fila, con la hora nueva y la de antes', (await citasDe(N.id)).filter((f) => f.clienteId === c.id).length === 1 && movida.inicio.getTime() === elInstante(5, z).getTime() && movida.movidaDe?.getTime() === elInstante(3, z).getTime() && movida.estado === 'agendada', movida)
  afirmar('Mover: la constancia lo dice con las dos horas', enviosA(c.telefono, antes).at(-1)?.texto.endsWith(constanciaDe({ tipo: 'movida', inicio: movida.inicio, antes: elInstante(3, z) }, z)) === true, enviosA(c.telefono, antes))
  afirmar('Mover: la hora vieja quedó libre', 'tipo' in (await guardarCita(N.id, (await clienteNuevo(N.id)).id, { inicio: elInstante(3, z), asunto: '', cambiaLaQueTiene: false })))
  afirmar('Mover: el Dueño la ve Movida', (await leerAgenda(N.id, z)).grupos.flatMap((g) => g.filas).some((f) => f.clienteId === c.id && f.estado === 'Movida' && f.antes === enPalabras(elInstante(3, z), z)))

  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const [mueve, pide] = [await clienteNuevo(N.id), await clienteNuevo(N.id)]
    await guardarCita(N.id, mueve.id, { inicio: elInstante(10 + vuelta, z), asunto: '', cambiaLaQueTiene: false })
    const destino = elInstante(20 + vuelta, z)
    const [a, b] = await Promise.all([guardarCita(N.id, mueve.id, { inicio: destino, asunto: '', cambiaLaQueTiene: true }), guardarCita(N.id, pide.id, { inicio: destino, asunto: '', cambiaLaQueTiene: false })])
    const enDestino = (await vivasDe(N.id)).filter((f) => f.inicio.getTime() === destino.getTime())
    afirmar(`Mover contra pedir la misma hora (${vuelta + 1}): gana uno`, enDestino.length === 1 && ['tipo' in a, 'tipo' in b].filter(Boolean).length === 1, { a, b, enDestino })
    afirmar(`Mover contra pedir (${vuelta + 1}): quien movió y perdió conserva la suya`, 'tipo' in a || (await vivasDe(N.id)).some((f) => f.clienteId === mueve.id && f.inicio.getTime() === elInstante(10 + vuelta, z).getTime()))
  }

  antes = envios.length
  await atenderMensaje(mensaje(c.telefono, 'cancélala'), N.id, guion(llama((p) => p.cancelar_cita())).motores)
  const cancelada = await fila()
  afirmar('Cancelar: la fila queda cancelada y la hora libre', cancelada.estado === 'cancelada' && 'tipo' in (await guardarCita(N.id, (await clienteNuevo(N.id)).id, { inicio: movida.inicio, asunto: '', cambiaLaQueTiene: false })), cancelada)
  afirmar('Cancelar: la constancia lo dice', enviosA(c.telefono, antes).at(-1)?.texto.includes('Cita cancelada:') === true)
  afirmar('Cancelar: el Dueño la ve Cancelada', (await leerAgenda(N.id, z)).grupos.flatMap((g) => g.filas).some((f) => f.clienteId === c.id && f.estado === 'Cancelada'))
}

async function probarPasado() {
  const N = await negocioNuevo('E')
  const z = N.zonaHoraria
  const c = await clienteNuevo(N.id)
  let r: unknown
  const antes = envios.length
  await atenderMensaje(mensaje(c.telefono), N.id, guion(async (e) => {
    r = await e.puerto.guardar_cita(pedido(-1, z))
    return { texto: 'Esa hora ya pasó, ¿te sirve otra?', uso: SIN_USO }
  }).motores)
  afirmar('Pasado: no guarda', (await citasDe(N.id)).length === 0 && (r as { ok: boolean }).ok === false, r)
  afirmar('Pasado: no sale constancia', !enviosA(c.telefono, antes).some((e) => e.texto.includes('Cita agendada')))

  await db.insert(esquema.citas).values({ negocioId: N.id, clienteId: c.id, inicio: elInstante(-2, z), asunto: 'Vieja' })
  afirmar('Pasado: una vieja no se cancela', (await cancelarCita(N.id, c.id)) === null)
  afirmar('Pasado: el Dueño la ve Ya pasó', (await leerAgenda(N.id, z)).grupos.flatMap((g) => g.filas).some((f) => f.asunto === 'Vieja' && f.estado === 'Ya pasó'))
  const nueva = await guardarCita(N.id, c.id, { inicio: elInstante(2, z), asunto: 'Nueva', cambiaLaQueTiene: false })
  const filas = await citasDe(N.id)
  afirmar('Pasado: una vieja no estorba una nueva y deja de contar como viva', 'tipo' in nueva && nueva.tipo === 'agendada' && filas.length === 2 && filas.find((f) => f.asunto === 'Vieja')?.estado === 'pasada' && filas.find((f) => f.asunto === 'Nueva')?.estado === 'agendada', filas)
}

async function probarLaZona() {
  const N = await negocioNuevo('F', 'consultorio', 'America/Santiago')
  const z = N.zonaHoraria
  const c = await clienteNuevo(N.id)
  const dia = diaEn(3, z)
  const antes = envios.length
  await atenderMensaje(mensaje(c.telefono), N.id, guion(llama((p) => p.guardar_cita({ fecha: dia, hora: '15:00', asunto: '', cambiaLaQueTiene: false }))).motores)
  const [fila] = await citasDe(N.id)
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: z, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(fila.inicio)
  afirmar('Zona: la hora que dijo el modelo es la del Negocio', local === '15:00' && fechaDeCalendario(fila.inicio, z) === dia, { local, inicio: fila.inicio })
  afirmar('Zona: lo que oye el Cliente también', enviosA(c.telefono, antes).at(-1)?.texto.includes('3:00 p. m.') === true, enviosA(c.telefono, antes))

  // Lunes a las 00:30 en Tokio todavía es domingo en UTC: la semana se cuenta en la zona del Negocio.
  const T = await negocioNuevo('G', 'spa', 'Asia/Tokyo')
  const ahoraEnTokio = new Date(`${fechaDeCalendario(new Date(), T.zonaHoraria)}T12:00:00Z`)
  const lunes = fechaDeCalendario(new Date(ahoraEnTokio.getTime() - ((ahoraEnTokio.getUTCDay() + 6) % 7) * 86_400_000), 'UTC')
  const enElLunes = instanteLocal({ fecha: lunes, hora: '00:30' }, T.zonaHoraria)!
  const domingoAntes = new Date(enElLunes.getTime() - 3_600_000)
  const lunesSiguiente = new Date(enElLunes.getTime() + 7 * 86_400_000)
  await db.insert(esquema.citas).values([
    { negocioId: T.id, clienteId: (await clienteNuevo(T.id)).id, inicio: enElLunes },
    { negocioId: T.id, clienteId: (await clienteNuevo(T.id)).id, inicio: domingoAntes },
    { negocioId: T.id, clienteId: (await clienteNuevo(T.id)).id, inicio: lunesSiguiente },
  ])
  afirmar('Zona: la semana se cuenta en la del Negocio, y no en UTC', (await leerCifras(T.id, T.zonaHoraria)).citas.semana === 1, await leerCifras(T.id, T.zonaHoraria))
  const tablero = await leerCitasDelTablero(T.id, T.zonaHoraria)
  afirmar('Tablero: la gráfica va de lunes a domingo y suma lo mismo', tablero.porDia.length === 7 && tablero.porDia[0].dia === lunes && tablero.porDia.reduce((s, d) => s + d.citas, 0) === 1, tablero.porDia)
}

async function probarSinCitas() {
  const N = await negocioNuevo('H')
  const hoy = await leerHoy(N.id, N.zonaHoraria, 'barbería')
  afirmar('Sin citas: la frase no trae cifras', texto(fraseDeHoy(hoy.voz, hoy.cifras)) === 'Esta semana todavía no tienes citas.', texto(fraseDeHoy(hoy.voz, hoy.cifras)))
  afirmar('Sin citas: la Agenda no trae grupos', (await leerAgenda(N.id, N.zonaHoraria)).grupos.length === 0)
  const tablero = await leerTablero(N.id, N.zonaHoraria, 'barbería')
  const [primera] = tarjetasDelTablero(tablero)
  afirmar('Sin citas: la tarjeta dice 0 y por qué', primera.dato === 'Citas de la semana' && primera.valor === '0' && primera.nota === 'Todavía sin citas esta semana', primera)
  afirmar('Sin citas: la gráfica y la lista vienen vacías', tablero.citas !== null && tablero.citas.proximas.length === 0 && tablero.citas.porDia.every((d) => d.citas === 0), tablero.citas)
  const tienda = await leerTablero(N.id, N.zonaHoraria, 'café')
  afirmar('Una tienda no lee citas', tienda.citas === null && tarjetasDelTablero(tienda)[0].dato === 'Ventas de la semana')

  const conCitas = await negocioNuevo('I')
  const c = await clienteNuevo(conCitas.id, 'Borrable')
  await guardarCita(conCitas.id, c.id, { inicio: elInstante(2, conCitas.zonaHoraria), asunto: '', cambiaLaQueTiene: false })
  await db.delete(esquema.clientes).where(eq(esquema.clientes.id, c.id))
  afirmar('Borrar un Cliente se lleva su cita y suelta la hora', (await citasDe(conCitas.id)).length === 0)
}

async function probarLaToma() {
  const N = await negocioNuevo('J')
  const z = N.zonaHoraria
  const [fila] = await db.insert(esquema.duenos).values({ negocioId: N.id, usuarioId: `probar-citas-${marca}-${randomUUID()}`, nombre: 'Dueño' }).returning()
  const ctx = { medio: 'web', negocio: N.id, dueno: marcar.dueno(fila.id) } as const

  const tomada = await clienteNuevo(N.id)
  await tomar(ctx, tomada.id)
  const antes = envios.length
  const g = guion(llama((p) => p.guardar_cita(pedido(2, z))))
  await atenderMensaje(mensaje(tomada.telefono), N.id, g.motores)
  afirmar('Toma: no corre el turno', g.llamadas.responder === 0)
  afirmar('Toma: no guarda ni le dice nada al Cliente', (await citasDe(N.id)).length === 0 && enviosA(tomada.telefono, antes).length === 0)

  const enMedio = await clienteNuevo(N.id)
  let r: unknown
  const enElTurno = envios.length
  await atenderMensaje(mensaje(enMedio.telefono), N.id, guion(async (e) => {
    await tomar(ctx, enMedio.id)
    r = await e.puerto.guardar_cita(pedido(3, z))
    return { texto: 'Listo, te agendé.', uso: SIN_USO }
  }, '¿Te confirmo esa hora?').motores)
  afirmar('Toma en medio del turno: la cerca niega y no guarda', (r as { ok: boolean }).ok === false && (await citasDe(N.id)).filter((f) => f.clienteId === enMedio.id).length === 0, r)
  afirmar('Toma en medio del turno: al Cliente no le sale nada', enviosA(enMedio.telefono, enElTurno).length === 0, enviosA(enMedio.telefono, enElTurno))

  const conCita = await clienteNuevo(N.id)
  await guardarCita(N.id, conCita.id, { inicio: elInstante(4, z), asunto: '', cambiaLaQueTiene: false })
  await atenderMensaje(mensaje(conCita.telefono), N.id, guion(async (e) => {
    await tomar(ctx, conCita.id)
    await e.puerto.cancelar_cita()
    return { texto: 'Ya miré.', uso: SIN_USO }
  }).motores)
  afirmar('Toma en medio del turno: tampoco cancela', (await vivasDe(N.id)).some((f) => f.clienteId === conCita.id))

  const justoAntes = await clienteNuevo(N.id)
  const previo = envios.length
  await atenderMensaje(mensaje(justoAntes.telefono), N.id, guion(async (e) => {
    await e.puerto.guardar_cita(pedido(5, z))
    await tomar(ctx, justoAntes.id)
    return { texto: 'Listo.', uso: SIN_USO }
  }).motores)
  afirmar('Tomada justo después de guardar: la fila queda y el Cliente no recibe nada', (await vivasDe(N.id)).some((f) => f.clienteId === justoAntes.id) && enviosA(justoAntes.telefono, previo).length === 0)
  const hilo = await db.select().from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.negocioId, N.id))
  afirmar('Tomada justo después de guardar: el Hilo dice que revise la Agenda', hilo.some((m) => JSON.stringify(m).includes('Revisa Pedidos, Agenda y Casos')))
}

async function probarLoFalso() {
  const N = await negocioNuevo('K')
  const z = N.zonaHoraria

  const a = await clienteNuevo(N.id)
  let antes = envios.length
  await atenderMensaje(mensaje(a.telefono, 'Quiero el jueves a las 3'), N.id, guion('Listo, te agendé para el jueves a las 3', 'Quedó agendada tu cita').motores)
  afirmar('Lo dice sin guardar: al Cliente le sale el respaldo', enviosA(a.telefono, antes).at(-1)?.texto === RESPALDO, enviosA(a.telefono, antes))
  afirmar('Lo dice sin guardar: no hay fila, y el Dueño tiene un Caso', (await citasDe(N.id)).length === 0 && (await casosDe(N.id)).some((k) => k.clienteId === a.id && k.titulo === 'Respuesta frenada por el núcleo'))

  const b = await clienteNuevo(N.id)
  antes = envios.length
  const g = guion('Dale, te espero el viernes a las 9', '¿Te confirmo el viernes a las 9?')
  await atenderMensaje(mensaje(b.telefono), N.id, g.motores)
  afirmar('Lo corrige preguntando: sale la pregunta', g.llamadas.reescribir === 1 && enviosA(b.telefono, antes).at(-1)?.texto === '¿Te confirmo el viernes a las 9?', enviosA(b.telefono, antes))

  const c = await clienteNuevo(N.id)
  await guardarCita(N.id, c.id, { inicio: elInstante(2, z), asunto: '', cambiaLaQueTiene: false })
  antes = envios.length
  const dia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(`${diaEn(4, z)}T12:00:00Z`).getUTCDay()]
  await atenderMensaje(mensaje(c.telefono), N.id, guion(`Quedó para el ${dia} a las 4`, `Listo, quedó para el ${dia} a las 4`).motores)
  afirmar('Ya tiene otra guardada y afirma una nueva: se frena', enviosA(c.telefono, antes).at(-1)?.texto === RESPALDO, enviosA(c.telefono, antes))

  const d = await clienteNuevo(N.id)
  await guardarCita(N.id, (await clienteNuevo(N.id)).id, { inicio: elInstante(6, z), asunto: '', cambiaLaQueTiene: false })
  antes = envios.length
  await atenderMensaje(mensaje(d.telefono), N.id, guion(llama((p) => p.guardar_cita(pedido(6, z)), 'Listo, te agendé.'), '¿Te sirve otra hora?').motores)
  afirmar('La herramienta negó y lo afirma igual: se frena', (await citasDe(N.id)).every((f) => f.clienteId !== d.id) && enviosA(d.telefono, antes).at(-1)?.texto === '¿Te sirve otra hora?', enviosA(d.telefono, antes))

  const e = await clienteNuevo(N.id)
  antes = envios.length
  await atenderMensaje(mensaje(e.telefono), N.id, guion(llama((p) => p.guardar_cita(pedido(7, z)), 'Son $999.000 en total'), 'Siguen siendo $999.000').motores)
  const salida = enviosA(e.telefono, antes).at(-1)?.texto ?? ''
  const guardada = (await citasDe(N.id)).find((f) => f.clienteId === e.id)
  afirmar('Guardó y se frena lo que escribió: la fila queda', guardada?.estado === 'agendada')
  afirmar('Guardó y se frena lo que escribió: el Cliente recibe la constancia, y no un déjame confirmarlo', salida.endsWith(constanciaDe({ tipo: 'agendada', inicio: guardada!.inicio, antes: null }, z)) && !salida.includes(RESPALDO) && !salida.includes('$999.000'), salida)
  afirmar('Guardó y se frena lo que escribió: el Dueño tiene su Caso', (await casosDe(N.id)).some((k) => k.clienteId === e.id))

  const f = await clienteNuevo(N.id)
  antes = envios.length
  await atenderMensaje(mensaje(f.telefono), N.id, guion(llama((p) => p.guardar_cita(pedido(8, z)), '')).motores)
  afirmar('Guardó y no escribió nada: sale la constancia', enviosA(f.telefono, antes).at(-1)?.texto.includes('Cita agendada:') === true, enviosA(f.telefono, antes))

  const g1 = await clienteNuevo(N.id)
  antes = envios.length
  await atenderMensaje(mensaje(g1.telefono), N.id, guion('Todo bien para el viernes').motores)
  afirmar('Una forma de decirlo que nadie anotó: sale con la línea cierta', enviosA(g1.telefono, antes).at(-1)?.texto === 'Todo bien para el viernes\n\nPor ahora no tienes una cita guardada.', enviosA(g1.telefono, antes))
  const g2 = await clienteNuevo(N.id)
  await guardarCita(N.id, g2.id, { inicio: elInstante(9, z), asunto: '', cambiaLaQueTiene: false })
  antes = envios.length
  await atenderMensaje(mensaje(g2.telefono), N.id, guion(`Nos pillamos el ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(`${diaEn(11, z)}T12:00:00Z`).getUTCDay()]}`, '¿Te confirmo esa hora?').motores)
  afirmar('Una cita guardada y otra hora: se frena, sin línea si la corrección solo pregunta', enviosA(g2.telefono, antes).at(-1)?.texto === '¿Te confirmo esa hora?', enviosA(g2.telefono, antes))
  const g3 = await clienteNuevo(N.id)
  await guardarCita(N.id, g3.id, { inicio: elInstante(12, z), asunto: '', cambiaLaQueTiene: false })
  antes = envios.length
  await atenderMensaje(mensaje(g3.telefono), N.id, guion(`Todo bien para el ${diaEn(13, z).slice(8)} a las 7`).motores)
  afirmar('Otra hora dicha de otra forma: la línea dice cuál es la guardada', enviosA(g3.telefono, antes).at(-1)?.texto.endsWith(`Tu cita guardada sigue siendo: ${enPalabras(elInstante(12, z), z)}`) === true, enviosA(g3.telefono, antes))
  const g4 = await clienteNuevo(N.id)
  antes = envios.length
  await atenderMensaje(mensaje(g4.telefono), N.id, guion('¿Te sirve el jueves a las 3?').motores)
  afirmar('Una oferta sale limpia, sin línea', enviosA(g4.telefono, antes).at(-1)?.texto === '¿Te sirve el jueves a las 3?')
  const g5 = await clienteNuevo(N.id)
  await db.insert(esquema.mensajesCliente).values({ negocioId: N.id, clienteId: g5.id, rol: 'agente', texto: '¿Te sirve el jueves a las 3?' })
  antes = envios.length
  await atenderMensaje(mensaje(g5.telefono, 'sí, dale'), N.id, guion('Perfecto, gracias').motores)
  afirmar('Aceptó y no se guardó: el Cliente sabe que no hay cita', enviosA(g5.telefono, antes).at(-1)?.texto === 'Perfecto, gracias\n\nPor ahora no tienes una cita guardada.' && (await citasDe(N.id)).every((f) => f.clienteId !== g5.id), enviosA(g5.telefono, antes))

  // La regla de #48 está en `main`: un Negocio que partió de la plantilla la guarda como fila. No debe poder esconder una cita real.
  const V = await negocioNuevo('V')
  await db.insert(esquema.elementos).values({
    negocioId: V.id,
    clave: comoClave('regla:no-dar-una-cita-por-agendada'),
    version: 3,
    tipo: 'regla',
    contrato: 1,
    contenido: {
      tipo: 'regla',
      nombre: 'No dar una cita por agendada',
      cuando: { tipo: 'siempre' },
      efectos: [
        { tipo: 'no_prometer', que: 'disponibilidad' },
        { tipo: 'no_decir', frases: ['cita agendada', 'queda agendada', 'quedó agendada', 'te agendé', 'cita confirmada', 'te confirmo la cita'] },
      ],
      escenarios: { activan: [{ mensajeDelCliente: 'Quiero una cita para el jueves', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] },
    },
    origen: 'tablas_viejas',
    sinPublicar: false,
  })
  const conRegla = await clienteNuevo(V.id)
  antes = envios.length
  await atenderMensaje(mensaje(conRegla.telefono), V.id, guion(llama((p) => p.guardar_cita(pedido(2, z)), 'Gracias, Camila.')).motores)
  const deLaRegla = (await citasDe(V.id)).find((f) => f.clienteId === conRegla.id)
  afirmar('Con la regla vieja: la cita se guarda y su constancia sale', deLaRegla?.estado === 'agendada' && enviosA(conRegla.telefono, antes).at(-1)?.texto === `Gracias, Camila.\n\n${constanciaDe({ tipo: 'agendada', inicio: deLaRegla.inicio, antes: null }, z)}`, enviosA(conRegla.telefono, antes))
  const sinGuardar = await clienteNuevo(V.id)
  antes = envios.length
  await atenderMensaje(mensaje(sinGuardar.telefono), V.id, guion('Listo, cita agendada', 'Tu cita queda agendada').motores)
  afirmar('Con la regla vieja: lo dicho sin guardar sigue frenado', enviosA(sinGuardar.telefono, antes).at(-1)?.texto === RESPALDO, enviosA(sinGuardar.telefono, antes))

  const T = await negocioNuevo('L', 'café')
  const t = await clienteNuevo(T.id)
  let herramientas: string[] = []
  let system = ''
  antes = envios.length
  await atenderMensaje(mensaje(t.telefono), T.id, guion(async (x) => {
    herramientas = Object.keys(x.herramientas)
    system = x.system
    return { texto: 'Tu cita quedó agendada', uso: SIN_USO }
  }, '¿Te ayudo con un pedido?').motores)
  afirmar('Una tienda no tiene herramientas de citas ni calendario', !herramientas.includes('guardar_cita') && !herramientas.includes('cancelar_cita') && !system.includes('## Calendario') && herramientas.includes('crear_pedido'), herramientas)
  afirmar('Una tienda tampoco puede afirmar una cita', enviosA(t.telefono, antes).at(-1)?.texto === '¿Te ayudo con un pedido?', enviosA(t.telefono, antes))
  const agenda = await negocioNuevo('M')
  const m = await clienteNuevo(agenda.id)
  await atenderMensaje(mensaje(m.telefono), agenda.id, guion(async (x) => {
    herramientas = Object.keys(x.herramientas)
    return { texto: 'Hola', uso: SIN_USO }
  }).motores)
  afirmar('Una agenda sigue pudiendo vender: crear_pedido no se va', herramientas.includes('crear_pedido') && herramientas.includes('guardar_cita') && herramientas.includes('cancelar_cita'), herramientas)
}

async function probarElEnsayo() {
  const N = await negocioNuevo('N')
  const z = N.zonaHoraria
  const estado = await leerPublicado(N.id)
  const cliente = { id: marcar.cliente(randomUUID()), nombre: 'Ensayo', telefono: null, pedidos: [], agenda: { ocupadas: [], cita: null } }
  const conversacion = { cliente, historial: [], mensaje: { texto: 'sí', wamid: marcar.wamid(`ensayo.${marca}`), enviadoEn: marcar.instante(new Date()) } }
  const t = await turno(estado, conversacion, entornoDeEnsayo(estado, cliente), guion(llama((p) => p.guardar_cita(pedido(2, z)))).motores)
  afirmar('Ensayo: dice la constancia, sin escribir una fila', t.texto.includes('Cita agendada:') && (await citasDe(N.id)).length === 0, t.texto)
  afirmar('Ensayo: la acción queda anotada para los escenarios', t.acciones.some((a) => a.nombre === 'guardar_cita' && a.detalle === 'agendada'), t.acciones)
}

/** Mide a Muse Spark: cuántas veces guarda de verdad, y si alguna vez lo dice sin haber guardado. No afirma su texto. */
async function medirElModelo(vueltas: number) {
  const N = await negocioNuevo('Z')
  const z = N.zonaHoraria
  const dia = diaEn(3, z)
  const conteo = { pedir: { guardo: 0, sinConstancia: 0 }, ocupada: { noPiso: 0 }, mover: { movio: 0, unaSola: 0 }, cancelar: { cancelo: 0 }, pedidos: 0, frenadas: 0, tandas: 0, turnos: 0, lineaCierta: 0, sinGuardarSuenaACita: [] as string[], fallaron: [] as string[] }
  let cupo = 0
  const uno = async (telefono: string, dice: string) => {
    const desde = envios.length
    const antesDeLaFila = (await citasDe(N.id)).map((f) => `${f.id}${f.estado}${f.inicio.toISOString()}`).join()
    await atenderMensaje(mensaje(telefono, dice), N.id)
    const dijo = enviosA(telefono, desde).map((e) => e.texto).join('\n')
    conteo.turnos++
    if (/Por ahora no tienes una cita guardada|Tu cita guardada sigue siendo/.test(dijo)) conteo.lineaCierta++
    // Medida aparte del detector: una lectura a mano de lo que suena a cita en un turno que no cambió ninguna fila.
    const cambio = antesDeLaFila !== (await citasDe(N.id)).map((f) => `${f.id}${f.estado}${f.inicio.toISOString()}`).join()
    if (!cambio && /\b(agend|reserv|apart|qued|confirm|espero|esperamos|nos vemos|anot|listo)/i.test(dijo)) conteo.sinGuardarSuenaACita.push(dijo)
    return dijo
  }
  const hora = () => `${String(8 + (cupo % 9)).padStart(2, '0')}:${cupo++ % 2 ? '30' : '00'}`
  const horaEnPalabras = (h: string) => {
    const [a, m] = h.split(':').map(Number)
    return `${a % 12 || 12}${m ? ':30' : ''} ${a >= 12 ? 'de la tarde' : 'de la mañana'}`
  }

  for (let i = 0; i < vueltas; i++) {
    conteo.tandas++
    const c = await clienteNuevo(N.id, `Camila ${i}`)
    const h = hora()
    const primera = await uno(c.telefono, `Hola, quiero una cita para un corte el ${dia} a las ${horaEnPalabras(h)}`)
    const conUna = (await vivasDe(N.id)).some((f) => f.clienteId === c.id)
    const segunda = conUna ? '' : await uno(c.telefono, 'Sí, dale, esa hora me sirve')
    const fila = (await vivasDe(N.id)).find((f) => f.clienteId === c.id)
    if (fila) conteo.pedir.guardo++
    else conteo.fallaron.push(`pedir ${i}: ${primera} || ${segunda}`)
    if (Boolean(fila) !== `${primera}\n${segunda}`.includes('Cita agendada:')) conteo.pedir.sinConstancia++
    const pedidosDeC = await db.select().from(esquema.pedidos).where(eq(esquema.pedidos.clienteId, c.id))
    conteo.pedidos += pedidosDeC.length

    const o = await clienteNuevo(N.id, `Otra ${i}`)
    if (fila) {
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: z, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(fila.inicio)
      await uno(o.telefono, `Hola, quiero una cita para un corte el ${fechaDeCalendario(fila.inicio, z)} a las ${horaEnPalabras(local)}`)
      await uno(o.telefono, 'Sí, a esa hora')
      if ((await vivasDe(N.id)).filter((f) => f.inicio.getTime() === fila.inicio.getTime()).length === 1 && (await vivasDe(N.id)).find((f) => f.inicio.getTime() === fila.inicio.getTime())?.clienteId === c.id) conteo.ocupada.noPiso++
      else conteo.fallaron.push(`ocupada ${i}`)

      const destino = hora()
      const otroDia = diaEn(4, z)
      const propuesta = await uno(c.telefono, `Necesito mover mi cita para el ${otroDia} a las ${horaEnPalabras(destino)}`)
      const antesDeSi = (await vivasDe(N.id)).find((f) => f.clienteId === c.id)
      const dice = antesDeSi?.movidaDe ? '' : await uno(c.telefono, 'Sí, muévela a esa')
      const movida = (await vivasDe(N.id)).filter((f) => f.clienteId === c.id)
      if (movida.length === 1) conteo.mover.unaSola++
      if (movida[0]?.movidaDe) conteo.mover.movio++
      else conteo.fallaron.push(`mover ${i}: ${propuesta} || ${dice}`)

      const cancela = await uno(c.telefono, 'Mejor cancela mi cita, ya no puedo ir')
      const cancelada = (await vivasDe(N.id)).find((f) => f.clienteId === c.id)
      const otra = cancelada ? await uno(c.telefono, 'Sí, cancélala') : ''
      if (!(await vivasDe(N.id)).some((f) => f.clienteId === c.id)) conteo.cancelar.cancelo++
      else conteo.fallaron.push(`cancelar ${i}: ${cancela} || ${otra}`)
    }
  }
  conteo.frenadas = (await casosDe(N.id)).filter((k) => k.titulo === 'Respuesta frenada por el núcleo').length
  console.log(JSON.stringify({ ...conteo, sinGuardarSuenaACita: conteo.sinGuardarSuenaACita.map((f) => f.slice(0, 300)), fallaron: conteo.fallaron.map((f) => f.slice(0, 400)) }, null, 1))
}

try {
  if (process.argv.includes('--modelo')) {
    const i = process.argv.indexOf('--modelo')
    await medirElModelo(Number(process.argv[i + 1]) || 5)
  } else {
    probarElTiempo()
    probarElDetector()
    await probarAgendar()
    await probarDosClientes()
    await probarMover()
    await probarPasado()
    await probarLaZona()
    await probarSinCitas()
    await probarLaToma()
    await probarLoFalso()
    await probarElEnsayo()
  }
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
}
terminar()
