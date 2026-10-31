import { Pool } from '@neondatabase/serverless'
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import type { Marca } from '../nucleo/identidad'
import * as esquema from './esquema'

type TransaccionDeDrizzle = Parameters<Parameters<NeonDatabase<typeof esquema>['transaction']>[0]>[0]

/**
 * Una conexión dentro de `BEGIN … COMMIT`, que solo produce `conTransaccion`. Es la transacción de drizzle con
 * marca, no el `query(sql, params)` de `tipos.ts`: así se escribe con el mismo `esquema` que el resto del repo.
 */
export type Transaccion = Marca<TransaccionDeDrizzle, 'Transaccion'>

class Deshecha {
  constructor(readonly valor: unknown) {}
}

/**
 * La única transacción interactiva: `neon-http` no las tiene. Abre un `Pool` por WebSocket para un solo pedido y
 * lo cierra al terminar, como pide el driver en serverless. drizzle hace `ROLLBACK` si `f` lanza.
 *
 * `deshacer(v)` hace `ROLLBACK` y `conTransaccion` devuelve `v`: un desenlace esperado no es una excepción. Una
 * excepción también hace `ROLLBACK`, y sube.
 */
export async function conTransaccion<T>(f: (tx: Transaccion, deshacer: (valor: T) => never) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    return await drizzle({ client: pool, schema: esquema }).transaction((tx) =>
      f(tx as Transaccion, (valor) => {
        throw new Deshecha(valor)
      }),
    )
  } catch (e) {
    if (e instanceof Deshecha) return e.valor as T
    throw e
  } finally {
    await pool.end()
  }
}
