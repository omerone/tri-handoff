#!/bin/sh
set -e

# Migrations run before the server, and a failure here has to stop the container.
#
# This was `migrate deploy 2>/dev/null || echo "already applied"`, which reported success for
# every outcome. A migration that could not apply — a conflicting column, a constraint an
# existing row violates, a database that was not up yet — printed "already applied" and the
# server started anyway against the old schema. The deploy health-checks `/login`, which
# touches none of the new columns, so the rollout would be declared good while the schema it
# needed was never there. That is the one failure this setup could not see, and it matters
# more now that every change deploys on its own.
#
# `migrate deploy` already exits 0 when there is nothing to apply, so nothing needed
# swallowing. Failing loudly is what lets `tri-deploy` find an unhealthy container and roll
# back to the image that was serving a minute ago.
echo "[tri] applying database migrations…"
npx prisma migrate deploy

echo "[tri] starting server…"
exec node server.js
