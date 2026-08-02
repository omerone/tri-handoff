# Incident Response Playbook

**Version**: 1.0  
**Last Updated**: 2026-08-03  
**Scope**: TRi Trading Journal  

This document outlines the procedures for detecting, responding to, and recovering from security incidents.

## Table of Contents

1. [Incident Classification](#incident-classification)
2. [Detection & Reporting](#detection--reporting)
3. [Initial Response](#initial-response)
4. [GDPR Breach Response](#gdpr-breach-response)
5. [Investigation & Containment](#investigation--containment)
6. [Recovery](#recovery)
7. [Communication](#communication)
8. [Post-Incident Review](#post-incident-review)

---

## Incident Classification

### Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|----------------|----------|
| **Critical** | Active threat, data exposure, service down | 15 min | Ransomware, breach confirmed, DDoS |
| **High** | Potential data exposure, significant impact | 1 hour | Unauthorized access, credential leak |
| **Medium** | Limited scope, temporary unavailability | 4 hours | Configuration error, failed backup |
| **Low** | No user impact, minor security issue | 24 hours | Dependency warning, policy violation |

### Incident Types

- **Data Breach**: Unauthorized access to user data (trades, personal finance, MT5 creds)
- **Account Compromise**: User session stolen, admin account compromised
- **Denial of Service**: Service unavailable (DDoS, resource exhaustion)
- **Credential Leak**: API keys, database passwords, session tokens exposed
- **Malware/Code Injection**: Malicious code in codebase or dependencies
- **Configuration Error**: Misconfigured security settings, overpermissioned access

---

## Detection & Reporting

### Automated Monitoring

The following systems must alert on incidents:

1. **CI/CD Pipeline** (`npm audit --audit-level=moderate`)
   - Fails build on moderate+ vulnerabilities
   - Review in GitHub Actions artifacts

2. **Application Logs**
   - Monitor for: failed login attempts, privilege escalation, unusual API access
   - Setup: Application must implement SecurityLogger (see Task 8)

3. **Database Audit Logs**
   - Schema: `auth_events`, `admin_audit_log`, `data_access_log`
   - Alert on: Data export > 1000 rows, multiple failed auth, admin actions

### Manual Reporting

**Who to Report To**:

1. **Security Incident Lead** (or on-call manager)
   - Immediate notification via Slack #security-incidents
   - Include: timestamp, incident type, severity, affected systems

2. **Engineering Lead**
   - Notify immediately for Critical/High
   - Provide initial assessment within 1 hour

3. **Product/Compliance Officer**
   - Required for data breaches (72-hour GDPR window)

### Report Template

```
INCIDENT REPORT
================

Time Detected: [ISO 8601 timestamp]
Reported By: [name/email]
Initial Severity: [Critical/High/Medium/Low]

Incident Type: [Category]
Description: [2-3 sentences]

Affected Systems:
- [ ] Users (count: ___)
- [ ] Database tables: ___
- [ ] Deployments affected: ___

Initial Impact:
- Confidentiality: [High/Medium/Low/None]
- Integrity: [High/Medium/Low/None]
- Availability: [High/Medium/Low/None]

Next Steps:
- Action 1
- Action 2
```

---

## Initial Response

### Immediate Actions (First 15 Minutes)

**Critical/High Incidents**:

1. **Page on-call team** (Security Lead, Database Admin, Platform Engineer)
   - Establish war room (Zoom/Slack)
   - Assign Incident Commander

2. **Preserve Evidence**
   - Don't delete logs or data
   - Take snapshots of affected systems
   - Screenshot error messages / dashboard anomalies

3. **Contain the Incident**
   - Isolate affected system (e.g., revoke API keys, kill sessions)
   - Restrict access to investigation team
   - Update status page if service impacted

4. **Start Timeline**
   - When was incident detected?
   - When did it likely start?
   - Any prior warnings?

### Incident Commander Responsibilities

- Coordinates team response
- Updates stakeholders every 30 min
- Manages escalation
- Approves containment/recovery actions
- Keeps detailed timeline

---

## GDPR Breach Response

**Trigger**: Personal data of EU residents exposed (email, trades, connected MT5 accounts)

### 72-Hour GDPR Notification (Data Protection Authority)

**Timeline**:
- **T+0-6h**: Confirm breach, assess impact
- **T+6-24h**: Prepare notification content
- **T+24-48h**: Submit to data protection authority
- **T+48-72h**: Notify affected users

### Notification to Data Protection Authority

**Required Information** (GDPR Article 33):

1. **Breach Description**
   - What data was affected (specific categories)
   - How many users/records
   - Confirmed vs. suspected

2. **Personal Data Categories**
   - Email addresses
   - Trade history/strategy data
   - Connected MT5 account login (NOT password)
   - IP addresses / session data

3. **Likely Consequences**
   - Risk of identity theft
   - Account takeover risk
   - Privacy impact

4. **Measures Taken**
   - Incident contained (how/when)
   - User notifications (when)
   - Root cause investigation status

5. **Point of Contact**
   - Name, title
   - Email, phone
   - Available 24/7

### Template: GDPR Breach Notification

```
GDPR DATA BREACH NOTIFICATION
==============================

Authority: [Country Data Protection Authority]
Report Date: [ISO 8601]
Incident Reference: [TRi-BREACH-2026-###]

--- BREACH SUMMARY ---
Description of the Processing:
TRi provides trading journal services. Personal data includes email, 
trading history, connected MetaTrader5 account references, and session data.

Description of the Breach:
[Specific details: what happened, when discovered, how detected]

Data Categories Affected:
- Email addresses: [count]
- Trading history: [count] records from [date range]
- MT5 account references: [count] (NOT including passwords)
- IP addresses / session logs: [count]

--- ASSESSMENT ---
Likelihood of High Risk:
[High/Medium/Low] - explanation

Affected Data Subjects:
- EU residents affected: [count]
- Likely notification method: Email

--- CONTAINMENT & RECOVERY ---
Measures Taken:
1. [Containment measure, timestamp]
2. [Investigation measure, timestamp]
3. [Prevention measure, timestamp]

Ongoing Investigation:
[Root cause analysis status]

--- CONTACT ---
Data Protection Officer: [Name/Email/Phone]
Incident Coordinator: [Name/Email/Phone]
```

### User Notification

**Timeline**: Notify users within 72 hours of authority notification

**Message Template**:

```
Subject: Security Incident Notification - TRi Trading Journal

Dear [User Name],

We are writing to inform you of a security incident affecting TRi.

WHAT HAPPENED:
On [date], we detected unauthorized access to [describe scope]. 
We immediately contained the incident and are conducting a full investigation.

WHAT INFORMATION WAS AFFECTED:
- Your email address
- Your trading history (trades, dates, profits/losses)
- References to your MetaTrader5 account (login/server only - NOT password)

WHAT WE'RE DOING:
1. Full forensic investigation (completed by [date])
2. Strengthened security controls: [list specific improvements]
3. Monitoring accounts for suspicious activity
4. [Any other remediation]

WHAT YOU SHOULD DO:
1. Change your TRi password immediately
2. Monitor your email for suspicious activity
3. Consider changing your MetaTrader5 password as precaution
4. Do NOT respond to emails requesting verification

SUPPORT:
If you have concerns, contact us at [support email/phone] or visit [knowledge base link]

We regret this incident and appreciate your trust.

TRi Security Team
```

---

## Investigation & Containment

### Forensic Steps

**Immediately** (within 1 hour):

1. **Review Logs**
   - Application logs (stderr, stdout, app logs)
   - Database audit logs (if available)
   - Security event logs (from SecurityLogger)
   - Web server logs (nginx/Caddy access logs)

2. **Analyze Timeline**
   - First suspicious activity
   - Full scope of access
   - Dwell time (how long attacker had access)

3. **Check for Additional Compromises**
   - Review other user accounts for unauthorized access
   - Check admin accounts for unusual activity
   - Review API tokens / session tokens for signs of theft

**Within 4 Hours**:

4. **Isolate Root Cause**
   - Configuration error?
   - Dependency vulnerability?
   - Credential leak?
   - Insider access?

5. **Scope Impact**
   - How many users affected?
   - What data accessed?
   - How is data used downstream?

### Containment Actions

| Incident Type | Immediate Action | Follow-up |
|---------------|-----------------|-----------|
| **Account Compromise** | Revoke all sessions for affected user | Reset password, enable MFA audit |
| **Admin Access Abuse** | Revoke admin credentials, audit access logs | Review permission grants |
| **API Key Leak** | Revoke leaked key, generate new | Audit key usage in logs |
| **Database Breach** | Kill all sessions (force re-login) | Change DB password, audit queries |
| **Dependency Vulnerability** | Stop deployment, patch version | Test in staging, deploy fix |

### Data Exfiltration Assessment

**Determine**: What data left the system?

1. Check database query logs for large `SELECT` queries
2. Review network egress (traffic to external IPs)
3. Check for file downloads/exports
4. Review backup access logs (if available)

---

## Recovery

### Restore from Backup

**Steps**:

1. **Identify Clean Snapshot**
   - Use backup from before breach started
   - Verify backup integrity (checksums)

2. **Restore in Staging**
   - Never restore to production directly
   - Verify data looks correct
   - Test application functionality

3. **Switch to Restored State**
   - Plan maintenance window
   - Notify users (if downtime)
   - Execute cutover
   - Monitor for errors

4. **Verify Recovery**
   - Run integration tests
   - Spot-check user data
   - Monitor logs for errors

### Patch & Deploy

**Steps**:

1. **Apply Security Patch**
   - Fix root cause in code/config
   - Test in staging
   - Code review by 2 engineers
   - Build and test in CI

2. **Deploy to Production**
   - Use staged rollout (10% → 50% → 100%)
   - Monitor error rates
   - Keep previous version ready for rollback

3. **Verify Fix**
   - Confirm vulnerability patched
   - Re-run security tests
   - Verify no regression

---

## Communication

### Internal (First 30 Minutes)

**Slack #security-incidents**:
```
@security-team INCIDENT: [Type] - [Severity]
Incident ID: TRi-INC-2026-###
Time Detected: [ISO timestamp]
Incident Commander: [Name]
Status Page: [link]
War Room: [Zoom link]
```

### Status Updates

- **Every 30 minutes**: Slack update to stakeholders
- **Every 2 hours**: Email update to exec team
- **Daily**: Incident review & communication

### External Communication

**Timing**: Only after internal team is informed

**Channels**:
1. **Status Page** (public.status.tri.app)
   - Post "Investigating" incident
   - Update with recovery ETA

2. **Email to Users** (only if data breach confirmed)
   - Use template above
   - Coordinate with legal/compliance

3. **Press Release** (only if high-profile breach)
   - Coordinate with PR team
   - Emphasize containment & response

### Post-Breach Notification Audit

Document all notifications:
- Who was contacted (internal team)
- When (timestamps)
- What channel (email, Slack, call)
- Confirmation of receipt
- Any escalations

---

## Post-Incident Review

### Timeline (Conducted Within 48 Hours of Resolution)

**Attendees**: Incident Commander, on-call team, relevant engineers, product lead

**Agenda** (2 hours):

1. **Incident Summary** (15 min)
   - Chronological timeline
   - What went wrong
   - How it was detected
   - How it was resolved

2. **Root Cause Analysis** (30 min)
   - Why did it happen?
   - Was it preventable?
   - What gaps in monitoring/process?

3. **Impact Assessment** (15 min)
   - Users affected
   - Data exposed
   - Business impact
   - Customer response

4. **Lessons Learned** (30 min)
   - What did we do well?
   - What could we improve?
   - Detection: How did we miss it?
   - Response: What took too long?
   - Recovery: Were backups adequate?

5. **Action Items** (30 min)
   - Who owns each action?
   - Deadline for completion?
   - Acceptance criteria?
   - Who validates?

### Post-Incident Report

**Created within 5 days**. Shared with exec team and team. Example:

```markdown
# Post-Incident Report: TRi-INC-2026-001

**Date**: 2026-08-15
**Incident Type**: Database credentials leaked via CI logs
**Severity**: Critical
**Duration**: 2 hours 15 minutes (detected to full containment)
**Users Affected**: None confirmed (credentials rotated within 1 hour)

## Timeline
- 14:32 UTC: Developer commits environment variable to GitHub
- 14:35 UTC: Automated scanner detects leak in CI build
- 14:38 UTC: Incident reported to security team
- 14:45 UTC: Database credentials rotated, connections killed
- 14:52 UTC: GitHub commit history scrubbed, new credentials deployed

## Root Cause
Developer did not have pre-commit hooks enabled locally. The `.husky/pre-commit` 
hook would have prevented this commit.

## Impact
Database credentials exposed in GitHub build logs for ~3 minutes. 
Attacker would need GitHub access + ability to pull logs (unlikely but possible).

## Lessons Learned
1. ✅ Pre-commit hooks caught an attempted manual bypass - hooks are effective
2. ❌ We don't audit CI log access - add monitoring for GitHib log reads
3. ✅ Credential rotation was fast
4. ❌ Need onboarding checklist to ensure husky is installed (npm install was not run)

## Actions
1. [DONE] Database credentials rotated (Aug 15, 14:45)
2. [DONE] CI build logs purged (Aug 15, 15:00)
3. [TODO] Add GitHub Actions audit logging (Due: Aug 22)
4. [TODO] Create developer onboarding checklist (Due: Aug 22)
5. [TODO] Add automated credential rotation test to CI (Due: Aug 29)

## Owner: [Security Lead Name]
## Next Review: 2026-08-22
```

### Action Item Tracking

All post-incident actions must be:
1. Created as GitHub issues (label: `security-incident-followup`)
2. Assigned to owner with deadline
3. Reviewed monthly in security meeting
4. Closed when acceptance criteria met

---

## Escalation Path

```
Application Error / Log Alert
           ↓
Security On-Call (paged)
           ↓
Incident Commander assigned
           ↓
Assess Severity
      ↙          ↙         ↘
   LOW       MEDIUM        HIGH/CRITICAL
   ↓            ↓              ↓
Async resp.  Manager      CEO + CTO + Counsel
             notified      Notified immediately
   
   ↓            ↓              ↓
   |----------→ Incident Response Team Activated
                ↓
           War Room (Zoom)
                ↓
           Execute Playbook
```

---

## Contacts & Escalation

### On-Call Team

- **Security Lead**: [Name] [Phone/Email]
- **Database Admin**: [Name] [Phone/Email]
- **Platform/DevOps**: [Name] [Phone/Email]
- **CEO**: [Name] [Phone/Email]

### External Contacts

- **Data Protection Authority** (GDPR): [Contact info]
- **Legal Counsel**: [Firm name/contact]
- **Insurance Provider**: [Contact/policy #]
- **PR/Communications**: [Contact]

### Tools & Access

- **War Room**: Zoom link (on status page)
- **Incident Dashboard**: [Internal link]
- **Log Aggregation**: [ELK/Datadog/etc]
- **Database Access**: [Connection details in 1Password/vault]
- **GitHub/AWS Access**: [How to grant emergency access]

---

## Appendix: Runbooks

### Runbook: Account Compromise

```
Suspected user account compromise detected.

IMMEDIATE (5 min):
1. Page security on-call
2. Kill all sessions for user (delete all Session rows)
3. Mark last_login_at for audit

ASSESSMENT (15 min):
1. Review audit logs for unauthorized actions
2. Check if trades/finance data were modified
3. Check if MT5 account credentials were accessed
4. Determine scope (this user only? admin? data exfil?)

CONTAINMENT (30 min):
1. Force password reset (send reset email)
2. Disable login temporarily (set flag in User model)
3. Review change logs (which trades/finance were modified)
4. Reverse any fraudulent changes

RECOVERY (1 hour):
1. Enable login with new password
2. Send user notification email
3. Offer 2FA enrollment
4. Set security review flag for next login
```

### Runbook: Dependency Vulnerability

```
npm audit reports moderate/high/critical vulnerability.

IMMEDIATE (15 min):
1. Identify affected package & version range
2. Check GitHub Security Advisory for patch availability
3. Determine if we use the vulnerable code path

ASSESSMENT (30 min):
1. What's the impact? (RCE, DOS, info disclosure?)
2. Can it be exploited in our usage?
3. Is there a workaround?

RESPONSE (60 min):
1. Patch version (or upgrade to fixed version)
2. Test in staging (npm run check)
3. Deploy to production
4. Run npm audit again to confirm
```

---

**Document Owner**: Security Lead  
**Last Review**: 2026-08-03  
**Next Review Due**: 2026-11-03 (Quarterly)
