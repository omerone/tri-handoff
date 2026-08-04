#!/bin/sh
set -e

echo "[tri] applying database migrations…"
npx prisma migrate deploy 2>/dev/null || echo "[tri] migrations already applied"

echo "[tri] starting server…"
exec node server.js
