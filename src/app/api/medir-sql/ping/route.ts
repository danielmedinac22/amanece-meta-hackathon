export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ ok: true, procesoActivoDesdeSeg: process.uptime(), memoriaRssMb: Math.round(process.memoryUsage().rss / 1e6) })
}
