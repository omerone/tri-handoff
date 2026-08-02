/**
 * Production-grade rate limiting configuration
 *
 * All rate limits are defined in one place for easy auditing and tuning.
 * Environment overrides are supported via RATE_LIMIT_* env vars.
 *
 * OWASP Reference: A07:2021 Identification and Authentication Failures
 * https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
 */

export interface RateLimitRule {
  limit: number;
  windowMs: number;
  description: string;
}

export const RATE_LIMITS = {
  // Global: 100 requests per minute per IP
  // Purpose: Prevent general brute force and DoS attacks
  global: {
    limit: parseInt(process.env.RATE_LIMIT_GLOBAL || '100'),
    windowMs: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW || `${60 * 1000}`),
    description: 'Global rate limit per IP to prevent DoS attacks',
  } as RateLimitRule,

  // Authentication: Login attempts
  // Purpose: Prevent credential stuffing and brute force password attacks
  auth: {
    login: {
      limit: parseInt(process.env.RATE_LIMIT_AUTH_LOGIN || '5'),
      windowMs: parseInt(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW || `${15 * 60 * 1000}`),
      description: 'Login attempts: 5 per 15 minutes to prevent brute force attacks',
    } as RateLimitRule,

    // Password reset attempts
    // Purpose: Prevent account takeover via reset link enumeration
    passwordReset: {
      limit: parseInt(process.env.RATE_LIMIT_AUTH_RESET || '3'),
      windowMs: parseInt(process.env.RATE_LIMIT_AUTH_RESET_WINDOW || `${60 * 60 * 1000}`),
      description: 'Password reset attempts: 3 per hour to prevent account enumeration',
    } as RateLimitRule,

    // Signup attempts
    // Purpose: Prevent bulk account registration attacks
    signup: {
      limit: parseInt(process.env.RATE_LIMIT_AUTH_SIGNUP || '2'),
      windowMs: parseInt(process.env.RATE_LIMIT_AUTH_SIGNUP_WINDOW || `${60 * 60 * 1000}`),
      description: 'Signup attempts: 2 per hour to prevent bulk registration',
    } as RateLimitRule,

    // Email verification attempts
    // Purpose: Prevent email bombing and verification spam
    emailVerification: {
      limit: parseInt(process.env.RATE_LIMIT_EMAIL_VERIFY || '5'),
      windowMs: parseInt(process.env.RATE_LIMIT_EMAIL_VERIFY_WINDOW || `${60 * 60 * 1000}`),
      description: 'Email verification attempts: 5 per hour',
    } as RateLimitRule,

    // Password change attempts
    // Purpose: Prevent account compromise via rapid password changes
    passwordChange: {
      limit: parseInt(process.env.RATE_LIMIT_PASSWORD_CHANGE || '3'),
      windowMs: parseInt(process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW || `${60 * 60 * 1000}`),
      description: 'Password change attempts: 3 per hour',
    } as RateLimitRule,
  },

  // MT5 Connection Management
  // Purpose: Prevent connection/disconnection spam and resource exhaustion
  mt5: {
    connect: {
      limit: parseInt(process.env.RATE_LIMIT_MT5_CONNECT || '5'),
      windowMs: parseInt(process.env.RATE_LIMIT_MT5_CONNECT_WINDOW || `${30 * 60 * 1000}`),
      description: 'MT5 connection attempts: 5 per 30 minutes',
    } as RateLimitRule,

    disconnect: {
      limit: parseInt(process.env.RATE_LIMIT_MT5_DISCONNECT || '3'),
      windowMs: parseInt(process.env.RATE_LIMIT_MT5_DISCONNECT_WINDOW || `${60 * 60 * 1000}`),
      description: 'MT5 disconnection attempts: 3 per hour',
    } as RateLimitRule,
  },

  // Data Export and Account Actions
  // Purpose: Prevent bulk data extraction and account deletion spam
  account: {
    dataExport: {
      limit: parseInt(process.env.RATE_LIMIT_DATA_EXPORT || '1'),
      windowMs: parseInt(process.env.RATE_LIMIT_DATA_EXPORT_WINDOW || `${24 * 60 * 60 * 1000}`),
      description: 'Data export: 1 per day per user (GDPR compliance)',
    } as RateLimitRule,

    // Account deletion is heavily rate limited as it's a destructive operation
    delete: {
      limit: parseInt(process.env.RATE_LIMIT_ACCOUNT_DELETE || '1'),
      windowMs: parseInt(process.env.RATE_LIMIT_ACCOUNT_DELETE_WINDOW || `${48 * 60 * 60 * 1000}`),
      description: 'Account deletion: 1 per 48 hours (security measure)',
    } as RateLimitRule,
  },

  // File Upload
  // Purpose: Prevent storage exhaustion and upload bombing
  upload: {
    requestsPerMinute: {
      limit: parseInt(process.env.RATE_LIMIT_UPLOAD_REQUESTS || '10'),
      windowMs: 60 * 1000,
      description: 'Upload requests: 10 per minute per user',
    } as RateLimitRule,

    bytesPerDay: {
      limit: parseInt(process.env.RATE_LIMIT_UPLOAD_BYTES || `${5 * 1024 * 1024 * 1024}`), // 5GB
      windowMs: 24 * 60 * 60 * 1000,
      description: 'Upload storage: 5GB per day per user',
    } as RateLimitRule,
  },

  // API Endpoints
  // Purpose: Protect API from resource exhaustion
  api: {
    trades: {
      limit: parseInt(process.env.RATE_LIMIT_API_TRADES || '50'),
      windowMs: parseInt(process.env.RATE_LIMIT_API_TRADES_WINDOW || `${60 * 1000}`),
      description: 'Trades API: 50 requests per minute per user',
    } as RateLimitRule,

    settings: {
      limit: parseInt(process.env.RATE_LIMIT_API_SETTINGS || '20'),
      windowMs: parseInt(process.env.RATE_LIMIT_API_SETTINGS_WINDOW || `${60 * 1000}`),
      description: 'Settings API: 20 requests per minute per user',
    } as RateLimitRule,
  },

  // Admin Actions
  // Purpose: Prevent misuse of administrative functions
  admin: {
    actions: {
      limit: parseInt(process.env.RATE_LIMIT_ADMIN_ACTIONS || '100'),
      windowMs: parseInt(process.env.RATE_LIMIT_ADMIN_ACTIONS_WINDOW || `${60 * 1000}`),
      description: 'Admin actions: 100 per minute per admin user',
    } as RateLimitRule,
  },

  // Exponential backoff configuration
  // Purpose: Increase cost of attacking after repeated violations
  backoff: {
    enabled: process.env.RATE_LIMIT_BACKOFF_ENABLED !== 'false',
    multiplier: parseInt(process.env.RATE_LIMIT_BACKOFF_MULTIPLIER || '2'),
    maxDelay: parseInt(process.env.RATE_LIMIT_BACKOFF_MAX_DELAY || `${60 * 60 * 1000}`), // 1 hour
  },

  // Redis configuration
  // Purpose: Distributed rate limiting across multiple instances
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'ratelimit:',
    // Fallback to in-memory if Redis unavailable
    fallbackEnabled: process.env.RATE_LIMIT_FALLBACK_ENABLED !== 'false',
  },
} as const;

export type RateLimitConfig = typeof RATE_LIMITS;
