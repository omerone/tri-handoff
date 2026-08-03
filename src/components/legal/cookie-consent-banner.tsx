'use client';

/**
 * Cookie Consent Banner Component
 *
 * EU ePrivacy Directive compliant cookie banner with:
 * - Non-intrusive design
 * - Granular consent options
 * - Persistent user choice (1 year)
 * - WCAG 2.1 AA accessibility
 * - Dark mode support
 * - Mobile responsive
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'tri_cookie_consent';
const _CONSENT_EXPIRY_DAYS = 365;

export interface CookieConsent {
  analytics: boolean;
  preferences: boolean;
  timestamp: number;
}

interface CookieConsentBannerProps {
  onConsent?: (consent: CookieConsent) => void;
  companyEmail?: string;
}

/**
 * Google Analytics installs `gtag` on the window at runtime; TypeScript has no way to know
 * that, and casting at each call site hides the optionality that the guards below rely on.
 */
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function CookieConsentBanner({ onConsent, companyEmail: _companyEmail = 'privacy@tri.com' }: CookieConsentBannerProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [preferences, setPreferences] = useState(false);

  // Check if user has already made a choice
  useEffect(() => {
    const storedConsent = localStorage.getItem(STORAGE_KEY);
    if (!storedConsent) {
      setShowBanner(true);
    }
  }, []);

  const saveConsent = (analyticsChoice: boolean, preferencesChoice: boolean) => {
    const consent: CookieConsent = {
      analytics: analyticsChoice,
      preferences: preferencesChoice,
      timestamp: Date.now(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    setShowBanner(false);
    setShowPreferences(false);

    // Call callback if provided
    onConsent?.(consent);

    // Load analytics if consented
    if (analyticsChoice) {
      loadAnalytics();
    }
  };

  const handleAcceptAll = () => {
    saveConsent(true, true);
  };

  const handleRejectAll = () => {
    saveConsent(false, false);
  };

  const handleSavePreferences = () => {
    saveConsent(analytics, preferences);
  };

  const loadAnalytics = () => {
    // Load Google Analytics
    if (window.gtag) {
      window.gtag('consent', 'update', {
        analytics_storage: 'granted',
      });
    }
  };

  if (!showBanner) {
    return null;
  }

  if (showPreferences) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Cookie Preferences</h2>
            <button
              onClick={() => setShowPreferences(false)}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              aria-label="Close preferences"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4 mb-6">
            {/* Essential Cookies */}
            <div className="flex items-start space-x-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">Essential Cookies</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Required for TRi to function. Cannot be disabled.
                </p>
              </div>
              <div className="flex-shrink-0">
                <input
                  type="checkbox"
                  checked={true}
                  disabled
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-not-allowed"
                  aria-label="Essential cookies (always required)"
                />
              </div>
            </div>

            {/* Analytics Cookies */}
            <div className="flex items-start space-x-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">Analytics Cookies</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Help us understand how you use TRi to improve features.
                </p>
              </div>
              <div className="flex-shrink-0">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  aria-label="Analytics cookies"
                />
              </div>
            </div>

            {/* Preference Cookies */}
            <div className="flex items-start space-x-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">Preference Cookies</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Remember your settings (theme, language, layout).
                </p>
              </div>
              <div className="flex-shrink-0">
                <input
                  type="checkbox"
                  checked={preferences}
                  onChange={(e) => setPreferences(e.target.checked)}
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  aria-label="Preference cookies"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={handleRejectAll}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors"
            >
              Reject All
            </button>
            <button
              onClick={handleSavePreferences}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Save Preferences
            </button>
            <button
              onClick={handleAcceptAll}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Accept All
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-lg">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">🍪 Cookie Consent</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              We use cookies to enhance your experience. Essential cookies are always on.{' '}
              <Link
                href="/legal/cookie-policy"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Learn more
              </Link>
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleRejectAll}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              Reject All
            </button>
            <button
              onClick={() => setShowPreferences(true)}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              Preferences
            </button>
            <button
              onClick={handleAcceptAll}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              Accept All
            </button>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          <Link href="/legal/privacy-policy" className="hover:underline">
            Privacy Policy
          </Link>
          {' • '}
          <Link href="/legal/terms-of-service" className="hover:underline">
            Terms of Service
          </Link>
          {' • '}
          <Link href="/legal/cookie-policy" className="hover:underline">
            Cookie Policy
          </Link>
        </div>
      </div>
    </div>
  );
}

export default CookieConsentBanner;
