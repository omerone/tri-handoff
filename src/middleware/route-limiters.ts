/**
 * Route-specific rate limiter middleware
 *
 * Pre-configured middleware for common routes and actions.
 * Each function handles both IP-based and user-based limiting.
 */

import 'server-only';
import { headers } from 'next/headers';
import { RATE_LIMITS } from '@/config/rate-limits';
import {
  checkAndAuditRateLimit,
  createRateLimitResponse,
  type RateLimitOptions,
} from './rate-limiter';

/**
 * Get client IP from request headers
 */
async function getClientIP(): Promise<string> {
  const headersList = await headers();

  const realIP = headersList.get('x-real-ip')?.trim();
  if (realIP) return realIP;

  const forwardedFor = headersList.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;

  return 'unknown';
}

/**
 * Get user ID from auth context (if available)
 */
async function getUserID(): Promise<string | undefined> {
  const headersList = await headers();
  // This would be populated by auth middleware
  return headersList.get('x-user-id') || undefined;
}

/**
 * Auth: Login attempts - 5 per 15 minutes per IP
 */
export async function rateLimitAuth(email?: string) {
  const ip = await getClientIP();
  const key = `auth:login:${ip}${email ? `:${email}` : ''}`;

  return {
    key,
    limit: RATE_LIMITS.auth.login.limit,
    windowMs: RATE_LIMITS.auth.login.windowMs,
    description: RATE_LIMITS.auth.login.description,
  };
}

/**
 * Auth: Password reset - 3 per hour per email
 */
export async function rateLimitAuthReset(email: string) {
  const key = `auth:reset:${email}`;

  return {
    key,
    limit: RATE_LIMITS.auth.passwordReset.limit,
    windowMs: RATE_LIMITS.auth.passwordReset.windowMs,
    description: RATE_LIMITS.auth.passwordReset.description,
  };
}

/**
 * Auth: Signup - 2 per hour per IP
 */
export async function rateLimitSignup() {
  const ip = await getClientIP();
  const key = `auth:signup:${ip}`;

  return {
    key,
    limit: RATE_LIMITS.auth.signup.limit,
    windowMs: RATE_LIMITS.auth.signup.windowMs,
    description: RATE_LIMITS.auth.signup.description,
  };
}

/**
 * Auth: Email verification - 5 per hour per email
 */
export async function rateLimitEmailVerification(email: string) {
  const key = `auth:email-verify:${email}`;

  return {
    key,
    limit: RATE_LIMITS.auth.emailVerification.limit,
    windowMs: RATE_LIMITS.auth.emailVerification.windowMs,
    description: RATE_LIMITS.auth.emailVerification.description,
  };
}

/**
 * Auth: Password change - 3 per hour per user
 */
export async function rateLimitPasswordChange(userId: string) {
  const key = `auth:password-change:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.auth.passwordChange.limit,
    windowMs: RATE_LIMITS.auth.passwordChange.windowMs,
    description: RATE_LIMITS.auth.passwordChange.description,
  };
}

/**
 * MT5: Connect - 5 per 30 minutes per user
 */
export async function rateLimitMt5Connect(userId: string) {
  const key = `mt5:connect:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.mt5.connect.limit,
    windowMs: RATE_LIMITS.mt5.connect.windowMs,
    description: RATE_LIMITS.mt5.connect.description,
  };
}

/**
 * MT5: Disconnect - 3 per hour per user
 */
export async function rateLimitMt5Disconnect(userId: string) {
  const key = `mt5:disconnect:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.mt5.disconnect.limit,
    windowMs: RATE_LIMITS.mt5.disconnect.windowMs,
    description: RATE_LIMITS.mt5.disconnect.description,
  };
}

/**
 * Data export - 1 per day per user
 */
export async function rateLimitDataExport(userId: string) {
  const key = `account:export:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.account.dataExport.limit,
    windowMs: RATE_LIMITS.account.dataExport.windowMs,
    description: RATE_LIMITS.account.dataExport.description,
  };
}

/**
 * Account deletion - 1 per 48 hours per user
 */
export async function rateLimitAccountDelete(userId: string) {
  const key = `account:delete:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.account.delete.limit,
    windowMs: RATE_LIMITS.account.delete.windowMs,
    description: RATE_LIMITS.account.delete.description,
  };
}

/**
 * File upload - 10 per minute per user
 */
export async function rateLimitUploadRequests(userId: string) {
  const key = `upload:requests:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.upload.requestsPerMinute.limit,
    windowMs: RATE_LIMITS.upload.requestsPerMinute.windowMs,
    description: RATE_LIMITS.upload.requestsPerMinute.description,
  };
}

/**
 * API: Trades endpoint - 50 per minute per user
 */
export async function rateLimitApiTrades(userId: string) {
  const key = `api:trades:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.api.trades.limit,
    windowMs: RATE_LIMITS.api.trades.windowMs,
    description: RATE_LIMITS.api.trades.description,
  };
}

/**
 * API: Settings endpoint - 20 per minute per user
 */
export async function rateLimitApiSettings(userId: string) {
  const key = `api:settings:${userId}`;

  return {
    key,
    limit: RATE_LIMITS.api.settings.limit,
    windowMs: RATE_LIMITS.api.settings.windowMs,
    description: RATE_LIMITS.api.settings.description,
  };
}

/**
 * Admin actions - 100 per minute per admin
 */
export async function rateLimitAdminActions(adminId: string) {
  const key = `admin:actions:${adminId}`;

  return {
    key,
    limit: RATE_LIMITS.admin.actions.limit,
    windowMs: RATE_LIMITS.admin.actions.windowMs,
    description: RATE_LIMITS.admin.actions.description,
  };
}

/**
 * Global rate limit - 100 per minute per IP
 */
export async function rateLimitGlobal() {
  const ip = await getClientIP();
  const key = `global:${ip}`;

  return {
    key,
    limit: RATE_LIMITS.global.limit,
    windowMs: RATE_LIMITS.global.windowMs,
    description: RATE_LIMITS.global.description,
  };
}

/**
 * Middleware factory: checks rate limit and returns error response if exceeded
 * Usage: const options = await rateLimitAuth(); const result = await checkRateLimitMiddleware(options);
 */
export async function checkRateLimitMiddleware(options: RateLimitOptions) {
  const ip = await getClientIP();
  const userId = await getUserID();

  const result = await checkAndAuditRateLimit(options, {
    userId,
    ip,
  });

  if (!result.allowed) {
    const errorResponse = createRateLimitResponse(result, options.description);
    return {
      error: true,
      status: errorResponse.status,
      body: errorResponse.body,
      headers: errorResponse.headers,
    };
  }

  return {
    error: false,
    headers: {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.ceil((Date.now() + result.resetAfterSeconds * 1000) / 1000)),
    },
  };
}
