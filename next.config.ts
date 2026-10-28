import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // QuickJS carga su WebAssembly desde node_modules; no hay que empaquetarlo.
  serverExternalPackages: ['quickjs-emscripten', '@jitl/quickjs-wasmfile-release-sync', ...(process.env.PG_EXTERNAL === '1' ? ['libpg-query'] : [])],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
