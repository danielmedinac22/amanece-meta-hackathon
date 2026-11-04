/**
 * Pasa las cuentas de Neon Auth a Clerk. Solo escribe en Clerk y nunca en `duenos`: cada fila pasa al id de Clerk cuando
 * ese Dueño entra (`sinFila` en `src/negocio/sesion.ts`), así que se puede correr antes o después de publicar y otra vez
 * al final, para los que se registraron en medio. Sin `--de-verdad` solo cuenta, y primero hay que leer ese conteo.
 *
 * `--con-sin-verificar` también pasa las cuentas sin verificar, con el correo por confirmar en Clerk: la puerta no las
 * enlaza hasta que su dueño escriba un código de ese correo. Sin esta bandera se quedan afuera y se listan.
 *
 *   pnpm tsx scripts/importar-cuentas.mts
 *   pnpm tsx scripts/importar-cuentas.mts --de-verdad --base=<endpoint que imprime la corrida sin bandera>
 *   Una llave que no sea `sk_test_` pide además `--produccion`.
 */
import { config } from 'dotenv'
import { pathToFileURL } from 'node:url'

export type CuentaVieja = {
  id: string
  nombre: string | null
  email: string
  verificado: boolean
  /** `password` de `neon_auth.account`. `null` si entró con Google. */
  contrasena: string | null
  correoDelDueno: string | null
}

export type EnClerk = { id: string; idViejo: string | null; correoVerificado: boolean; tieneDueno: boolean }

export type Decision =
  | { accion: 'crear'; digest: string | null; confirmaAlEntrar: boolean }
  | { accion: 'poner_id_viejo'; clerkId: string }
  | { accion: 'ya_estaba' }
  | { accion: 'omitir_sin_verificar' }
  | { accion: 'choca'; clerkId: string; porque: string }

/**
 * Better Auth guarda `sal:llave` en hexadecimal, con scrypt N=16384, r=16, p=1 y 64 bytes, y usa la sal como texto. Es
 * lo mismo que `scrypt_werkzeug` de Clerk con esos parámetros. Otra forma da `null`: esa persona crea una contraseña nueva.
 */
export function digestDeClerk(contrasena: string | null): string | null {
  const partes = contrasena?.match(/^([0-9a-f]{32}):([0-9a-f]{128})$/)
  return partes ? `scrypt:16384:16:1$${partes[1]}$${partes[2]}` : null
}

/** Un correo sin verificar en el lado viejo no enlaza nada: cualquiera pudo escribir el correo de otro. */
export function decidir(vieja: CuentaVieja, porId: EnClerk | null, porCorreo: EnClerk | null, conSinVerificar = false): Decision {
  if (porId) return { accion: 'ya_estaba' }
  if (!vieja.verificado && !conSinVerificar) return { accion: 'omitir_sin_verificar' }
  if (!porCorreo) return { accion: 'crear', digest: digestDeClerk(vieja.contrasena), confirmaAlEntrar: !vieja.verificado }
  if (porCorreo.idViejo) return { accion: 'choca', clerkId: porCorreo.id, porque: 'ese correo ya es de otra cuenta importada' }
  if (!porCorreo.correoVerificado) return { accion: 'choca', clerkId: porCorreo.id, porque: 'ese correo está sin verificar en Clerk' }
  // Ya entró y recibió un Negocio: la puerta nunca miraría el id viejo, y el Negocio de antes se quedaría sin Dueño.
  if (porCorreo.tieneDueno) return { accion: 'choca', clerkId: porCorreo.id, porque: 'esa cuenta de Clerk ya tiene su propio Negocio' }
  return { accion: 'poner_id_viejo', clerkId: porCorreo.id }
}

type UsuarioDeClerk = { id: string; external_id: string | null; email_addresses: { email_address: string; verification: { status: string } | null }[] }

export function clerkConLlave(llave: string, tieneDueno: (clerkId: string) => Promise<boolean> = async () => false) {
  async function pedir(ruta: string, metodo = 'GET', cuerpo?: unknown): Promise<unknown> {
    for (;;) {
      const r = await fetch(`https://api.clerk.com/v1${ruta}`, {
        method: metodo,
        headers: { authorization: `Bearer ${llave}`, 'content-type': 'application/json' },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
      if (r.status === 429) {
        await new Promise((listo) => setTimeout(listo, 1000 * Number(r.headers.get('retry-after') ?? 10)))
        continue
      }
      const datos = await r.json().catch(() => null)
      if (!r.ok) throw new Error(`Clerk respondió ${r.status} a ${metodo} ${ruta.split('?')[0]}: ${JSON.stringify(datos).slice(0, 300)}`)
      return datos
    }
  }
  const comoEnClerk = (u: UsuarioDeClerk, email: string, tieneDueno: boolean): EnClerk => ({
    id: u.id,
    idViejo: u.external_id,
    correoVerificado: u.email_addresses.some((c) => c.email_address.toLowerCase() === email.toLowerCase() && c.verification?.status === 'verified'),
    tieneDueno,
  })
  const buscar = async (consulta: string, email: string) => {
    const [u] = (await pedir(`/users?${consulta}&limit=1`)) as UsuarioDeClerk[]
    return u ? comoEnClerk(u, email, await tieneDueno(u.id)) : null
  }
  return {
    pedir,
    porIdViejo: (id: string, email: string) => buscar(`external_id=${encodeURIComponent(id)}`, email),
    porCorreo: (email: string) => buscar(`email_address=${encodeURIComponent(email)}`, email),
    crear: (vieja: CuentaVieja, digest: string | null, confirmaAlEntrar: boolean) =>
      pedir('/users', 'POST', {
        email_address: [vieja.email],
        ...(confirmaAlEntrar ? { email_address_identification_status: ['reserved'] } : {}),
        external_id: vieja.id,
        first_name: vieja.nombre || undefined,
        ...(digest ? { password_digest: digest, password_hasher: 'scrypt_werkzeug' } : { skip_password_requirement: true }),
      }),
    ponerIdViejo: (clerkId: string, idViejo: string) => pedir(`/users/${clerkId}`, 'PATCH', { external_id: idViejo }),
  }
}

export type ResumenDeImportacion = Record<Decision['accion'] | 'fallo', string[]> & { sinDigest: string[]; correoDistintoDelDueno: string[] }

/** Idempotente: la segunda corrida solo encuentra `ya_estaba`. Una fila que falla se cuenta y no frena a las demás. */
export async function importar(cuentas: readonly CuentaVieja[], clerk: ReturnType<typeof clerkConLlave>, opciones: { deVerdad: boolean; conSinVerificar?: boolean }): Promise<ResumenDeImportacion> {
  const resumen: ResumenDeImportacion = { crear: [], poner_id_viejo: [], ya_estaba: [], omitir_sin_verificar: [], choca: [], fallo: [], sinDigest: [], correoDistintoDelDueno: [] }
  for (const vieja of cuentas) {
    if (vieja.correoDelDueno !== null && vieja.correoDelDueno.toLowerCase() !== vieja.email.toLowerCase()) resumen.correoDistintoDelDueno.push(vieja.id)
    try {
      const decision = decidir(vieja, await clerk.porIdViejo(vieja.id, vieja.email), await clerk.porCorreo(vieja.email), opciones.conSinVerificar)
      if (decision.accion === 'crear' && !decision.digest) resumen.sinDigest.push(vieja.id)
      if (opciones.deVerdad && decision.accion === 'crear') await clerk.crear(vieja, decision.digest, decision.confirmaAlEntrar)
      if (opciones.deVerdad && decision.accion === 'poner_id_viejo') await clerk.ponerIdViejo(decision.clerkId, vieja.id)
      resumen[decision.accion].push(vieja.id)
    } catch (e) {
      console.error(`${vieja.id}: ${e instanceof Error ? e.message : String(e)}`)
      resumen.fallo.push(vieja.id)
    }
  }
  return resumen
}

/** Las lecturas que corre `main`, aparte para que `probar-sesion` las pruebe contra el esquema de verdad. */
export const CUENTAS_VIEJAS_SQL = `
  select u.id::text as id, u.name as nombre, u.email, u."emailVerified" as verificado, a.password as contrasena, d.email as "correoDelDueno"
  from neon_auth."user" u
  left join neon_auth.account a on a."userId" = u.id and a."providerId" = 'credential'
  left join duenos d on d.usuario_id = u.id::text
  order by u."createdAt"`

/** Dueños sin cuenta vieja ni de Clerk: el importador no los puede pasar y esperarían para siempre. */
export const DUENOS_SIN_CUENTA_SQL = `
  select d.id::text as id from duenos d
  where d.usuario_id not like 'user\\_%' and not exists (select 1 from neon_auth."user" u where u.id::text = d.usuario_id)`

async function main() {
  config({ path: '.env.local', quiet: true })
  const argumentos = process.argv.slice(2)
  const deVerdad = argumentos.includes('--de-verdad')
  const llave = process.env.CLERK_SECRET_KEY
  if (!llave) throw new Error('Falta CLERK_SECRET_KEY.')
  const esDesarrollo = llave.startsWith('sk_test_')
  if (!esDesarrollo && !argumentos.includes('--produccion')) throw new Error('Esta llave no es de desarrollo. Para producción, Daniel pasa --produccion.')
  const urlDeLaBase = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!urlDeLaBase) throw new Error('Falta DATABASE_URL.')
  const base = new URL(urlDeLaBase).hostname.split('.')[0].replace('-pooler', '')
  console.log(`Base: ${base}. Clerk: ${esDesarrollo ? 'desarrollo' : 'producción'}. ${deVerdad ? 'Escribe en Clerk.' : 'Solo cuenta, no escribe.'}`)
  // Una llave de desarrollo con la base de producción copiaría correos y contraseñas reales a la instancia de pruebas.
  if (deVerdad && !argumentos.includes(`--base=${base}`)) throw new Error(`Para escribir, repite la base que vas a leer: --base=${base}`)

  const { Client } = await import('@neondatabase/serverless')
  const cliente = new Client(urlDeLaBase)
  await cliente.connect()
  try {
    const { rows } = await cliente.query<CuentaVieja>(CUENTAS_VIEJAS_SQL)
    const sinCuenta = await cliente.query<{ id: string }>(DUENOS_SIN_CUENTA_SQL)
    const tieneDueno = async (clerkId: string) => ((await cliente.query('select 1 from duenos where usuario_id = $1', [clerkId])).rowCount ?? 0) > 0
    console.log(`Cuentas: ${rows.length}. Verificadas: ${rows.filter((c) => c.verificado).length}. Sin verificar: ${rows.filter((c) => !c.verificado).length}.`)
    console.log(`Dueños sin cuenta vieja: ${sinCuenta.rows.length}${sinCuenta.rows.length ? ` (${sinCuenta.rows.map((d) => d.id).join(', ')})` : ''}.`)
    const resumen = await importar(rows, clerkConLlave(llave, tieneDueno), { deVerdad, conSinVerificar: argumentos.includes('--con-sin-verificar') })
    for (const [que, ids] of Object.entries(resumen)) console.log(`${que}: ${ids.length}${ids.length && que !== 'crear' && que !== 'ya_estaba' ? ` (${ids.join(', ')})` : ''}`)
    if (resumen.fallo.length) process.exitCode = 1
  } finally {
    await cliente.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
