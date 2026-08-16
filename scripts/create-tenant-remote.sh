#!/usr/bin/env bash
#
# Onboard a tenant on the production box, from this machine, over ssh.
#
# `tenant:create` (the TypeScript sibling) needs DATABASE_URL pointing at the database, and
# production's Postgres is docker-internal on the VPS — reachable only through `ssh tri-prod`,
# which lands in a forced command for deploys and `docker exec` for everything else. This
# script is the missing bridge: the password is generated and hashed HERE, with the same
# argon2id parameters the product verifies with (OWASP: 19 MiB, t=2, p=1), and only the hash
# travels. The plaintext is printed once, to the person running this, and never written down.
#
#   bash scripts/create-tenant-remote.sh <domain> <email> [name] [member ...]
#   bash scripts/create-tenant-remote.sh omer.troinvest.uk omer@example.com "Omer"
#   bash scripts/create-tenant-remote.sh pair.example.com pair@example.com "Pair" יוני אביתר
#
# Members are the household — the names the member switch offers and rows are attributed to.
# None (the usual case) onboards a single person: no switch, no split.
#
set -euo pipefail

DOMAIN="${1:?usage: create-tenant-remote.sh <domain> <email> [name]}"
EMAIL="${2:?usage: create-tenant-remote.sh <domain> <email> [name]}"
NAME="${3:-$DOMAIN}"
shift 2; [ "$#" -gt 0 ] && shift  # what remains is the household, possibly empty
HOUSEHOLD_SQL='{}'
if [ "$#" -gt 0 ]; then
  HOUSEHOLD_SQL="{$(printf '"%s",' "$@" | sed 's/,$//')}"
fi
SSH_HOST="${TRI_SSH_HOST:-tri-prod}"
PG_CONTAINER="${TRI_PG_CONTAINER:-tri-handoff-postgres-1}"

# Node 22 lives behind nvm on this machine; the shell default is too old for @node-rs/argon2.
if [ -d "$HOME/.nvm/versions/node/v22.22.0/bin" ]; then
  export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
fi

# Password, hash and ids — all generated locally. The alphabet drops 0/O/1/l/I, because a
# password that will be read off one screen and typed into another must survive the reading.
CRED=$(node --input-type=module <<'NODE'
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const pick = () => alphabet[randomBytes(1)[0] % alphabet.length];
const block = () => Array.from({ length: 6 }, pick).join('');
const password = [block(), block(), block(), block()].join('-');

// The parameters src/lib/crypto/password.ts verifies with; they are also encoded into the
// hash itself, so verify() would honour them regardless — matching keeps the cost identical.
const digest = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const id = () => 'c' + randomBytes(12).toString('hex');

// One line each, shell-friendly, nothing else on stdout.
console.log(password);
console.log(digest);
console.log(id());
console.log(id());
NODE
)

PASSWORD=$(sed -n 1p <<<"$CRED")
HASH=$(sed -n 2p <<<"$CRED")
TENANT_ID=$(sed -n 3p <<<"$CRED")
USER_ID=$(sed -n 4p <<<"$CRED")
EMAIL_LOWER=$(tr '[:upper:]' '[:lower:]' <<<"$EMAIL")

# The same two rows scripts/create-tenant.ts writes, in one transaction. ON_ERROR_STOP makes
# a duplicate domain a loud failure instead of half a tenant.
ssh "$SSH_HOST" "docker exec -i $PG_CONTAINER psql -U tri -d tri -v ON_ERROR_STOP=1" <<SQL
BEGIN;
INSERT INTO tenants (id, name, domain, status, household, created_at, updated_at)
VALUES ('$TENANT_ID', '$NAME', '$DOMAIN', 'active', '$HOUSEHOLD_SQL', now(), now());
INSERT INTO users (id, tenant_id, email, password_hash, locale, display_currency, theme, display_style, created_at, updated_at)
VALUES ('$USER_ID', '$TENANT_ID', '$EMAIL_LOWER', '$HASH', 'he', 'ILS', 'dark', 'depth', now(), now());
COMMIT;
SQL

echo
echo "Client created."
echo "  domain   : https://$DOMAIN"
echo "  email    : $EMAIL_LOWER"
echo "  password : $PASSWORD"
echo
echo "Write the password down now — it is not stored anywhere in this form."
