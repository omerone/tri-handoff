/**
 * Data Processing Agreement (DPA) Page
 *
 * Renders the markdown DPA from /public/legal/data-processing-agreement.md
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MarkdownRenderer from '@/components/markdown-renderer';

export const metadata = {
  title: 'Data Processing Agreement | TRi',
  description: 'GDPR Article 28 Data Processing Agreement for TRi Trading Journal',
};

export default function DataProcessingAgreementPage() {
  const markdownPath = join(process.cwd(), 'public', 'legal', 'data-processing-agreement.md');
  const content = readFileSync(markdownPath, 'utf-8');

  return (
    <div>
      <MarkdownRenderer content={content} />
    </div>
  );
}
