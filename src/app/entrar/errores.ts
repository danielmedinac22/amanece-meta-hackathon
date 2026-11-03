/** Lo que le puede pasar al Dueño al entrar, sin importar quién autentica. Las palabras son de Amanece. */
export type MotivoDeEntrada = 'datos_no_coinciden' | 'ya_tiene_cuenta' | 'contrasena_corta' | 'contrasena_larga' | 'correo_invalido' | 'correo_sin_confirmar' | 'muchos_intentos' | 'sin_conexion' | 'no_se_pudo'

export const PALABRAS_DE_ENTRADA: Record<MotivoDeEntrada, string> = {
  datos_no_coinciden: 'El correo o la contraseña no coinciden. Revísalos y vuelve a intentar.',
  ya_tiene_cuenta: 'Ese correo ya tiene cuenta. Entra con tu contraseña.',
  contrasena_corta: 'Esa contraseña es muy corta. Usa al menos 8 caracteres.',
  contrasena_larga: 'Esa contraseña es muy larga. Usa una más corta.',
  correo_invalido: 'Ese correo no está completo. Revísalo, debe verse como nombre@correo.com.',
  correo_sin_confirmar: 'Todavía no confirmas tu correo. Abre el mensaje que te llegó y toca el enlace.',
  muchos_intentos: 'Ya van muchos intentos. Espera un minuto y vuelve a intentar.',
  sin_conexion: 'No me pude conectar. Revisa tu internet y vuelve a intentar.',
  no_se_pudo: 'No pude dejarte entrar. Vuelve a intentar en un momento.',
}

/** La única tabla que conoce los códigos del proveedor. Cambiar de proveedor es cambiar esta tabla y `con-neon-auth.tsx`. */
const MOTIVO_DEL_CODIGO: Record<string, MotivoDeEntrada> = {
  INVALID_EMAIL_OR_PASSWORD: 'datos_no_coinciden',
  INVALID_PASSWORD: 'datos_no_coinciden',
  USER_NOT_FOUND: 'datos_no_coinciden',
  USER_EMAIL_NOT_FOUND: 'datos_no_coinciden',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'datos_no_coinciden',
  USER_ALREADY_EXISTS: 'ya_tiene_cuenta',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'ya_tiene_cuenta',
  PASSWORD_TOO_SHORT: 'contrasena_corta',
  PASSWORD_TOO_LONG: 'contrasena_larga',
  INVALID_EMAIL: 'correo_invalido',
  EMAIL_NOT_VERIFIED: 'correo_sin_confirmar',
}

/** El límite de intentos responde 429 sin código. Nada del texto en inglés del proveedor llega al Dueño. */
export function motivoDelError({ code, status }: { code?: string; status?: number }): MotivoDeEntrada {
  if (code && Object.hasOwn(MOTIVO_DEL_CODIGO, code)) return MOTIVO_DEL_CODIGO[code]
  return status === 429 ? 'muchos_intentos' : 'no_se_pudo'
}
