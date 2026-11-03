import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest } from 'next/server'

const irA = (ruta: string, req: NextRequest) => NextResponse.redirect(new URL(ruta, req.url))

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()
  const ruta = req.nextUrl.pathname
  // Clerk rechaza entrar con una sesión abierta.
  if (ruta === '/entrar' || ruta.startsWith('/entrar/')) return userId ? irA('/panel', req) : undefined
  // Las API responden su propio 401.
  if (!userId && !ruta.startsWith('/api/')) return irA('/entrar', req)
})

// Una lista y no el comodín de Clerk: `/`, el webhook de Kapso y la vitrina no dependen de que el login funcione.
// `auth()` lanza en una ruta que no esté aquí, y `probar-sesion` falla si una que importa la puerta se queda fuera.
export const config = {
  matcher: ['/panel/:path*', '/medicion/:path*', '/entrar/:path*', '/api/dueno/:path*', '/api/propuestas/:path*', '/api/publicar'],
}
