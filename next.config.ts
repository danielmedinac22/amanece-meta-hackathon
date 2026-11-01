import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // QuickJS y libpg-query cargan su WebAssembly desde node_modules; empaquetados, la ruta da 500 aunque el build pase.
  serverExternalPackages: ['quickjs-emscripten', '@jitl/quickjs-wasmfile-release-sync', 'libpg-query'],
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
