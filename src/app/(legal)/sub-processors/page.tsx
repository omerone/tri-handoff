/**
 * Sub-Processors List Page
 *
 * Renders the markdown sub-processor list from /public/legal/sub-processors.md
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MarkdownRenderer from '@/components/markdown-renderer';

export const metadata = {
  title: 'Sub-Processors List | TRi',
  description: 'GDPR Article 28(2) compliant list of data sub-processors used by TRi',
};

export default function SubProcessorsPage() {
  const markdownPath = join(process.cwd(), 'public', 'legal', 'sub-processors.md');
  const content = readFileSync(markdownPath, 'utf-8');

  return (
    <div>
      <MarkdownRenderer content={content} />
    </div>
  );
}
