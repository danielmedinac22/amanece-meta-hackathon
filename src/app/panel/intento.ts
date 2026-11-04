export type Intento = { readonly texto: string; readonly id: string }

/**
 * Pura. Con el mismo texto el reintento lleva el mismo id, y si el primero sí llegó no sale dos veces. Con otro texto
 * es otro mensaje: con el id viejo, el servidor contestaría que ya salió y lo nuevo no saldría nunca.
 */
export const intentoPara = (previo: Intento | null, texto: string, nuevoId: () => string): Intento => (previo?.texto === texto ? previo : { texto, id: nuevoId() })
