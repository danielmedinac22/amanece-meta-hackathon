/** El mínimo de la instancia de Clerk. Se cambia allá y aquí a la vez: si no, esta pantalla promete algo que Clerk rechaza. */
export const MINIMO_DE_CONTRASENA = 15

/** Lo que le puede pasar al Dueño al entrar, sin importar quién autentica. Las palabras son de Amanece. */
export type MotivoDeEntrada =
  | 'datos_no_coinciden'
  | 'ya_tiene_cuenta'
  | 'correo_sin_cuenta'
  | 'sin_contrasena'
  | 'contrasena_corta'
  | 'contrasena_larga'
  | 'contrasena_debil'
  | 'contrasena_filtrada'
  | 'correo_invalido'
  | 'codigo_incorrecto'
  | 'codigo_vencido'
  | 'muchos_intentos'
  | 'sin_conexion'
  | 'no_se_pudo'

export const PALABRAS_DE_ENTRADA: Record<MotivoDeEntrada, string> = {
  datos_no_coinciden: 'El correo o la contraseña no coinciden. Revísalos y vuelve a intentar.',
  ya_tiene_cuenta: 'Ese correo ya tiene cuenta. Entra con tu contraseña.',
  correo_sin_cuenta: 'No encontré una cuenta con ese correo. Revísalo o crea una.',
  sin_contrasena: 'Esa cuenta no tiene contraseña todavía. Toca ¿Olvidaste tu contraseña? y crea una, o sigue con Google.',
  contrasena_corta: `Esa contraseña es muy corta. Usa al menos ${MINIMO_DE_CONTRASENA} caracteres.`,
  contrasena_larga: 'Esa contraseña es muy larga. Usa una más corta.',
  contrasena_debil: 'Esa contraseña es muy fácil de adivinar. Usa otra.',
  contrasena_filtrada: 'Esa contraseña salió en una filtración de otra página. Toca ¿Olvidaste tu contraseña? y crea otra.',
  correo_invalido: 'Ese correo no está completo. Revísalo, debe verse como nombre@correo.com.',
  codigo_incorrecto: 'Ese código no coincide. Revísalo y vuelve a intentar.',
  codigo_vencido: 'Ese código ya venció. Pide otro y vuelve a intentar.',
  muchos_intentos: 'Ya van muchos intentos. Espera un minuto y vuelve a intentar.',
  sin_conexion: 'No me pude conectar. Revisa tu internet y vuelve a intentar.',
  no_se_pudo: 'No pude dejarte entrar. Vuelve a intentar en un momento.',
}

/** La única tabla que conoce los códigos del proveedor. Cambiar de proveedor es cambiar esta tabla y `con-clerk.tsx`. */
const MOTIVO_DEL_CODIGO: Record<string, MotivoDeEntrada> = {
  form_password_incorrect: 'datos_no_coinciden',
  form_password_or_identifier_incorrect: 'datos_no_coinciden',
  form_identifier_not_found: 'datos_no_coinciden',
  form_identifier_exists: 'ya_tiene_cuenta',
  strategy_for_user_invalid: 'sin_contrasena',
  form_password_length_too_short: 'contrasena_corta',
  form_password_size_in_bytes_exceeded: 'contrasena_larga',
  form_password_not_strong_enough: 'contrasena_debil',
  form_password_matches_identifier: 'contrasena_debil',
  form_password_pwned: 'contrasena_filtrada',
  form_password_compromised: 'contrasena_filtrada',
  form_password_untrusted: 'contrasena_filtrada',
  form_param_format_invalid: 'correo_invalido',
  form_code_incorrect: 'codigo_incorrecto',
  verification_expired: 'codigo_vencido',
  verification_failed: 'muchos_intentos',
  too_many_requests: 'muchos_intentos',
  user_locked: 'muchos_intentos',
  network_error: 'sin_conexion',
}

/** Nada del texto en inglés del proveedor llega al Dueño: un código que no conocemos dice `no_se_pudo`. */
export function motivoDelError({ code, status }: { code?: string; status?: number }): MotivoDeEntrada {
  if (code && Object.hasOwn(MOTIVO_DEL_CODIGO, code)) return MOTIVO_DEL_CODIGO[code]
  return status === 429 ? 'muchos_intentos' : 'no_se_pudo'
}
