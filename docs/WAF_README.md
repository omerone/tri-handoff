# WAF Implementation for TRi - Quick Reference

This document provides a quick reference for the WAF implementation. For detailed information, see the other documentation files.

## Files Overview

### Core Implementation

1. **scripts/setup-cloudflare-waf.ts** (2h)
   - CloudFlare WAF configuration
   - SQL injection, XSS, path traversal detection
   - Rate limiting setup
   - Geo-blocking configuration
   - Bot management
   - Testing with non-destructive payloads

2. **scripts/setup-aws-waf.ts** (2h)
   - AWS WAF configuration
   - AWS Managed Rules (Core, SQLi, XSS, etc.)
   - IP reputation list configuration
   - Rate-based rules setup
   - GuardDuty integration
   - Testing suite

3. **scripts/deploy-waf.ts** (2h)
   - Unified WAF deployment script
   - Handles both CloudFlare and AWS
   - Validates rules from YAML config
   - Tests WAF with payloads
   - Verifies DNS/traffic routing

### Configuration

4. **docs/WAF_RULES.yaml** (2h)
   - Rule definitions and priorities
   - Endpoint-specific rates
   - Exception whitelisting
   - Geo-blocking settings
   - Custom app-specific rules
   - Performance considerations

### Rate Limiting

5. **src/middleware/waf-rate-limit.ts** (2h)
   - Enhanced rate limiting middleware
   - Per-IP: 100 req/min global
   - Per-route: auth (5/15min), API (50/min), upload (10/min)
   - Per-user (authenticated): 1000 req/min
   - Exponential backoff
   - Graceful degradation

### Monitoring

6. **src/lib/waf/monitoring.ts** (2h)
   - CloudWatch integration
   - Real-time metric tracking
   - Slack/email alerting
   - Dashboard generation
   - Event logging

### Testing

7. **tests/waf/waf-rules.test.ts** (2h)
   - SQL injection payload tests
   - XSS payload tests
   - Path traversal tests
   - RFI/LFI tests
   - Command injection tests
   - Rate limiting tests
   - False positive checks
   - Performance tests

### Documentation

8. **docs/WAF_DEPLOYMENT.md** (2h)
   - Complete deployment guide
   - CloudFlare vs AWS comparison
   - Step-by-step setup
   - 3-phase deployment strategy
   - Monitoring and alerts
   - Incident response procedures
   - Compliance (PCI DSS, OWASP)

9. **docs/DDOS_MITIGATION.md** (1h)
   - DDoS protection strategy
   - Circuit breaker pattern
   - Graceful degradation
   - Traffic spike alerts
   - Incident response playbook
   - Testing procedures

### Infrastructure as Code

10. **terraform/waf.tf** (2h)
    - AWS WAF as Terraform code
    - CloudFlare integration options
    - Managed rules configuration
    - Logging setup
    - Auto-scaling support
    - State management

### CI/CD Integration

11. **.github/workflows/deploy.yml** (updated 1h)
    - WAF rules validation in CI
    - Syntax checking
    - Test execution
    - Dry-run testing for PRs

## Quick Start (5 minutes)

### Deploy with CloudFlare (Recommended for SaaS)

```bash
# Set environment variables
export CLOUDFLARE_API_TOKEN=your_token
export CLOUDFLARE_ZONE_ID=your_zone_id

# Deploy in log-only mode (7 days)
npm run waf:deploy

# After 7 days, switch to challenge mode
npm run waf:deploy:challenge

# After 14 days, switch to block mode
npm run waf:deploy:block
```

### Deploy with AWS WAF

```bash
# Set environment variables
export AWS_REGION=us-east-1
export ALB_ARN=arn:aws:elasticloadbalancing:...

# Deploy in log-only mode
npm run waf:setup:aws

# Or use Terraform
cd terraform
terraform apply -var-file="environments/production.tfvars"
```

### Test WAF Rules

```bash
# Run test suite
npm run waf:test

# Dry-run deployment
npm run waf:dry-run

# Monitor in real-time
npm run waf:monitor
```

## Deployment Timeline

### Day 1-7: Log-Only Mode
- Deploy WAF in log-only (monitoring only)
- Track false positive rate
- Monitor block rate
- Identify issues

**Target**: < 1% false positive rate

### Day 8-14: Challenge Mode
- Switch to challenge (CAPTCHA)
- Verify legitimate users can pass
- Monitor challenge rate
- Refine rules if needed

**Target**: < 5% legitimate users challenged

### Day 15+: Block Mode
- Full enforcement with blocking
- Maintain 24/7 monitoring
- Weekly rule reviews
- Monthly false positive audits

## Key Metrics to Monitor

```
Global Metrics:
├─ Block Rate: Target < 2%
├─ Challenge Rate: Target < 5%
├─ Error Rate: Target < 1%
├─ Response Time: Target < 100ms (p99)
└─ Cache Hit Rate: Target > 60%

Attack Metrics:
├─ SQL Injection Attempts: Log all
├─ XSS Attempts: Log all
├─ Path Traversal Attempts: Log all
├─ Rate Limit Violations: Track trends
└─ Geo-Anomalies: Alert on spike
```

## Alerts Configuration

### Slack
```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK
# Alerts go to #security-alerts
```

### Email
```bash
SECURITY_ALERT_EMAIL=security@tri.app
# Critical alerts sent immediately
```

### PagerDuty
```bash
PAGERDUTY_SERVICE_KEY=your_key
# Critical P0 events trigger incident
```

## Rule Categories

### 1. SQL Injection (Priority 1-2)
- UNION-based detection
- Boolean-based detection
- Time-based detection
- URL-encoded bypass detection

### 2. XSS (Priority 3-5)
- Script tag injection
- Event handler injection
- JavaScript protocol injection

### 3. Path Traversal (Priority 6-8)
- Directory traversal (../)
- Local file inclusion (/etc/passwd)
- Remote file inclusion (http://)

### 4. Command Injection (Priority 9)
- Shell metacharacters (;|&)
- Command substitution ($() or `)

### 5. Protocol Attacks (Priority 10-11)
- HTTP request smuggling
- Null byte injection

### 6. Custom Rules (Priority 20-24)
- Auth endpoint brute force protection
- API rate limiting
- Upload validation
- Admin IP restrictions
- User-agent blocking

## Maintenance

### Daily
- [ ] Monitor block rate (target: < 2%)
- [ ] Check error rates
- [ ] Review Slack alerts

### Weekly
- [ ] Review new WAF logs
- [ ] Check for false positives
- [ ] Analyze block patterns

### Monthly
- [ ] Generate false positive report
- [ ] Review threat intelligence updates
- [ ] Update rules as needed

### Quarterly
- [ ] Full WAF audit
- [ ] Review compliance status
- [ ] Plan rule updates

## Troubleshooting

### Issue: Legitimate users blocked
1. Check CloudWatch logs for the blocking rule
2. Add exception to WAF_RULES.yaml if necessary
3. Re-deploy: `npm run waf:deploy`

### Issue: High false positive rate
1. Review blocked requests in CloudWatch
2. Identify over-triggering rules
3. Temporarily disable problematic rule
4. Gather data for 24-48 hours
5. Update rule or add exception

### Issue: Performance degradation
1. WAF should add < 10ms latency
2. Check if caching is working
3. Verify rate limiting isn't too aggressive
4. Consider geo-shielding or origin shield

### Emergency: Disable WAF
```bash
# Temporary disable
npm run waf:deploy -- --environment log-only

# Or disassociate from ALB
aws wafv2 disassociate-web-acl --resource-arn $ALB_ARN
```

## Environment Variables

### CloudFlare
```
CLOUDFLARE_API_TOKEN      - API token for CloudFlare
CLOUDFLARE_ZONE_ID        - Zone ID for domain
WAF_MODE                  - log-only, challenge, or block
```

### AWS WAF
```
AWS_REGION                - AWS region
AWS_ACCESS_KEY_ID         - AWS credentials
AWS_SECRET_ACCESS_KEY     - AWS credentials
ALB_ARN                   - Load balancer ARN (optional)
CLOUDFRONT_ID             - CloudFront distribution ID (optional)
```

### Alerting
```
SLACK_WEBHOOK_URL         - Slack webhook for alerts
SECURITY_ALERT_EMAIL      - Email for critical alerts
PAGERDUTY_SERVICE_KEY     - PagerDuty integration
```

## References

- **WAF Rules**: docs/WAF_RULES.yaml
- **Deployment Guide**: docs/WAF_DEPLOYMENT.md
- **DDoS Guide**: docs/DDOS_MITIGATION.md
- **Rate Limiting**: src/middleware/waf-rate-limit.ts
- **Monitoring**: src/lib/waf/monitoring.ts
- **Tests**: tests/waf/waf-rules.test.ts

## Support

**Questions?** security@tri.app
**Issues?** GitHub Issues
**Critical?** Page on-call via PagerDuty

## Compliance Status

✓ PCI DSS 6.6 - Web Application Firewall
✓ OWASP Top 10 - Attack Prevention
✓ GDPR Article 32 - Technical Safeguards
✓ ISO 27001 - Access Control

---

**Last Updated**: August 3, 2024
**Next Review**: November 3, 2024 (quarterly)
