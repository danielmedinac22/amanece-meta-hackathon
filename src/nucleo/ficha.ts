/** La ficha del link `wa.me`: `(CODIGO)` al inicio del texto, en mayúsculas o minúsculas. Nada más del texto enruta. */
export const FICHA_DE_ENRUTAMIENTO = /^\(([A-Za-z0-9]{3,12})\)/

/** Solo la de este Negocio: `(sin) azúcar` tiene la misma forma y lo escribió el Cliente. */
export const sinSuFicha = (texto: string, codigo: string) => (FICHA_DE_ENRUTAMIENTO.exec(texto)?.[1].toUpperCase() === codigo ? texto.replace(FICHA_DE_ENRUTAMIENTO, '') : texto)
