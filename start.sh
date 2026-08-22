#!/usr/bin/env bash
# ============================================================================
# Virtual Laboratory — development launcher (Linux/macOS)
# Requires: Node.js >= 18 (https://nodejs.org)
#
#   ./start.sh            → installs deps (first time), seeds, starts server
#   PORT=9000 ./start.sh  → custom port
# ============================================================================
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8080}"

if [ ! -d node_modules ]; then
  echo "▸ Installing dependencies (npm install)…"
  npm install --no-audit --no-fund
fi

echo "▸ Seeding the database (idempotent)…"
node server/seed.js || true

echo "▸ Starting Virtual Laboratory on http://localhost:${PORT} …"
echo "  (Ctrl+C to stop)"
node server/server.js
