import { desc, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db, esquema } from '@/db'

export const dynamic = 'force-dynamic'

/** Cuánto cuesta y cuánto tarda cada agente y cada Cambio, medido en uso real. Es el dato que vuelve al mapa. */
export default async function Medicion() {
  const [porAgente, porTipo, recientes] = await Promise.all([
    db
      .select({
        agente: esquema.turnos.agente,
        turnos: sql<number>`count(*)::int`,
        ms: sql<number>`avg(${esquema.turnos.ms})::int`,
        entrada: sql<number>`avg(${esquema.turnos.tokensEntrada})::int`,
        salida: sql<number>`avg(${esquema.turnos.tokensSalida})::int`,
        costo: sql<number>`sum(${esquema.turnos.costoUsd})::float`,
      })
      .from(esquema.turnos)
      .groupBy(esquema.turnos.agente),
    db
      .select({
        tipo: esquema.cambios.tipo,
        cambios: sql<number>`count(*)::int`,
        aplicados: sql<number>`count(*) filter (where ${esquema.cambios.estado} in ('aplicado','revertido'))::int`,
        costo: sql<number>`avg(${esquema.cambios.costoUsd})::float`,
        msPropuesta: sql<number>`avg(${esquema.cambios.msHastaPropuesta})::int`,
      })
      .from(esquema.cambios)
      .groupBy(esquema.cambios.tipo),
    db.select().from(esquema.cambios).orderBy(desc(esquema.cambios.creado)).limit(20),
  ])
  const usd = (n: number | null) => (n === null ? '—' : `USD ${n.toFixed(4)}`)
  const seg = (n: number | null) => (n === null ? '—' : `${(n / 1000).toFixed(1)} s`)

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <Link href="/panel" className="text-sm text-suave hover:text-tinta">
        ← Panel
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">Medición</h1>
      <p className="mt-2 text-suave">Tokens, costo y latencia reales con Muse Spark.</p>

      <h2 className="mt-8 font-medium">Por agente</h2>
      <Tabla
        columnas={['Agente', 'Turnos', 'Latencia media', 'Tokens de entrada', 'Tokens de salida', 'Costo total']}
        filas={porAgente.map((f) => [f.agente, f.turnos, seg(f.ms), f.entrada, f.salida, usd(f.costo)])}
      />

      <h2 className="mt-8 font-medium">Por tipo de Cambio</h2>
      <Tabla
        columnas={['Tipo', 'Propuestos', 'Aplicados', 'Costo medio', 'Hasta la vista previa']}
        filas={porTipo.map((f) => [f.tipo, f.cambios, f.aplicados, usd(f.costo), seg(f.msPropuesta)])}
      />

      <h2 className="mt-8 font-medium">Últimos Cambios</h2>
      <Tabla
        columnas={['Pedido', 'Tipo', 'Estado', 'Costo', 'Hasta la vista previa', 'Hasta aplicado']}
        filas={recientes.map((c) => [c.pedido.slice(0, 70), c.tipo, c.estado, usd(c.costoUsd), seg(c.msHastaPropuesta), seg(c.msHastaAplicado)])}
      />
    </main>
  )
}

function Tabla({ columnas, filas }: { columnas: string[]; filas: (string | number)[][] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-2xl border border-borde bg-tarjeta">
      <table className="w-full text-left text-sm">
        <thead className="text-suave">
          <tr>{columnas.map((c) => <th key={c} className="px-3 py-2 font-normal">{c}</th>)}</tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr><td className="px-3 py-3 text-suave" colSpan={columnas.length}>Todavía no hay datos.</td></tr>
          ) : (
            filas.map((f, i) => (
              <tr key={i} className="border-t border-borde">
                {f.map((v, j) => <td key={j} className="px-3 py-2">{v}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
