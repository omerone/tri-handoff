/**
 * Privacy Policy Page
 *
 * Renders the markdown privacy policy from /public/legal/privacy-policy.md
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MarkdownRenderer from '@/components/markdown-renderer';

export const metadata = {
  title: 'Privacy Policy | TRO',
  description: 'GDPR-compliant privacy policy for TRO Trading Journal',
};

export default function PrivacyPolicyPage() {
  // Read markdown file
  const markdownPath = join(process.cwd(), 'public', 'legal', 'privacy-policy.md');
  const content = readFileSync(markdownPath, 'utf-8');

  return (
    <div>
      <MarkdownRenderer content={content} />
    </div>
  );
}
