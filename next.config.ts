import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

/** La vitrina vive en `page.dev.tsx`: solo `next dev` reconoce esa extensión, así que ningún build la publica. */
export default function config(fase: string): NextConfig {
  return {
    pageExtensions: fase === PHASE_DEVELOPMENT_SERVER ? ['tsx', 'ts', 'jsx', 'js', 'dev.tsx'] : ['tsx', 'ts', 'jsx', 'js'],
    // libpg-query carga su WebAssembly desde node_modules; empaquetado, la ruta da 500 aunque el build pase.
    serverExternalPackages: ['libpg-query'],
    turbopack: {
      rules: {
        '*.css': {
          loaders: ['@tailwindcss/turbopack'],
          as: '*.css',
        },
      },
    },
  }
}
