# Sub-Processor List and Addendum

**Effective Date**: August 3, 2026  
**Last Updated**: August 3, 2026  
**Version**: 1.0

---

## Introduction

This document lists all **Data Sub-Processors** used by TRi to deliver Services. A sub-processor is a third-party vendor that processes personal data on behalf of TRi (the data processor) and on behalf of you (the controller).

All sub-processors are bound by Data Processing Agreements (DPAs) that require:
- Processing only as instructed by TRi
- Confidentiality and security obligations
- No further sub-contracting without authorization
- Standard Contractual Clauses (SCCs) for international transfers
- Audit rights and compliance verification

---

## Authorized Sub-Processors

### 1. MetaApi

**Purpose**: MT5 Trading Account Connection and Data Retrieval

| Attribute | Value |
|-----------|-------|
| **Vendor Name** | MetaApi LLC (formerly Forex Peace Army) |
| **Website** | https://metaapi.cloud |
| **Location** | United States (Delaware) |
| **Data Processed** | MT5 Account ID, Server, Access Token (encrypted), Trading History, Account Balance, Performance Metrics |
| **Processing Type** | Read-only access to MT5 account data |
| **Data Subject** | Traders using TRi |
| **DPA Status** | ✅ Data Processing Agreement in place |
| **Sub-sub-Processors** | MetaApi may use third-party brokers and data providers |
| **Audit Rights** | Annual compliance audit conducted by TRi |
| **Complaint Contact** | legal@metaapi.cloud |
| **Data Retention** | 90 days after account disconnection (per MetaApi policy) |

**Security Measures**:
- Encryption of credentials in transit (TLS 1.3+)
- Encrypted storage of access tokens
- IP whitelisting
- Rate limiting
- SOC 2 Type II certified

**Data Flow**:
1. User connects MT5 account via TRi
2. User provides MT5 Account ID, Server, Password (encrypted)
3. TRi sends encrypted credentials to MetaApi API
4. MetaApi validates access and returns read-only token
5. TRi stores encrypted token in secure vault
6. TRi retrieves trading data via MetaApi API daily
7. Data is cached locally and displayed in dashboard

**Opt-Out**: Users can disconnect MT5 account anytime via Settings → Trading Accounts → Disconnect.

---

### 2. Amazon Web Services (AWS)

**Purpose**: Cloud Hosting, Storage, Backups, Analytics Infrastructure

| Attribute | Value |
|-----------|-------|
| **Vendor Name** | Amazon Web Services, Inc. |
| **Website** | https://aws.amazon.com |
| **Location** | Multiple regions: EU (Ireland), US (Virginia), Asia Pacific (Singapore) |
| **Data Processed** | All personal data: accounts, profiles, trading data, audit logs, backups |
| **Processing Type** | Storage, computation, backup, disaster recovery |
| **Data Subject** | All TRi users |
| **DPA Status** | ✅ AWS Data Processing Addendum (DPA) in place |
| **Sub-sub-Processors** | AWS uses regional sub-processors for infrastructure |
| **Audit Rights** | Annual SOC 2 Type II audit + on-demand compliance reports |
| **Complaint Contact** | aws-compliance@amazon.com |
| **Data Retention** | Duration of account + 30 days for backups |

**Services Used**:
- **EC2**: Application servers
- **RDS**: PostgreSQL database (encrypted)
- **S3**: File storage (encrypted)
- **Backup**: Automated daily backups
- **CloudTrail**: Audit logging
- **KMS**: Key management for encryption
- **VPC**: Network isolation and security

**Data Location**:
- **Primary**: EU (Ireland) - GDPR compliant, Data localization
- **Backup**: US (Virginia) - Encrypted, SCC protected
- **Disaster Recovery**: Asia Pacific (Singapore) - Encrypted

**Security Measures**:
- AES-256 encryption at rest (KMS-managed keys)
- TLS 1.3+ encryption in transit
- Network isolation (VPC, security groups)
- Multi-factor authentication for admin access
- Regular security patches and updates
- DDoS protection via CloudFront
- Intrusion detection systems

**Opt-Out**: Users cannot opt-out of AWS (core infrastructure); they may delete account instead.

---

### 3. CloudFlare

**Purpose**: DDoS Protection, Web Application Firewall (WAF), Content Delivery Network (CDN)

| Attribute | Value |
|-----------|-------|
| **Vendor Name** | Cloudflare, Inc. |
| **Website** | https://www.cloudflare.com |
| **Location** | Distributed globally; data processed in US/EU |
| **Data Processed** | IP addresses, request metadata, traffic patterns, security events |
| **Processing Type** | Traffic filtering, DDoS mitigation, malware scanning |
| **Data Subject** | All TRi users and visitors |
| **DPA Status** | ✅ Cloudflare Data Processing Addendum (DPA) in place |
| **Sub-sub-Processors** | Cloudflare uses sub-processors for analytics and logging |
| **Audit Rights** | Annual compliance verification |
| **Complaint Contact** | dpo@cloudflare.com |
| **Data Retention** | 30 days for security logs (per Cloudflare policy) |

**Services Used**:
- **DDoS Protection**: Automatic attack mitigation
- **WAF**: Web Application Firewall with custom rules
- **CDN**: Static content caching and delivery
- **Bot Management**: Automated bot detection
- **Rate Limiting**: Protection against brute-force attacks
- **SSL/TLS**: Encrypted connections

**Data Minimization**:
- Cloudflare cannot see decrypted data (TLS layer)
- Only sees aggregated traffic metadata
- Does not store user personal data
- Logs retained for security purposes only

**Opt-Out**: CloudFlare cannot be disabled (essential for security).

---

### 4. Google Analytics

**Purpose**: Usage Analytics and Performance Measurement

| Attribute | Value |
|-----------|-------|
| **Vendor Name** | Google LLC |
| **Website** | https://www.google.com/analytics |
| **Location** | United States (data processing in EU via Google Ireland Limited) |
| **Data Processed** | Anonymized usage events, page views, feature usage, device/browser info |
| **Processing Type** | Analytics, behavioral analysis, performance reporting |
| **Data Subject** | TRi users who consent to analytics |
| **DPA Status** | ✅ Google Analytics Data Processing Terms in place |
| **Sub-sub-Processors** | Google uses sub-processors for data processing |
| **Audit Rights** | Google Analytics Compliance documentation available |
| **Complaint Contact** | privacy@google.com |
| **Data Retention** | 14 months (configurable, default per Google policy) |

**Data Anonymization**:
- IP addresses are anonymized (last octet removed)
- User IDs are pseudonymized
- No personal data (names, emails) are shared
- Google Analytics cannot re-identify individuals

**Tracking Code**:
- Google Analytics 4 (GA4)
- Tag: gtag.js
- Conversion tracking for feature adoption

**Opt-Out Options**:
1. **In-App**: Settings → Privacy → Disable Analytics
2. **Browser**: Google Analytics Opt-out Browser Add-on
3. **Cookie**: Reject analytics cookies via cookie banner
4. **Device**: Enable "Do Not Track" in browser settings

**User Control**: Analytics cookies are optional (consent required).

---

### 5. Stripe

**Purpose**: Payment Processing and Billing

| Attribute | Value |
|-----------|-------|
| **Vendor Name** | Stripe, Inc. |
| **Website** | https://stripe.com |
| **Location** | United States (data processing in EU via Stripe Ireland Limited) |
| **Data Processed** | Payment method type (not full card number), billing address, transaction history |
| **Processing Type** | Payment processing, subscription management, invoicing |
| **Data Subject** | TRi users with paid subscriptions |
| **DPA Status** | ✅ Stripe Data Processing Addendum (DPA) in place |
| **PCI Compliance** | ✅ PCI DSS Level 1 certified |
| **Sub-sub-Processors** | Stripe uses payment networks and acquiring banks |
| **Audit Rights** | Annual PCI DSS audit reports available |
| **Complaint Contact** | dpo@stripe.com |
| **Data Retention** | Per PCI DSS requirements (typically 3-7 years) |

**Payment Data Security**:
- PCI DSS Level 1 certification (highest level)
- Encrypted transmission of payment data
- No storage of full card numbers on TRi servers
- Tokenization of payment methods
- Fraud detection and prevention

**Data Minimization**:
- TRi only receives:
  - Payment method type (Visa, Mastercard, etc)
  - Last 4 digits of card
  - Billing address
  - Transaction status
- TRi does NOT receive:
  - Full card number
  - CVV code
  - Payment method details

**Opt-Out**: Cannot opt-out if paying for subscription; users may pay via alternative methods if available.

---

## Sub-Processor Procedures

### Adding a New Sub-Processor

**Process**:
1. TRi identifies need for third-party service
2. Conduct security and compliance assessment
3. Execute Data Processing Agreement (DPA) with vendor
4. **Provide 30-day notice to all users** via email
5. Update this Sub-Processor List
6. Document change in Compliance Records
7. Implement vendor integration

**User Rights**:
- Right to be informed of new sub-processors
- 30-day advance notice period
- Right to object to new sub-processor
- Right to terminate service if objecting

**Objection Process**:
1. Receive notice of new sub-processor
2. Contact privacy@tri.com with objections within 30 days
3. TRi will consider objections and respond
4. If not resolved, user may terminate account without penalty

### Removing a Sub-Processor

**Process**:
1. TRi may remove sub-processor due to:
   - Service discontinuation
   - Security concerns
   - Non-compliance
   - Business decision
2. Transition data to replacement vendor or storage
3. Notify users if change impacts their experience
4. Update this Sub-Processor List
5. Document removal in Compliance Records

**Data Handling**:
- Ensure data is transferred securely
- Verify deletion/return by departing vendor
- Maintain backup copies during transition
- No service interruption to users

### Sub-Processor Monitoring

**TRi annually**:
- Reviews sub-processor compliance
- Verifies DPA in place and up-to-date
- Checks security certifications (SOC 2, ISO 27001, etc)
- Audits data handling practices
- Documents findings in Compliance Record
- Removes non-compliant vendors

---

## Sub-Processor Contact Information

### MetaApi
- **Legal Contact**: legal@metaapi.cloud
- **Security Contact**: security@metaapi.cloud
- **Support**: support@metaapi.cloud

### Amazon Web Services (AWS)
- **Compliance Contact**: aws-compliance@amazon.com
- **Data Protection Officer**: dpo@amazon.com
- **Support**: https://console.aws.amazon.com/support

### CloudFlare
- **Data Protection Officer**: dpo@cloudflare.com
- **Legal Contact**: legal@cloudflare.com
- **Support**: https://support.cloudflare.com

### Google Analytics
- **Privacy Contact**: privacy@google.com
- **Support**: https://support.google.com/analytics

### Stripe
- **Data Protection Officer**: dpo@stripe.com
- **Legal Contact**: legal@stripe.com
- **Support**: https://support.stripe.com

---

## Data Flows by Sub-Processor

### MetaApi Data Flow

```
User Account Creation
    ↓
User Connects MT5 Account
    ↓
TRi → MetaApi (encrypted credentials)
    ↓
MetaApi validates access & returns token
    ↓
TRi stores encrypted token in AWS KMS
    ↓
Daily: TRi → MetaApi API (retrieve trading data)
    ↓
MetaApi → TRi (trading history, account data)
    ↓
TRi → AWS (store encrypted data)
    ↓
User views dashboard (displays data from AWS)
```

### AWS Data Flow

```
All Personal Data Collection
    ↓
TRi Application (running on AWS EC2)
    ↓
AWS RDS PostgreSQL (encrypted database)
    ↓
AWS S3 (encrypted file storage)
    ↓
AWS Backup (automated daily backups)
    ↓
AWS Disaster Recovery (replicated to US region)
```

### CloudFlare Data Flow

```
User requests tri.com
    ↓
Request → CloudFlare global network
    ↓
CloudFlare DDoS filtering & WAF scanning
    ↓
CloudFlare → AWS Application (if legitimate)
    ↓
Response cached at edge (CloudFlare CDN)
    ↓
Response → User browser (encrypted TLS)
```

### Google Analytics Data Flow

```
User visits TRi (if analytics enabled)
    ↓
JavaScript tag (gtag.js) loads
    ↓
User event (page view, feature usage)
    ↓
Event → Google Analytics (anonymized)
    ↓
Google Analytics → Processing in Google Ireland
    ↓
Aggregated reports → TRi admin dashboard
```

### Stripe Data Flow

```
User subscribes to paid plan
    ↓
User navigates to Stripe Checkout
    ↓
User enters payment information
    ↓
Stripe processes payment (PCI DSS Level 1)
    ↓
Stripe → TRi (payment token, confirmation)
    ↓
TRi stores payment method token in AWS
    ↓
Monthly: Stripe charges via stored token
    ↓
Stripe → TRi (invoice, receipt)
```

---

## Sub-Processor Security Standards

All sub-processors must maintain:

| Standard | Requirement |
|----------|-------------|
| **SOC 2 Type II** | Annual audit demonstrating security controls (or equivalent) |
| **ISO 27001** | Information security management certification (or equivalent) |
| **Encryption** | TLS 1.3+ for data in transit, AES-256 for data at rest |
| **DPA** | Signed Data Processing Agreement per GDPR Article 28 |
| **Incident Response** | 24-hour notification of security incidents |
| **Audit Rights** | TRi has audit rights over processing |

**Verification**: TRi maintains documentation of certifications and audit reports for each sub-processor.

---

## Data Subject Rights with Sub-Processors

### Right to Access
Data subjects may request access to personal data held by sub-processors. TRi will:
1. Forward request to relevant sub-processor
2. Compile data from all sub-processors
3. Return comprehensive data export to data subject

### Right to Deletion
Data subjects may request deletion of personal data. TRi will:
1. Delete data from TRi systems
2. Instruct sub-processors to delete data
3. Verify deletion completion
4. Provide confirmation

### Right to Portability
Data subjects may request data export in portable format. TRi will:
1. Extract data from TRi systems
2. Request data from sub-processors
3. Convert to JSON/CSV format
4. Provide to data subject

---

## Compliance and Audits

### Annual Sub-Processor Review

TRi conducts annual reviews of all sub-processors to verify:
- Continued compliance with DPA terms
- Maintenance of security certifications
- No unauthorized sub-processing
- No data breaches
- Proper access controls

### Audit Documentation

TRi maintains:
- Signed DPAs for each sub-processor
- Copies of security certifications (SOC 2, ISO 27001)
- Audit reports from sub-processors
- Incident response records
- Data processing logs
- Sub-processor change history

**Available to**: Data Protection Authority upon request, customers with legitimate audit rights.

---

## Updates to Sub-Processor List

This list is updated whenever:
- A new sub-processor is added
- An existing sub-processor is removed
- A sub-processor's data processing changes materially
- Contact information changes

**Notification**: Changes are posted on this page with an updated "Last Updated" date. Material changes trigger user notifications per Section on "Adding a New Sub-Processor."

---

## Appendix A: DPA Template

All sub-processors sign a standard DPA based on GDPR Article 28 and including:
- Scope of processing
- Processor obligations
- Sub-processor authorization
- Data subject rights assistance
- Audit rights
- Data return and deletion
- Standard Contractual Clauses for international transfers

**Template available upon request from legal@tri.com**

---

**Document Version History**
- v1.0 (2026-08-03): Initial publication
  - MetaApi (MT5 integration)
  - AWS (hosting, storage, backups)
  - CloudFlare (WAF, DDoS, CDN)
  - Google Analytics (analytics, optional)
  - Stripe (payment processing)
