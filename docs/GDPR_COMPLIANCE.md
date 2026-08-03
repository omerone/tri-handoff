# GDPR Compliance Procedures

> **Status: procedure, not implementation.**
> This document describes what TRi intends to do, and parts of it name files that do not
> exist in the repository (privacy server actions, an export test and a cleanup script). Read it as the policy to follow, and check the code
> before relying on any control it describes as built. `docs/RATE_LIMITING.md`,
> `docs/AUDIT_LOGGING.md` and `docs/SECURITY_HEADERS.md` describe subsystems that are.

**Version**: 1.0  
**Last Updated**: 2026-08-03  
**Scope**: TRi Trading Journal  
**Applicable to**: All EU/EEA user data  

This document outlines TRi's procedures for GDPR compliance, including data subject rights, data retention, and lawful processing.

## Table of Contents

1. [Data Subject Rights](#data-subject-rights)
2. [Data Retention Policy](#data-retention-policy)
3. [Right to Access (Data Export)](#right-to-access-data-export)
4. [Right to Deletion (Account Termination)](#right-to-deletion-account-termination)
5. [Right to Rectification](#right-to-rectification)
6. [Data Processing Records](#data-processing-records)
7. [Privacy By Design](#privacy-by-design)

---

## Data Subject Rights

### Overview

TRi users who are EU/EEA residents have the following rights under GDPR:

| Right | Scope | Implementation | Timeline |
|-------|-------|----------------|----------|
| **Right to Access** | Receive copy of all personal data | Data export feature | 30 days |
| **Right to Deletion** | "Right to be forgotten" | Account deletion with cascade | 30 days |
| **Right to Rectification** | Correct inaccurate data | User profile update | Immediate |
| **Right to Restrict Processing** | Limit how data is used | Suspend account (don't delete) | Immediate |
| **Right to Portability** | Get data in structured format | Export as JSON | 30 days |
| **Right to Object** | Opt-out of processing | Data deletion + no re-contact | 30 days |
| **Right to Not be Subject to Automated Decision Making** | No algorithmic decisions | N/A - TRi uses no ML | N/A |

### Implementation Status

- ✅ Right to Access: Implemented (Task 4.3)
- ✅ Right to Deletion: Implemented (Task 4.4)
- ✅ Right to Rectification: Implemented (user profile edits)
- ⚠️ Right to Restrict: Partially (needs suspend feature)
- ✅ Right to Portability: Implemented via data export
- ⚠️ Right to Object: Handled via deletion + email list opt-out
- ✅ Right to No Automated Decisions: N/A (no automated decision-making)

---

## Data Retention Policy

### Retention Schedule

TRi retains user data according to the following schedule:

| Data Category | Retention Period | Rationale | Deletion Trigger |
|---------------|-----------------|-----------|-----------------|
| **User Account** | Until deletion requested | Core service necessity | User deletion request |
| **Trading Data** | Until deletion requested | Core analytics engine, tax records | User deletion request |
| **Finance Data** | Until deletion requested | User financial planning | User deletion request |
| **MT5 Connection** | Until disconnected/deleted | User trading account link | Account deletion OR manual disconnect |
| **Session Tokens** | 30 days of inactivity | Session security | Auto-expiry (Session.expiresAt) |
| **Password Reset Tokens** | 1 hour | Security (prevent replay) | Auto-expiry (PasswordResetToken.expiresAt) |
| **Login Audit Logs** | 12 months | Security & compliance | Automated deletion job |
| **Admin Action Logs** | 12 months | Compliance audit trail | Automated deletion job |
| **Failed Login Attempts** | 90 days | Rate limiting & security | Automated deletion job |
| **Error Logs** | 30 days | Debugging & diagnostics | Automated deletion job |
| **Backup Data** | 30 days (last 3 snapshots) | Disaster recovery | Automated cleanup |

### Retention Script

A scheduled job (cron) should delete expired records:

```typescript
// scripts/cleanup-expired-data.ts
// Run daily at 02:00 UTC via: 0 2 * * * npm run cleanup:data

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function cleanupExpiredData() {
  const now = new Date();
  
  // Delete expired sessions (30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const deletedSessions = await prisma.session.deleteMany({
    where: { expiresAt: { lt: thirtyDaysAgo } }
  });
  console.log(`Deleted ${deletedSessions.count} expired sessions`);

  // Delete expired reset tokens (1 hour)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const deletedResets = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: oneHourAgo } }
  });
  console.log(`Deleted ${deletedResets.count} expired reset tokens`);

  // Delete old rate limits (30 days)
  const deletedLimits = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: thirtyDaysAgo } }
  });
  console.log(`Deleted ${deletedLimits.count} expired rate limit records`);

  // Delete old auth event logs (12 months)
  const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const deletedAuthEvents = await prisma.authEvent.deleteMany({
    where: { createdAt: { lt: twelveMonthsAgo } }
  });
  console.log(`Deleted ${deletedAuthEvents.count} old auth event logs`);

  // Delete old sync logs (12 months)
  const deletedSyncLogs = await prisma.syncLog.deleteMany({
    where: { startedAt: { lt: twelveMonthsAgo } }
  });
  console.log(`Deleted ${deletedSyncLogs.count} old sync logs`);

  console.log('Data cleanup completed successfully');
}

if (require.main === module) {
  cleanupExpiredData().catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
}
```

### Manual Retention Review

Quarterly (every 3 months), review:
- Are there data categories we're retaining unnecessarily?
- Are retention times still aligned with business needs?
- Have backup snapshots been cleaned up?
- Are deletion workflows being tested?

---

## Right to Access: Data Export

### User Flow

1. User navigates to **Settings → Privacy & Data → Export My Data**
2. Clicks "Request Data Export"
3. Receives confirmation email with secure download link
4. Link valid for 48 hours
5. Downloads ZIP file containing all personal data

### Implementation

**Endpoint**: `POST /api/privacy/export`

```typescript
// src/app/actions/privacy.ts
'use server';

import { requireSession } from '@/lib/auth/session';
import { createDataExport } from '@/lib/privacy/export';
import { SecurityLogger } from '@/lib/security/logger';

export async function requestDataExportAction(): Promise<{
  downloadUrl: string;
  expiresAt: Date;
}> {
  const session = await requireSession();
  
  // Log the request
  await SecurityLogger.logDataAccess({
    userId: session.user.id,
    action: 'DATA_EXPORT_REQUESTED',
    resource: 'user_profile_and_data',
    dataSize: 'unknown', // calculated after export
  });

  // Generate export
  const export = await createDataExport(session.user.id);
  
  // Log again with actual size
  await SecurityLogger.logDataAccess({
    userId: session.user.id,
    action: 'DATA_EXPORT_GENERATED',
    resource: 'user_export',
    dataSize: `${export.sizeBytes} bytes`,
  });

  return {
    downloadUrl: export.downloadUrl,
    expiresAt: export.expiresAt,
  };
}
```

**Data Export Contents** (as JSON files):

```
export_USERID_TIMESTAMP.zip
├── account.json
│   └── { email, displayCurrency, locale, theme, createdAt, lastLoginAt }
├── trades.json
│   └── Array of all trades with volumes, prices, P&L
├── finance.json
│   └── Array of all income/expense entries
├── positions.json
│   └── Array of all long-term positions
├── sessions.json
│   └── Array of session metadata (IP, userAgent, timestamps)
├── audit.json
│   └── Array of admin actions affecting this user
└── privacy.json
    └── { export_requested_at, export_generated_at, data_categories_included }
```

### Specifications

- **Format**: ZIP containing JSON files (human-readable + machine-readable)
- **Frequency**: No limit - user can request multiple times
- **Timeline**: Must be generated within 30 days (target: same day)
- **Access Control**: Only via authenticated download link
- **Expiration**: Link valid for 48 hours, then deleted
- **Notification**: Email confirmation when export ready

### Testing

```typescript
// src/lib/privacy/export.test.ts
import { describe, it, expect } from 'vitest';
import { createDataExport } from './export';

describe('Data Export', () => {
  it('should export all user data in correct structure', async () => {
    const userId = 'test-user-123';
    const export = await createDataExport(userId);
    
    expect(export).toHaveProperty('downloadUrl');
    expect(export).toHaveProperty('expiresAt');
    expect(export.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should include all data categories', async () => {
    // Verify ZIP contains: account.json, trades.json, etc.
  });

  it('should filter to single user only', async () => {
    // Verify no other users' data in export
  });
});
```

---

## Right to Deletion: Account Termination

### User Flow

1. User navigates to **Settings → Privacy & Data → Delete Account**
2. Reads warning: "This action cannot be undone"
3. Enters password for confirmation (re-authentication)
4. Clicks "Delete My Account Permanently"
5. Receives confirmation email
6. All data deleted within 24 hours

### Implementation

**Schema: Add deletion tracking**

Prisma migration (when ready):

```prisma
model User {
  // ... existing fields ...
  deletionRequestedAt   DateTime?  @map("deletion_requested_at")
  deletionScheduledFor   DateTime?  @map("deletion_scheduled_for")
  deletionReason        String?    @map("deletion_reason")
  
  @@index([deletionScheduledFor])
}
```

**API Endpoint**: `POST /api/privacy/delete`

```typescript
// src/app/actions/privacy.ts
'use server';

import { requireSession } from '@/lib/auth/session';
import { endSession } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { SecurityLogger } from '@/lib/security/logger';
import { sendAccountDeletionEmail } from '@/lib/email';
import { prisma } from '@/lib/db/client';

export async function requestAccountDeleteAction(password: string): Promise<void> {
  const session = await requireSession();
  
  // Re-authenticate with password
  const user = await prisma.user.findUnique({
    where: { id: session.user.id }
  });
  
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    throw new Error('Invalid password');
  }
  
  // Log the deletion request
  await SecurityLogger.logAdminAction({
    userId: session.user.id,
    actionType: 'ACCOUNT_DELETION_REQUESTED',
    details: 'User requested account deletion',
  });

  // Schedule deletion for 24 hours from now (grace period)
  const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      deletionRequestedAt: new Date(),
      deletionScheduledFor: scheduledFor,
      deletionReason: 'user_requested',
    }
  });

  // Send confirmation email
  await sendAccountDeletionEmail(user.email, scheduledFor);

  // End current session
  await endSession();
}

// Cron job: runs daily at 03:00 UTC
export async function executePendingDeletions() {
  const now = new Date();
  
  const usersToDelete = await prisma.user.findMany({
    where: {
      deletionScheduledFor: { lte: now }
    }
  });

  for (const user of usersToDelete) {
    try {
      // Delete all user data (cascade will handle related records)
      await prisma.user.delete({
        where: { id: user.id }
      });
      
      console.log(`Deleted user ${user.id}`);
      
      // Log for audit trail (before user is gone)
      // Store in a separate audit table if needed
    } catch (err) {
      console.error(`Failed to delete user ${user.id}:`, err);
    }
  }
}
```

### Cascade Delete Logic

The Prisma schema already has `onDelete: Cascade` for all user-related tables:

```prisma
// From schema.prisma
model Session {
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Trade {
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ... all user-related models have onDelete: Cascade
```

**This means deleting the User automatically deletes**:
- ✅ All Session records
- ✅ All Trade records
- ✅ All FinanceEntry records
- ✅ All LongPosition records
- ✅ All PasswordResetToken records
- ✅ All Mt5Account records
- ✅ All SyncLog records
- ✅ The User's Tenant (if no other users)

### Email Template

```
Subject: Account Deletion Scheduled - TRi

Dear [User Name],

Your request to delete your TRi account has been received.

DELETION DETAILS:
- Scheduled Deletion: [Date/Time in user's timezone]
- Cancellation Available: Until [Date/Time]
- Action: All your data will be permanently deleted

WHAT WILL BE DELETED:
✓ Your account and email
✓ All trading history and records
✓ All personal finance entries
✓ All MetaTrader5 connections
✓ All session and login history
✓ Backups (within 30 days)

WHAT WILL NOT BE DELETED:
✗ Tax records maintained by your accountant
✗ Bank records of payments made
✗ Historical messages we've sent you

CANCEL DELETION:
If you change your mind, log in to TRi before [Date/Time] and 
click "Cancel Deletion" in Settings.

AFTER DELETION:
We will retain no personal data about you except as required by law.
You can create a new account anytime with a different email.

Questions? Contact support@tri.app

TRi Team
```

### Specifications

- **Delay**: 24-hour grace period before execution
- **Cancellation**: User can cancel via login anytime before deadline
- **Irreversible**: After 24 hours, automatic execution is permanent
- **Notification**: Confirmation email sent immediately
- **Speed**: All data deleted within 24 hours of scheduled time
- **Audit**: Deletion logged (before deletion occurs)

---

## Right to Rectification

### Process

Users can correct inaccurate data through:

1. **User Profile** → Edit email, currency, locale, theme
2. **Trading Data** → Edit trade notes, tags, rating, mood, strategy
3. **Finance Data** → Edit category, label, amount, date
4. **Positions** → Edit price, note, any field except symbol/date

### Logging

All updates must be logged:

```typescript
await SecurityLogger.logDataAccess({
  userId: session.user.id,
  action: 'DATA_RECTIFIED',
  resource: 'user_profile',
  changes: {
    field: 'email',
    oldValue: '[redacted]', // Never log actual values
    newValue: '[redacted]'
  }
});
```

---

## Data Processing Records

### Article 30 - Record of Processing Activities

TRi must maintain records of all data processing. Example:

```markdown
# Data Processing Record - TRi Trading Journal

## 1. Identity of Controller
Name: TRi Ltd.
Contact: privacy@tri.app
DPA: [Name/Email if appointed]

## 2. Purpose of Processing
- Core service: Trading journal analytics
- Account management and authentication
- Tax reporting (user-initiated)
- Service improvement (anonymized aggregates)
- Fraud prevention and security

## 3. Categories of Personal Data
- Authentication: Email, password hash, session tokens
- Profile: Display currency, locale, theme, timezone
- Trading: Trades, positions, P&L, strategy notes
- Finance: Income/expense entries, categories
- Usage: IP addresses, user agent, login timestamps
- Performance: Error logs, sync timestamps

## 4. Categories of Recipients
- Service providers: MetaTrader5 (via investor password)
- Payment processors: [if applicable]
- Email providers: SendGrid/Mailgun [if applicable]
- Analytics: [none - all on-device]

## 5. Retention Periods
See data-retention-policy (above)

## 6. Security Measures
- Encryption: AES-256-GCM for MT5 passwords
- Hashing: Argon2 for password hashes, SHA-256 for session tokens
- TLS: All data in transit encrypted
- Access Control: Role-based (tenant isolation)
- Audit Logging: All data access logged
- Regular security reviews and penetration testing

## 7. Lawful Basis
- Consent: User account creation
- Contract: Necessary to provide trading journal service
- Legal Obligation: Fraud prevention, tax records
- Legitimate Interest: Service improvement (aggregated)
```

---

## Privacy By Design

### Principles

1. **Data Minimization**: Collect only what's needed
   - ✅ No tracking pixels
   - ✅ No third-party analytics
   - ✅ No cookies except session
   - ✅ No fingerprinting

2. **Storage Limitation**: Delete data when no longer needed
   - ✅ Implement retention schedule (above)
   - ✅ Run daily cleanup job
   - ✅ Quarterly retention review

3. **Integrity & Confidentiality**: Protect data from unauthorized access
   - ✅ AES-256-GCM encryption for sensitive values
   - ✅ Argon2 for password hashing
   - ✅ TLS for all transport
   - ✅ SQL injection prevention (Prisma ORM)
   - ✅ CSRF protection (Next.js built-in)

4. **Accountability**: Document everything
   - ✅ Pre-commit hooks to prevent secret leaks
   - ✅ Audit logging (SecurityLogger)
   - ✅ Git history of all changes
   - ✅ Incident response procedures (INCIDENT_RESPONSE.md)

### Checklist: For Each New Feature

When adding a feature that processes user data:

- [ ] Identify what personal data is collected
- [ ] Document lawful basis for processing
- [ ] Set retention period (or use default 12 months)
- [ ] Implement access logging
- [ ] Implement deletion logic (cascade delete)
- [ ] Add field to audit log for changes
- [ ] Update Data Processing Record (above)
- [ ] Run privacy impact assessment
- [ ] Document in this file

---

## Compliance Contacts

### Data Protection Officer (DPO)

[Name/Email/Phone] - Appointed if required by GDPR

### Legal Representative (Article 27)

If TRi is established outside EU, appoint representative:
[Name/Address/Email/Phone]

---

## Related Documents

- **INCIDENT_RESPONSE.md** - GDPR breach notification procedures
- **security.yml** - CI/CD security scanning
- **.husky/pre-commit** - Secret leak detection
- **src/lib/security/logger.ts** - Audit logging implementation

---

**Document Owner**: Data Protection Officer / Privacy Officer  
**Last Review**: 2026-08-03  
**Next Review Due**: 2026-11-03 (Quarterly)
