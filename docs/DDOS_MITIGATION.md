# DDoS Mitigation Strategy for TRi

## Overview

Comprehensive DDoS protection strategy combining:
- CloudFlare/AWS automatic mitigation
- Circuit breaker pattern
- Graceful degradation
- Traffic spike alerts
- Incident response procedures

**Status**: Production-Ready
**Last Updated**: August 3, 2024

## Architecture

### Layer 1: Edge Protection (CloudFlare/AWS)

**CloudFlare:**
- Automatic DDoS protection (included in all plans)
- L3/L4 (network layer) attack mitigation
- L7 (application layer) protection with WAF
- Traffic rate limiting at edge
- Instant global failover

**AWS Shield:**
- **Standard** (Free): L3/L4 DDoS protection
- **Advanced** ($3,000/month): 
  - L7 protection
  - DDoS cost protection (up to $1M/month)
  - 24x7 DDoS Response Team (DRT)
  - Real-time attack diagnostics

### Layer 2: Application Level (Next.js Middleware)

Circuit breaker pattern:
- Monitor request rate
- Detect anomalies (10x normal traffic)
- Gracefully degrade functionality
- Return cached responses
- Queue requests when possible

### Layer 3: Database Level

Connection pooling:
- Limit max connections
- Queue database requests
- Fail fast on timeouts
- Return cached data

### Layer 4: Content Delivery (Caching)

- CloudFlare Cache: Everything by default
- Browser Cache: 30-minute TTL
- Origin Shield: Protect database from spike
- Stale-While-Revalidate: Return cached data even if origin fails

## DDoS Threat Types

### 1. Volumetric Attacks (90% of DDoS)

**Attack Type**: Large volume of traffic
**Examples**: 
- UDP floods (10-100 Gbps)
- ICMP floods
- DNS amplification

**Mitigation**:
- ✓ CloudFlare/AWS automatic mitigation at network edge
- ✓ No action needed (handled before reaching app)

### 2. Protocol Attacks (5% of DDoS)

**Attack Type**: Exploit protocol weaknesses
**Examples**:
- SYN floods
- Fragmented packet floods
- Ping of Death

**Mitigation**:
- ✓ CloudFlare/AWS protocol protection
- ✓ Rate limiting on SYN packets

### 3. Application Attacks (5% of DDoS)

**Attack Type**: Legitimate-looking requests targeting application logic
**Examples**:
- Slowloris (slow POST requests)
- HTTP floods to specific endpoints
- Expensive query attacks

**Mitigation**:
- ✓ Rate limiting (100 req/min global)
- ✓ Per-endpoint limits (auth: 5 req/15min)
- ✓ Timeout protection (30s max request time)
- ✓ Connection pooling
- ✓ Circuit breaker pattern
- ✓ Graceful degradation

## Implementation

### Circuit Breaker Pattern

Detects and responds to attack:

```typescript
// Example from middleware/circuit-breaker.ts
interface CircuitBreakerConfig {
  threshold: number;          // requests/second to trigger
  timeout: number;            // ms to remain open
  halfOpenRequests: number;   // requests to allow during recovery
}

// Monitor traffic
if (requestsPerSecond > normalTraffic * 10) {
  // Circuit opens
  // Gracefully degrade:
  // 1. Return cached responses
  // 2. Queue write operations
  // 3. Show maintenance message for non-critical features
  // 4. Allow essential operations (auth, critical API)
}
```

### Traffic Monitoring

Real-time metrics:

```bash
# Normal traffic baseline
# Peak hour: ~1,000 req/s
# Average: ~200 req/s

# Spike detection threshold: 10,000 req/s (10x peak)
# Alert threshold: 5,000 req/s (5x peak)

# CloudWatch metric
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name RequestCount \
  --period 60 \
  --statistics Sum
```

### Caching Strategy

Minimize database load during attack:

```yaml
# docs/WAF_RULES.yaml
cache:
  static_assets: 24h
  api_responses: 5min
  user_data: 1min
  
stale_while_revalidate:
  enabled: true
  ttl: 60s  # Serve stale data while refreshing

origin_shield:
  enabled: true
  location: auto  # CloudFlare chooses optimal location
```

### Rate Limiting During Attack

Progressive rate limit enforcement:

```typescript
// Normal mode
Per-IP: 100 req/min
Per-User: 1000 req/min

// Alert mode (5x traffic spike)
Per-IP: 50 req/min
Per-User: 500 req/min

// Emergency mode (10x traffic spike)
Per-IP: 20 req/min
Per-User: 100 req/min
```

### Graceful Degradation

When circuit breaker opens:

```
1. Critical features: Keep fully operational
   - Authentication
   - Account management
   - Existing account data (read-only)

2. Secondary features: Degrade gracefully
   - Report generation: Show cached version
   - Data sync: Pause until attack subsides
   - Real-time features: Use stale data

3. Non-critical features: Temporarily disable
   - Analytics collection
   - Image processing
   - Complex queries
```

## Incident Response

### Detection (Automatic)

Triggers for DDoS alert:

1. **Traffic Spike**: Requests 10x normal baseline
2. **Block Rate**: > 50% requests blocked
3. **Error Rate**: > 10% requests returning 5xx
4. **Latency Spike**: Response time > 5 seconds (p99)

```bash
# Automated alert via Slack
[ALERT] DDoS Attack Detected
├── Type: Application Layer
├── Peak Traffic: 15,000 req/s (10x normal)
├── Duration: 5 minutes
└── Status: MITIGATING
    ├── Circuit Breaker: OPEN
    ├── Rate Limiting: ENFORCED (20 req/min)
    └── Cached Responses: ACTIVE
```

### Phase 1: Confirm Attack (First 2 minutes)

**Automated Actions**:
- ✓ Circuit breaker opens
- ✓ Rate limiting enforces
- ✓ Slack alert sent

**Manual Tasks**:
```bash
# 1. Verify it's real attack (not legitimate traffic)
# Check if users report issues:
# - Can they log in? (should work)
# - Can they access data? (should work, slow)
# - Are they seeing errors? (expected)

# 2. Review CloudWatch logs
aws logs tail /tri/waf-logs --follow

# 3. Identify attack type
# - Volumetric? (handled at edge, no action needed)
# - Protocol? (handled at edge, no action needed)
# - Application? (proceed to Phase 2)
```

### Phase 2: Mitigation (2-30 minutes)

**Ongoing Actions**:
- Continue serving cached data
- Maintain authentication
- Queue non-critical operations

**Analysis**:
```bash
# Identify attacked endpoint(s)
aws logs filter-log-events \
  --log-group-name /tri/waf-logs \
  --filter-pattern "BlockedRequests" \
  | jq '.events[].message | fromjson | .requestPath' \
  | sort | uniq -c | sort -rn

# Check if pattern-based (same path repeatedly)
# or distributed (random endpoints)
```

**Response Options**:

Option A: **Temporary IP Block** (If single IP source)
```bash
# Add attacker IP to WAF blocklist
# Only if clearly single-source attack

aws wafv2 update-ip-set \
  --name AttackerIPs \
  --scope REGIONAL \
  --id YOUR_IP_SET_ID \
  --addresses ["192.0.2.1/32"]  # Attacker's IP
```

Option B: **Stricter Rate Limiting** (If multi-IP)
```bash
# Temporary rate limit reduction
# All IPs: 10 req/min
# Auth: 1 req/15min

# Update in WAF rules, re-deploy
npm run deploy-waf
```

Option C: **Geo-Blocking** (If from specific region)
```bash
# If attack originates from specific country
# Temporarily block that country

# In CloudFlare:
# Security → WAF Rules → Add rule to block country

# In AWS:
# Create IP set with country's IP ranges
# Add to WAF rule with "Block" action
```

Option D: **CAPTCHA Challenge** (Recommended)
```bash
# Best option: Challenge all requests with CAPTCHA
# Legitimate users: Complete challenge, get access
# Bots: Fail challenge, no access

# Switch to "challenge" mode
npm run deploy-waf --environment challenge
```

### Phase 3: Monitor Recovery (30+ minutes)

```bash
# Every 5 minutes:
# 1. Check block rate
# 2. Verify legitimate users can access
# 3. Monitor error rates
# 4. Check database connections

# When traffic returns to normal:
# 1. Gradually restore rate limits to normal
# 2. Re-enable disabled features
# 3. Document incident
# 4. Schedule post-mortem
```

### Phase 4: Post-Attack (After attack ends)

1. **Immediate** (< 1 hour):
   - Restore all systems to normal
   - Remove temporary blocks/limits
   - Verify functionality

2. **Short-term** (< 24 hours):
   - Review CloudWatch logs
   - Document attack characteristics
   - Identify if preventable

3. **Medium-term** (< 1 week):
   - Post-mortem meeting
   - Update defense strategies
   - Implement preventive measures

4. **Long-term** (Ongoing):
   - Monitor for repeat attacks
   - Update threat models
   - Share findings with security team

## Configuration Files

### Environment Variables

```bash
# .env or GitHub Actions secrets

# CloudFlare DDoS Protection
CLOUDFLARE_ZONE_ID=your_zone_id

# AWS Shield Advanced (Optional, $3k/month)
AWS_SHIELD_ADVANCED=false

# Alert thresholds
DDOS_ALERT_THRESHOLD=10000        # requests/sec
DDOS_BLOCK_THRESHOLD=5000         # trigger circuit breaker

# Rate limiting during attack
EMERGENCY_RATE_LIMIT_IP=20        # requests/min per IP
EMERGENCY_RATE_LIMIT_USER=100     # requests/min per user
```

### Caching Rules

```yaml
# docs/WAF_RULES.yaml - cache configuration

cache_rules:
  - path: "/api/data/*"
    ttl: 300
    stale_while_revalidate: 60
    bypass_cache_if: ["logged-out", "admin"]

  - path: "/api/user/*"
    ttl: 60
    stale_while_revalidate: 30
    bypass_cache_if: ["writing"]

  - path: "/static/*"
    ttl: 86400
    stale_while_revalidate: 0
```

## Monitoring Dashboard

Real-time metrics to watch:

```
┌─────────────────────────────────────────────────────┐
│ TRi DDoS Protection Dashboard                       │
├─────────────────────────────────────────────────────┤
│ Status: ✓ HEALTHY                                  │
│                                                     │
│ Traffic:                                            │
│ ├─ Current: 450 req/s ████████ (Normal)            │
│ ├─ Peak (24h): 1,200 req/s ████████████ (Normal)   │
│ └─ Attack Threshold: 10,000 req/s                  │
│                                                     │
│ Circuit Breaker: ✓ CLOSED (Normal operation)       │
│ Cache Hit Rate: 65%                                │
│ Error Rate: 0.2% (Normal)                          │
│                                                     │
│ Blocked Requests (24h):                            │
│ ├─ WAF Rules: 450 (normal scanning)                │
│ ├─ Rate Limited: 120 (expected)                    │
│ └─ Other: 50                                       │
│                                                     │
│ Alert History: No critical alerts (24h)            │
└─────────────────────────────────────────────────────┘
```

Access dashboard:

```bash
# CloudFlare Dashboard
https://dash.cloudflare.com/analytics/page_rules

# AWS CloudWatch
https://console.aws.amazon.com/cloudwatch/home
# Dashboard: tri-ddos-protection

# Custom dashboard
npm run waf:dashboard
```

## Prevention vs. Remediation

### Prevention (Proactive)

✓ Implemented:
- Rate limiting (100 req/min global)
- Per-endpoint limits (auth: 5 req/15min)
- CloudFlare/AWS DDoS protection
- Caching strategy
- Database connection pooling
- Connection timeouts
- Request validation

### Remediation (Reactive)

✓ Implemented:
- Circuit breaker pattern
- Graceful degradation
- Cached response serving
- Real-time monitoring
- Automated alerts
- Incident response playbook
- Manual escalation procedures

## Testing DDoS Response

### Load Test (Non-destructive)

```bash
# Simulate traffic spike with Apache Bench
ab -n 100000 -c 1000 https://staging.example.com/

# Or with k6 (better for sustained load)
k6 run scripts/load-test.js \
  --vus 1000 \
  --duration 5m

# Monitor response
# Check if:
# - Rate limiting activates
# - Circuit breaker opens
# - Cached responses served
# - Error rates stable
```

### Test Checklist

```
□ Rate limiting activates at threshold
□ Circuit breaker opens and closes
□ Cached responses served correctly
□ Authentication still works
□ Database connections don't max out
□ Response times increase gracefully
□ Alerts trigger correctly
□ Slack notification received
□ Manual override procedures work
□ Recovery after attack simulated
```

## Compliance

### PCI DSS

✓ 6.6 Requirement: "Implement monitoring and alerting for unauthorized network access"
- WAF logs all blocked requests
- Real-time alerts for attacks
- 30-day log retention

### GDPR

✓ Article 32: "Appropriate technical and organizational measures"
- DDoS protection is technical measure
- Request logging for security purpose
- IP addresses retained only for security

## Cost Analysis

### CloudFlare (Recommended for SaaS)

- **Free**: $0/month (Basic DDoS protection)
- **Pro**: $20/month (Advanced DDoS, WAF)
- **Business**: $200/month (Highest protection)
- **Enterprise**: Custom

### AWS

- **Shield Standard**: $0/month (Basic L3/L4 protection)
- **Shield Advanced**: $3,000/month
  - Includes DDoS cost protection
  - 24/7 DRT support
  - Real-time attack diagnostics

### Recommendation

For TRi SaaS: **CloudFlare Pro/Business** ($20-200/month)
- Includes DDoS protection
- Includes WAF
- Global coverage
- No AWS dependency

## Emergency Contacts

Keep updated contact information for:

```
On-Call Security: [PagerDuty integration]
Incident Commander: [To be assigned]
CloudFlare Account Manager: [Account contact]
AWS TAM: [Tech Account Manager, if Enterprise]
```

## References

- [CloudFlare DDoS Protection](https://www.cloudflare.com/ddos/)
- [AWS Shield Documentation](https://aws.amazon.com/shield/)
- [OWASP DDoS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Prevention_Cheat_Sheet.html)
- [RFC 9116 - DDoS Open Threat Signaling](https://datatracker.ietf.org/doc/html/rfc9116)

---

**Last Reviewed**: August 3, 2024
**Next Review**: November 3, 2024 (quarterly)
