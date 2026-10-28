import { cargarParser, validarConsulta, type Forma } from '@/medir-sql/validar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const t0 = performance.now()
  await cargarParser()
  const t1 = performance.now()
  const { sql, forma } = (await req.json()) as { sql: string; forma?: Forma }
  const r = validarConsulta(sql, forma ?? { tipo: 'filas' })
  const t2 = performance.now()
  return Response.json({ resultado: r, msCargaDelParser: t1 - t0, msValidar: t2 - t1, procesoActivoDesdeSeg: process.uptime(), memoriaRssMb: Math.round(process.memoryUsage().rss / 1e6) })
}
