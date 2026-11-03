import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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

export default nextConfig
