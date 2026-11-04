/**
 * Lo que la portada le muestra al visitante es lo que el código dejaría salir. Sin base ni modelo: solo textos.
 *
 *   pnpm tsx scripts/probar-portada.mts
 */
import { plantillasDe } from '../src/app/plantillas-datos'
import { imagenParaCompartir, TAMANO_DE_IMAGEN } from '../src/app/portada/imagen-para-compartir'
import { TEXTOS, type Idioma } from '../src/app/portada/textos'
import { HECHOS_DE_PRUEBA, revisar } from '../src/nucleo/salida/revisar'
import { afirmar, terminar } from './afirmar.mjs'

const NUNCA = [/cr[eé]dito/i, /credit/i, /122/, /waichat/i, /—/]
const IDIOMAS: Idioma[] = ['es', 'en']
const PESO_MAXIMO_DE_LA_IMAGEN = 300 * 1024

const textosDe = (valor: unknown): string[] => {
  if (typeof valor === 'string') return [valor]
  if (Array.isArray(valor)) return valor.flatMap(textosDe)
  if (valor && typeof valor === 'object') return Object.values(valor).flatMap(textosDe)
  return []
}

try {
  for (const { pregunta, respuesta, caso } of TEXTOS.es.dificil.preguntas) {
    afirmar(`«${pregunta}»: la respuesta pasa por revisar`, revisar(respuesta, HECHOS_DE_PRUEBA).tipo === 'pasa', revisar(respuesta, HECHOS_DE_PRUEBA))
    if (caso) afirmar(`«${pregunta}»: la respuesta del Caso pasa por revisar`, revisar(caso.respuesta, HECHOS_DE_PRUEBA).tipo === 'pasa', revisar(caso.respuesta, HECHOS_DE_PRUEBA))
  }
  afirmar('revisar sí atrapa lo que la muestra promete atrapar: un precio fuera del catálogo', revisar('Te la dejo en $20.000', HECHOS_DE_PRUEBA).tipo === 'corregir')
  afirmar('revisar sí atrapa lo que la muestra promete atrapar: decir que es una persona', revisar('Soy una persona real del equipo', HECHOS_DE_PRUEBA).tipo === 'corregir')
  afirmar('revisar sí atrapa lo que la muestra promete atrapar: una promesa de salud', revisar('Este café sirve para la gastritis', HECHOS_DE_PRUEBA).tipo === 'corregir')

  for (const idioma of IDIOMAS) {
    const todos = [...textosDe(TEXTOS[idioma]), ...textosDe(plantillasDe(idioma))]
    afirmar(`${idioma}: hay textos para revisar`, todos.length > 100, todos.length)
    for (const nunca of NUNCA) {
      const con = todos.filter((t) => nunca.test(t))
      afirmar(`${idioma}: ningún texto tiene ${nunca}`, con.length === 0, con)
    }
  }

  for (const idioma of IDIOMAS) {
    const png = Buffer.from(await (await imagenParaCompartir(idioma)).arrayBuffer())
    afirmar(`${idioma}: la imagen para compartir mide lo que declara`, png.readUInt32BE(16) === TAMANO_DE_IMAGEN.width && png.readUInt32BE(20) === TAMANO_DE_IMAGEN.height, { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) })
    afirmar(`${idioma}: la imagen para compartir es liviana para que WhatsApp la muestre`, png.length < PESO_MAXIMO_DE_LA_IMAGEN, png.length)
  }

  const { es, en } = TEXTOS
  const cifras = (texto: string) => (texto.match(/\d[\d.,]*\d|\d/g) ?? []).map((c) => c.replace(/[.,]/g, '')).join()
  es.dificil.preguntas.forEach((p, i) => afirmar(`«${p.pregunta}»: las cifras son las mismas en inglés`, cifras(p.respuesta) === cifras(en.dificil.preguntas[i].respuesta), { es: p.respuesta, en: en.dificil.preguntas[i].respuesta }))
  const formaDelDia = (i: Idioma) => TEXTOS[i].dia.momentos.map((m) => `${m.hora} ${m.meridiano} ${m.pieza.tipo}`).join()
  afirmar('los dos idiomas cuentan el mismo día', formaDelDia('es') === formaDelDia('en'), { es: formaDelDia('es'), en: formaDelDia('en') })
  afirmar('los dos idiomas traen las mismas preguntas y los mismos Casos', es.dificil.preguntas.map((p) => !!p.caso).join() === en.dificil.preguntas.map((p) => !!p.caso).join())
  afirmar('los dos idiomas traen las mismas plantillas con sus ids', plantillasDe('es').map((p) => p.id).join() === plantillasDe('en').map((p) => p.id).join())
} catch (e) {
  afirmar('probar-portada terminó sin error inesperado', false, e)
} finally {
  terminar()
}
