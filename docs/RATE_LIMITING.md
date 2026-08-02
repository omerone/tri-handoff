# Production-Grade Rate Limiting

This document describes TRi's comprehensive rate limiting system, designed to protect against brute force attacks, resource exhaustion, and abuse while maintaining good UX for legitimate users.

## Overview

Rate limiting is implemented using a **token bucket algorithm** with:
- **Per-IP** limits for unauthenticated endpoints
- **Per-user** limits for authenticated endpoints
- **Per-route** limits for specific sensitive operations
- **Exponential backoff** to increase cost of repeated violations
- **Redis backend** with in-memory fallback for distributed systems
- **Graceful degradation** if Redis unavailable

## Architecture

### Components

1. **Configuration** (`src/config/rate-limits.ts`)
   - Centralized rate limit rules
   - Environment variable overrides
   - Easy to audit and update

2. **Redis Client** (`src/lib/redis/client.ts`)
   - Connection pooling and retry logic
   - In-memory fallback when Redis unavailable
   - Health checks and error logging

3. **Rate Limiter Middleware** (`src/middleware/rate-limiter.ts`)
   - Token bucket implementation
   - Exponential backoff calculation
   - Rate limit header generation

4. **Route-Specific Limiters** (`src/middleware/route-limiters.ts`)
   - Pre-configured middleware for common routes
   - Consistent error handling
   - Easy integration with API routes

5. **Audit Logger** (`src/lib/security/audit-logger.ts`)
   - Logs all rate limit violations
   - Sends to centralized logging in production
   - Critical events logged to stderr

## Rate Limit Rules

All limits are defined in `src/config/rate-limits.ts`:

### Authentication (Prevent credential stuffing)
- **Login**: 5 attempts per 15 minutes per IP
- **Password Reset**: 3 attempts per 1 hour per email
- **Signup**: 2 attempts per 1 hour per IP
- **Email Verification**: 5 attempts per 1 hour per email
- **Password Change**: 3 attempts per 1 hour per user

### MT5 Connection (Prevent resource exhaustion)
- **Connect**: 5 attempts per 30 minutes per user
- **Disconnect**: 3 attempts per 1 hour per user

### Account Operations (GDPR compliance)
- **Data Export**: 1 per day per user
- **Account Deletion**: 1 per 48 hours per user

### File Upload (Storage protection)
- **Requests**: 10 per minute per user
- **Bytes**: 5GB per day per user

### API Endpoints (Resource protection)
- **Trades API**: 50 requests per minute per user
- **Settings API**: 20 requests per minute per user
- **Admin Actions**: 100 per minute per admin

### Global
- **Default**: 100 requests per minute per IP

## Token Bucket Algorithm

The token bucket algorithm works like this:

1. **Bucket State**: Each key has a counter within a time window
2. **Request Processing**:
   - Client makes request
   - System checks if `count < limit` for the current window
   - If yes: increment counter, allow request
   - If no: return 429 with retry time
3. **Window Expiration**: When window expires, counter resets to 0

### Example

```
Limit: 5 requests per minute
Window: 60 seconds

Time 0s:  Request 1 → Allowed (count=1, remaining=4)
Time 2s:  Request 2 → Allowed (count=2, remaining=3)
Time 4s:  Request 3 → Allowed (count=3, remaining=2)
Time 6s:  Request 4 → Allowed (count=4, remaining=1)
Time 8s:  Request 5 → Allowed (count=5, remaining=0)
Time 10s: Request 6 → BLOCKED, Retry-After: 50s
Time 60s: Window expires, counter resets
Time 61s: Request 7 → Allowed (count=1, remaining=4)
```

## Exponential Backoff

When a user violates rate limits repeatedly, the effective limit is reduced by a multiplier:

```
Violations: 0 → Limit = 5
Violations: 1 → Limit = 5 / 2 = 2
Violations: 2 → Limit = 5 / 4 = 1
Violations: 3 → Limit = 5 / 8 = 0 (effectively locked out)
```

This makes it expensive for attackers to continue attempts while allowing legitimate users who make mistakes to recover.

## Configuration & Tuning

### Environment Variables

All rate limits support environment variable overrides:

```bash
# Global rate limit
RATE_LIMIT_GLOBAL=100
RATE_LIMIT_GLOBAL_WINDOW=60000

# Auth limits
RATE_LIMIT_AUTH_LOGIN=5
RATE_LIMIT_AUTH_LOGIN_WINDOW=900000

# MT5 limits
RATE_LIMIT_MT5_CONNECT=5
RATE_LIMIT_MT5_CONNECT_WINDOW=1800000

# Backoff configuration
RATE_LIMIT_BACKOFF_ENABLED=true
RATE_LIMIT_BACKOFF_MULTIPLIER=2
RATE_LIMIT_BACKOFF_MAX_DELAY=3600000

# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret
REDIS_DB=0
REDIS_KEY_PREFIX=ratelimit:

# Fallback to in-memory if Redis unavailable
RATE_LIMIT_FALLBACK_ENABLED=true

# Admin API tokens (comma-separated for health checks)
ADMIN_API_TOKENS=token1,token2
```

### Tuning Guidelines

- **Increase limit** if legitimate users are being blocked
- **Decrease limit** if seeing abuse patterns
- **Adjust window** based on typical user behavior
- **Tune backoff** to balance protection vs UX

## Integration Guide

### Using Route-Specific Limiters

```typescript
// In your API route handler
import { checkRateLimitMiddleware, rateLimitAuth } from '@/middleware/route-limiters';

export async function POST(request: NextRequest) {
  // Check rate limit for auth login
  const options = await rateLimitAuth('user@example.com');
  const limit = await checkRateLimitMiddleware(options);

  if (limit.error) {
    return new NextResponse(limit.body, {
      status: limit.status,
      headers: limit.headers,
    });
  }

  // Process login...
  return NextResponse.json({ success: true }, {
    headers: limit.headers, // Include rate limit headers in response
  });
}
```

### Creating New Rate Limits

1. **Add to config** (`src/config/rate-limits.ts`):
```typescript
export const RATE_LIMITS = {
  myFeature: {
    limit: 10,
    windowMs: 60 * 1000,
    description: 'Description of why this limit exists',
  }
}
```

2. **Create limiter** (`src/middleware/route-limiters.ts`):
```typescript
export async function rateLimitMyFeature(userId: string) {
  const key = `myfeature:${userId}`;
  return {
    key,
    limit: RATE_LIMITS.myFeature.limit,
    windowMs: RATE_LIMITS.myFeature.windowMs,
    description: RATE_LIMITS.myFeature.description,
  };
}
```

3. **Use in route**:
```typescript
const options = await rateLimitMyFeature(userId);
const result = await checkRateLimitMiddleware(options);
```

## Response Headers

All rate-limited responses include standard headers:

```
X-RateLimit-Limit: 5          # Total requests allowed in window
X-RateLimit-Remaining: 2      # Requests remaining in current window
X-RateLimit-Reset: 1628095200 # Unix timestamp when limit resets
Retry-After: 120              # Seconds to wait before retrying (429 only)
```

## Error Responses

### 429 Too Many Requests

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded: Login attempts: 5 per 15 minutes. Please try again in 120 seconds.",
  "retryAfter": 120,
  "rateLimit": {
    "limit": 5,
    "remaining": 0,
    "reset": 1628095320
  }
}
```

## Testing

### Unit Tests

```bash
npm run test tests/rate-limiting/rate-limiter.test.ts
```

Tests cover:
- Single request under limit (passes)
- Multiple requests hit limit (429)
- Exponential backoff (2x penalty after violation)
- Token refresh after time window
- Different keys isolated
- Graceful degradation if Redis down
- Correct headers present
- Accurate Retry-After
- Audit logging of violations

### Load Testing

```bash
# Using Apache Bench
ab -n 100 -c 10 http://localhost:3000/api/auth/signin

# Using k6
k6 run tests/k6/rate-limit-load-test.js

# Using wrk
wrk -t12 -c400 -d30s http://localhost:3000/api/auth/signin
```

### Manual Testing

```bash
# Test rate limit
curl -v http://localhost:3000/api/auth/signin

# Check admin status
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/rate-limits/status

# Verify Redis
redis-cli ping
```

## Emergency Procedures

### If Legitimate Users Are Blocked

1. **Temporarily disable backoff** (reduces penalty):
```bash
RATE_LIMIT_BACKOFF_ENABLED=false
```

2. **Increase limit** for specific endpoint:
```bash
RATE_LIMIT_AUTH_LOGIN=10
```

3. **Check logs** for patterns:
```bash
grep "RATE_LIMIT_EXCEEDED" logs/*.log
```

### If Under Attack

1. **Decrease limits** to block more aggressively
2. **Enable stricter backoff** (higher multiplier)
3. **Check admin dashboard** for patterns:
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/rate-limits/status
```

4. **Consider IP blocking** via WAF if concentrated attack

### If Redis Unavailable

System automatically falls back to in-memory storage:
- ✅ All rate limits still work
- ⚠️ Limits are per-process only (won't coordinate across instances)
- ⚠️ Limits are lost on process restart

To disable fallback and enforce Redis:
```bash
RATE_LIMIT_FALLBACK_ENABLED=false
```

## Performance Impact

Rate limiting adds minimal overhead:
- **Redis check**: ~1-5ms per request
- **In-memory check**: <1ms per request
- **Graceful degradation**: Allows all requests if Redis down

## Monitoring & Alerting

### Key Metrics

- `rate_limit_blocks_total` - Total blocked requests
- `rate_limit_violations_per_endpoint` - Blocks per endpoint
- `redis_latency_ms` - Redis response time
- `rate_limit_false_positives` - Legitimate users blocked

### Alert Conditions

```
Alert if:
- >50% of traffic being rate limited (possible false positives)
- Single IP generating >10,000 requests/min (attack pattern)
- Redis unavailable for >5 minutes (fallback only)
- Email verification attempts spike 10x (account enumeration)
```

## Compliance & Security References

### OWASP A07:2021 - Identification and Authentication Failures

This implementation addresses common authentication attacks:
- **Brute Force**: Per-account and per-IP limits on login
- **Account Enumeration**: Uniform response times for reset
- **Credential Stuffing**: Rate limiting and backoff
- **Password Spray**: Per-IP global limit

### GDPR Compliance

Data export limited to 1 per day per user (reasonable access).

### Best Practices

- ✅ Per-IP limits on public endpoints
- ✅ Per-user limits on authenticated endpoints
- ✅ Progressive backoff on repeated violations
- ✅ Audit logging of all violations
- ✅ Clear error messages with retry times
- ✅ Distributed rate limiting (Redis)
- ✅ Graceful degradation
- ✅ Easy configuration & tuning

## Troubleshooting

### Requests Still Being Blocked After Reset

Check the expiration time - Redis keys might not have expired yet.

### Rate Limits Not Persisting Across Restarts

If using in-memory fallback, limits are lost on restart. Deploy Redis for production.

### "Redis unavailable" Messages

Check Redis connection:
```bash
redis-cli ping
redis-cli CONFIG GET maxmemory
redis-cli INFO stats
```

### High Latency on Rate Limit Checks

Check Redis performance:
```bash
redis-cli --latency
redis-cli --latency-history
```

## Future Improvements

- [ ] Sliding window rate limiter (more accurate)
- [ ] Machine learning to detect attack patterns
- [ ] Geographic rate limiting
- [ ] Dynamic limit adjustment based on load
- [ ] Integration with WAF for automatic IP blocking

## References

- [OWASP Rate Limiting](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#rate-limiting)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [Redis](https://redis.io/)
- [NIST 800-63B Authentication](https://pages.nist.gov/800-63-3/sp800-63b.html)
