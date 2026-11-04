/**
 * Lo que dice Entrar, lo que el Hilo reconoce como Capacidad faltante y lo que lee Ajustes, este último contra Neon
 * real y sin modelo: dos Negocios desechables, y lo de uno no se cuela en el otro. Borra lo que crea, también si falla.
 *
 *   pnpm tsx scripts/probar-estados.mts
 */
import { config } from 'dotenv'
import { inArray } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { UIMessage } from 'ai'
import { motivoDelError, PALABRAS_DE_ENTRADA, type MotivoDeEntrada } from '../src/app/entrar/errores'
import { esCapacidadFaltante, QUEDO_ANOTADO, tarjetaDeLaParte } from '../src/negocio/partes-del-hilo'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

console.log('Entrar')
const ESPERADOS: [string, MotivoDeEntrada][] = [
  ['form_password_incorrect', 'datos_no_coinciden'],
  ['form_identifier_not_found', 'datos_no_coinciden'],
  ['form_identifier_exists', 'ya_tiene_cuenta'],
  ['strategy_for_user_invalid', 'sin_contrasena'],
  ['form_password_length_too_short', 'contrasena_corta'],
  ['form_password_size_in_bytes_exceeded', 'contrasena_larga'],
  ['form_password_not_strong_enough', 'contrasena_debil'],
  ['form_password_pwned', 'contrasena_filtrada'],
  ['form_param_format_invalid', 'correo_invalido'],
  ['form_code_incorrect', 'codigo_incorrecto'],
  ['verification_expired', 'codigo_vencido'],
  ['user_locked', 'muchos_intentos'],
  ['network_error', 'sin_conexion'],
]
for (const [code, motivo] of ESPERADOS) afirmar(`${code} se dice como ${motivo}`, motivoDelError({ code, status: 400 }) === motivo)
afirmar('El límite de intentos llega sin código', motivoDelError({ status: 429 }) === 'muchos_intentos')
afirmar('Un código que no conocemos no deja pasar el inglés', motivoDelError({ code: 'origin_invalid', status: 403 }) === 'no_se_pudo' && motivoDelError({}) === 'no_se_pudo')
afirmar('Un código con nombre de propiedad de objeto no rompe la tabla', motivoDelError({ code: 'constructor' }) === 'no_se_pudo')
for (const [motivo, palabras] of Object.entries(PALABRAS_DE_ENTRADA)) {
  afirmar(`${motivo}: dice qué pasó y qué hacer, sin disculpas`, palabras.split('. ').length === 2 && !/lo siento|perd[oó]n|disculpa|lament|sorry|invalid|error/i.test(palabras), palabras)
}

console.log('\nCapacidad faltante en el Hilo')
const parte = (type: string, state: string, output?: object) => ({ type, state, toolCallId: 'x', input: {}, output }) as unknown as UIMessage['parts'][number]
const nucleo = readFileSync(fileURLToPath(new URL('../src/nucleo/cambios/index.ts', import.meta.url)), 'utf8')
afirmar('La frase que la reconoce sigue en el resumen del núcleo', nucleo.includes(`${QUEDO_ANOTADO};`))
afirmar('registrar_capacidad_faltante, ya anotada', esCapacidadFaltante(parte('tool-registrar_capacidad_faltante', 'output-available', { ok: true })))
afirmar('Mientras corre todavía no está anotada', !esCapacidadFaltante(parte('tool-registrar_capacidad_faltante', 'input-available')))
afirmar('Si no se pudo anotar, no dice que sí', !esCapacidadFaltante(parte('tool-registrar_capacidad_faltante', 'output-available', { ok: false, error: 'x' })))
afirmar('proponer que terminó en Capacidad faltante', esCapacidadFaltante(parte('tool-proponer', 'output-available', { resumen: `No está. ${QUEDO_ANOTADO}; díselo.`, tarjeta: null })))
afirmar('proponer sin tarjeta por otra razón no lo es', !esCapacidadFaltante(parte('tool-proponer', 'output-available', { resumen: 'Falta la hora.', tarjeta: null })))
const conTarjeta = parte('tool-proponer', 'output-available', { resumen: 'Listo', tarjeta: { propuesta: 'p' } })
afirmar('proponer con tarjeta es una decisión, no una Capacidad faltante', !esCapacidadFaltante(conTarjeta) && tarjetaDeLaParte(conTarjeta) !== null)

console.log('\nAjustes contra la base')
const { db, esquema } = await import('../src/db')
const { ajustesDe } = await import('../src/nucleo/ajustes')
const { guardarEnElAlta } = await import('../src/nucleo/cambios')
const { leerAplicado } = await import('../src/nucleo/estado')
const { marcar } = await import('../src/nucleo/identidad')

const marca = String(Date.now()).slice(-7)
const creados: string[] = []

async function negocioNuevo(letra: string, estado: 'armando' | 'listo', ciudad: string | null) {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Ajustes ${letra} ${marca}`, codigo: `AJ${letra}${marca}` }).returning()
  creados.push(n.id)
  const [d] = await db.insert(esquema.duenos).values({ negocioId: n.id, usuarioId: `probar-estados-${letra}-${marca}`, nombre: `Dueño ${letra}` }).returning()
  if (ciudad) await guardarEnElAlta({ negocio: marcar.negocio(n.id), dueno: marcar.dueno(d.id), medio: 'web' }, { nombre: null, rubro: null, quiere: [{ tipo: 'poner', elemento: { tipo: 'dato', campo: 'ciudad', valor: ciudad }, reemplaza: null }] })
  if (estado === 'listo') await db.update(esquema.negocios).set({ estado }).where(inArray(esquema.negocios.id, [n.id]))
  return n
}

try {
  const abierto = await negocioNuevo('A', 'listo', 'Pereira')
  const armandose = await negocioNuevo('B', 'armando', null)
  const a = ajustesDe(await leerAplicado(marcar.negocio(abierto.id)))
  const b = ajustesDe(await leerAplicado(marcar.negocio(armandose.id)))
  afirmar('Abierto: su nombre y su ciudad', a.nombre === abierto.nombre && a.ciudad === 'Pereira', a)
  afirmar('Abierto: el link lleva su código', a.link?.startsWith('https://wa.me/') === true && a.link.includes(abierto.codigo), a.link)
  afirmar('Armándose: sin ciudad y sin link, y nada del otro Negocio', b.nombre === armandose.nombre && b.ciudad === '' && b.link === null, b)
} finally {
  if (creados.length) await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
}

terminar()
