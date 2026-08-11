/**
 * Cookie Policy Page
 *
 * Renders the markdown cookie policy from /public/legal/cookie-policy.md
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MarkdownRenderer from '@/components/markdown-renderer';

export const metadata = {
  title: 'Cookie Policy | TRO',
  description: 'EU ePrivacy Directive compliant cookie policy for TRO Trading Journal',
};

export default function CookiePolicyPage() {
  const markdownPath = join(process.cwd(), 'public', 'legal', 'cookie-policy.md');
  const content = readFileSync(markdownPath, 'utf-8');

  return (
    <div>
      <MarkdownRenderer content={content} />
    </div>
  );
}
