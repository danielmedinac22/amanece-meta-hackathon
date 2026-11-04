import { imagenParaCompartir, TAMANO_DE_IMAGEN } from './portada/imagen-para-compartir'
import { TEXTOS } from './portada/textos'

export const alt = TEXTOS.es.meta.altDeImagen
export const size = TAMANO_DE_IMAGEN
export const contentType = 'image/png'

export default function Image() {
  return imagenParaCompartir('es')
}
