#!/bin/sh
set -e

echo "[tri] applying database migrations…"
./node_modules/.bin/prisma migrate deploy

echo "[tri] starting server…"
exec node server.js
