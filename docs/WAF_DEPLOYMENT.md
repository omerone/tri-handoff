# TRi Web Application Firewall (WAF) Deployment Guide

## Overview

This guide covers the deployment and management of production-grade WAF protection for the TRi application using either CloudFlare or AWS WAF.

**Status**: Production-Ready
**Last Updated**: August 3, 2024
**Maintained By**: Security Team

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Decision](#architecture-decision)
3. [CloudFlare WAF Setup](#cloudflare-waf-setup)
4. [AWS WAF Setup](#aws-waf-setup)
5. [Deployment Phases](#deployment-phases)
6. [Monitoring & Alerts](#monitoring--alerts)
7. [Incident Response](#incident-response)
8. [Compliance](#compliance)

## Quick Start

### Option 1: CloudFlare WAF (Recommended for SaaS)

```bash
# Prerequisites
export CLOUDFLARE_API_TOKEN=your_token_here
export CLOUDFLARE_ZONE_ID=your_zone_id_here
export WAF_MODE=log-only

# Deploy
NODE_OPTIONS=--conditions=react-server npx tsx scripts/setup-cloudflare-waf.ts

# Deploy via deploy-waf script
NODE_OPTIONS=--conditions=react-server npx tsx scripts/deploy-waf.ts \
  --provider cloudflare \
  --environment log-only
```

### Option 2: AWS WAF (Recommended for AWS Infrastructure)

```bash
# Prerequisites
export AWS_REGION=us-east-1
export ALB_ARN=arn:aws:elasticloadbalancing:...
export WAF_MODE=log-only

# Deploy
NODE_OPTIONS=--conditions=react-server npx tsx scripts/setup-aws-waf.ts

# Deploy via deploy-waf script
NODE_OPTIONS=--conditions=react-server npx tsx scripts/deploy-waf.ts \
  --provider aws \
  --environment log-only
```

## Architecture Decision

### CloudFlare WAF

**Best For:**
- SaaS applications without fixed AWS infrastructure
- Simple domain-based protection
- Global DDoS protection included
- Easy rule management via UI

**Pros:**
- ✓ Global coverage (100+ data centers)
- ✓ DDoS protection included
- ✓ Bot management built-in
- ✓ Simple DNS-based deployment
- ✓ Good free tier option
- ✓ Easy rollback

**Cons:**
- ✗ Requires DNS change
- ✗ Less customization for complex rules
- ✗ Dependency on CloudFlare availability

**Cost:** Free tier, $20-200/month for advanced features

### AWS WAF

**Best For:**
- AWS-native deployments (ALB, CloudFront)
- Complex custom rules
- High-volume traffic
- Integration with AWS ecosystem

**Pros:**
- ✓ Deep AWS integration
- ✓ Extremely customizable
- ✓ Powerful IP reputation lists
- ✓ GuardDuty integration
- ✓ Fine-grained logging
- ✓ Works with ALB/CloudFront

**Cons:**
- ✗ More complex setup
- ✗ Requires AWS infrastructure
- ✗ Separate DDoS protection (Shield)
- ✗ Higher operational overhead

**Cost:** $5/month per Web ACL, $0.60 per rule + $0.30 per million requests

## CloudFlare WAF Setup

### Step 1: Verify Domain DNS

Ensure your domain is using CloudFlare nameservers:

```bash
# Check current nameservers
dig +short NS example.com

# Should show CloudFlare nameservers:
# ns1.cloudflare.com
# ns2.cloudflare.com
```

### Step 2: Generate API Token

1. Log in to CloudFlare Dashboard
2. Go to User Settings → API Tokens
3. Create token with permissions:
   - Zone Firewall Rules: Read/Write
   - Rate Limiting: Read/Write
   - Account Firewall: Read/Write

```bash
# Save token
export CLOUDFLARE_API_TOKEN=your_generated_token
export CLOUDFLARE_ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=example.com" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
```

### Step 3: Deploy WAF Rules

```bash
NODE_OPTIONS=--conditions=react-server npx tsx scripts/setup-cloudflare-waf.ts
```

### Step 4: Enable Origin Shielding

```bash
# Via CloudFlare Dashboard:
# 1. Caching → Cache Rules
# 2. Create rule: Cache Level = Cache Everything for API endpoints
# 3. Browser Cache TTL = 30 minutes
# 4. Enable Origin Shield (if available on plan)
```

### Step 5: Verify Deployment

```bash
# Test that WAF is protecting
curl -I https://example.com -H "User-Agent: WAF-Test"

# Check WAF logs
# CloudFlare Dashboard → Security → Firewall Events
```

## AWS WAF Setup

### Step 1: Prerequisites

- ALB or CloudFront distribution already deployed
- AWS CLI configured with appropriate credentials
- Terraform (optional but recommended)

### Step 2: Deploy Web ACL

```bash
export AWS_REGION=us-east-1
export WAF_NAME=tri-waf
export ALB_ARN=arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:loadbalancer/app/tri-alb/1234567890abcdef

NODE_OPTIONS=--conditions=react-server npx tsx scripts/setup-aws-waf.ts
```

### Step 3: Associate with Resources

```bash
# Associate with ALB
aws wafv2 associate-web-acl \
  --web-acl-arn arn:aws:wafv2:us-east-1:ACCOUNT:global/webacl/tri-waf/... \
  --resource-arn $ALB_ARN \
  --region $AWS_REGION

# Or with CloudFront (must be us-east-1)
aws wafv2 associate-web-acl \
  --web-acl-arn arn:aws:wafv2:us-east-1:ACCOUNT:global/webacl/tri-waf/... \
  --resource-arn arn:aws:cloudfront::ACCOUNT:distribution/DISTRIBUTION_ID \
  --region us-east-1
```

### Step 4: Enable Logging

```bash
# Create log group
aws logs create-log-group --log-group-name /aws/wafv2/tri-waf

# Configure WAF logging to send to log group
aws wafv2 put-logging-configuration \
  --logging-configuration ResourceArn=arn:aws:wafv2:...,LogDestinationConfigs=arn:aws:logs:...
```

### Step 5: Integrate with GuardDuty (Optional)

```bash
# GuardDuty findings are automatically sent to WAF
# High-risk IPs from GuardDuty are blocked automatically
aws wafv2 create-ip-set \
  --name GuardDuty-High-Risk-IPs \
  --scope REGIONAL \
  --ip-address-version IPV4 \
  --addresses []
```

## Deployment Phases

### Phase 1: Baseline (Days 1-7) - "Log-Only" Mode

**Objective:** Baseline traffic patterns and identify false positives

```bash
NODE_OPTIONS=--conditions=react-server npx tsx scripts/deploy-waf.ts \
  --provider cloudflare \
  --environment log-only
```

**Activities:**
- Deploy WAF in "log-only" mode
- Monitor CloudWatch Logs for all rule matches
- Check for false positives (legitimate traffic being flagged)
- Document any high-volume rule triggers
- Share findings with product team

**Acceptance Criteria:**
- False positive rate < 1%
- No legitimate users blocked
- All rule categories working correctly

**Daily Tasks:**
```bash
# Monitor block rate
aws logs tail /tri/waf-logs --follow

# Check top blocked IPs
aws logs filter-log-events --log-group-name /tri/waf-logs \
  | jq '.events[] | .message' | grep "blocked" | head -20

# Generate report
npm run waf:report  # Custom script to analyze logs
```

### Phase 2: Challenge (Days 8-14) - CAPTCHA Challenge

**Objective:** Activate challenge mode to verify bots vs legitimate users

```bash
NODE_OPTIONS=--conditions=react-server npx tsx scripts/deploy-waf.ts \
  --provider cloudflare \
  --environment challenge
```

**Activities:**
- Reduce false positive exceptions to minimum
- Monitor CAPTCHA challenge rates
- Verify legitimate users can still access application
- Adjust rules based on Phase 1 findings

**Acceptance Criteria:**
- < 5% of legitimate users challenged
- CAPTCHA challenge rate stable
- No performance degradation

**Daily Tasks:**
```bash
# Monitor challenge rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/WAFV2 \
  --metric-name BlockedRequests \
  --start-time 2024-08-10T00:00:00Z \
  --end-time 2024-08-11T00:00:00Z \
  --period 3600 \
  --statistics Sum

# Review challenge patterns
grep "challenge" /tri/waf-logs | tail -100
```

### Phase 3: Full Enforcement (Day 15+) - "Block" Mode

**Objective:** Full WAF enforcement with blocking enabled

```bash
NODE_OPTIONS=--conditions=react-server npx tsx scripts/deploy-waf.ts \
  --provider cloudflare \
  --environment block
```

**Activities:**
- Enable full blocking mode
- Maintain continuous monitoring
- Set up alerting for anomalies
- Weekly WAF rule review

**Acceptance Criteria:**
- Block rate stable at expected level
- No false positive impact on users
- Alerts firing correctly

**Ongoing Maintenance:**
```bash
# Weekly rule review
aws wafv2 list-rules --scope REGIONAL

# Monthly false positive audit
npm run waf:false-positive-report

# Quarterly rule update based on threat intelligence
npm run waf:update-rules
```

## Monitoring & Alerts

### CloudWatch Metrics

Key metrics to monitor:

```bash
# Block rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/WAFV2 \
  --metric-name BlockedRequests \
  --period 300 \
  --statistics Sum

# Allowed requests
aws cloudwatch get-metric-statistics \
  --namespace AWS/WAFV2 \
  --metric-name AllowedRequests \
  --period 300 \
  --statistics Sum

# Challenged requests (if applicable)
aws cloudwatch get-metric-statistics \
  --namespace AWS/WAFV2 \
  --metric-name CountedRequests \
  --period 300 \
  --statistics Sum
```

### Alert Configuration

```yaml
# alerts.yaml
alerts:
  block_rate_spike:
    metric: BlockedRequests
    threshold: 100  # per minute
    duration: 5  # minutes
    action: page-on-call

  sql_injection_detected:
    rule: SQL-Injection
    threshold: 1
    action: slack-alert
    channel: '#security-alerts'

  geo_anomaly:
    type: Login from unusual country
    action: slack-alert

  rate_limit_violation:
    metric: RateLimitExceeded
    threshold: 50  # per minute
    action: email-alert
```

### Slack Alerts

Configure in `deploy-waf.ts`:

```typescript
// Environment variables
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
SECURITY_ALERT_EMAIL=security@tri.app
PAGERDUTY_SERVICE_KEY=your_key_here
```

### Dashboard

Access CloudWatch dashboard:

```bash
# View in AWS Console
# CloudWatch → Dashboards → tri-waf

# Or query via CLI
npm run waf:dashboard
```

## Incident Response

### If Block Rate Spikes

```bash
# Step 1: Verify it's real attack (not false positive)
aws logs filter-log-events --log-group-name /tri/waf-logs \
  --filter-pattern "BlockedRequests" \
  --start-time $(date -d '1 hour ago' +%s)000

# Step 2: Identify affected users
# Check if users report access issues
# Compare with error logs

# Step 3: If false positive, disable problematic rule
aws wafv2 update-rule-group \
  --name tri-waf-rules \
  --scope REGIONAL \
  --id your_rule_group_id \
  --rules 'arn:aws:wafv2:region:account:regional/rule-group/tri/id' \
  --rules ... # with problematic rule disabled

# Step 4: Monitor recovery
npm run waf:monitor
```

### If Legitimate Users Are Blocked

```bash
# Step 1: Confirm blocking status
curl -v https://example.com -H "User-Agent: Test"

# Step 2: Check WAF logs
aws logs tail /tri/waf-logs --follow

# Step 3: Identify which rule is blocking
grep "RequestBlockedAt" /tri/waf-logs | jq '.RuleId' | head -10

# Step 4: Create exception (whitelist) for rule
# Modify WAF_RULES.yaml:
# exceptions:
#   - rule_id: sql-injection-basic
#     endpoints:
#       - /api/search  # Only if necessary!
#     cidr_blocks: []

# Step 5: Re-deploy
npm run deploy-waf
```

### Emergency: Disable WAF Entirely

```bash
# If WAF is causing widespread outages:

# Option 1: Switch to log-only (won't block)
NODE_OPTIONS=--conditions=react-server npx tsx scripts/deploy-waf.ts \
  --provider cloudflare \
  --environment log-only

# Option 2: Temporarily disassociate (AWS only)
aws wafv2 disassociate-web-acl \
  --resource-arn $ALB_ARN \
  --region us-east-1

# Option 3: Via CloudFlare Dashboard
# Security → WAF → Pause all rules
```

## Compliance

### PCI DSS Requirements

| Requirement | WAF Coverage | Status |
|---|---|---|
| 6.6.1 SQL Injection | ✓ Core Rule Set | ✓ |
| 6.6.2 XSS | ✓ Core Rule Set | ✓ |
| 6.6.3 Path Traversal | ✓ Custom Rules | ✓ |
| 6.6.4 Command Injection | ✓ Custom Rules | ✓ |
| 6.6.5 Buffer Overflow | ✓ Protocol Attack Rules | ✓ |
| 6.6.6 Insecure Cryptography | ✓ Via HTTPS enforcement | ✓ |

### OWASP Top 10 Coverage

| OWASP | Threat | WAF Coverage | Status |
|---|---|---|---|
| A01 | Broken Access Control | Partial (IP-based) | ✓ |
| A02 | Cryptographic Failures | ✓ HTTPS enforcement | ✓ |
| A03 | Injection | ✓ SQL, Command, Header | ✓ |
| A04 | Insecure Design | N/A | - |
| A05 | Security Misconfiguration | N/A | - |
| A06 | Vulnerable & Outdated | N/A | - |
| A07 | Identification Failures | ✓ Rate limiting | ✓ |
| A08 | Data Integrity Failures | N/A | - |
| A09 | Logging & Monitoring | ✓ Full logging | ✓ |
| A10 | SSRF | ✓ Geo-blocking, IP reputation | ✓ |

### GDPR Compliance

- ✓ IP addresses logged (legitimate purpose: security)
- ✓ Retention: 30 days (logs auto-purged)
- ✓ Privacy: No PII in logs by default
- ✓ Data Processing Agreement: AWS/CloudFlare required

## Testing

Run comprehensive WAF tests:

```bash
# Test all payload types
npm run test tests/waf/waf-rules.test.ts

# Integration tests
npm run test:e2e

# Load test (verify performance)
npm run waf:load-test

# False positive analysis
npm run waf:false-positive-report
```

## Troubleshooting

### "WAF is blocking legitimate requests"

1. Check CloudWatch logs for the rule that's matching
2. Verify the rule is necessary
3. If needed, add exception to WAF_RULES.yaml
4. Re-deploy and monitor

### "WAF rules not taking effect"

1. Verify WAF is associated with ALB/CloudFront
2. Check rule group exists: `aws wafv2 list-rule-groups`
3. Verify rule actions are set to "Block" or "Challenge"
4. Check CloudWatch metrics show rules triggering

### "Performance degradation after WAF deployment"

1. WAF should add < 10ms latency
2. Check CloudWatch "WAFLatency" metric
3. May need to optimize rule order (put fast rules first)
4. Consider geo-shielding or caching

## References

- [CloudFlare WAF Documentation](https://developers.cloudflare.com/waf/)
- [AWS WAF Documentation](https://docs.aws.amazon.com/waf/)
- [OWASP ModSecurity Rules](https://coreruleset.org/)
- [PCI DSS WAF Requirements](https://docs.pcisecuritystandards.org/)

## Support & Escalation

**Questions?** Contact: security@tri.app

**Critical Issue?** Page on-call via PagerDuty: security-critical

**False Positives?** File issue: [GitHub Issues](https://github.com/tri/tri/issues)
