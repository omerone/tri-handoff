# Data Processing Agreement (DPA)

**Effective Date**: August 3, 2026  
**Last Updated**: August 3, 2026  
**Version**: 1.0  
**Applicable To**: GDPR, UK GDPR, Swiss FADP

## 1. Introduction and Scope

This Data Processing Agreement ("**DPA**") is entered into between:

- **Controller**: You, the user of TRi Services ("**Customer**" or "**Controller**")
- **Processor**: TRi Ltd., a company incorporated in Israel ("**TRi**" or "**Processor**")

This DPA applies when TRi processes personal data on your behalf, including when you are an organization using TRi for employee or customer data.

**Effective Date**: Upon acceptance of TRi's Services  
**Duration**: Continues for the duration of the Services agreement and for 30 days after termination for data return/deletion

---

## 2. Definitions

| Term | Definition |
|------|-----------|
| **Personal Data** | Any information relating to an identified or identifiable natural person |
| **Processing** | Any operation on personal data (collection, storage, analysis, transmission, etc.) |
| **Controller** | Entity that determines the purposes and means of processing (you) |
| **Processor** | Entity that processes data on behalf of the controller (TRi) |
| **Sub-Processor** | Third party hired by processor to process data (MetaApi, AWS, CloudFlare, etc.) |
| **Data Subject** | The individual whose personal data is processed (your users/traders) |
| **Data Breach** | Unauthorized or accidental disclosure, loss, alteration, or destruction of personal data |
| **GDPR** | General Data Protection Regulation (EU Regulation 2016/679) |
| **Standard Contractual Clauses (SCCs)** | EU-approved contractual terms for international data transfers |

---

## 3. Scope of Processing

### 3.1 Categories of Personal Data

TRi processes the following categories of personal data:

| Category | Details | Purpose |
|----------|---------|---------|
| **Identity Data** | Name, email address, password hash | Account creation, authentication |
| **Account Data** | Profile information, preferences, theme, language | Service delivery, personalization |
| **MT5 Connection Data** | MT5 Account ID, Server, Access Token (encrypted) | MT5 integration, data retrieval |
| **Trading Data** | Order history, positions, account balance, performance metrics | Analytics, journaling, reporting |
| **Financial Data** | Transaction history, fees, withdrawals, deposits | Financial tracking, analysis |
| **Session Data** | Session tokens, login timestamps, IP address | Security, authentication, audit logging |
| **Usage Data** | Pages visited, features accessed, time spent (if analytics enabled) | Service improvement, analytics |
| **Security & Audit Data** | Access logs, failed login attempts, administrative actions | Security, compliance, incident investigation |

### 3.2 Categories of Data Subjects

- Traders and users of TRi Services
- Employees of organizations using TRi
- Administrative users and account managers

### 3.3 Duration of Processing

Processing continues during the active account period and for up to 30 days after account deletion for backup and recovery purposes.

---

## 4. Controller and Processor Responsibilities

### 4.1 Controller Responsibilities (You)

As the Controller, you are responsible for:

- **Lawfulness**: Ensuring processing has a lawful basis (contract, consent, legal obligation, etc.)
- **Transparency**: Informing data subjects about processing via privacy notice
- **Data Subject Rights**: Responding to requests for access, deletion, portability, etc.
- **Risk Assessment**: Conducting Data Protection Impact Assessments (DPIA) if high-risk processing
- **Compliance**: Ensuring compliance with GDPR, data protection laws, and this DPA
- **Third-Party Management**: Managing any sub-processors you hire directly

### 4.2 Processor Responsibilities (TRi)

As the Processor, TRi is responsible for:

- **Instruction Adherence**: Processing data only as instructed by the Controller
- **Confidentiality**: Protecting personal data from unauthorized access
- **Security**: Implementing appropriate technical and organizational measures (Section 7)
- **Sub-Processor Management**: Vetting and managing all sub-processors
- **Data Subject Requests**: Assisting with data subject rights requests (access, deletion, portability, etc.)
- **Incident Response**: Notifying Controller of data breaches and security incidents within 24 hours
- **Compliance**: Maintaining records of processing activities (ROPA - Records of Processing Activities)
- **Cooperation**: Assisting with audits, inspections, and regulatory requests
- **Data Return/Deletion**: Deleting or returning personal data upon termination

---

## 5. Processing Instructions

### 5.1 Lawful Basis

TRi processes your personal data under the following lawful bases (GDPR Article 6):

| Data Type | Lawful Basis | Purpose |
|-----------|-------------|---------|
| Account creation, authentication | Contractual necessity (Article 6(1)(b)) | Provide Services |
| MT5 connection | Contractual necessity (Article 6(1)(b)) | Enable trading functionality |
| Security and audit logs | Legal obligation (Article 6(1)(c)) | Regulatory compliance, fraud prevention |
| Analytics (optional) | Consent (Article 6(1)(a)) | Service improvement (user may opt-out) |
| Marketing communications | Consent (Article 6(1)(a)) | Newsletters (user may unsubscribe) |

### 5.2 Processing Limitations

TRi will process personal data:
- **Only as instructed** by the Controller
- **Only for the purposes** stated in this DPA
- **Only for the duration** of the Services agreement
- **Only to the extent necessary** for service delivery
- **Only by authorized staff** with confidentiality obligations
- **Not shared** with third parties except authorized sub-processors

### 5.3 Prohibited Processing

TRi will **not**:
- Sell personal data
- Use personal data for TRi's own commercial purposes
- Combine personal data with data from other sources
- Use personal data for profiling or automated decision-making
- Process personal data without a lawful basis
- Transfer personal data to unauthorized third parties

---

## 6. Sub-Processors

### 6.1 Authorized Sub-Processors

TRi uses the following sub-processors to deliver Services:

| Sub-Processor | Purpose | Processing | Location | DPA Status |
|---------------|---------|-----------|----------|-----------|
| **MetaApi** | MT5 account connection & data retrieval | MT5 Account ID, Server, Token | EU/US | ✅ DPA in place |
| **Amazon Web Services (AWS)** | Cloud hosting, storage, backups | All personal data (encrypted) | EU/US | ✅ DPA in place |
| **CloudFlare** | DDoS protection, WAF, CDN | IP address, request metadata | EU/US | ✅ DPA in place |
| **Google Analytics** | Usage analytics (optional) | Anonymized usage events | US | ✅ DPA in place |
| **Stripe** | Payment processing | Payment method, billing info | EU/US | ✅ PCI DSS certified |

All sub-processors are bound by Data Processing Agreements requiring:
- Processing only as instructed
- Confidentiality and security obligations
- No sub-contracting without authorization
- Standard Contractual Clauses for international transfers

### 6.2 Sub-Processor Changes

**TRi may add or remove sub-processors with 30 days' notice.** If you object to a new sub-processor, you may:
- Terminate the Services without penalty
- Request confirmation of your data's deletion

**Notice mechanism**: Email notification to your account email address. You may contact legal@tri.com to request manual notice.

### 6.3 Sub-Processor Audits

TRi maintains contractual audit rights over sub-processors and will:
- Annually audit sub-processor compliance
- Provide audit reports upon request
- Remove non-compliant sub-processors

---

## 7. Data Security (Technical and Organizational Measures)

### 7.1 Technical Measures

TRi implements the following technical controls:

**Encryption**
- Data in transit: TLS 1.3+ (mandatory for all connections)
- Data at rest: AES-256 encryption for sensitive data
- Database encryption: PostgreSQL native encryption
- Backups: Encrypted storage with AES-256

**Access Control**
- Multi-factor authentication (MFA) for admin access
- Principle of least privilege (minimal access by role)
- Role-based access control (RBAC)
- Regular access reviews and revocation of inactive users

**Authentication**
- Password hashing: Argon2 (slow hash function)
- Session tokens: Secure, 30-day expiry
- Password reset tokens: 1-hour expiry
- No plain-text storage of credentials

**Infrastructure Security**
- Web Application Firewall (WAF) via CloudFlare
- Intrusion Detection System (IDS)
- DDoS protection and rate limiting
- Automated security patching and updates
- Regular penetration testing (quarterly)

**Data Integrity**
- Checksum verification of backups
- Transaction logging and audit trails
- Database integrity constraints
- Change data capture (CDC) for audit trails

### 7.2 Organizational Measures

**Personnel**
- Data protection training for all staff
- Background checks for access staff
- Confidentiality agreements for all employees
- Ongoing security awareness training

**Processes**
- Incident response procedures (Section 9)
- Data protection impact assessments (DPIA)
- Data minimization (collect only necessary data)
- Retention schedules (automatic deletion of expired data)
- Regular compliance audits

**Physical Security**
- Secure data center access (AWS, managed by AWS)
- Environmental controls (fire, flood, temperature)
- Visitor logs and access restrictions
- CCTV and monitoring

**Vendor Management**
- Third-party risk assessment
- Vendor security audits
- Contractual security requirements
- Annual compliance verification

### 7.3 Security Ratings

TRi maintains:
- **SOC 2 Type II** compliance (annual audit)
- **ISO 27001** certification (in process)
- **GDPR** compliance
- **PCI DSS** Level 1 (payment data via Stripe)

---

## 8. International Data Transfers

### 8.1 Transfer Mechanisms

TRi uses the following mechanisms for transferring personal data outside the EEA/UK:

**Standard Contractual Clauses (SCCs)**
- GDPR Article 46(2)(c)
- EU Commission Decision 2021/915 (updated SCCs)
- Applied to all transfers to non-adequate countries

**Supplementary Safeguards**
- Encryption of data in transit and at rest
- Access restrictions and authentication controls
- Regular security audits
- Incident response procedures

### 8.2 Transfers to the United States

If personal data is transferred to our US servers:
- Data remains subject to GDPR/UK GDPR obligations
- Standard Contractual Clauses provide contractual protections
- US servers are located in AWS EU-compatible regions with enhanced protections
- Encrypted storage limits access even by AWS staff

### 8.3 Adequacy Decisions

- **EU → EU/UK/Switzerland**: No additional transfer mechanism needed (adequate level)
- **EU → US**: Standard Contractual Clauses + supplementary safeguards
- **UK → non-UK**: Standard Contractual Clauses (per UK adequacy rules)

---

## 9. Data Subject Rights

### 9.1 Processor Assistance with Rights Requests

TRi will assist the Controller in fulfilling data subject rights requests:

#### Right to Access (GDPR Article 15)
- Data subjects may request a copy of their personal data
- TRi provides data in portable format (JSON, CSV) within 30 days
- Feature: Settings → Privacy → Request Personal Data Export

#### Right to Rectification (GDPR Article 16)
- Data subjects may request correction of inaccurate data
- TRi updates data in systems within 10 business days
- Feature: Settings → Profile → Edit Information

#### Right to Erasure (GDPR Article 17)
- Data subjects may request deletion of their data
- TRi deletes personal data within 30 days (exceptions for legal holds)
- Trading data retained 7 years for tax compliance
- Feature: Settings → Account → Delete Account

#### Right to Restrict Processing (GDPR Article 18)
- Data subjects may request suspension of processing
- TRi will suspend processing while honoring the request
- Timeline: 30 days

#### Right to Data Portability (GDPR Article 20)
- Data subjects may receive data in structured format
- TRi exports data as JSON or CSV within 30 days
- Feature: Settings → Privacy → Export Data

#### Right to Object (GDPR Article 21)
- Data subjects may opt-out of specific processing
- For marketing: Unsubscribe from email newsletters
- For analytics: Reject cookies via Cookie Preferences
- Timeline: Immediate

### 9.2 Request Process

Data subjects should submit rights requests to:

**Email**: privacy@tri.com  
**Form**: Settings → Privacy → Submit Request  

**Response Timeline**:
- Acknowledgment: 5 business days
- Fulfillment: 30 days (extendable by 2 months for complex requests)

TRi will:
1. Verify the data subject's identity
2. Locate relevant personal data
3. Fulfill the request
4. Provide written confirmation
5. Document the request and response

---

## 10. Data Breach Notification

### 10.1 Incident Report Timeline

**TRi will notify the Controller of any data breach within 24 hours of discovery,** including:

- **Description**: What data was affected
- **Scope**: Number of records, data subjects potentially impacted
- **Cause**: How the breach occurred
- **Discovery Time**: When breach was discovered
- **Notification To**: Which authorities have been notified
- **Mitigation**: Steps taken to prevent recurrence

### 10.2 Controller Notification Obligations

The Controller is responsible for:
- **Notifying authorities**: TRi will assist but Controller must notify relevant authorities (e.g., ICO) within 72 hours
- **Notifying data subjects**: Controller must notify affected data subjects if risk is high
- **Documentation**: Controller must maintain records of the breach and response

### 10.3 Cooperation

TRi will:
- Cooperate fully with incident investigation
- Preserve evidence
- Provide forensic reports
- Assist with regulatory inquiries
- Document all breach-related activities

See `/docs/BREACH_NOTIFICATION.md` for full procedures.

---

## 11. Audit Rights and Compliance

### 11.1 Audit Rights

The Controller (or a qualified independent auditor) may:
- Request compliance certifications (SOC 2, ISO 27001)
- Conduct annual audits of TRi's security practices
- Review sub-processor agreements and compliance
- Interview TRi staff on security practices
- Conduct spot-checks (no more than annually without cause)

**Audit Process**:
1. Controller submits audit request via legal@tri.com
2. TRi schedules audit within 30 days (mutually convenient date)
3. Audit conducted (typically 2-5 days)
4. Audit report provided within 15 days
5. Remediation plan for any findings (if applicable)

### 11.2 Regulatory Inspections

TRi will:
- Cooperate with data protection authorities
- Provide records and documentation
- Respond to regulatory inquiries
- Notify Controller of major investigations

### 11.3 Records of Processing

TRi maintains Records of Processing Activities (ROPA) per GDPR Article 30, including:
- Purposes of processing
- Categories of data and data subjects
- Recipients of personal data
- Retention periods
- Security measures
- Sub-processors

The Controller may request ROPA at legal@tri.com.

---

## 12. Data Return and Deletion

### 12.1 Upon Termination

When the Services are terminated, TRi will (at Controller's election):

**Option A: Data Deletion**
- Delete all personal data within 30 days
- Provide written confirmation of deletion
- Retain backup copies for 30 days for recovery
- After 30 days, all data is permanently destroyed

**Option B: Data Return**
- Export all personal data in structured format (JSON, CSV)
- Provide data within 30 days
- Controller is responsible for returned data
- TRi retains backup copies for 30 days only

### 12.2 Retention Exceptions

Personal data may be retained beyond termination if:
- **Legal Obligation**: Law requires retention (e.g., 7-year tax records)
- **Legal Hold**: Dispute or litigation requires preservation
- **Regulatory Investigation**: Regulatory authority requests retention
- **Backup Recovery**: Backup snapshots retained for 30 days

All retained data remains subject to confidentiality and security obligations.

---

## 13. Confidentiality and Security

### 13.1 Confidentiality Obligations

TRi staff and sub-processors must:
- Keep personal data confidential
- Not disclose data without authorization
- Limit access to authorized personnel only
- Maintain confidentiality during and after employment/engagement
- Return or delete data upon termination

### 13.2 Non-Disclosure

TRi will not disclose personal data except:
- To authorized sub-processors (with DPA)
- To fulfill data subject rights requests
- When legally required (with notice to Controller if possible)
- With Controller's explicit authorization
- In aggregated, anonymized form (no individual identification)

---

## 14. Liability

### 14.1 Controller Liability

The Controller is responsible for:
- Ensuring processing is lawful
- Obtaining consent if required
- Accuracy of personal data provided
- Instructing TRi appropriately
- Responding to data subject rights requests
- Notifying authorities of breaches

### 14.2 Processor Liability

TRi is liable for:
- Breaches of GDPR obligations
- Unauthorized processing or disclosure
- Failure to implement security measures
- Non-compliance with this DPA
- Breaches by sub-processors

**Liability Limitations**:
- TRi's total liability for DPA breaches is capped at fees paid in preceding 12 months
- TRi is not liable for Controller's failures to exercise rights
- TRi is not liable for inaccurate data provided by Controller

---

## 15. Dispute Resolution

Disputes arising from this DPA shall be:

1. **Negotiation**: Both parties attempt good-faith resolution (30 days)
2. **Escalation**: Issue escalated to management (30 days)
3. **Mediation**: Engage independent mediator (if needed)
4. **Arbitration/Litigation**: Per Terms of Service governing law (Israel; arbitration available)

**Regulatory Authority**: Either party may file a complaint with data protection authorities (ICO, CNIL, etc.)

---

## 16. Standard Contractual Clauses (SCCs)

This DPA incorporates the Standard Contractual Clauses (Module One: Controller to Processor) as approved by the European Commission Decision 2021/915.

### 16.1 SCC Terms Included

The following SCC provisions are incorporated by reference:

- **Clause 1**: Purpose and scope
- **Clause 2**: Processor obligations and transfers
- **Clause 3**: Sub-processors
- **Clause 4**: Assistance with data subject rights
- **Clause 5**: Assistance with Controller obligations
- **Clause 6**: Deletion and return of data
- **Clause 7**: Audit and monitoring
- **Clause 8**: Auditor qualifications
- **Clause 9**: Sub-processor terms
- **Clause 10**: Data subject rights information
- **Clause 11**: Redress for data subjects
- **Clause 12**: Liability
- **Clause 13**: Severability
- **Clause 14**: Governing law
- **Clause 15**: Dispute resolution
- **Clause 16**: Supplementary measures (encryption, access controls)

### 16.2 Supplementary Measures

To address the decision in **Schrems II**, TRi implements:

**Data Encryption**
- AES-256 encryption at rest and TLS 1.3+ in transit
- Encryption keys managed separately from data
- Only encrypted data transmitted outside EU

**Access Restrictions**
- Strong authentication (MFA for sensitive data)
- Role-based access control
- Audit logging of all access
- Regular access reviews

**Contractual Protections**
- Standard Contractual Clauses in all sub-processor agreements
- Data processing limited to EU/UK compliant regions
- Regular compliance certifications
- Incident notification and remediation

**Regulatory Cooperation**
- Commitment to refuse unlawful government access requests
- Notification to Controller if demanded to disclose data
- Cooperation with data protection authorities

---

## 17. Changes to This DPA

### 17.1 Modifications by TRi

TRi may modify this DPA:
- To comply with law or regulatory requirements
- To implement new security measures
- To change sub-processors (with 30-day notice)

**Notice**: Email to Controller's account email. Material changes require written consent or right to terminate.

### 17.2 Modifications by Controller

The Controller may propose modifications via legal@tri.com. TRi will respond within 30 days.

---

## 18. Entire Agreement

This DPA, together with the Terms of Service and Privacy Policy, constitutes the entire agreement regarding data processing and supersedes all prior agreements.

---

## 19. Signature Page

### Controller

By using TRi Services, you agree to this Data Processing Agreement.

---

### Processor (TRi Ltd.)

TRi Ltd. commits to the obligations and responsibilities outlined in this DPA.

**Authorized Representative**: Legal Department  
**Email**: legal@tri.com  
**Date**: August 3, 2026  

---

## Appendix A: List of Sub-Processors

See `/legal/sub-processors.md` for the current list of authorized sub-processors.

## Appendix B: Standard Contractual Clauses

The Standard Contractual Clauses (Module One) are available upon request from legal@tri.com.

---

**Document Version History**
- v1.0 (2026-08-03): Initial publication
