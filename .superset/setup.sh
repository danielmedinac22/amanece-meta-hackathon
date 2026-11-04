#!/usr/bin/env bash
# Deja listo un worktree nuevo de Superset: variables de prueba y dependencias. Se niega a copiar variables de producción.
set -euo pipefail
cd "$(dirname "$0")/.."

origen="${SUPERSET_ROOT_PATH:?Superset no dijo dónde está la carpeta principal}/.env.local"
if ! grep -q '^ENVIO_SIMULADO=1' "$origen" || ! grep -Eq '^CLERK_SECRET_KEY="?sk_test_' "$origen"; then
  echo "El .env.local de la carpeta principal no es de pruebas. No lo copio. Ver ~/Simetrik/amanece-avance/LEEME.md." >&2
  exit 1
fi
cp "$origen" .env.local
pnpm install --frozen-lockfile
echo "Listo. Para correr pruebas, usa una rama de Neon propia. Ver ~/Simetrik/amanece-avance/LEEME.md."
