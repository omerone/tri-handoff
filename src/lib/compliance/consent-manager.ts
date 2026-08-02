/**
 * Consent Management System for GDPR Compliance
 *
 * Manages user consent for:
 * - GDPR data processing consent
 * - Marketing communication consent
 * - Analytics consent (Google Analytics, etc.)
 * - Cookie consent (essential, analytics, preferences)
 * - Terms of Service acceptance
 * - Privacy Policy acceptance
 *
 * All consent changes are audit-logged for compliance.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Consent types
 */
export type ConsentType =
  | 'gdpr_processing'
  | 'marketing_email'
  | 'analytics_cookies'
  | 'preference_cookies'
  | 'essential_cookies'
  | 'terms_of_service'
  | 'privacy_policy';

/**
 * Consent record
 */
export interface ConsentRecord {
  id: string;
  userId: string;
  type: ConsentType;
  granted: boolean;
  grantedAt: Date;
  expiresAt?: Date | null;
  ipAddress?: string;
  userAgent?: string;
  source: 'banner' | 'settings' | 'implicit' | 'api';
  notes?: string;
}

/**
 * User consent status
 */
export interface UserConsentStatus {
  userId: string;
  gdprProcessing: boolean;
  marketingEmail: boolean;
  analyticsCookies: boolean;
  preferenceCookies: boolean;
  essentialCookies: boolean; // Always true (required)
  termsOfService: boolean;
  privacyPolicy: boolean;
  lastUpdated: Date;
}

/**
 * Grant user consent for a specific type
 *
 * @param userId - User ID
 * @param type - Consent type
 * @param granted - Whether consent is granted
 * @param source - Where the consent came from (banner, settings, etc.)
 * @param metadata - Optional metadata (IP, user agent)
 */
export async function grantConsent(
  userId: string,
  type: ConsentType,
  granted: boolean,
  source: 'banner' | 'settings' | 'implicit' | 'api' = 'api',
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    notes?: string;
  }
): Promise<ConsentRecord> {
  // Essential cookies cannot be rejected
  if (type === 'essential_cookies' && !granted) {
    throw new Error('Essential cookies consent cannot be revoked');
  }

  // Calculate expiration (1 year from now)
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // Create consent record
  const consent = await (prisma as any).userConsent.create({
    data: {
      userId,
      type,
      granted,
      source,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      notes: metadata?.notes,
      grantedAt: new Date(),
      expiresAt,
    },
  });

  // Log consent change for audit trail
  await logConsentChange(userId, type, granted, source, metadata?.ipAddress);

  return consent as ConsentRecord;
}

/**
 * Get current consent status for a user
 *
 * @param userId - User ID
 */
export async function getUserConsentStatus(
  userId: string
): Promise<UserConsentStatus> {
  // Get latest consent for each type
  const consents = await (prisma as any).userConsent.findMany({
    where: { userId },
    distinct: ['type'],
    orderBy: { grantedAt: 'desc' },
  });

  // Build status object
  const status: UserConsentStatus = {
    userId,
    gdprProcessing: false,
    marketingEmail: false,
    analyticsCookies: false,
    preferenceCookies: false,
    essentialCookies: true, // Always required
    termsOfService: false,
    privacyPolicy: false,
    lastUpdated: new Date(),
  };

  // Map consents to status
  for (const consent of consents) {
    if (consent.granted) {
      switch (consent.type) {
        case 'gdpr_processing':
          status.gdprProcessing = true;
          break;
        case 'marketing_email':
          status.marketingEmail = true;
          break;
        case 'analytics_cookies':
          status.analyticsCookies = true;
          break;
        case 'preference_cookies':
          status.preferenceCookies = true;
          break;
        case 'terms_of_service':
          status.termsOfService = true;
          break;
        case 'privacy_policy':
          status.privacyPolicy = true;
          break;
      }
      if (consent.grantedAt > status.lastUpdated) {
        status.lastUpdated = consent.grantedAt;
      }
    }
  }

  return status;
}

/**
 * Check if user has granted consent for a specific type
 *
 * @param userId - User ID
 * @param type - Consent type
 */
export async function hasConsent(
  userId: string,
  type: ConsentType
): Promise<boolean> {
  // Essential cookies are always required
  if (type === 'essential_cookies') {
    return true;
  }

  const consent = await (prisma as any).userConsent.findFirst({
    where: { userId, type },
    orderBy: { grantedAt: 'desc' },
  });

  return consent?.granted ?? false;
}

/**
 * Revoke consent for a specific type
 *
 * @param userId - User ID
 * @param type - Consent type
 * @param source - Where the revocation came from
 * @param reason - Optional reason for revocation
 */
export async function revokeConsent(
  userId: string,
  type: ConsentType,
  source: 'settings' | 'api' | 'deletion' = 'api',
  reason?: string
): Promise<ConsentRecord> {
  // Essential cookies cannot be revoked
  if (type === 'essential_cookies') {
    throw new Error('Essential cookies consent cannot be revoked');
  }

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // Create revocation record
  const consent = await (prisma as any).userConsent.create({
    data: {
      userId,
      type,
      granted: false,
      source,
      grantedAt: new Date(),
      expiresAt,
      notes: reason || `Consent revoked via ${source}`,
    },
  });

  // Log revocation for audit trail
  await logConsentChange(userId, type, false, source);

  return consent as ConsentRecord;
}

/**
 * Get all consent records for a user (for export)
 *
 * @param userId - User ID
 */
export async function getUserConsentHistory(
  userId: string
): Promise<ConsentRecord[]> {
  const consents = await (prisma as any).userConsent.findMany({
    where: { userId },
    orderBy: { grantedAt: 'desc' },
  });

  return consents as ConsentRecord[];
}

/**
 * Export all consent records in GDPR-compliant format
 *
 * @param userId - User ID
 */
export async function exportUserConsents(
  userId: string
): Promise<Record<string, unknown>> {
  const history = await getUserConsentHistory(userId);
  const status = await getUserConsentStatus(userId);

  return {
    userId,
    currentStatus: status,
    consentHistory: history,
    exportedAt: new Date().toISOString(),
    exportFormat: 'GDPR Article 20 Portable Format',
  };
}

/**
 * Accept Terms of Service
 *
 * @param userId - User ID
 * @param version - Version of ToS accepted
 * @param ipAddress - Optional IP address
 */
export async function acceptTermsOfService(
  userId: string,
  version: string,
  ipAddress?: string
): Promise<void> {
  await grantConsent(userId, 'terms_of_service', true, 'settings', {
    ipAddress,
    notes: `Accepted version ${version}`,
  });
}

/**
 * Accept Privacy Policy
 *
 * @param userId - User ID
 * @param version - Version of privacy policy accepted
 * @param ipAddress - Optional IP address
 */
export async function acceptPrivacyPolicy(
  userId: string,
  version: string,
  ipAddress?: string
): Promise<void> {
  await grantConsent(userId, 'privacy_policy', true, 'settings', {
    ipAddress,
    notes: `Accepted version ${version}`,
  });
}

/**
 * Handle cookie banner consent (batch operation)
 *
 * @param userId - User ID
 * @param choices - Cookie choices
 * @param ipAddress - User's IP address
 */
export async function saveCookieConsent(
  userId: string,
  choices: {
    analytics?: boolean;
    preferences?: boolean;
  },
  ipAddress?: string
): Promise<void> {
  // Essential cookies are always granted (implicit)
  await grantConsent(userId, 'essential_cookies', true, 'banner', {
    ipAddress,
    notes: 'Essential cookies (always required)',
  });

  // Analytics cookies (optional)
  if (choices.analytics !== undefined) {
    await grantConsent(userId, 'analytics_cookies', choices.analytics, 'banner', {
      ipAddress,
    });
  }

  // Preference cookies (optional)
  if (choices.preferences !== undefined) {
    await grantConsent(userId, 'preference_cookies', choices.preferences, 'banner', {
      ipAddress,
    });
  }
}

/**
 * Delete all consent records for a user (on account deletion)
 *
 * @param userId - User ID
 */
export async function deleteUserConsents(userId: string): Promise<number> {
  const result = await (prisma as any).userConsent.deleteMany({
    where: { userId },
  });

  // Log deletion for audit trail
  await logConsentChange(userId, 'all', false, 'deletion');

  return result.count;
}

/**
 * Audit log consent changes (internal logging)
 *
 * Used for compliance tracking and investigation.
 */
async function logConsentChange(
  userId: string,
  type: string,
  granted: boolean,
  source: string,
  ipAddress?: string
): Promise<void> {
  try {
    // Log to security/audit logs (implement based on your logging system)
    console.log(`[COMPLIANCE] Consent change for user ${userId}:`, {
      type,
      granted,
      source,
      timestamp: new Date().toISOString(),
      ipAddress: ipAddress || 'unknown',
    });

    // TODO: Send to your audit logging system
    // await auditLogger.log({
    //   event: 'consent_change',
    //   userId,
    //   type,
    //   granted,
    //   source,
    //   ipAddress,
    //   timestamp: new Date(),
    // });
  } catch (error) {
    console.error('Failed to log consent change:', error);
    // Continue anyway - don't break the flow
  }
}

/**
 * Check if user has accepted required consents
 *
 * @param userId - User ID
 */
export async function hasAcceptedRequiredConsents(
  userId: string
): Promise<boolean> {
  const status = await getUserConsentStatus(userId);

  // Required consents: ToS and Privacy Policy
  return status.termsOfService && status.privacyPolicy;
}

/**
 * Get consent statistics for compliance reporting
 *
 * @param dateFrom - Start date for statistics
 * @param dateTo - End date for statistics
 */
export async function getConsentStatistics(
  dateFrom: Date,
  dateTo: Date
): Promise<Record<string, number>> {
  const consents = await (prisma as any).userConsent.findMany({
    where: {
      grantedAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
  });

  const stats: Record<string, number> = {
    totalConsents: consents.length,
    uniqueUsers: new Set(consents.map((c: ConsentRecord) => c.userId)).size,
    gdprProcessing: consents.filter((c: ConsentRecord) => c.type === 'gdpr_processing' && c.granted)
      .length,
    marketingEmail: consents.filter((c: ConsentRecord) => c.type === 'marketing_email' && c.granted)
      .length,
    analyticsCookies: consents.filter(
      (c: ConsentRecord) => c.type === 'analytics_cookies' && c.granted
    ).length,
    preferenceCookies: consents.filter(
      (c: ConsentRecord) => c.type === 'preference_cookies' && c.granted
    ).length,
    termsOfService: consents.filter((c: ConsentRecord) => c.type === 'terms_of_service' && c.granted)
      .length,
    privacyPolicy: consents.filter((c: ConsentRecord) => c.type === 'privacy_policy' && c.granted)
      .length,
  };

  return stats;
}

export default {
  grantConsent,
  getUserConsentStatus,
  hasConsent,
  revokeConsent,
  getUserConsentHistory,
  exportUserConsents,
  acceptTermsOfService,
  acceptPrivacyPolicy,
  saveCookieConsent,
  deleteUserConsents,
  hasAcceptedRequiredConsents,
  getConsentStatistics,
};
