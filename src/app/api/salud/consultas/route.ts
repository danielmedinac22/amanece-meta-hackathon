import { esErrorDeConsulta, validarConsulta } from '@/nucleo/consultas/validar'

export const dynamic = 'force-dynamic'

/** Que el validador carga su WebAssembly en este despliegue. `probar-humo` la pide contra `next start`. */
export async function GET() {
  const ok = !esErrorDeConsulta(await validarConsulta('select count(*) as valor from pedidos', 'numero'))
  return Response.json({ ok }, { status: ok ? 200 : 500 })
}
