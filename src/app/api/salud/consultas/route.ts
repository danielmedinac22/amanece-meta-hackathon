import { validarConsulta } from '@/nucleo/consultas/validar'

export const dynamic = 'force-dynamic'

/** Que el validador carga su WebAssembly en este despliegue. `probar-humo` la pide contra `next start`. */
export async function GET() {
  const r = await validarConsulta('select count(*) as valor from pedidos')
  return Response.json({ ok: r.ok }, { status: r.ok ? 200 : 500 })
}
