/**
 * Terms of Service Page
 *
 * Renders the markdown ToS from /public/legal/terms-of-service.md
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MarkdownRenderer from '@/components/markdown-renderer';

export const metadata = {
  title: 'Terms of Service | TRi',
  description: 'Terms of Service for TRi Trading Journal',
};

export default function TermsOfServicePage() {
  const markdownPath = join(process.cwd(), 'public', 'legal', 'terms-of-service.md');
  const content = readFileSync(markdownPath, 'utf-8');

  return (
    <div>
      <MarkdownRenderer content={content} />
    </div>
  );
}
