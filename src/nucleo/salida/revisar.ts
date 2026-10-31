/**
 * Detectores en código, entre el modelo y la compuerta, y sobre lo que escribe el Dueño. Cada fila trae su
 * detector y su tabla de pruebas, que corre `scripts/probar-revisar.mts`. Puro: no lee la base ni llama modelos.
 */

export type HechosDeRevision = {
  /** Productos, pedidos del Cliente, lo que devolvieron las herramientas del turno y, hasta que exista `precio`, las cifras de los `dato`. */
  readonly montosConRespaldo: ReadonlySet<number>
  readonly telefonoDelCliente: string | null
  readonly nombresInternos: readonly string[]
  readonly otrosNegocios: readonly string[]
  readonly emojisMaximos: 0 | 1 | 2 | 3
}

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

const EMOJI = /\p{Extended_Pictographic}/gu

const TELEFONO = /(?<!\d)(?:\+?57[\s-]?)?(3\d{2}[\s-]?\d{3}[\s-]?\d{4}|60\d[\s-]?\d{3}[\s-]?\d{4})(?!\d)/g

const soloDigitos = (s: string) => s.replace(/\D/g, '')

/** Una frase que niega lo que sigue ("nunca te pido la clave", "no cura"): no es una afirmación ni un pedido. */
function negada(frase: string): boolean {
  return /\b(no|nunca|jamas|ni)\b/.test(frase)
}

function frases(texto: string): string[] {
  return plano(texto)
    .split(/[.!?¿¡\n]+/)
    .map((f) => f.trim())
    .filter(Boolean)
}

const DATO_DE_PAGO = /\b(numero de (la |tu )?tarjeta|cvv|cvc|codigo de seguridad|clave|contrasena|codigo de verificacion|codigo que te llego|otp|pin)\b/
const PEDIR = /\b(envia|enviame|mandame|manda|dime|dame|comparte|comparteme|compartenos|compartime|escribe|escribeme|pasame|necesito|necesitamos|regalame|indicame|confirma|confirmame)\b/

const SALUD = [
  /\bcura(r|n)?\b/,
  /\bprevien(e|en)\b/,
  /\bprevenir\b/,
  /\b(sirve|ayuda|es bueno|es buena) (para|contra) (la |el )?(diabetes|gastritis|cancer|presion|tension|colesterol|ansiedad|depresion|artritis|migrana|insomnio|covid|gripa)\b/,
  /\badelgaza\b/,
  /\b(baja|bajar) de peso\b/,
  /\bquema (la )?grasa\b/,
  /\bcontrola (la |el )?(presion|tension|azucar|diabetes|colesterol)\b/,
]

const SER_PERSONA = [/\bno soy (un |una )?(bot|robot|asistente virtual|maquina|ia|inteligencia artificial)\b/, /\bsoy (una |un )?(persona|humano|humana|persona real|de carne y hueso)\b/]

/** Una fila por motivo. Agregar un motivo sin `detecta` ni `pruebas` no compila. */
export const DETECTORES = {
  cifra_sin_respaldo: {
    alcance: 'respuesta',
    detecta: (t, h) => montosEn(t).some((m) => !h.montosConRespaldo.has(m)),
    pruebas: {
      dispara: ['Te queda en $50.000 con envío', 'Son 45 mil pesos', 'El total es 120.000'],
      noDispara: ['La bolsa de Castillo vale $38.000', 'Las dos te quedan en $76.000', 'Llega en 2 a 4 días', 'Tu pedido #12 ya salió', 'Son 500 g de café', 'Pesa 1.500 gramos'],
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
  telefono_ajeno: {
    alcance: 'todo_texto',
    detecta: (t, h) => [...t.matchAll(TELEFONO)].some((m) => !h.telefonoDelCliente || !soloDigitos(h.telefonoDelCliente).endsWith(soloDigitos(m[1]))),
    pruebas: {
      dispara: ['Escríbele a Juan al 311 555 1234', 'Llama al +57 300-123-4567'],
      noDispara: ['Te escribimos a este mismo número', 'Tu pedido es el 3001'],
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
    detecta: (t) => frases(t).some((f) => DATO_DE_PAGO.test(f) && PEDIR.test(f) && !negada(f)),
    pruebas: {
      dispara: ['Envíame el número de la tarjeta para cobrarte', 'Dime el código que te llegó por mensaje', 'Compárteme la clave del Nequi'],
      noDispara: ['Nunca te vamos a pedir la clave ni el código de la tarjeta', 'Pagas en efectivo cuando te llegue', 'No compartas tu clave con nadie'],
    },
  },
  afirmacion_de_salud: {
    alcance: 'todo_texto',
    detecta: (t) => frases(t).some((f) => SALUD.some((p) => p.test(f)) && !negada(f)),
    pruebas: {
      dispara: ['Este té cura la gastritis', 'El café verde adelgaza', 'Sirve para la diabetes'],
      noDispara: ['No podemos decir que cure nada: consulta a tu médico', 'Es un café suave, de tueste medio'],
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
  montosConRespaldo: new Set([38000, 76000]),
  telefonoDelCliente: '573001112233',
  nombresInternos: ['crear_pedido', 'buscar_productos'],
  otrosNegocios: ['Panadería Trigo'],
  emojisMaximos: 1,
}

/** Pura. Corre todos los detectores sobre la respuesta del Agente de clientes. */
export function revisar(texto: string, hechos: HechosDeRevision): Revision {
  const motivos = MOTIVOS.filter((m) => DETECTORES[m].detecta(texto, hechos))
  return motivos.length ? { tipo: 'corregir', motivos } : { tipo: 'pasa' }
}

/** Pura. Solo los de `todo_texto`, sobre un texto del Dueño que puede llegar a un Cliente. */
export function revisarTextoDelDueno(texto: string, otrosNegocios: readonly string[]): readonly MotivoDeRevision[] {
  const hechos: HechosDeRevision = { montosConRespaldo: new Set(), telefonoDelCliente: null, nombresInternos: [], otrosNegocios, emojisMaximos: 3 }
  return MOTIVOS.filter((m) => DETECTORES[m].alcance === 'todo_texto' && DETECTORES[m].detecta(texto, hechos))
}

/** Lo que el Dueño puede pedir que no se prometa (`no_prometer`). Cada uno con su tabla de pruebas. */
export const PROMESAS = {
  plazo: {
    detecta: (t: string) =>
      frases(t).some(
        (f) =>
          !negada(f) &&
          (/\b(te )?(llega|llegaria|llegan|entregamos|entregariamos|recibes|recibirias|despachamos)\b.*\b(\d+ (a \d+ )?(dias|horas|semanas)|manana|hoy|esta semana|el (lunes|martes|miercoles|jueves|viernes|sabado))\b/.test(f) ||
            /\b(se demora|tarda|demora)\b.*\b\d+ (a \d+ )?(dias|horas|semanas)\b/.test(f)),
      ),
    pruebas: {
      dispara: ['Te llega en 3 días hábiles', 'A Cali se demora de 2 a 4 días', 'Lo recibes mañana'],
      noDispara: ['No te puedo prometer una fecha; le pregunto a Ana', 'Despachamos de lunes a viernes'],
    },
  },
  descuento: {
    detecta: (t: string) => frases(t).some((f) => !negada(f) && /\b(\d+ ?%|descuento|rebaja|promocion|te lo dejo en|precio especial)\b/.test(f)),
    pruebas: {
      dispara: ['Te hago un 10% de descuento', 'Te lo dejo en 30 mil', 'Tenemos una promoción para ti'],
      noDispara: ['No manejamos descuentos por ahora', 'La bolsa vale $38.000'],
    },
  },
  disponibilidad: {
    detecta: (t: string) => frases(t).some((f) => !negada(f) && /\b(hay|tenemos|queda|quedan)\b.*\b(disponible|disponibles|stock|existencias|unidades)\b|\besta disponible\b|\bsi hay\b/.test(f)),
    pruebas: {
      dispara: ['Sí hay, tenemos 5 unidades disponibles', 'Está disponible para envío hoy'],
      noDispara: ['Déjame confirmar si queda', 'No tenemos stock de ese'],
    },
  },
} as const satisfies Record<'plazo' | 'descuento' | 'disponibilidad', { detecta(t: string): boolean; pruebas: Pruebas }>

/** Coincidencia literal normalizada de `no_decir`. */
export function diceAlguna(texto: string, frasesProhibidas: readonly string[]): string | null {
  const t = plano(texto)
  return frasesProhibidas.find((f) => plano(f).trim() && t.includes(plano(f).trim())) ?? null
}
