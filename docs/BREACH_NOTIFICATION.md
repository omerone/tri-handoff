# Data Breach Notification Procedure

**Document Version**: 1.0  
**Last Updated**: August 3, 2026  
**Scope**: All security incidents involving personal data  
**Applies To**: GDPR (EU/EEA/UK), CCPA (California), and other privacy laws

---

## 1. Executive Summary

This procedure defines how TRi responds to data breaches involving personal data. **A data breach is any unauthorized or accidental disclosure, loss, alteration, or destruction of personal data.**

**Key Timelines**:
- **GDPR Notification Timeline**: 72 hours to notify authorities (Article 33)
- **User Notification**: "Without undue delay" (typically 30 days)
- **Internal Response**: Immediate escalation upon discovery
- **Investigation**: 5-14 days depending on severity

---

## 2. Definition of Data Breach

### 2.1 What Constitutes a Breach

A breach occurs when personal data is:

| Scenario | Example | Severity |
|----------|---------|----------|
| **Disclosed to unauthorized parties** | Hacker gains access to user database | 🔴 Critical |
| **Lost or deleted accidentally** | Production database deleted by mistake | 🔴 Critical |
| **Altered or corrupted** | Attacker modifies trading data | 🔴 Critical |
| **Inadvertently sent to wrong recipient** | Email with user data sent to wrong address | 🟡 High |
| **Accessed by employee without authorization** | Admin views user's private data without permission | 🟡 Medium |
| **Exposed to public (accidental or malicious)** | Private data exposed via misconfigured S3 bucket | 🔴 Critical |

### 2.2 What Does NOT Constitute a Breach

- **Authorized access** (e.g., support team helping customer)
- **Encrypted data (if key not compromised)** (e.g., encrypted backup accessed)
- **Aggregated, anonymized data** (cannot identify individuals)
- **Failed access attempts** (not actually accessed)
- **Security testing** (authorized penetration testing)

---

## 3. Detection & Discovery

### 3.1 How Breaches Are Detected

**Monitoring Systems**:
- 🔍 AWS CloudTrail (unauthorized access attempts)
- 🔍 Database audit logs (suspicious queries)
- 🔍 Application logs (error patterns, anomalies)
- 🔍 WAF logs (injection attempts, malicious requests)
- 🔍 Email alerts (failed login spikes, unusual activities)
- 🔍 External reports (users reporting suspicious activity)
- 🔍 Third-party security scanners (vulnerabilities, misconfigurations)

**Automated Detection**:
- Intrusion detection system (IDS) alerts
- Unusual database query patterns
- Spike in authentication failures
- Unauthorized API access
- Data exfiltration attempts

**Manual Detection**:
- User reports suspicious activity
- Support team notices unusual requests
- Regulatory authority notification
- Third-party researcher disclosure

### 3.2 Initial Response (Immediate)

**Upon Detection**:

1. **DO NOT PANIC** — follow this procedure
2. **Isolate the affected system** (if possible, without destroying evidence)
3. **Document the discovery**:
   - What was discovered?
   - When was it discovered?
   - Who discovered it?
   - How was it discovered?
   - What systems are affected?
4. **Preserve evidence** — do not delete logs or data
5. **Notify Incident Commander** (see Section 4)

---

## 4. Incident Response Team

### 4.1 Incident Response Structure

```
Incident Discovery
    ↓
Incident Commander (Security Lead)
    ├→ Legal Team (Notifications, compliance)
    ├→ Technical Team (Investigation, containment)
    ├→ Communications (User notifications, PR)
    └→ Executive (CEO, CFO for critical breaches)
```

### 4.2 Incident Commander

**Responsible for**:
- Coordinating response
- Assessing severity
- Deciding notification requirements
- Communicating with authorities
- Managing timeline

**Primary**: Chief Security Officer (CSO) or Security Lead  
**Backup**: CTO or Lead Engineer  
**Contact**: security@tri.com

### 4.3 Team Responsibilities

| Team | Responsibilities |
|------|------------------|
| **Security** | Investigate breach, determine scope, contain threat |
| **Legal** | Notify authorities, notify data subjects, manage compliance |
| **Engineering** | Fix vulnerability, restore systems, verify remediation |
| **Communications** | Prepare user notifications, manage external messaging |
| **Executive** | Make final approval for notifications, manage escalation |
| **Data Protection Officer** | Advise on GDPR/privacy implications |

---

## 5. Breach Investigation (5-14 Days)

### 5.1 Scope Assessment

**Determine**:
- Which personal data was affected?
- How many users/data subjects affected?
- What was the scope of access?
- Was data actually accessed or just exposed?
- For how long was data exposed?

**Data Affected Determination**:
```
Check each data category:
✓ User accounts (email, profile)
✓ MT5 tokens (encrypted storage)
✓ Trading data (historical records)
✓ Financial data (billing records)
✓ Audit logs (security events)
✓ Session data (tokens, IPs)
✓ Backups (if exposed)
```

**Impact Assessment**:
- **Data subjects affected**: Count of unique individuals
- **Data types**: Which fields were exposed?
- **Severity**: High risk (passwords, tokens) vs. low risk (profile data)
- **Regulatory impact**: GDPR, CCPA, sectoral laws

### 5.2 Cause Determination

**Identify root cause**:
- Was it a malicious attack (hacking)?
- Was it accidental exposure (misconfiguration)?
- Was it insider threat (employee)?
- Was it supply chain compromise (third-party)?
- Was it natural disaster (hardware failure)?

**Example**:
```
Discovery: S3 bucket publicly accessible
Cause: Misconfigured bucket policy (ACL error)
Scope: Daily backups exposed for 48 hours
Impact: 500 user accounts + trading data
Severity: CRITICAL - immediate action required
```

### 5.3 Forensic Analysis

**Conduct**:
1. **Timeline Analysis**: When did breach start? When did it end?
2. **Access Logs**: Who accessed the data? What did they access?
3. **Network Logs**: Where did the access come from (IP addresses)?
4. **Database Audit**: Which queries were executed? By whom?
5. **Malware Analysis**: If malware involved, analyze it
6. **Third-party Analysis**: Engage forensics firm if severe

**Preserve Evidence**:
- [ ] Take disk images of affected systems
- [ ] Export database audit logs
- [ ] Export firewall/WAF logs
- [ ] Export CloudTrail logs
- [ ] Document physical access logs
- [ ] Preserve email communications

### 5.4 Investigation Report

**Document**:
- **Breach Summary**: What, when, who, how
- **Scope**: Number of data subjects, data types affected
- **Root Cause**: Why the breach occurred
- **Timeline**: When each event occurred
- **Forensic Findings**: Technical investigation results
- **Remediation**: Steps taken to stop the breach
- **Prevention**: Steps to prevent recurrence
- **Recommendations**: Improvements to security

**Examples**:
- "Attacker used SQL injection to extract 500 user records over 72 hours"
- "S3 bucket misconfiguration exposed 1000 backups for 48 hours; no unauthorized access confirmed"
- "Employee accidentally attached user list to customer email; recipient alerted, data securely destroyed"

---

## 6. Severity Classification

### 6.1 Severity Levels

| Level | Criteria | Timeline | Action |
|-------|----------|----------|--------|
| **🔴 CRITICAL** | Large-scale breach (1000+ affected users) OR highly sensitive data (passwords, tokens) OR confirmed malicious access | Immediate | Notify within 24 hours |
| **🟠 HIGH** | Moderate breach (100-999 users) OR sensitive data (emails, profile) OR likely malicious access | 48 hours | Notify within 72 hours |
| **🟡 MEDIUM** | Small breach (<100 users) OR limited data (generic info) OR no confirmed access | 7 days | Notify within 30 days |
| **🟢 LOW** | No actual data access OR encrypted data (key not compromised) OR anonymized data | Defer | Monitor, no notification |

### 6.2 Severity Factors

Increase severity if:
- ✗ Data subject has already experienced identity theft
- ✗ Children's data affected (COPPA violation)
- ✗ Broker/financial account data compromised
- ✗ Multiple breaches in short timeframe
- ✗ Regulatory investigation underway

Decrease severity if:
- ✓ Data was encrypted (end-to-end)
- ✓ Only anonymized data exposed
- ✓ No confirmed unauthorized access
- ✓ Exposed data is public already (emails from social media)

---

## 7. Regulatory Notification

### 7.1 GDPR Article 33: Notify Authorities (72 Hours)

**TRi must notify authorities without undue delay, and in most cases within 72 hours of discovery.**

**Step 1: Determine if Notification Required**

Not required if breach is "unlikely to result in risk to the rights and freedoms of natural persons" (e.g., encrypted data, no access confirmed).

**Question**: Does the breach present a risk to data subjects?
- Passwords compromised? → YES, notify
- Encrypted data exposed (key secure)? → NO, likely exempt
- Anonymized data? → NO, not personal data

**Step 2: Gather Information for Authority**

Authority notification must include:
- [ ] Breach description (what, when, who, how)
- [ ] Number of data subjects affected
- [ ] Number of records affected
- [ ] Data types affected
- [ ] Likely consequences for data subjects
- [ ] Mitigation measures taken
- [ ] Contact person (DPO or legal contact)

**Step 3: Notify Authority**

**Notification Channels by Country**:

| Authority | Contact | How to Report |
|-----------|---------|---------------|
| **ICO (UK)** | https://ico.org.uk | Breach report form: https://ico.org.uk/about-the-ico/what-we-do/report-data-breach |
| **EDPB (EU)** | Contact your national DPA | Via national DPA website |
| **CNIL (France)** | https://www.cnil.fr | Breach form: https://www.cnil.fr/fr/plaintes |
| **BfDI (Germany)** | https://www.bfdi.bund.de | Breach portal |
| **DPA (Israel)** | https://www.justice.gov.il | Via email: mishmarti@justice.gov.il |
| **FTC (US/CCPA)** | https://reportfraud.ftc.gov | File complaint form |

**Example Notification Email**:

```
Subject: Data Breach Notification - Article 33 (GDPR)

Dear [Authority Name],

This is to notify you of a data breach affecting TRi users, in accordance with GDPR Article 33.

**Breach Details**:
- Date of Discovery: August 5, 2026
- Date of Breach: August 3, 2026 (48-hour window)
- Number of Affected Individuals: 250
- Data Categories: Email addresses, trading history (no passwords or payment data)
- Root Cause: Attacker gained access via compromised employee credentials

**Immediate Actions**:
- Affected user accounts have been suspended
- Compromised credentials have been reset
- Enhanced monitoring has been implemented
- All access logs are being preserved for investigation

**Mitigation**:
- Users notified within 72 hours
- Data protection impact assessment completed
- Multi-factor authentication now mandatory

For questions, contact: [DPO Email]

Regards,
TRi Data Protection Officer
```

### 7.2 GDPR Article 34: Notify Data Subjects

**If there is a high risk to data subjects, they must be notified.**

**Factors for High Risk**:
- ✗ Passwords or authentication tokens compromised
- ✗ Financial data exposed
- ✗ Identity document copies exposed
- ✗ Medical or sensitive personal data exposed
- ✗ Identity theft already occurring

**Factors Against High Risk**:
- ✓ Only names and email addresses
- ✓ No financial or health data
- ✓ No authentication credentials
- ✓ Data properly encrypted

**Notification Contents** (Article 34):
- [ ] Name and contact of DPO
- [ ] Description of breach
- [ ] Likely consequences
- [ ] Measures taken or proposed to mitigate harm
- [ ] Contact for further information
- [ ] Remediation options (credit monitoring, password reset, etc.)

**Notification Method**:
- Primary: Email to account email address
- Secondary: In-app notification banner
- Tertiary: SMS/phone (for critical breaches)
- If 500+ affected: Press release + website notice

### 7.3 CCPA Notification (California, USA)

**If affected users include California residents:**

**Timeline**: Without unreasonable delay (typically 30-45 days)

**Notification Channels** (any one sufficient):
- Written notice by mail
- Email notice
- Telephone notice (for premium services)
- Website notice (if >500 affected)

**Notification Contents**:
- [ ] What personal information was involved?
- [ ] What are the likely consequences?
- [ ] What is TRi doing to protect data subjects?
- [ ] Contact information for more information
- [ ] Information about credit monitoring (if applicable)

**Consumer Reporting Agencies**:
- Must notify major credit reporting agencies if 500+ residents affected
- Agencies: Equifax, Experian, TransUnion

---

## 8. User Notification

### 8.1 Notification Timing

| Severity | Timeline | Method |
|----------|----------|--------|
| 🔴 Critical | Within 24 hours | Email + In-app notification |
| 🟠 High | Within 72 hours | Email + In-app notification |
| 🟡 Medium | Within 30 days | Email or In-app notification |

### 8.2 Notification Template

**Subject**: [URGENT] Security Incident Affecting Your Account - Action Required

**Body**:

```
Dear [User Name],

We are writing to inform you of a security incident that may affect your account.

**What Happened**:
On [DATE], we discovered that [DESCRIPTION OF BREACH].
[Number] user accounts were affected, including yours.

**What Data Was Affected**:
- Email address
- Trading history
- [Other data categories]

**What Was NOT Affected**:
- Passwords (securely hashed, not exposed)
- Payment information (handled by Stripe)
- MT5 account credentials (encrypted)

**What We Are Doing**:
1. We have secured the affected systems
2. We are investigating the root cause
3. We are implementing additional security measures
4. Law enforcement has been notified

**What You Should Do**:
1. Reset your password immediately: https://tri.com/reset-password
2. Enable multi-factor authentication (MFA): https://tri.com/settings/security
3. Monitor your account for suspicious activity
4. Review your credit report (if applicable)
5. Contact us if you notice anything unusual

**Your Rights**:
- You can request a copy of your data: Settings → Privacy → Export Data
- You can request deletion of your account: Settings → Account → Delete Account
- You can file a complaint with your local data protection authority

**Contact Information**:
- For questions: privacy@tri.com
- Security team: security@tri.com
- Data Protection Officer: dpo@tri.com

We sincerely apologize for this incident and appreciate your patience as we work to 
resolve it.

Regards,
The TRi Team
```

### 8.3 Multi-Channel Notification

**Email** → Primary notification method
- Sent to account email address
- Include link to full details page
- Include steps to secure account

**In-App Notification** → Displayed on login
- Prominent banner at top of dashboard
- Link to full incident details
- Dismiss after read (or 7 days)
- Resend if user doesn't acknowledge

**Website Notice** → For large breaches (500+ affected)
- Displayed on homepage
- Explain incident and steps to take
- Direct to more information page

**SMS/Phone** → For critical breaches
- Text message with incident summary
- Phone call from security team
- Only if direct threat to user (e.g., fraud)

### 8.4 Notification Log

**Track all notifications**:
- [ ] User email address
- [ ] Notification date/time
- [ ] Notification method (email, in-app, SMS)
- [ ] Delivery confirmation
- [ ] User acknowledgment
- [ ] Follow-up actions
- [ ] Feedback received

---

## 9. Remediation & Prevention

### 9.1 Immediate Mitigation

**During/After Breach**:
- [ ] Isolate affected systems
- [ ] Reset compromised passwords
- [ ] Revoke compromised tokens
- [ ] Block malicious IP addresses
- [ ] Revoke third-party API access
- [ ] Restore from clean backups
- [ ] Patch vulnerable systems
- [ ] Review and strengthen firewall rules

### 9.2 Post-Breach Security Improvements

**Within 30 days**:
- [ ] Implement more robust access controls
- [ ] Deploy multi-factor authentication (MFA)
- [ ] Enhance monitoring and alerting
- [ ] Increase audit logging
- [ ] Deploy additional intrusion detection
- [ ] Review third-party access
- [ ] Conduct security awareness training
- [ ] Implement vulnerability scanning

**Within 90 days**:
- [ ] Complete security code review
- [ ] Conduct penetration testing
- [ ] Implement SIEM (Security Information and Event Management)
- [ ] Upgrade encryption standards
- [ ] Deploy data loss prevention (DLP)
- [ ] Conduct security architecture review

### 9.3 Root Cause Prevention

**Example**:
- Breach Cause: Unpatched vulnerability in library
- Prevention: Implement automated dependency scanning (Renovate, Snyk)
- Timeline: 30 days to integrate

---

## 10. Communications & Public Relations

### 10.1 External Communications

**Press Release** (if 500+ affected or media inquiry):

```
[COMPANY NAME] REPORTS DATA SECURITY INCIDENT

[CITY], [DATE] – TRi Ltd. today reported that it discovered a data security 
incident affecting approximately [NUMBER] user accounts.

Upon discovery on [DATE], TRi immediately launched an investigation with the 
assistance of [forensics firm, if applicable]. The investigation determined that 
[DESCRIPTION].

TRi has taken the following steps:
- Secured affected systems
- Notified affected users
- Notified regulatory authorities
- Implemented additional security measures

TRi takes the security of user data seriously and sincerely apologizes for this 
incident. Users who have questions can contact privacy@tri.com.

[Additional details as appropriate]
```

### 10.2 Stakeholder Communication

**Internal** (employees):
- Incident summary in all-hands meeting
- Q&A session with security team
- Talking points for support staff

**Customers** (if B2B):
- Direct email from account manager
- Detailed incident report
- Remediation plan
- Timeline for fixes

**Partners** (if applicable):
- Notification of incident
- Impact on their systems
- Remediation timeline
- Verification steps

### 10.3 Crisis Communications Plan

**Spokesperson**:
- Primary: CEO or Chief Communication Officer
- Backup: General Counsel (Legal)
- Technical: Chief Security Officer (for media inquiries)

**Key Messages**:
- "We take security seriously"
- "We discovered the incident and took immediate action"
- "We are cooperating with authorities"
- "We have implemented additional protections"
- "User data protection is our priority"

---

## 11. Documentation & Record-Keeping

### 11.1 Breach Register

**TRi maintains a Breach Register (Article 33, GDPR)**:

| Field | Details |
|-------|---------|
| **Incident ID** | TRI-2026-001 |
| **Date Discovered** | 2026-08-05 |
| **Date of Breach** | 2026-08-03 |
| **Data Affected** | Emails, trading data |
| **Subjects Affected** | 250 |
| **Root Cause** | Compromised credentials |
| **Authority Notified** | ICO (UK) |
| **Authority Notification Date** | 2026-08-05 |
| **Users Notified** | 2026-08-05 |
| **Status** | Investigation ongoing |
| **Remediation** | MFA implemented |
| **Contact** | John Doe (DPO) |
| **Notes** | Forensics report filed |

### 11.2 Investigation Documentation

**Preserve and store**:
- [ ] Incident discovery report
- [ ] Forensic analysis report
- [ ] Timeline of events
- [ ] Screenshots/logs of breach
- [ ] Copies of notifications sent
- [ ] Responses from authorities
- [ ] User feedback/complaints
- [ ] Remediation actions taken
- [ ] Follow-up audit results
- [ ] Cost analysis (if applicable)

### 11.3 Retention Policy

**Documentation retained**:
- **Active investigation**: During investigation + 30 days
- **For authorities**: Until 72-hour notification deadline + 90 days
- **For users**: Until all notifications sent + 1 year
- **Regulatory file**: For 3+ years (per data protection law)
- **Litigation hold**: Longer if pending lawsuit

---

## 12. Post-Incident Review

### 12.1 Lessons Learned

**Within 30 days of resolution**:
- [ ] Schedule review meeting
- [ ] Invite: Security, Engineering, Legal, Executive
- [ ] Analyze what happened and why
- [ ] Identify gaps in prevention/detection/response
- [ ] Document lessons learned
- [ ] Create action items for improvements
- [ ] Assign owners and deadlines

**Questions to Answer**:
1. Could this breach have been prevented? How?
2. How quickly was it detected?
3. How could detection be faster?
4. Was the response adequate?
5. What resources were missing?
6. What training would help?

### 12.2 Continuous Improvement

**Implement**:
- Enhanced monitoring
- Better access controls
- Improved training
- Process changes
- Technology upgrades
- Testing and drills

**Track**:
- Action items completion
- Effectiveness of improvements
- Incident metrics (time to detect, time to respond, etc.)

---

## 13. Testing & Drills

### 13.1 Incident Response Testing

**Quarterly Tests**:
- Tabletop exercise (discuss breach scenario)
- Validate contact information
- Review procedures
- Test notification system
- Test backup restoration

**Annual Full Drill**:
- Simulate actual breach
- Test all procedures
- Measure response time
- Identify gaps
- Update procedures

### 13.2 Security Drills

**Regular Security Training**:
- Monthly phishing simulations
- Quarterly security awareness training
- Annual penetration testing
- Continuous vulnerability scanning
- Monthly backup restoration drills

---

## 14. Contacts & Escalation

### 14.1 Incident Contacts

| Role | Name | Email | Phone | On-Call |
|------|------|-------|-------|---------|
| Incident Commander | [Security Lead] | security@tri.com | [Phone] | Yes |
| Legal | [General Counsel] | legal@tri.com | [Phone] | Yes |
| DPO | [Name] | dpo@tri.com | [Phone] | Yes |
| CTO | [Name] | cto@tri.com | [Phone] | Yes |
| CEO | [Name] | ceo@tri.com | [Phone] | On Critical Only |

### 14.2 Escalation Path

```
Incident Discovered
    ↓ (Immediate)
Incident Commander
    ↓ (Within 1 hour)
Legal Team + Security Team
    ↓ (Within 4 hours)
Executive (CEO, CFO)
    ↓ (Within 24 hours)
Board of Directors (if critical)
```

---

## 15. Appendices

### Appendix A: Breach Notification Checklist

**[ ] Hour 0-1 (Immediate)**
- [ ] Incident confirmed
- [ ] Evidence preserved
- [ ] Incident Commander notified
- [ ] System isolated (if possible)
- [ ] Investigation started

**[ ] Hour 1-24 (First Day)**
- [ ] Scope determined (approx)
- [ ] Severity classified
- [ ] Root cause hypothesis formed
- [ ] Legal team notified
- [ ] Response plan activated
- [ ] Communications drafted

**[ ] Hour 24-72 (72-Hour Rule)**
- [ ] Investigation completed
- [ ] Forensic report ready
- [ ] Authority notifications sent (if required)
- [ ] User notifications sent
- [ ] Media inquiries managed
- [ ] Internal communications sent

**[ ] Day 4-7 (First Week)**
- [ ] All investigations concluded
- [ ] Remediation plan implemented
- [ ] Follow-up notifications sent
- [ ] Lessons learned documented
- [ ] Incident report finalized

**[ ] Day 8-30 (First Month)**
- [ ] All security improvements implemented
- [ ] Users offered remediation (credit monitoring, etc.)
- [ ] Incident response review completed
- [ ] Staff trained on findings
- [ ] Procedures updated
- [ ] Board briefed

### Appendix B: Regulatory Contact Info

**ICO (UK)**
- Website: https://ico.org.uk
- Report breach: https://ico.org.uk/about-the-ico/what-we-do/report-data-breach
- Phone: +44 (0)303 123 1113

**EDPB (European Data Protection Board)**
- Website: https://edpb.europa.eu
- Local DPA: https://edpb.europa.eu/about-edpb/members_en

**CCPA (California)**
- Attorney General: ca.gov/consumer-protection
- FTC: https://reportfraud.ftc.gov

### Appendix C: Sample Notification Email

See Section 8.2 for full template.

### Appendix D: Incident Response Plan Template

Form for documenting each breach:

```
INCIDENT RESPONSE FORM

Incident ID: TRI-[YEAR]-[NUMBER]
Date Reported: ________________
Reported By: ________________

DISCOVERY
- Date Discovered: ________________
- Date of Breach: ________________
- How Discovered: ________________
- Discoverer: ________________

SCOPE
- Systems Affected: ________________
- Data Affected: ________________
- Number of Users: ________________
- Sensitive Data: ________________

ROOT CAUSE
- Description: ________________
- Contributing Factors: ________________
- Classification: [ ] Malicious [ ] Accidental [ ] Other

SEVERITY
- Classification: [ ] Critical [ ] High [ ] Medium [ ] Low
- Reasoning: ________________

RESPONSE ACTIONS
- Time to Detect: ________________
- Time to Contain: ________________
- Time to Remediate: ________________
- Actions Taken: ________________

NOTIFICATIONS
- Authority Notified: [ ] Yes [ ] No
- Authority: ________________
- Notification Date: ________________
- Users Notified: [ ] Yes [ ] No
- Notification Date: ________________

LESSONS LEARNED
- What Happened: ________________
- Why It Happened: ________________
- How to Prevent: ________________
- Action Items: ________________

DPO Sign-Off: ________________ Date: ________________
```

---

**Document Version History**
- v1.0 (2026-08-03): Initial publication

**Last Reviewed**: August 3, 2026  
**Next Review**: August 3, 2027
