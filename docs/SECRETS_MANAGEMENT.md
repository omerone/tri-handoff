# TRi Secrets Management

Production-grade secrets management using AWS Secrets Manager with local development support.

## Overview

Secrets are loaded in this order of precedence:

1. **AWS Secrets Manager** (production) — recommended for all deployments
2. **.env.local** (local development) — git-ignored, for developer machine only
3. **Environment variables** (Docker, CI/CD) — fallback for containerized environments

The app initializes secrets on startup and caches them with a 5-minute TTL for performance.

## Quick Start

### Local Development (No AWS)

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in the required secrets:
   ```bash
   # Generate SESSION_SECRET (32+ bytes, base64)
   openssl rand -base64 48

   # Generate ENCRYPTION_KEY (exactly 32 bytes, base64)
   openssl rand -base64 32
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

The app will automatically load `.env.local` during startup (see `src/lib/secrets/manager.ts`).

### Docker Compose (Local)

1. Ensure `.env` or `.env.local` exists with secrets
2. Run:
   ```bash
   docker-compose up
   ```

Environment variables from `.env` will be passed to the container.

### AWS Secrets Manager (Production)

#### 1. Create a Secret in AWS

```bash
# Create a JSON secret with all sensitive values
aws secretsmanager create-secret \
  --name tri/secrets \
  --secret-string '{
    "SESSION_SECRET": "YOUR_32_PLUS_BYTES_BASE64",
    "ENCRYPTION_KEY": "YOUR_32_BYTES_BASE64",
    "DATABASE_URL": "postgresql://...",
    "METAAPI_TOKEN": "...",
    "SMTP_PASS": "..."
  }' \
  --region us-east-1
```

#### 2. Configure IAM Permissions

Create an IAM policy for your app container/EC2/Lambda:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:tri/secrets-*"
    },
    {
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:ACCOUNT_ID:key/KEY_ID"
    }
  ]
}
```

Attach this policy to:
- EC2 instance role (if deployed on EC2)
- ECS task role (if using ECS)
- Lambda execution role (if using Lambda)

#### 3. Deploy App

The app will automatically detect `AWS_REGION` and load secrets from AWS Secrets Manager:

```bash
export AWS_REGION=us-east-1
export AWS_SECRETS_NAME=tri/secrets
docker run -e AWS_REGION -e AWS_SECRETS_NAME tri:latest
```

Or in docker-compose.yml:
```yaml
app:
  environment:
    AWS_REGION: us-east-1
    AWS_SECRETS_NAME: tri/secrets
```

#### 4. Verify Secrets Loaded

Check app startup logs:
```
[Secrets] Loaded from: AWS Secrets Manager (tri/secrets)
[Env] Environment initialized and validated
```

## Rotating Secrets

### Manual Rotation (AWS Secrets Manager)

Use the rotation script to rotate `SESSION_SECRET` and `ENCRYPTION_KEY`:

```bash
npm run secrets:rotate
```

Options:
```bash
npm run secrets:rotate -- --dry-run    # Show what would change
npm run secrets:rotate -- --force      # Skip confirmation prompt
```

### Automatic Rotation (Lambda)

AWS Secrets Manager can automatically rotate secrets using Lambda:

1. Create a Lambda function with permissions to update the secret
2. Configure rotation in AWS Secrets Manager console
3. Set rotation interval (e.g., 30 days)

See: [AWS Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets.html)

## Understanding Secret Types

### SESSION_SECRET (32+ bytes, base64)

Used for:
- Signing session cookies
- Creating secure session IDs

Generate:
```bash
openssl rand -base64 48
```

Impact of rotation:
- Existing sessions become invalid
- Users must log in again
- New sessions use new key

### ENCRYPTION_KEY (exactly 32 bytes, base64)

Used for:
- AES-256-GCM encryption of MT5 investor passwords
- Encrypted data at rest

Generate:
```bash
openssl rand -base64 32   # Must decode to exactly 32 bytes
```

Impact of rotation:
- Existing encrypted MT5 passwords become unreadable
- Users must reconnect their MT5 accounts
- New MT5 connections use new key

### DATABASE_URL

Connection string to PostgreSQL database.

Impact of rotation:
- App must restart to use new connection
- In-flight requests may fail during transition
- Should be done during maintenance window

## Emergency Procedures

### Secrets Compromised

1. **Immediately disable compromised secret**:
   ```bash
   # Update the secret with a new value
   aws secretsmanager update-secret \
     --secret-id tri/secrets \
     --secret-string '{"SESSION_SECRET": "NEW_VALUE", ...}'
   ```

2. **Restart all app instances** to pick up new secret:
   ```bash
   # For Docker containers
   docker-compose restart app

   # For Kubernetes
   kubectl rollout restart deployment/tri-app
   ```

3. **Invalidate all sessions**:
   - Delete all rows from `sessions` table (users must log in)
   - Or wait for sessions to expire naturally (24 hours default)

4. **Audit logs**:
   ```sql
   SELECT * FROM "adminAuditLog" 
   WHERE "actionType" = 'rotate_secrets' 
   ORDER BY "createdAt" DESC;
   ```

### Lost Backup

If you don't have a backup of the old secret:

1. Check AWS Secrets Manager version history:
   ```bash
   aws secretsmanager list-secret-version-ids \
     --secret-id tri/secrets
   ```

2. Restore a previous version:
   ```bash
   aws secretsmanager restore-secret-version \
     --secret-id tri/secrets \
     --version-id arn:aws:secretsmanager:...
   ```

### Database Connection Lost

If the app can't connect to the database:

1. Check IAM permissions for AWS Secrets Manager access
2. Verify `AWS_REGION` is set correctly
3. Ensure `DATABASE_URL` in secret is correct
4. Check network connectivity (security groups, VPC)

Temporary workaround (development only):
```bash
export DISABLE_AWS_SECRETS_MANAGER=true
export DATABASE_URL="postgresql://..."
npm start
```

## Architecture

### Flow Diagram

```
App Startup
    ↓
[src/instrumentation.ts → src/instrumentation-node.ts]
    ↓
[Call initializeEnv()]
    ↓
[Load secrets from src/lib/secrets/manager.ts]
    ├─ Try AWS Secrets Manager (if AWS_REGION set)
    ├─ Try .env.local (if exists, NODE_ENV ≠ production)
    └─ Fall back to process.env (always available)
    ↓
[Validate with Zod schema in src/lib/env.ts]
    ↓
[Cache secrets (5 min TTL)]
    ↓
[env() returns cached secrets]
```

### Key Files

- `src/lib/secrets/manager.ts` — AWS Secrets Manager client, fallback logic
- `src/lib/env.ts` — Environment validation & caching
- `scripts/rotate-secrets.ts` — CLI for rotating secrets
- `src/instrumentation-node.ts` — App startup (initializes env)
- `.github/workflows/deploy.yml` — CI/CD secrets injection
- `docker-compose.yml` — Local environment configuration

## Troubleshooting

### "Environment not yet initialized"

The app tried to access `env()` before startup completed.

**Solution**: Ensure all code that uses `env()` is in request handlers or background tasks, not module top-level.

```typescript
// ❌ Wrong: Called at import time
import { env } from '@/lib/env';
const dbUrl = env().DATABASE_URL;

// ✅ Correct: Called at request time
export async function GET(req: Request) {
  const { DATABASE_URL } = env();
  // ...
}
```

### "Could not load secrets from AWS Secrets Manager"

The app tried to load from AWS but it's not available.

**Causes**:
- `AWS_REGION` not set
- IAM permissions missing
- Secret name wrong (`AWS_SECRETS_NAME`)
- AWS credentials not found

**Solutions**:
1. Check IAM policy (see "Configure IAM Permissions" above)
2. Verify AWS credentials: `aws sts get-caller-identity`
3. Test manual fetch: `aws secretsmanager get-secret-value --secret-id tri/secrets`
4. Check logs: `docker logs tri-app | grep "\[Secrets\]"`

### "No secrets loaded. Ensure AWS or .env.local configured"

Neither AWS nor .env.local have secrets.

**Solutions**:
1. Create `.env.local` in project root
2. Or set `AWS_SECRETS_NAME` and `AWS_REGION`
3. Or export environment variables: `export SESSION_SECRET=...`

### Session Invalidation on Rotation

After rotating `SESSION_SECRET`, all existing sessions are invalid.

**Expected behavior**: Users see "session expired" and must log in again.

**To avoid**: Rotate during low-traffic periods (e.g., 3am UTC).

**To accelerate**: Delete old sessions manually:
```sql
DELETE FROM "sessions" WHERE "createdAt" < now() - interval '24 hours';
```

## Best Practices

1. **Never commit .env** — Use `.env.example` template instead
2. **Rotate regularly** — At least every 90 days
3. **Use AWS Secrets Manager** — In production, always use AWS (not env vars)
4. **Monitor rotations** — Check audit logs after each rotation
5. **Test rollback** — Practice recovery before you need it
6. **Use IAM roles** — Don't store AWS credentials in environment
7. **Version secrets** — AWS Secrets Manager auto-versions on update
8. **Audit everything** — All secret access is logged to CloudTrail

## References

- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [Environment Variables in Node.js](https://nodejs.org/en/knowledge/file-system/security/introduction/)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [dotenv library](https://github.com/motdotla/dotenv)
