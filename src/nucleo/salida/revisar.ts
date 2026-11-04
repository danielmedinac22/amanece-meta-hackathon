/**
 * Detectores en código, entre el modelo y la compuerta, y sobre lo que escribe el Dueño. Cada fila trae su
 * detector y su tabla de pruebas, que corre `scripts/probar-revisar.mts`. Puro: no lee la base ni llama modelos.
 */

export type HechosDeRevision = {
  /** Productos, pedidos del Cliente, lo que devolvieron las herramientas del turno y, hasta que exista `precio`, las cifras de los `dato`. */
  readonly montosConRespaldo: ReadonlySet<number>
  readonly telefonoDelCliente: string | null
  /** Los teléfonos que el Negocio puso en sus datos y preguntas: el Agente de clientes los puede repetir. */
  readonly telefonosDelNegocio: readonly string[]
  readonly nombresInternos: readonly string[]
  readonly otrosNegocios: readonly string[]
  readonly emojisMaximos: 0 | 1 | 2 | 3
  readonly cita: CitaEnRevision
}

/** Una hora de la cita, como se puede decir. `minutos` va en 12 horas: `a las 3` y `15:00` son la misma. */
export type MomentoDeCita = { readonly diaDeSemana: string; readonly diaDelMes: number; readonly relativo: 'hoy' | 'manana' | null; readonly minutos: number }

export type CitaEnRevision =
  | { readonly tipo: 'sin_agenda' }
  /** `antes`: la hora de la que se movió en este turno, que también se puede nombrar. */
  | { readonly tipo: 'con_agenda'; readonly vigente: MomentoDeCita | null; readonly antes: MomentoDeCita | null; readonly escritaEnElTurno: boolean; readonly aceptoUnaHora: boolean }

type Pruebas = { readonly dispara: readonly string[]; readonly noDispara: readonly string[] }

type Detector = {
  /** `todo_texto` corre también sobre cada texto del Dueño que puede llegar a un Cliente. */
  readonly alcance: 'respuesta' | 'todo_texto'
  readonly detecta: (texto: string, hechos: HechosDeRevision) => boolean
  /** Con `HECHOS_DE_PRUEBA`. */
  readonly pruebas: Pruebas
}

export const LARGO_MAXIMO_DE_UNA_RESPUESTA = 900

/** Sin tildes, en minúsculas y con espacios simples. */
export function plano(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const UNIDADES_QUE_NO_SON_DINERO = /^\s*(?:g|gr|gramos?|kg|kilos?|ml|litros?|metros?|m|km|cm|unidades|pedidos|clientes|bolsas)\b/i

/** Los montos en pesos de un texto: con `$`, con "pesos" o "mil", o con puntos de miles. */
export function montosEn(texto: string): number[] {
  const montos: number[] = []
  const conSigno = /\$\s?(\d{1,3}(?:[.,]\d{3})+|\d+)/g
  for (const m of texto.matchAll(conSigno)) montos.push(Number(m[1].replace(/[.,]/g, '')))
  const sinSigno = texto.replace(conSigno, ' ')
  for (const m of sinSigno.matchAll(/(\d+(?:[.,]\d+)?)\s*mil\b/gi)) montos.push(Math.round(Number(m[1].replace(',', '.')) * 1000))
  for (const m of sinSigno.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+)(?![\d,])/g)) {
    if (UNIDADES_QUE_NO_SON_DINERO.test(sinSigno.slice((m.index ?? 0) + m[0].length))) continue
    montos.push(Number(m[1].replace(/\./g, '')))
  }
  for (const m of sinSigno.matchAll(/(\d{4,})\s*(?:pesos|cop)\b/gi)) montos.push(Number(m[1]))
  return montos
}

/** Con respaldo, o la suma de dos montos con respaldo: un total más el domicilio fijo de un dato. */
function conRespaldo(monto: number, respaldo: ReadonlySet<number>): boolean {
  if (respaldo.has(monto)) return true
  for (const a of respaldo) if (a < monto && respaldo.has(monto - a)) return true
  return false
}

const EMOJI = /\p{Extended_Pictographic}/gu

const TELEFONO = /(?<!\d)(?:\+?57[\s-]?)?(3\d{2}[\s-]?\d{3}[\s-]?\d{4}|60\d[\s-]?\d{3}[\s-]?\d{4})(?!\d)/g

const soloDigitos = (s: string) => s.replace(/\D/g, '')

/** Los teléfonos de un texto, solo los dígitos sin el indicativo. */
export function telefonosEn(texto: string): string[] {
  return [...texto.matchAll(TELEFONO)].map((m) => soloDigitos(m[1]))
}

const AFIRMAR = ['puedo', 'podemos', 'podria', 'podriamos', 'puede', 'vamos', 'voy', 'prometo', 'prometemos', 'prometer', 'aseguro', 'aseguramos', 'asegurar', 'garantizo', 'garantizamos', 'garantizar', 'sabemos', 'sabria', 'se cuando', 'se si', 'se exactamente', 'confirmo', 'confirmamos', 'confirmar']

/**
 * La negación pegada al verbo de lo que se afirma ("no te puedo prometer", "nunca te vamos a pedir", "no cura"):
 * un "no" en otra parte de la frase ("no te preocupes", "no pagas envío") no la anula.
 */
function niega(frase: string, verbos: readonly string[] = []): boolean {
  return new RegExp(`\\b(?:no|nunca|jamas|tampoco)(?: (?:te|le|les|lo|la|los|las|se|nos|me))* (?:${[...AFIRMAR, ...verbos].join('|')})\\b`).test(frase)
}

function frases(texto: string): string[] {
  return plano(texto)
    .split(/[.!?¿¡;\n]+|,? pero /)
    .map((f) => f.trim())
    .filter(Boolean)
}

const DATO_DE_PAGO = /\b(numero de (la |tu )?tarjeta|cvv|cvc|codigo de seguridad|clave|contrasena|codigo de verificacion|codigo que te llego|otp|pin)\b/
const PEDIR = /\b(envia|enviame|mandame|manda|dime|dame|comparte|comparteme|compartenos|compartime|escribe|escribeme|pasame|necesito|necesitamos|regalame|indicame|confirma|confirmame)\b/

const PEDIR_DE_VERDAD = ['pedimos', 'pido', 'pedir', 'pediremos', 'pediria', 'solicitamos']

const ENFERMEDAD = '(?:enferm\\w*|diabetes|gastritis|cancer|presion|tension|colesterol|ansiedad|depresion|artritis|migrana|insomnio|covid|gripa|gripe|resfriado|infeccion\\w*|inflamacion|dolor\\w*)'
const AFIRMAR_SALUD = ['cura', 'curan', 'previene', 'previenen', 'sirve', 'ayuda', 'adelgaza', 'controla', 'baja', 'quema', 'es']

const SALUD = [
  /\bcura(r|n)?\b/,
  /\bprevien(e|en)\b/,
  /\bprevenir\b(?! que\b)/,
  new RegExp(`\\bprevenir que\\b.*\\b${ENFERMEDAD}\\b`),
  new RegExp(`\\b(sirve|ayuda|es bueno|es buena) (para|contra) (la |el )?${ENFERMEDAD}\\b`),
  /\badelgaza\b/,
  /\b(baja|bajar) de peso\b/,
  /\bquema (la )?grasa\b/,
  /\bcontrola (la |el )?(presion|tension|azucar|diabetes|colesterol)\b/,
]

const SER_PERSONA = [/\bno soy (un |una )?(bot|robot|asistente virtual|maquina|ia|inteligencia artificial)\b/, /\bsoy (una |un )?(persona|humano|humana|persona real|de carne y hueso)\b/]

const NUMEROS_EN_PALABRAS: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
const HORA = `\\d{1,2}|${Object.keys(NUMEROS_EN_PALABRAS).join('|')}`
const DIAS_DE_LA_SEMANA = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g

/** Sin `a. m.` partido en dos oraciones. `Listo, quedó, ¿algo más?` son dos: la pregunta no le quita lo que afirma la primera. */
const oraciones = (t: string) =>
  plano(t)
    .replace(/\b([ap])\. ?m\b\.?/g, '$1m')
    .split(/(?<=\?)|(?=¿)|[.!;\n]+/)
    .map((o) => o.replace(/[,\s]+$/, '').trim())
    .filter(Boolean)

const esPregunta = (o: string) => /[?¿]/.test(o)

function horasEn(o: string): number[] {
  const horas: number[] = []
  const anotar = (h: string, m = 0) => horas.push((((NUMEROS_EN_PALABRAS[h] ?? Number(h)) % 12) * 60 + m) % 720)
  for (const x of o.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) anotar(x[1], Number(x[2]))
  const sinReloj = o.replace(/\b\d{1,2}:\d{2}\b/g, ' ')
  for (const x of sinReloj.matchAll(new RegExp(`\\b(?:a|para|de|desde|hasta) las? (${HORA})\\b( y media)?`, 'g'))) anotar(x[1], x[2] ? 30 : 0)
  for (const x of sinReloj.matchAll(/(?<!(?:a|para|de|desde|hasta) las? )\b(\d{1,2}) ?(?:am|pm)\b/g)) anotar(x[1])
  return horas
}

const diasEn = (o: string) => [...o.matchAll(DIAS_DE_LA_SEMANA)].map((x) => x[1])
const relativosEn = (o: string) => [...o.replace(/\b(?:de|en|por) la manana\b/g, ' ').matchAll(/\b(hoy|manana)\b/g)].map((x) => x[1])
const diasDelMesEn = (o: string) => [...o.matchAll(/\bel (\d{1,2})(?: de [a-z]+)?\b(?! ?(?:am|pm))/g)].map((x) => Number(x[1]))

/** Nombra un momento que no es de estos. Sin saber de qué mes habla, un jueves de otra semana no se distingue. */
const noEsDe = (o: string, ...v: readonly MomentoDeCita[]) =>
  horasEn(o).some((h) => !v.some((m) => m.minutos === h)) || diasEn(o).some((d) => !v.some((m) => m.diaDeSemana === d)) || relativosEn(o).some((r) => !v.some((m) => m.relativo === r)) || diasDelMesEn(o).some((d) => !v.some((m) => m.diaDelMes === d))
const nombraUnMomento = (o: string) => horasEn(o).length + diasEn(o).length + relativosEn(o).length + diasDelMesEn(o).length > 0
const nombraDiaYHora = (o: string) => horasEn(o).length > 0 && nombraUnMomento(o.replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(new RegExp(`\\b(?:a|para|de|desde|hasta) las? (?:${HORA})\\b`, 'g'), ' '))

const NIEGA_LA_CITA = /\b(?:no|nunca|jamas|tampoco)(?: (?:te|le|la|lo|les|los|las|se|me|nos|he|hemos|ha|han|puedo|pude|alcance|quedo|queda|esta|tienes|tiene))*(?: (?:agendar|agendado|agendada|agende|reservar|reservado|reservada|reserve|apartar|apartado|apartada|aparte|guardar|guardado|guardada|guarde|mover|movido|movida|movi|cancelar|cancelado|cancelada|cancele|cita))\b/
const ES_DE_OTRA_COSA = /\b(pedido|pedidos|entrega|envio|envios|recogida|domicilio|despacho|paquete|bolsa|compra)\b/
const SI_ACASO = /^(?:si (?:quieres|prefieres|puedes|necesitas|deseas|gustas|tienes|hay|no|me|te (?:sirve|queda|parece|gusta)|lo|la)|cuando|apenas|en cuanto|tan pronto|antes de|puedo|podemos|podria|podriamos|quieres|te gustaria|hay que)\b/

const YO_AGENDE = /\b(?:te|le|la|lo|les|los|las) (?:agende|reserve|aparte|separe|anote|guarde|cuadre|deje)\b|\b(?:ya|listo,?) (?:agende|reserve|aparte|anote|guarde|cuadre)\b/
const NOMBRA_LA_CITA = /\b(?:cita|turno|cupo)\b/
const CITA_LISTA = /\b(?:cita|turno|cupo)\b.*\b(?:agendad[ao]|confirmad[ao]|reservad[ao]|apartad[ao]|separad[ao]|anotad[ao]|guardad[ao]|cuadrad[ao]|list[ao]|queda|quedo)\b|\b(?:agendad[ao]|confirmad[ao]|reservad[ao]|apartad[ao]|anotad[ao]|guardad[ao]|cuadrad[ao])\b.*\b(?:cita|turno|cupo)\b|\b(?:estas?|quedaste|quedo|queda) (?:agendad[ao]|anotad[ao]|reservad[ao])\b|\bya qued(?:o|a) (?:tu|la|su) (?:cita|turno|cupo)\b|\bte confirmo la cita\b/
/** Solo cuenta con un día o una hora al lado: `te esperamos` a secas es cortesía, y `cuenta con` puede ser parqueadero. */
const ACUSE = /\b(?:te|la|lo|los|las|les) (?:espero|esperamos|esperan)\b|\bnos (?:vemos|pillamos)\b|\bquedamos\b|\bquedas?(?:te)? para\b|\bquedo para\b|\bqueda para\b|\blisto\b|\bdale\b|\bhagale\b|\bcuadrad[ao]\b|\bcuadramos\b|\bya qued(?:o|a|aste)\b|\bvente\b|\bvenga\b|\bven\b|\bcuenta con\b/
const SE_MOVIO = /\b(?:te|le) (?:pase|cambie|movi|corri)\b|\b(?:pase|cambie|movi|corri|mude) (?:la|tu|su) (?:cita|hora|turno)\b|\b(?:cita|turno)\b.*\b(?:movid[ao]|cambiad[ao]|reprogramad[ao]|corrid[ao])\b/
const SE_CANCELO = /\bcancele\b|\bcancelad[ao]\b/
const YA_NO_TIENE = /\bya no tienes? (?:una )?(?:cita|turno)\b/

/** Una hora que se ofrece o se informa, sin darla por tomada. Equivocarse aquí cuesta una línea cierta de más. */
const OFERTA = /\b(libres?|ocupad[ao]s?|atendemos|atiendo|abrimos|cerramos|empezamos|horario|desde las|hasta las|tengo|hay|puede ser|podria ser|te sirve|te queda|prefieres|disponibles?|me cuenta|me dices|o el|o a las|si te|no)\b/
const ACEPTA = /^(?:(?:uy|pues|ah|ay) )?(si|sip|sisas|dale|de una|listo|perfecto|ok|okay|bueno|claro|esa|ese|me sirve|me queda bien|esta bien|melo|hagale|hagamosle|de acuerdo|vale|va|confirmo)\b/
const PREGUNTA_DE_HORA = /\b(te sirve|prefieres|que hora|que dia|confirm|cuando|seguro|queda bien|a esa hora|esa hora)\b/
const NO_PUDO = /\b(ocupad[ao]s?|ya paso|ya no esta|no (puedo|pude|tengo|hay|atiendo|atendemos))\b/

/** El agente preguntó por una hora y el Cliente dijo que sí: lo que siga, sin escritura, se lee como un sí del Negocio. */
export function aceptoUnaHora(historial: readonly { readonly rol: string; readonly texto: string }[], mensaje: string): boolean {
  const antes = historial.at(-1)
  const dijo = plano(mensaje).trim()
  if (antes?.rol !== 'agente' || dijo.length > 40 || esPregunta(dijo) || !ACEPTA.test(dijo)) return false
  return oraciones(antes.texto).some((o) => esPregunta(o) && horasEn(o).length > 0)
}

const afirma = (o: string, familia: RegExp) => {
  const limpia = o.replace(/\bno te (preocupes|afanes)\b/g, ' ')
  return limpia.split(',').some((c) => familia.test(c) && !SI_ACASO.test(c.trim()) && !NIEGA_LA_CITA.test(c) && !ES_DE_OTRA_COSA.test(c))
}

/** Lo que el modelo dio por hecho con palabras claras. Lo demás no se frena: lo cubre `hablaDeUnaHora`. */
function citaSinRespaldo(texto: string, cita: CitaEnRevision): boolean {
  const declarativas = oraciones(texto).filter((o) => !esPregunta(o))
  const vigente = cita.tipo === 'con_agenda' ? cita.vigente : null
  const escrita = cita.tipo === 'con_agenda' && cita.escritaEnElTurno
  const anterior = cita.tipo === 'con_agenda' ? cita.antes : null
  const contradice = (o: string) => vigente !== null && noEsDe(o, vigente, ...(anterior ? [anterior] : []))
  for (const o of declarativas) {
    if (YA_NO_TIENE.test(o) && (!escrita || vigente)) return true
    if (afirma(o, SE_CANCELO) && (NOMBRA_LA_CITA.test(o) || cita.tipo === 'con_agenda')) {
      if (!escrita || vigente) return true
      continue
    }
    if (afirma(o, SE_MOVIO)) {
      if (!escrita || !vigente || contradice(o)) return true
      continue
    }
    const yo = afirma(o, YO_AGENDE) && (NOMBRA_LA_CITA.test(o) || nombraUnMomento(o) || /\b(?:te|le) agende\b/.test(o))
    const dada = yo || afirma(o, CITA_LISTA) || (afirma(o, ACUSE) && nombraUnMomento(o))
    if (!dada) continue
    if (!vigente || contradice(o)) return true
    if (!escrita && !nombraDiaYHora(o)) return true
  }
  return false
}

/**
 * Pura. Si esta respuesta, sin escritura en el turno, puede dejar al Cliente creyendo algo de su cita. Ninguna lista de
 * frases alcanza para saber si un mensaje afirma una cita, así que esto no frena nada: pide que el núcleo agregue una línea
 * que es cierta se haya entendido como se haya entendido el mensaje, y equivocarse cuesta esa línea de más.
 */
export function hablaDeUnaHora(texto: string, cita: CitaEnRevision): boolean {
  if (cita.tipo === 'sin_agenda' || cita.escritaEnElTurno) return false
  const todas = oraciones(texto)
  const { vigente } = cita
  const declarativas = todas.filter((o) => !esPregunta(o))
  if (declarativas.some((o) => nombraUnMomento(o) && !OFERTA.test(o) && (!vigente || noEsDe(o, vigente)))) return true
  return cita.aceptoUnaHora && !todas.some((o) => (esPregunta(o) && PREGUNTA_DE_HORA.test(o)) || NO_PUDO.test(o))
}

/** Una fila por motivo. Agregar un motivo sin `detecta` ni `pruebas` no compila. */
export const DETECTORES = {
  cifra_sin_respaldo: {
    alcance: 'respuesta',
    detecta: (t, h) => montosEn(t).some((m) => !conRespaldo(m, h.montosConRespaldo)),
    pruebas: {
      dispara: ['Te queda en $50.000 con envío', 'Son 45 mil pesos', 'El total es 120.000'],
      noDispara: [
        'La bolsa de Castillo vale $38.000',
        'Las dos te quedan en $76.000',
        'Llega en 2 a 4 días',
        'Tu pedido #12 ya salió',
        'Son 500 g de café',
        'Pesa 1.500 gramos',
        'Tu pedido queda en $38.000 más $6.000 del domicilio, $44.000 en total.',
      ],
    },
  },
  nombre_interno: {
    alcance: 'respuesta',
    detecta: (t, h) => /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(t) || h.nombresInternos.some((n) => t.includes(n)),
    pruebas: {
      dispara: ['Voy a llamar crear_pedido con tus datos', 'Tu producto es 3f2a1c4e-1111-4222-8333-123456789abc'],
      noDispara: ['Ya te creé el pedido #12', 'Listo, quedó confirmado'],
    },
  },
  demasiados_emojis: {
    alcance: 'respuesta',
    detecta: (t, h) => (t.match(EMOJI)?.length ?? 0) > h.emojisMaximos,
    pruebas: { dispara: ['¡Listo! ☕☕'], noDispara: ['¡Listo! ☕', 'Listo, quedó confirmado'] },
  },
  demasiado_largo: {
    alcance: 'respuesta',
    detecta: (t) => t.length > LARGO_MAXIMO_DE_UNA_RESPUESTA,
    pruebas: { dispara: ['a'.repeat(LARGO_MAXIMO_DE_UNA_RESPUESTA + 1)], noDispara: ['Hola, ¿en qué te ayudo?'] },
  },
  /** Solo en la respuesta: el Dueño sí puede poner el Nequi o el fijo del Negocio en sus datos. */
  telefono_ajeno: {
    alcance: 'respuesta',
    detecta: (t, h) => telefonosEn(t).some((n) => !h.telefonosDelNegocio.includes(n) && !(h.telefonoDelCliente && soloDigitos(h.telefonoDelCliente).endsWith(n))),
    pruebas: {
      dispara: ['Escríbele a Juan al 311 555 1234', 'Llama al +57 300-123-4567'],
      noDispara: ['Te escribimos a este mismo número', 'Tu pedido es el 3001', 'Puedes pagar por Nequi al 310 555 1234 cuando te llegue.', 'Escríbenos al 601 555 1234 si necesitas algo.'],
    },
  },
  dice_ser_persona: {
    alcance: 'todo_texto',
    detecta: (t) => SER_PERSONA.some((p) => p.test(plano(t))),
    pruebas: {
      dispara: ['Tranquila, no soy un bot', 'Soy una persona real del equipo'],
      noDispara: ['Soy el asistente virtual de Café Ladera', 'Le paso tu mensaje a una persona del equipo'],
    },
  },
  pide_datos_de_pago: {
    alcance: 'todo_texto',
    detecta: (t) => frases(t).some((f) => DATO_DE_PAGO.test(f) && PEDIR.test(f) && !niega(f, PEDIR_DE_VERDAD)),
    pruebas: {
      dispara: ['Envíame el número de la tarjeta para cobrarte', 'Dime el código que te llegó por mensaje', 'Compárteme la clave del Nequi', 'No te preocupes, dime el código que te llegó'],
      noDispara: ['Nunca te vamos a pedir la clave ni el código de la tarjeta', 'Pagas en efectivo cuando te llegue', 'No compartas tu clave con nadie'],
    },
  },
  afirmacion_de_salud: {
    alcance: 'todo_texto',
    detecta: (t) => frases(t).some((f) => SALUD.some((p) => p.test(f)) && !niega(f, AFIRMAR_SALUD)),
    pruebas: {
      dispara: ['Este té cura la gastritis', 'El café verde adelgaza', 'Sirve para la diabetes', 'Ayuda a prevenir que te dé gripa', 'No te preocupes: este té cura la gastritis'],
      noDispara: ['No podemos decir que cure nada: consulta a tu médico', 'Es un café suave, de tueste medio', 'Para prevenir que pierda aroma, guárdalo en un frasco cerrado.', 'Este té no cura nada'],
    },
  },
  /** Vale para todo Negocio, porque un Rubro mal reconocido no tiene agenda y el modelo igual podría decirlo. */
  cita_sin_respaldo: {
    alcance: 'respuesta',
    detecta: (t, h) => citaSinRespaldo(t, h.cita),
    pruebas: {
      dispara: ['Listo, tu cita quedó agendada para el jueves', 'Te agendé la cita', 'Tu turno quedó confirmado', 'Te espero el jueves a las 3', 'Le reservé el jueves a las 3'],
      noDispara: [
        'Te esperamos pronto en la tienda',
        'Tu pedido quedó confirmado',
        'Pedido #12 confirmado',
        'Te aparté la bolsa',
        'Te reservé la bolsa',
        'Tu reserva de la bolsa quedó lista',
        'El Café Reserva Especial queda en $38.000',
        'Tu entrega quedó agendada para el jueves',
        'Tu recogida está agendada para mañana',
        'Todavía no agendamos citas por aquí',
        '¿Quieres que te ayude con algo más?',
      ],
    },
  },
  habla_de_otro_negocio: {
    alcance: 'todo_texto',
    detecta: (t, h) => h.otrosNegocios.some((n) => n.trim().length >= 3 && new RegExp(`\\b${plano(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(plano(t))),
    pruebas: { dispara: ['Eso lo vende Panadería Trigo'], noDispara: ['En Café Ladera tostamos cada semana'] },
  },
} as const satisfies Record<string, Detector>

export type MotivoDeRevision = keyof typeof DETECTORES

export type Revision = { readonly tipo: 'pasa' } | { readonly tipo: 'corregir'; readonly motivos: readonly MotivoDeRevision[] }

const MOTIVOS = Object.keys(DETECTORES) as MotivoDeRevision[]

/** Los hechos con que corren las tablas de pruebas: un Café con dos precios y un vecino de número. */
export const HECHOS_DE_PRUEBA: HechosDeRevision = {
  montosConRespaldo: new Set([38000, 76000, 6000]),
  telefonoDelCliente: '573001112233',
  telefonosDelNegocio: ['3105551234', '6015551234'],
  nombresInternos: ['crear_pedido', 'buscar_productos'],
  otrosNegocios: ['Panadería Trigo'],
  emojisMaximos: 1,
  cita: { tipo: 'sin_agenda' },
}

/** Pura. Corre todos los detectores sobre la respuesta del Agente de clientes. */
export function revisar(texto: string, hechos: HechosDeRevision): Revision {
  const motivos = MOTIVOS.filter((m) => DETECTORES[m].detecta(texto, hechos))
  return motivos.length ? { tipo: 'corregir', motivos } : { tipo: 'pasa' }
}

/** Pura. Solo los de `todo_texto`, sobre un texto del Dueño que puede llegar a un Cliente. */
export function revisarTextoDelDueno(texto: string, otrosNegocios: readonly string[]): readonly MotivoDeRevision[] {
  const hechos: HechosDeRevision = { montosConRespaldo: new Set(), telefonoDelCliente: null, telefonosDelNegocio: [], nombresInternos: [], otrosNegocios, emojisMaximos: 3, cita: { tipo: 'sin_agenda' } }
  return MOTIVOS.filter((m) => DETECTORES[m].alcance === 'todo_texto' && DETECTORES[m].detecta(texto, hechos))
}

/** Lo que el Dueño puede pedir que no se prometa (`no_prometer`). Cada uno con su tabla de pruebas. */
const NUMERO = '(?:\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)'

/** "en 2 días", "de 4 a 8 días hábiles", "dos a cuatro días", "48 horas"; no "hace 2 días" ni "7 días a la semana". */
const CANTIDAD_DE_TIEMPO = new RegExp(`(?<!\\bhace )(?<!\\blas )\\b${NUMERO}(?: (?:a|o|y) ${NUMERO})? (?:dias?|horas?|semanas?)\\b(?! (?:a la|al|por) (?:semana|dia)\\b)`)

const LLEGA_UN_DIA =
  /\b(llega|llegan|llegaria|llegara|entregamos|entregariamos|entregaremos|recibes|recibirias|recibiras|despachamos|despacharemos|sale|saldria|saldra|estara|estaria|tendras)\b.*\b(manana|hoy|esta semana|la proxima semana|(el|este|el proximo) (lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/

/** Lo que el Dueño puede pedir que no se prometa (`no_prometer`). Cada uno con su tabla de pruebas. */
export const PROMESAS = {
  plazo: {
    detecta: (t: string) => frases(t).some((f) => !niega(f) && (CANTIDAD_DE_TIEMPO.test(f) || LLEGA_UN_DIA.test(f))),
    pruebas: {
      dispara: [
        'Te llega en 3 días hábiles',
        'A Cali se demora de 2 a 4 días',
        'Lo recibes mañana',
        'El envío a Pasto toma de 4 a 8 días hábiles.',
        'Son de 2 a 4 días hábiles.',
        'El tiempo de entrega es de 4 a 8 días hábiles.',
        'Te llega en 3 días hábiles y no pagas envío.',
        'Te llega en 3 días, no te preocupes.',
        'Llega de dos a cuatro días.',
        'Lo tienes en casa en 2 días.',
        'A Pasto llega en unos 5 días, no es mucho.',
        'Lo tienes en 48 horas.',
        'Estará allá entre el lunes y el miércoles.',
        'No te puedo dar el número de guía, pero te llega en 3 días.',
      ],
      noDispara: [
        'No te puedo prometer una fecha; le pregunto a Ana',
        'No sé cuándo llega: lo confirmo con el equipo.',
        'No podemos asegurarte que llegue en 3 días.',
        'Despachamos de lunes a viernes',
        'Tu pedido salió hace 2 días.',
        'Atendemos 7 días a la semana.',
      ],
    },
  },
  descuento: {
    detecta: (t: string) => frases(t).some((f) => !niega(f, ['manejamos', 'hay', 'tenemos', 'hacemos', 'damos', 'ofrecemos']) && /\b(\d+ ?%|descuento|rebaja|promocion|te lo dejo en|precio especial)\b/.test(f)),
    pruebas: {
      dispara: ['Te hago un 10% de descuento', 'Te lo dejo en 30 mil', 'Tenemos una promoción para ti', 'No te preocupes, te hago un 10% de descuento'],
      noDispara: ['No manejamos descuentos por ahora', 'La bolsa vale $38.000'],
    },
  },
  disponibilidad: {
    detecta: (t: string) =>
      frases(t).some((f) => !niega(f, ['hay', 'tenemos', 'queda', 'quedan']) && /\b(hay|tenemos|queda|quedan)\b.*\b(disponible|disponibles|stock|existencias|unidades)\b|\besta disponible\b|\bsi hay\b/.test(f)),
    pruebas: {
      dispara: ['Sí hay, tenemos 5 unidades disponibles', 'Está disponible para envío hoy', 'No te preocupes, tenemos 5 unidades disponibles'],
      noDispara: ['Déjame confirmar si queda', 'No tenemos stock de ese'],
    },
  },
} as const satisfies Record<'plazo' | 'descuento' | 'disponibilidad', { detecta(t: string): boolean; pruebas: Pruebas }>

/** Coincidencia literal normalizada de `no_decir`. */
export function diceAlguna(texto: string, frasesProhibidas: readonly string[]): string | null {
  const t = plano(texto)
  return frasesProhibidas.find((f) => plano(f).trim() && t.includes(plano(f).trim())) ?? null
}
