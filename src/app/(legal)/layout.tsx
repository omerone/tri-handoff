/**
 * Legal Pages Layout
 *
 * Routes:
 * - /legal/privacy-policy
 * - /legal/terms-of-service
 * - /legal/data-processing-agreement
 * - /legal/cookie-policy
 * - /legal/sub-processors
 *
 * Features:
 * - Markdown rendering with syntax highlighting
 * - Table of contents with jump links
 * - Last updated date
 * - Printable/PDF export
 * - Responsive design
 * - Dark mode support
 */

import React from 'react';
import Link from 'next/link';

interface LegalLayoutProps {
  children: React.ReactNode;
}

export const metadata = {
  title: 'Legal Documents | TRi',
  description: 'Privacy Policy, Terms of Service, and legal agreements for TRi Trading Journal',
};

export default function LegalLayout({ children }: LegalLayoutProps) {
  const links = [
    { href: '/legal/privacy-policy', label: 'Privacy Policy' },
    { href: '/legal/terms-of-service', label: 'Terms of Service' },
    { href: '/legal/data-processing-agreement', label: 'Data Processing Agreement' },
    { href: '/legal/cookie-policy', label: 'Cookie Policy' },
    { href: '/legal/sub-processors', label: 'Sub-Processors' },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Legal Documents</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Read our privacy policy, terms of service, and other legal agreements
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Sidebar Navigation */}
          <aside className="md:col-span-1">
            <div className="sticky top-8 space-y-2">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Documents</h2>
              <nav className="space-y-1">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>

              {/* Actions */}
              <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-800 space-y-2">
                <button
                  onClick={() => window.print()}
                  className="w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors text-left"
                >
                  🖨️ Print
                </button>
                <a
                  href="#"
                  className="block px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                >
                  📥 Download PDF
                </a>
              </div>

              {/* Last Updated */}
              <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-500">
                <p>Last updated: August 3, 2026</p>
                <p>Version: 1.0</p>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="md:col-span-3 prose dark:prose-invert max-w-none">
            <div className="prose-sm md:prose-base">
              {children}
            </div>

            {/* Footer */}
            <div className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Questions?</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                If you have questions about these legal documents, please contact us:
              </p>
              <ul className="space-y-2 text-gray-600 dark:text-gray-400">
                <li>
                  <strong>Email:</strong>{' '}
                  <a href="mailto:legal@tri.com" className="text-blue-600 dark:text-blue-400 hover:underline">
                    legal@tri.com
                  </a>
                </li>
                <li>
                  <strong>Privacy:</strong>{' '}
                  <a
                    href="mailto:privacy@tri.com"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    privacy@tri.com
                  </a>
                </li>
                <li>
                  <strong>Data Protection Officer:</strong>{' '}
                  <a href="mailto:dpo@tri.com" className="text-blue-600 dark:text-blue-400 hover:underline">
                    dpo@tri.com
                  </a>
                </li>
              </ul>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
