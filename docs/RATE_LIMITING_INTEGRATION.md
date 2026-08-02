# Rate Limiting Integration Guide

This guide shows how to integrate the rate limiting system into your API routes and server actions.

## Server Actions (Recommended for Forms)

For authentication forms using server actions, rate limiting is handled in the action itself:

### Example: Login Action

```typescript
// src/app/(auth)/actions.ts
'use server';

import { getTranslations } from 'next-intl/server';
import { clientIp, limitKey, LIMITS } from '@/lib/auth/limits';
import { consumeRateLimit } from '@/lib/db';
import { resolveTenant } from '@/lib/tenant/resolve';

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('auth');
  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return { error: t('invalidCredentials') };

  // ... form parsing ...

  const tenant = tenantLookup.tenant;
  const ip = await clientIp();

  // Check rate limits
  const perAccount = await consumeRateLimit(
    limitKey('login', tenant.id, email),
    LIMITS.loginPerAccount.limit,
    LIMITS.loginPerAccount.windowMs,
  );
  const perIp = await consumeRateLimit(
    limitKey('login-ip', tenant.id, ip),
    LIMITS.loginPerIp.limit,
    LIMITS.loginPerIp.windowMs,
  );

  if (!perAccount.allowed || !perIp.allowed) {
    const waitMs = Math.max(perAccount.retryAfterMs, perIp.retryAfterMs);
    return { error: t('tooManyAttempts', { minutes: Math.max(1, Math.ceil(waitMs / 60_000)) }) };
  }

  // ... perform authentication ...
}
```

## API Routes with Route Limiters

For API endpoints, use the route-specific limiters:

### Example: Login API Route

```typescript
// src/app/api/auth/signin/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitAuth } from '@/middleware/route-limiters';

export async function POST(request: NextRequest) {
  // 1. Check rate limit
  const rateLimitOptions = await rateLimitAuth(email);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // 2. Parse request
  const body = await request.json();
  const { email, password } = body;

  // 3. Authenticate user
  try {
    // ... your auth logic ...
    const user = await authenticateUser(email, password);

    // 4. Return success with rate limit headers
    return NextResponse.json(
      { success: true, user },
      {
        headers: rateLimitResult.headers,
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid credentials' },
      {
        status: 401,
        headers: rateLimitResult.headers,
      }
    );
  }
}
```

### Example: Password Reset API Route

```typescript
// src/app/api/auth/reset-password/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitAuthReset } from '@/middleware/route-limiters';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email } = body;

  // Check rate limit (per email, not per IP)
  const rateLimitOptions = await rateLimitAuthReset(email);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Send reset email (even if user doesn't exist - avoid enumeration)
  // ... your reset logic ...

  return NextResponse.json(
    { message: 'Reset link sent' },
    {
      headers: rateLimitResult.headers,
    }
  );
}
```

### Example: Signup API Route

```typescript
// src/app/api/auth/signup/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitSignup } from '@/middleware/route-limiters';

export async function POST(request: NextRequest) {
  // Check rate limit (per IP, not per email)
  const rateLimitOptions = await rateLimitSignup();
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  const body = await request.json();
  const { email, password } = body;

  // ... create user ...

  return NextResponse.json(
    { success: true },
    {
      headers: rateLimitResult.headers,
    }
  );
}
```

## MT5 Connection Routes

### Example: MT5 Connect

```typescript
// src/app/api/mt5/connect/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitMt5Connect } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function POST(request: NextRequest) {
  // Ensure user is authenticated
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check rate limit (per user)
  const rateLimitOptions = await rateLimitMt5Connect(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  const body = await request.json();
  const { brokerServer, login, password } = body;

  // Log connection attempt
  await auditLogSensitiveOperation('MT5_CONNECT', auth.userId, {
    brokerServer,
    login,
  });

  // Connect to MT5
  try {
    const connection = await connectToMt5(brokerServer, login, password);

    return NextResponse.json(
      { success: true, connection },
      {
        headers: rateLimitResult.headers,
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Connection failed' },
      {
        status: 400,
        headers: rateLimitResult.headers,
      }
    );
  }
}
```

### Example: MT5 Disconnect

```typescript
// src/app/api/mt5/disconnect/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitMt5Disconnect } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitOptions = await rateLimitMt5Disconnect(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Disconnect from MT5
  try {
    await disconnectFromMt5(auth.userId);

    return NextResponse.json(
      { success: true },
      {
        headers: rateLimitResult.headers,
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Disconnection failed' },
      {
        status: 400,
        headers: rateLimitResult.headers,
      }
    );
  }
}
```

## Data Export Route

### Example: Export User Data (GDPR)

```typescript
// src/app/api/user/export/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitDataExport } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check rate limit (1 per day)
  const rateLimitOptions = await rateLimitDataExport(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Require password confirmation for sensitive operation
  const body = await request.json();
  if (!body.password) {
    return NextResponse.json(
      { error: 'Password required' },
      {
        status: 403,
        headers: rateLimitResult.headers,
      }
    );
  }

  const isValid = await verifyPassword(auth.userId, body.password);
  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid password' },
      {
        status: 403,
        headers: rateLimitResult.headers,
      }
    );
  }

  // Audit log
  await auditLogSensitiveOperation('DATA_EXPORT', auth.userId);

  // Generate export
  const data = await generateUserDataExport(auth.userId);
  const csv = convertToCSV(data);

  return new NextResponse(csv, {
    headers: {
      ...rateLimitResult.headers,
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="user-data.csv"',
    },
  });
}
```

## Account Deletion Route

### Example: Delete Account

```typescript
// src/app/api/user/delete/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitAccountDelete } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check rate limit (1 per 48 hours)
  const rateLimitOptions = await rateLimitAccountDelete(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Require password confirmation
  const body = await request.json();
  if (!body.password) {
    return NextResponse.json(
      { error: 'Password required' },
      {
        status: 403,
        headers: rateLimitResult.headers,
      }
    );
  }

  const isValid = await verifyPassword(auth.userId, body.password);
  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid password' },
      {
        status: 403,
        headers: rateLimitResult.headers,
      }
    );
  }

  // Audit log (critical operation)
  await auditLogSensitiveOperation('ACCOUNT_DELETE', auth.userId, {
    email: auth.email,
    timestamp: new Date().toISOString(),
  });

  // Delete account (with grace period)
  await scheduleAccountDeletion(auth.userId, {
    gracePeriodDays: 30,
    reason: 'User requested',
  });

  return NextResponse.json(
    { message: 'Account scheduled for deletion' },
    {
      headers: rateLimitResult.headers,
    }
  );
}
```

## Upload Route

### Example: File Upload

```typescript
// src/app/api/upload/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitUploadRequests } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check rate limit (10 per minute)
  const rateLimitOptions = await rateLimitUploadRequests(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Parse form data
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json(
      { error: 'No file provided' },
      {
        status: 400,
        headers: rateLimitResult.headers,
      }
    );
  }

  // Validate file size
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: 'File too large' },
      {
        status: 413,
        headers: rateLimitResult.headers,
      }
    );
  }

  // Upload file
  try {
    const url = await uploadFile(auth.userId, file);

    return NextResponse.json(
      { success: true, url },
      {
        headers: rateLimitResult.headers,
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Upload failed' },
      {
        status: 500,
        headers: rateLimitResult.headers,
      }
    );
  }
}
```

## API Endpoints

### Example: Trades API

```typescript
// src/app/api/trades/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitApiTrades } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check rate limit (50 per minute)
  const rateLimitOptions = await rateLimitApiTrades(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Fetch trades
  const trades = await getTrades(auth.userId);

  return NextResponse.json(trades, {
    headers: rateLimitResult.headers,
  });
}
```

### Example: Settings API

```typescript
// src/app/api/settings/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitApiSettings } from '@/middleware/route-limiters';
import { requireAuth } from '@/middleware/auth';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitOptions = await rateLimitApiSettings(auth.userId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  const settings = await getSettings(auth.userId);

  return NextResponse.json(settings, {
    headers: rateLimitResult.headers,
  });
}
```

## Admin Routes

### Example: Admin Action

```typescript
// src/app/api/admin/users/route.ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitMiddleware, rateLimitAdminActions } from '@/middleware/route-limiters';
import { requireAdmin } from '@/middleware/auth';

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitOptions = await rateLimitAdminActions(admin.adminId);
  const rateLimitResult = await checkRateLimitMiddleware(rateLimitOptions);

  if (rateLimitResult.error) {
    return new NextResponse(rateLimitResult.body, {
      status: rateLimitResult.status,
      headers: rateLimitResult.headers,
    });
  }

  // Perform admin action
  // ...

  return NextResponse.json(
    { success: true },
    {
      headers: rateLimitResult.headers,
    }
  );
}
```

## Client-Side Handling

Handle rate limit errors gracefully on the client:

```typescript
// Example: React component
async function handleLogin(email: string, password: string) {
  try {
    const response = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const data = await response.json();

      setError(
        `Too many attempts. Please try again in ${retryAfter} seconds.\n${data.message}`
      );

      // Disable login button and show countdown
      setDisabled(true);
      setTimeout(() => setDisabled(false), parseInt(retryAfter) * 1000);

      return;
    }

    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Login failed');
      return;
    }

    const data = await response.json();
    // Handle successful login
  } catch (error) {
    setError('Network error. Please try again.');
  }
}
```

## Best Practices

1. **Always include rate limit headers** in responses
2. **Require password confirmation** for sensitive operations
3. **Audit log** all rate limit violations
4. **Handle 429 gracefully** on the client
5. **Display retry time** to users
6. **Test rate limits** in dev/staging before production
7. **Monitor rate limit metrics** in production
8. **Adjust limits** based on usage patterns
