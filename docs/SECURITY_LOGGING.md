# Security Event Logging Guide

> **Status: procedure, not implementation.**
> This document describes what TRi intends to do, and parts of it name files that do not
> exist in the repository (privacy server actions). Read it as the policy to follow, and check the code
> before relying on any control it describes as built. `docs/RATE_LIMITING.md`,
> `docs/AUDIT_LOGGING.md` and `docs/SECURITY_HEADERS.md` describe subsystems that are.

**Version**: 1.0  
**Last Updated**: 2026-08-03  

This document explains how to use the `SecurityLogger` utility to log security-relevant events throughout the application.

## Overview

The `SecurityLogger` is a centralized facility for logging security events to the database for compliance, audit trails, and real-time alerting.

**Events are automatically logged with**:
- Timestamp (ISO 8601, UTC)
- User ID (who performed the action)
- IP address (from X-Forwarded-For header)
- User agent (browser/client identifier)
- Event type and description

**Retention**: All events are kept for 12 months (see `GDPR_COMPLIANCE.md` for cleanup)

---

## Event Types

### 1. Authentication Events

Log login attempts, password changes, and session events.

```typescript
import { SecurityLogger } from '@/lib/security/logger';

// Successful login
await SecurityLogger.logAuthEvent({
  userId: user.id,
  eventType: 'login_success',
  description: `User ${user.email} logged in`,
  result: 'success',
});

// Failed login
await SecurityLogger.logAuthEvent({
  userId: user.id,
  eventType: 'login_failed',
  description: `Failed login attempt for ${user.email}`,
  result: 'failure',
  failureReason: 'wrong_password', // or 'account_locked', 'rate_limited', etc.
});

// Rate-limited login
await SecurityLogger.logAuthEvent({
  userId: user.id,
  eventType: 'login_blocked',
  description: `Login attempt blocked (rate limit) for ${user.email}`,
  result: 'blocked',
  failureReason: 'rate_limited',
});

// Password changed
await SecurityLogger.logAuthEvent({
  userId: user.id,
  eventType: 'password_changed',
  description: `Password changed via reset link`,
  result: 'success',
});

// Session created
await SecurityLogger.logAuthEvent({
  userId: user.id,
  eventType: 'session_created',
  description: `Session created (via login)`,
  result: 'success',
});

// Session ended
await SecurityLogger.logAuthEvent({
  userId: user.id,
  eventType: 'session_ended',
  description: `Session ended (user logout)`,
  result: 'success',
});
```

**Where to add**:
- `src/app/(auth)/actions.ts` - login/password reset flows
- `src/lib/auth/session.ts` - session creation/termination
- `src/lib/auth/anti-timing.ts` - failed login tracking

---

### 2. Data Access Events

Log sensitive data access for GDPR compliance.

```typescript
import { SecurityLogger } from '@/lib/security/logger';

// User exports data
await SecurityLogger.logDataAccess({
  userId: user.id,
  action: 'export',
  resource: 'user_profile',
  recordCount: 1,
  dataSizeBytes: 5_000,
});

// User exports trades
await SecurityLogger.logDataAccess({
  userId: user.id,
  action: 'export',
  resource: 'trades',
  recordCount: 500,
  dataSizeBytes: 2_500_000, // 2.5 MB
});

// User syncs MT5 data
await SecurityLogger.logDataAccess({
  userId: user.id,
  action: 'sync',
  resource: 'mt5_account',
  recordCount: 250, // trades synced
});

// System accesses user data (e.g., for backups)
await SecurityLogger.logDataAccess({
  userId: user.id,
  action: 'system_access',
  resource: 'user_profile',
  recordCount: 1,
  dataSizeBytes: 10_000,
});
```

**Where to add**:
- `src/app/actions/privacy.ts` - data export endpoint (Task 4)
- `src/lib/mt5/sync.ts` - MT5 data sync
- `src/app/(app)/dashboard/page.tsx` - analytics queries
- Backup jobs - periodic data access logging

**Large export alert**: Any single export >10 MB triggers a console warning (logged for investigation)

---

### 3. Admin Audit Events

Log administrative actions for compliance and change management.

```typescript
import { SecurityLogger } from '@/lib/security/logger';

// Admin creates tenant
await SecurityLogger.logAdminAction({
  adminId: admin.id,
  tenantId: tenant.id,
  actionType: 'create_tenant',
  description: `Created tenant "${tenant.name}" (domain: ${tenant.domain})`,
  changes: {
    name: { to: tenant.name },
    domain: { to: tenant.domain },
    status: { to: 'active' },
  },
});

// Admin suspends tenant
await SecurityLogger.logAdminAction({
  adminId: admin.id,
  tenantId: tenant.id,
  actionType: 'suspend_tenant',
  description: `Suspended tenant (reason: payment overdue)`,
  changes: {
    status: { from: 'active', to: 'suspended' },
  },
});

// Admin resets user password
await SecurityLogger.logAdminAction({
  adminId: admin.id,
  userId: user.id,
  actionType: 'reset_password',
  description: `Admin reset password for ${user.email}`,
});

// Admin exports user data
await SecurityLogger.logAdminAction({
  adminId: admin.id,
  userId: user.id,
  actionType: 'export_user_data',
  description: `Exported all data for user ${user.email}`,
  changes: {
    export_scope: { to: 'full' },
    record_count: { to: 1500 },
  },
});
```

**Where to add**:
- `src/app/admin/actions.ts` - tenant/user management
- `src/app/admin/tenant-actions.ts` - tenant configuration changes

---

## Real-Time Alerting

### Failed Login Threshold

Automatically checks if a user has too many failed logins:
- **Threshold**: 5 failed logins in 30 minutes
- **Action**: Logs `SECURITY_ALERT` to console (can be extended to email/page on-call)
- **Location**: Built into `logAuthEvent()` when `result === 'failure'`

**Future enhancements**:
- Disable account after threshold
- Send email alert to user
- Page on-call security team
- Add CAPTCHA challenge

### Large Data Access

Any single data export >10 MB triggers a warning:
- **Threshold**: 10 MB
- **Action**: Logs warning to console (can be extended to alerting)
- **Location**: Built into `logDataAccess()`

**Future enhancements**:
- Check against rate limits (max exports per day)
- Flag unusual access patterns (multiple users, same IP)
- Request admin approval for exports

---

## Event Schema Reference

### AuthEvent

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Event ID |
| `userId` | string | User ID |
| `eventType` | string | Event category (login_success, login_failed, etc.) |
| `description` | string | Human-readable description |
| `result` | string | success \| failure \| blocked |
| `ipAddress` | string? | Client IP (from X-Forwarded-For) |
| `userAgent` | string? | Browser/client identifier |
| `details` | JSON? | Additional context (failure reason, etc.) |
| `createdAt` | DateTime | Event timestamp (UTC) |

### DataAccessLog

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Event ID |
| `userId` | string | User who accessed data |
| `action` | string | export, sync, system_access, etc. |
| `resource` | string | user_profile, trades, mt5_account, etc. |
| `recordCount` | int? | Number of records accessed |
| `dataSizeBytes` | int? | Size of data in bytes |
| `ipAddress` | string? | Client IP |
| `createdAt` | DateTime | Event timestamp (UTC) |

### AdminAuditLog

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Event ID |
| `adminId` | string? | Admin user ID |
| `tenantId` | string? | Affected tenant ID |
| `userId` | string? | Affected user ID |
| `actionType` | string | create_tenant, reset_password, etc. |
| `description` | string | What was done |
| `changes` | JSON? | Field-level changes (old → new) |
| `ipAddress` | string? | Admin's IP |
| `userAgent` | string? | Admin's browser/client |
| `createdAt` | DateTime | Event timestamp (UTC) |

---

## Querying Logs

### Find all failed logins for a user

```typescript
import { prisma } from '@/lib/db/prisma';

const failedLogins = await prisma.authEvent.findMany({
  where: {
    userId: 'user123',
    eventType: 'login_failed',
    createdAt: {
      gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // last 7 days
    },
  },
  orderBy: { createdAt: 'desc' },
  take: 100,
});
```

### Find all large data exports

```typescript
const largeExports = await prisma.dataAccessLog.findMany({
  where: {
    action: 'export',
    dataSizeBytes: { gte: 10_000_000 }, // >10 MB
  },
  orderBy: { createdAt: 'desc' },
  take: 50,
});
```

### Audit trail for a tenant

```typescript
const auditTrail = await prisma.adminAuditLog.findMany({
  where: {
    tenantId: 'tenant123',
  },
  orderBy: { createdAt: 'desc' },
  take: 100,
});
```

---

## Best Practices

1. **Always log security-sensitive actions**
   - Login attempts (success & failure)
   - Password changes
   - Data exports
   - Admin actions
   - Permission changes

2. **Include context**
   - Why did this action happen?
   - What data was affected?
   - Was it authorized?

3. **Don't log sensitive data**
   - Never log passwords or API keys
   - Never log full email addresses in some cases
   - Never log raw credit card numbers
   - Use descriptions like "Password reset requested" instead

4. **Error handling**
   - `SecurityLogger` catches all errors (doesn't throw)
   - If logging fails, app continues normally
   - Check console logs for logging errors in development

5. **Performance**
   - Logging is async and non-blocking
   - Use `await` to ensure logs are written before redirecting
   - Logging adds minimal overhead (~1ms per event)

---

## Testing

Tests for `SecurityLogger` are in `src/lib/security/logger.test.ts`.

Run tests:
```bash
npm run test
npm run test:watch
```

Test coverage includes:
- Authentication event logging
- Data access logging
- Admin action logging
- Failed login threshold detection
- Large export detection
- Error handling (database failures, etc.)

---

## Compliance Mapping

| Requirement | Implementation | Evidence |
|-------------|-----------------|----------|
| **GDPR**: Log data access | `logDataAccess()` → DataAccessLog | Export events with timestamps, IPs |
| **GDPR**: 12-month retention | Cleanup script (GDPR_COMPLIANCE.md) | Auto-delete old events via cron |
| **Incident Response**: Log failed logins | `logAuthEvent()` + threshold | Detect brute force attacks |
| **Incident Response**: Access logs | `logDataAccess()` | Determine what data was accessed during breach |
| **Audit Trail**: Admin changes | `logAdminAction()` | Who changed what, when |
| **SOX/ISO**: Evidence of controls | All events logged with timestamps | Exportable audit trail |

---

## Troubleshooting

### Logs aren't appearing

1. Check database connection in `.env`
2. Verify Prisma migration was run: `npm run db:deploy`
3. Check console for errors: `npm run dev` and look for "Failed to log" messages
4. Verify user ID is correct: `userId` must be a valid user that exists

### Sensitive data was logged

If sensitive data was logged to the audit tables:
1. Delete the rows manually
2. Review the code to find where it's being logged
3. Update logging calls to exclude sensitive data
4. Create incident report (see INCIDENT_RESPONSE.md)

### Performance impact

If logging is slow:
1. Check database query performance
2. Verify indexes are created (should be automatic with migration)
3. Consider batching events (write script to log in batch)
4. Run `ANALYZE` on PostgreSQL to update stats

---

**Document Owner**: Security Lead  
**Last Review**: 2026-08-03  
**Next Review Due**: 2026-11-03
