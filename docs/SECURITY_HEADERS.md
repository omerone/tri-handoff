# Security Headers Documentation

**Version**: 1.0  
**Last Updated**: 2026-08-03  
**Scope**: TRi Trading Journal  

This document describes the security headers implemented in TRi and their purposes. All headers are set in the middleware (`src/middleware.ts`) on every HTTP response.

## Table of Contents

1. [Overview](#overview)
2. [Content Security Policy (CSP)](#content-security-policy-csp)
3. [X-Content-Type-Options](#x-content-type-options)
4. [X-Frame-Options](#x-frame-options)
5. [X-XSS-Protection](#x-xss-protection)
6. [Referrer-Policy](#referrer-policy)
7. [Permissions-Policy](#permissions-policy)
8. [Strict-Transport-Security (HSTS)](#strict-transport-security-hsts)
9. [Implementation](#implementation)
10. [Testing](#testing)

---

## Overview

Security headers are HTTP response headers that instruct browsers to enable additional security mechanisms. They work as a second line of defense against common web vulnerabilities:

- **XSS (Cross-Site Scripting)**: Injection of malicious JavaScript
- **Clickjacking**: Tricking users into clicking hidden elements
- **MIME-type sniffing**: Executing content as unintended type
- **Referrer leakage**: Exposing sensitive data in referrer headers
- **Phishing**: Accessing browser features for malicious purposes

| Header | Status | Level |
|--------|--------|-------|
| Content-Security-Policy | Implemented | Production |
| X-Content-Type-Options | Implemented | Production |
| X-Frame-Options | Implemented | Production |
| X-XSS-Protection | Implemented | Legacy support |
| Referrer-Policy | Implemented | Production |
| Permissions-Policy | Implemented | Production |
| Strict-Transport-Security | Implemented | Production only |

---

## Content Security Policy (CSP)

**Purpose**: Prevent XSS attacks by controlling which resources the browser can load.

### Policy

```
default-src 'self';
script-src 'self' 'nonce-<nonce>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
form-action 'self';
upgrade-insecure-requests;  /* production only */
```

### Explanation

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | All resources default to same-origin only |
| `script-src` | `'self' 'nonce-<nonce>' 'strict-dynamic'` | Only load scripts from same-origin or with valid nonce. `strict-dynamic` allows nonced scripts to load subresources |
| `style-src` | `'self' 'unsafe-inline'` | Load styles from same-origin. Inline styles allowed (critical CSS from Tailwind) |
| `img-src` | `'self' data: blob:` | Load images from same-origin, data URIs, or blobs (for generated charts) |
| `font-src` | `'self' data:` | Load fonts from same-origin or data URIs |
| `connect-src` | `'self'` | Only fetch from same-origin (AJAX, WebSocket, etc.) |
| `frame-ancestors` | `'none'` | Page cannot be embedded in frames (prevents clickjacking) |
| `base-uri` | `'self'` | Restrict `<base>` tag to same-origin |
| `object-src` | `'none'` | Disable `<object>`, `<embed>`, `<applet>` (dangerous) |
| `form-action` | `'self'` | Forms can only submit to same-origin |
| `upgrade-insecure-requests` | Always (prod) | Upgrade HTTP to HTTPS (production only) |

### Nonce Implementation

Every request receives a unique `x-nonce` header with a random base64-encoded UUID. This nonce:

1. Is set in the middleware (`src/middleware.ts`)
2. Is passed to Next.js via `content-security-policy` request header
3. Is stamped by Next onto inline `<script>` tags it generates
4. Prevents inline script injection by requiring exact nonce match

**Why**: Next.js inlines its bootstrap and streaming scripts. A CSP without nonce would either:
- Block these essential scripts (page doesn't work)
- Allow `unsafe-inline` (defeats CSP purpose)

The nonce solution allows Next to work while still preventing injected scripts.

### Testing CSP

```bash
# Check CSP header in response
curl -I https://tri.example.com

# Use browser DevTools Console to test violations
# (Blocked resources log errors, but page still works)
```

### Violations

CSP violations are **not reported** (no `report-uri` or `report-to` configured). Violations:
- Are logged to browser console
- Do not break the page (violations only prevent execution)
- Should prompt code review if legitimate resources are blocked

---

## X-Content-Type-Options

**Purpose**: Prevent MIME-type sniffing attacks (IE/older browsers).

### Header

```
X-Content-Type-Options: nosniff
```

### Explanation

**Vulnerability**: Some browsers (IE, legacy Chrome) would "sniff" the MIME type of responses:
- A file served as `text/plain` could be interpreted as `text/html` if it contains HTML
- Attackers could upload a `.txt` file containing JavaScript and get it executed as `text/javascript`

**Solution**: `nosniff` tells the browser to strictly trust the `Content-Type` header:
- If server says `text/plain`, treat it as plain text (never as HTML/JS)
- Requires the server to set correct `Content-Type` for all responses

**Status**: All endpoints in TRi use Next.js which sets correct `Content-Type` automatically.

### Testing

```bash
# Verify header present
curl -I https://tri.example.com | grep X-Content-Type-Options

# Expected output:
# X-Content-Type-Options: nosniff
```

---

## X-Frame-Options

**Purpose**: Prevent clickjacking attacks by disallowing iframe embedding.

### Header

```
X-Frame-Options: DENY
```

### Explanation

**Vulnerability (Clickjacking)**: Attacker creates a page with TRi embedded in a transparent iframe, then tricks user into clicking invisible buttons:
```html
<iframe src="https://tri.example.com/settings" style="opacity: 0;"></iframe>
<!-- User thinks they're clicking the attacker's page, but actually click TRi button -->
```

**Solution**: `X-Frame-Options: DENY` prevents TRi from being framed at all:
- TRi refuses to load inside any `<iframe>` (from any origin)
- Even if attacker embeds TRi, browser doesn't render it

**Alternatives**:
- `SAMEORIGIN`: Allow framing only from same domain (less secure)
- `ALLOW-FROM origin`: Allow specific domain (deprecated, use CSP instead)

**Status**: TRi is not a component that other apps embed, so `DENY` is appropriate.

### Testing

```bash
# Create test.html with iframe
cat > /tmp/test.html << 'EOF'
<iframe src="https://tri.example.com/dashboard" width="800" height="600"></iframe>
EOF

# Open in browser - iframe will be empty/blocked
```

**Related Header**: `Content-Security-Policy: frame-ancestors 'none'` (more modern, redundant)

---

## X-XSS-Protection

**Purpose**: Enable XSS filter in older browsers (legacy support).

### Header

```
X-XSS-Protection: 1; mode=block
```

### Explanation

**History**: IE8/9 and old Chrome had built-in XSS filters that detected reflected XSS attempts.

**Values**:
- `1; mode=block`: Enable filter; block page if XSS detected (recommended)
- `1; mode=sanitize`: Enable filter; sanitize malicious parts (less safe)
- `0`: Disable filter (not used)

**Modern Status**: Modern browsers use Content-Security-Policy instead. This header is for defense-in-depth on IE/legacy browsers.

**Why included**: No harm including it, provides protection for users on old browsers.

### Testing

```bash
curl -I https://tri.example.com | grep X-XSS-Protection

# Expected:
# X-XSS-Protection: 1; mode=block
```

---

## Referrer-Policy

**Purpose**: Control how much referrer information is sent to external sites.

### Header

```
Referrer-Policy: strict-origin-when-cross-origin
```

### Explanation

**Privacy Concern**: When user clicks a link from TRi to external site, the `Referer` header is sent:
```
User at https://tri.example.com/dashboard/trades
Clicks link to https://example.com
Browser sends: Referer: https://tri.example.com/dashboard/trades
```

The external site now knows the user was on TRi. If TRi URL contained sensitive info (e.g., `?tradeId=123`), it leaks.

**Policy Options**:
| Policy | Sends to Same-Origin | Sends to Cross-Origin | Use Case |
|--------|----------------------|----------------------|----------|
| `no-referrer` | Nothing | Nothing | Maximum privacy |
| `strict-origin-when-cross-origin` | Full URL | Only origin | **TRi choice: Balance** |
| `origin` | Only origin | Only origin | Minimal info |
| `unsafe-url` | Full URL | Full URL | Don't use |

**TRi Choice: `strict-origin-when-cross-origin`**:
- ✅ Sends full referrer for same-origin links (internal analytics)
- ✅ Sends only origin for external links (privacy protection)
- ✅ Works with legitimate external integrations

### Example

```
From: https://tri.example.com/dashboard/trades?tradeId=456
Click to: https://google.com

Sent referrer: https://tri.example.com/
(NOT: https://tri.example.com/dashboard/trades?tradeId=456)
```

### Testing

```bash
# Create external link test
curl -I -H "Referer: https://tri.example.com/test" \
  https://tri.example.com | grep Referrer-Policy

# Expected:
# Referrer-Policy: strict-origin-when-cross-origin
```

---

## Permissions-Policy

**Purpose**: Disable unused browser APIs to prevent malicious JavaScript from accessing them.

### Header

```
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), 
  gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), vr=()
```

### Explanation

**Vulnerability**: Even if XSS is prevented, malicious JS could:
- Access camera: `navigator.mediaDevices.getUserMedia()` → stream video
- Access microphone: Steal audio
- Access geolocation: Track user location
- Access payment APIs: Create unauthorized transactions

**Solution**: Explicitly disable all unused features:
```
camera=()           # Disable camera access
microphone=()       # Disable microphone
geolocation=()      # Disable geolocation
payment=()          # Disable Payment Request API
usb=()              # Disable USB device access
```

**TRi APIs Needed**: None of these (trading journal doesn't need hardware access)

### Testing

```bash
# Verify header
curl -I https://tri.example.com | grep Permissions-Policy

# In browser DevTools, if you try:
# navigator.permissions.query({ name: 'camera' })
# Returns: { state: 'denied' }
```

### OWASP Reference

See: [Feature Policy](https://owasp.org/www-community/attacks/Feature_policy_manipulation)

---

## Strict-Transport-Security (HSTS)

**Purpose**: Force HTTPS connections and prevent SSL/TLS downgrade attacks.

### Header (Production Only)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### Explanation

**Vulnerability (SSLStrip)**: Attacker intercepts user on insecure network (WiFi):
1. User tries: `https://tri.example.com`
2. Attacker intercepts, redirects to: `http://tri.example.com` (HTTP!)
3. User logs in over unencrypted connection
4. Credentials stolen

**Solution**: HSTS tells browser "always use HTTPS for this domain":
- Browser refuses to downgrade to HTTP
- Prevents SSLStrip attacks
- Remembered for max-age duration

### Directives

| Directive | Value | Meaning |
|-----------|-------|---------|
| `max-age` | `31536000` | 1 year: Remember this policy for 1 year |
| `includeSubDomains` | (present) | Apply to subdomains too (`api.tri.example.com`, etc.) |
| `preload` | (present) | Allow browser vendor inclusion in HSTS preload list |

### HSTS Preload List

Once you set `Strict-Transport-Security: ... preload`, you can:

1. Submit your domain to [HSTS Preload List](https://hstspreload.org/)
2. Browser vendors (Chrome, Firefox, Safari, Edge) hardcode your domain
3. Users visiting TRi for the first time (no prior HSTS header) are still protected

### Configuration

**Development**: Not sent (only in production)

```typescript
// In middleware.ts
if (process.env.NODE_ENV === 'production') {
  response.headers.set(
    'strict-transport-security',
    'max-age=31536000; includeSubDomains; preload'
  );
}
```

**Why**: During development with `http://localhost:3000`, HSTS would block local testing.

### Testing

```bash
# Production only
curl -I https://tri.example.com | grep Strict-Transport-Security

# Expected (production):
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

# Development (not present):
curl -I http://localhost:3000
# (header not present)
```

### SSL Certificate Requirements

HSTS only works over HTTPS. Before enabling HSTS:
1. ✅ Ensure valid SSL/TLS certificate
2. ✅ Certificate covers all domains (tri.example.com + api.tri.example.com)
3. ✅ Certificate is not self-signed (unless in development)
4. ✅ HTTPS redirect is working (HTTP 301/302 to HTTPS)

---

## Implementation

All headers are set in **`src/middleware.ts`**:

```typescript
export function middleware(request: NextRequest) {
  // ... nonce and CSP setup ...

  const response = NextResponse.next({ request: { headers } });

  // Content Security Policy
  response.headers.set('content-security-policy', csp);

  // X-Content-Type-Options: prevent MIME-type sniffing
  response.headers.set('x-content-type-options', 'nosniff');

  // X-Frame-Options: prevent clickjacking
  response.headers.set('x-frame-options', 'DENY');

  // X-XSS-Protection: enable XSS filter
  response.headers.set('x-xss-protection', '1; mode=block');

  // Referrer-Policy: control referrer leakage
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy: disable unused APIs
  response.headers.set('permissions-policy', permissionsPolicy);

  // HSTS: force HTTPS (production only)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  return response;
}
```

**Key Points**:
- Every response passes through middleware
- Headers are set once per request
- No performance impact (minimal header encoding)
- Headers apply to all routes (images, APIs, pages)

---

## Testing

### Manual Testing

```bash
# Test against local/staging environment
curl -I http://localhost:3000 | grep -E "(Content-Security|X-Frame|X-Content|X-XSS|Referrer|Permissions|Strict-Transport)"

# Expected output (excerpt):
# Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...'
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# X-XSS-Protection: 1; mode=block
# Referrer-Policy: strict-origin-when-cross-origin
# Permissions-Policy: accelerometer=(), camera=(), ...
```

### Browser DevTools

1. **Chrome DevTools**: Network tab → Click request → Headers section
2. **Firefox DevTools**: Network tab → Response Headers
3. **Safari**: Develop → Show Web Inspector → Network tab

### Online Testing Tools

- **OWASP Header Checker**: https://owasp.org/www-project-secure-headers/
- **SecurityHeaders.com**: https://securityheaders.com (auto-scan any domain)
- **Mozilla Observatory**: https://observatory.mozilla.org

### Unit Tests

See `tests/security/` for:
- CSP compliance tests
- Header presence verification
- SQL injection tests (related to security posture)

### CSP Violation Reporting (Optional Future)

To collect CSP violations, add:

```typescript
// In middleware.ts
response.headers.set(
  'content-security-policy',
  csp + `; report-uri /api/csp-violation`
);
```

Then handle POST `/api/csp-violation` to log violations. Useful for:
- Detecting XSS attempts
- Finding third-party scripts that violate CSP
- Monitoring security posture over time

---

## OWASP References

1. **OWASP Secure Headers Project**: https://owasp.org/www-project-secure-headers/
2. **OWASP CSP Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
3. **OWASP Clickjacking Defense**: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-03 | Initial documentation of all security headers |

---

**Document Owner**: Security Team  
**Last Review**: 2026-08-03  
**Next Review Due**: 2026-11-03 (Quarterly)
