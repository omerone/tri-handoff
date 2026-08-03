# Database Audit Logging

Comprehensive audit logging system for TRi trading platform. Logs all database operations for compliance, security, and forensic investigation.

## Overview

The audit logging system captures all INSERT, UPDATE, and DELETE operations on sensitive tables:
- `users` — user account changes
- `trades` — trading activity
- `mt5_accounts` — MT5 connection changes
- `sessions` — login sessions
- `password_reset_tokens` — password reset activity
- `super_admins` — admin account changes
- `tenants` — tenant configuration

## Architecture

### Components

1. **pgaudit Extension** — PostgreSQL native audit logging
   - Low-level database audit trail
   - Configurable logging on sensitive tables
   - Syslog integration for centralized logging

2. **Prisma client extension** — application-level audit logging (`src/lib/db/audit-middleware.ts`)
   - Logs every ORM mutation; reads are not logged, they would bury the trail in noise
   - Redacts sensitive fields (passwords, tokens, keys)
   - Captures user context (userId, tenantId, IP, userAgent)
   - Flags suspicious queries (slow, bulk operations)

3. **Database triggers** — *not installed.* `prisma/migrations/audit_triggers.sql` exists but
   is not part of any migration, and `pg_trigger` holds no `audit_*` rows. Everything the
   trail records today comes from the extension above, which means a write made outside the
   application — psql, a migration, a restore — leaves no entry.

4. **Retention & Archival** — Long-term storage
   - Active logs: 90 days (hot storage)
   - Archive: 275 days (cold storage/S3)
   - Total retention: 12 months
   - Daily archival job

5. **Admin Dashboard** — Query and monitoring
   - Real-time audit log viewer
   - Filters by user, table, operation, date
   - CSV export capability
   - Suspicious activity alerts

## Setup

### 1. Database Migration

Create the audit tables:

```bash
npx prisma migrate dev --name add_audit_logging
```

This creates:
- `database_audit_logs` — all database operations
- `data_change_logs` — detailed change tracking
- `schema_audit_logs` — DDL statements

### 2. Enable pgaudit (Optional but Recommended)

For production PostgreSQL:

```bash
./scripts/setup-pgaudit.sh
```

Or manually:

```sql
CREATE EXTENSION pgaudit;

ALTER SYSTEM SET pgaudit.log = 'ALL';
ALTER SYSTEM SET pgaudit.role = 'pgaudit';
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_min_duration_statement = 5000;

SELECT pg_reload_conf();
```

### 3. Setup Database Triggers (not done)

`prisma/migrations/audit_triggers.sql` is a loose file, not a migration — nothing applies it.
Applying it by hand is a deliberate decision, not a step in a setup guide: triggers double
every audited write and record rows the application never saw.

To check what is actually installed:

```sql
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'audit_%';   -- currently: none
```

### 4. Initialize Audit Middleware

The trail is a Prisma **client extension**, applied where the client is built —
`src/lib/db/prisma.ts`:

```typescript
import { auditExtension } from '@/lib/db/audit-middleware';

const base = new PrismaClient({ /* … */ });
export const prisma = base.$extends(auditExtension);
```

There is no `setupAuditMiddleware()` to call, and this is the one detail worth getting right:
`$extends` **returns a new client** rather than modifying the one it is handed. A setup
function called for its side effect would leave the app using the unextended client and audit
nothing at all, while looking initialised — the worst way for an audit trail to fail.

`prisma.ts` also exports `prismaBase`, the unextended client. The trail's own writes go
through it, so an audit row cannot be audited: recursion is prevented by construction rather
than by a string comparison on the model name.

(Prisma removed `$use` middleware in v5; this project is on v6, where extensions are the
only mechanism.)

### 5. Add npm Scripts

Update `package.json`:

```json
{
  "scripts": {
    "audit-logs:archive": "NODE_OPTIONS=--conditions=react-server tsx scripts/archive-audit-logs.ts",
    "audit-logs:archive:dry": "NODE_OPTIONS=--conditions=react-server tsx scripts/archive-audit-logs.ts --dry-run",
    "pgaudit:setup": "bash scripts/setup-pgaudit.sh"
  }
}
```

## Usage

### Query Audit Logs

#### Get User's Activity

```typescript
import { getUserAuditLog } from '@/lib/db/audit-queries';

const logs = await getUserAuditLog('user123', { limit: 100 });

logs.forEach(log => {
  console.log(`${log.operation} on ${log.tableName} at ${log.createdAt}`);
  console.log(`  Old values: ${JSON.stringify(log.oldValues)}`);
  console.log(`  New values: ${JSON.stringify(log.newValues)}`);
});
```

#### Get Suspicious Activity

```typescript
import { getSuspiciousActivity } from '@/lib/db/audit-queries';

const suspicious = await getSuspiciousActivity({
  timeWindowHours: 24,
  limit: 100,
});

suspicious.forEach(log => {
  console.warn(
    `Suspicious: ${log.suspicionReason} in ${log.tableName} by ${log.userId}`
  );
});
```

#### Get Slow Queries

```typescript
import { getSlowQueries } from '@/lib/db/audit-queries';

const slow = await getSlowQueries({
  thresholdMs: 5000,
  hoursBack: 24,
});

slow.forEach(log => {
  console.log(`${log.executionTimeMs}ms query on ${log.tableName}`);
});
```

#### Get Record History

```typescript
import { getRecordAuditLog } from '@/lib/db/audit-queries';

const history = await getRecordAuditLog('trades', 'trade_id_123');

history.forEach(log => {
  console.log(`${log.operation}: ${log.createdAt}`);
});
```

#### Export for Compliance

```typescript
import { exportAuditLog } from '@/lib/db/audit-queries';

const logs = await exportAuditLog({
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31'),
  tableName: 'users',
  suspicious: false,
});

// Convert to CSV and save
```

### API Access

#### Get Audit Logs via API

The endpoint requires an **operator session** and is served only on the platform's base
domain — a client's domain answers 404, so the operator API does not announce its existence
there. Sign in at `/admin/login` first; the examples below assume the session cookie.

```bash
# Get user's audit log
curl -b "$COOKIE" "http://localhost:3000/api/admin/audit-logs?user=user123&limit=50"

# Get suspicious activity
curl "http://localhost:3000/api/admin/audit-logs?suspicious=true"

# Get table's audit log
curl "http://localhost:3000/api/admin/audit-logs?table=trades"

# Export as CSV
curl "http://localhost:3000/api/admin/audit-logs?format=csv" > audit-logs.csv

# Get specific record history
curl "http://localhost:3000/api/admin/audit-logs?table=trades&record=trade123"
```

#### Response Format

```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "id": "cuid1",
      "tableName": "trades",
      "operation": "INSERT",
      "recordId": "trade123",
      "oldValues": null,
      "newValues": {
        "symbol": "EURUSD",
        "volume": 1.0,
        "direction": "long"
      },
      "userId": "user123",
      "tenantId": "tenant1",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "executionTimeMs": 45,
      "suspicious": false,
      "suspicionReason": null,
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Dashboard Component

```tsx
import { AuditLogViewer } from '@/components/admin/audit-log-viewer';

export default function AdminPage() {
  return (
    <div>
      <h1>Administration</h1>
      <AuditLogViewer />
    </div>
  );
}
```

## Archival & Retention

### Automatic Archival

Runs daily (configure via cron or GitHub Actions):

```bash
npm run audit-logs:archive
```

This:
1. Finds logs older than 90 days
2. Compresses with gzip
3. Saves to local storage or S3
4. Marks as archived in database
5. Verifies integrity with SHA-256 checksums

### Dry Run

Test archival without making changes:

```bash
npm run audit-logs:archive:dry --retention-days=90
```

### Restore from Archive

```typescript
import { restoreArchive } from '@/lib/db/audit-archiver';

const logs = await restoreArchive('./audit-archives/audit-logs-2024-01-01-batch-0.json.gz');
```

### Cleanup Very Old Logs

Remove logs older than 12 months:

```bash
npm run audit-logs:cleanup --retention-months=12
```

## Sensitive Field Redaction

The following fields are automatically redacted in audit logs:

- `password` → `[REDACTED]`
- `passwordHash` → `[REDACTED]`
- `token` → `[REDACTED]`
- `tokenHash` → `[REDACTED]`
- `secret` → `[REDACTED]`
- `key` → `[REDACTED]`
- `encryptionKey` → `[REDACTED]`
- `investorPw` → `[REDACTED]`
- `investorPwEncrypted` → `[REDACTED]`
- `refreshToken` → `[REDACTED]`
- `accessToken` → `[REDACTED]`
- `apiKey` → `[REDACTED]`
- `masterPassword` → `[REDACTED]`

Add custom fields in `src/lib/db/audit-middleware.ts`:

```typescript
const SENSITIVE_FIELDS = new Set([
  'password',
  'customSecretField', // Add here
]);
```

## Suspicious Activity Detection

Automatically flagged operations:

1. **Slow Queries** (>5 seconds)
   - May indicate denial-of-service
   - Review for optimization opportunities

2. **Bulk Deletes Without Filters**
   - `DELETE FROM users WHERE` (no condition)
   - Extremely dangerous — likely an error

3. **Bulk Updates Without Filters**
   - `UPDATE trades SET ...` (no condition)
   - High risk of unintended changes

4. **Large Result Sets** (future)
   - Exporting massive amounts of data

### Alert on Suspicious Activity

```typescript
import { getSuspiciousActivity } from '@/lib/db/audit-queries';

// Run hourly
const suspicious = await getSuspiciousActivity({ timeWindowHours: 1 });

if (suspicious.length > 0) {
  console.error('🚨 SECURITY ALERT: Suspicious database activity detected!');
  suspicious.forEach(log => {
    console.error(`  - ${log.suspicionReason}: ${log.tableName}`);
    console.error(`    User: ${log.userId}, IP: ${log.ipAddress}`);
  });
  // Send email/Slack alert to security team
}
```

## Compliance & Regulations

### GDPR Compliance

- **Right to Access**: Export user's data via `/api/admin/audit-logs?user=USER_ID`
- **Data Portability**: CSV export preserves all audit trails
- **Right to Erasure**: Deletes are logged; can prove data was purged
- **Audit Trail**: 12-month retention for investigation

### SOX / Audit Trail

- All financial transactions (trades) logged
- User identification required
- Timestamp accuracy guaranteed
- Immutable (database triggers prevent modification)
- Accessible for external audit

### PCI DSS (if processing payments)

- Failed login attempts tracked
- Admin actions logged
- Suspicious activity detected
- 12-month retention
- IP address captured

## Monitoring & Alerting

### Dashboard Metrics

Display on admin dashboard:

```typescript
import { getAuditStatistics } from '@/lib/db/audit-queries';

const stats = await getAuditStatistics({ hoursBack: 24 });

console.log(`Total operations: ${stats.totalOperations}`);
console.log(`Suspicious: ${stats.suspiciousCount}`);
console.log(`Affected users: ${stats.affectedUsers}`);
console.log(`Affected tenants: ${stats.affectedTenants}`);

// By operation type
Object.entries(stats.operationsByType).forEach(([op, count]) => {
  console.log(`  ${op}: ${count}`);
});

// By table
Object.entries(stats.operationsByTable).forEach(([table, count]) => {
  console.log(`  ${table}: ${count}`);
});
```

### CloudWatch Integration

If using AWS:

```bash
# Create log group
aws logs create-log-group --log-group-name /tri/audit-logs

# Set retention
aws logs put-retention-policy --log-group-name /tri/audit-logs --retention-in-days 365

# Put metric filter
aws logs put-metric-filter \
  --log-group-name /tri/audit-logs \
  --filter-name SuspiciousActivity \
  --filter-pattern '"suspicious": true'
```

Then create CloudWatch alarm:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name tri-suspicious-activity \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:security-team \
  --metric-name SuspiciousActivity \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold
```

### Datadog Integration

```typescript
import { getSuspiciousActivity } from '@/lib/db/audit-queries';

// Send to Datadog
const suspicious = await getSuspiciousActivity({ timeWindowHours: 1 });

suspicious.forEach(log => {
  datadog.gauge('tri.audit.suspicious', 1, {
    reason: log.suspicionReason,
    table: log.tableName,
    user: log.userId,
  });
});
```

## Local Development

### Option 1: Enable pgaudit in Docker

Update `docker-compose.yml`:

```yaml
postgres:
  image: postgres:15-alpine
  environment:
    - POSTGRES_INITDB_ARGS=-c shared_preload_libraries=pgaudit
```

Then run:

```bash
docker-compose up
npm run pgaudit:setup
```

### Option 2: Use Application Logging Only

If pgaudit is unavailable:

1. Middleware logging works standalone
2. Database triggers can be disabled
3. Full functionality via Prisma logging

The application gracefully handles missing pgaudit extension.

### Testing

```bash
# Run audit logging tests
npm test tests/audit/audit-logging.test.ts

# Watch mode
npm test:watch tests/audit/audit-logging.test.ts
```

## Performance Considerations

### Minimal Overhead

- Async middleware → no request blocking
- Batch archival → off-peak processing
- Indexed queries → fast lookups

### Index Strategy

Query performance via indexes on:
- `created_at` (time-range queries)
- `table_name` (table-specific audit)
- `user_id` (user activity)
- `tenant_id` (tenant audit)
- `suspicious` (alert filtering)

### Retention Policy

- Hot storage (90 days): Full performance
- Cold storage (9 months): Compressed, S3
- Automatic cleanup: Remove >12 months

## Troubleshooting

### Audit Logs Not Appearing

1. Check the client is the extended one — `src/lib/db/prisma.ts` must export the result of
   `.$extends(auditExtension)`, not the client it was applied to. A repository importing the
   base client writes nothing to the trail.

   Note that the fixtures in `tests/helpers/fixtures.ts` use an unextended client on purpose,
   so a write made with `testDb` is *expected* to leave no audit row.

2. Verify tables exist:
   ```sql
   SELECT * FROM database_audit_logs LIMIT 1;
   ```

3. Check for errors in logs:
   ```bash
   tail -f ./logs/app.log | grep -i audit
   ```

### High Database Growth

If audit tables are growing too fast:

1. Reduce retention: `--retention-days=30`
2. Archive more frequently: daily → hourly
3. Disable logging for high-volume tables
4. Increase archival batch size

### Performance Degradation

If queries slow down:

1. Run archival more frequently
2. Add indexes:
   ```sql
   CREATE INDEX idx_audit_created ON database_audit_logs(created_at);
   ```
3. Disable middleware for read operations only

## References

- [PostgreSQL pgaudit](https://github.com/pgaudit/pgaudit)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [GDPR Compliance](https://gdpr-info.eu/)
- [PCI DSS Requirements](https://www.pcisecuritystandards.org/)

## Support

For issues, questions, or feature requests:

1. Check this documentation
2. Review test cases in `tests/audit/`
3. Check GitHub issues
4. Contact security team

---

Last updated: 2024-01-15  
Version: 1.0  
Status: Production-ready
