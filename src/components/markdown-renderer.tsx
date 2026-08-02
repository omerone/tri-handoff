/**
 * Markdown Renderer Component
 *
 * Renders markdown content with proper styling for:
 * - Headings (h1-h6)
 * - Lists (ordered and unordered)
 * - Tables
 * - Code blocks
 * - Blockquotes
 * - Links
 * - Inline formatting
 */

import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Basic markdown parsing
  const parseMarkdown = (md: string): React.ReactNode => {
    const lines = md.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Headings
      if (line.startsWith('######')) {
        elements.push(
          <h6 key={i} className="text-base font-semibold mt-6 mb-3 text-gray-900 dark:text-white">
            {line.replace(/^#+\s/, '')}
          </h6>
        );
      } else if (line.startsWith('#####')) {
        elements.push(
          <h5 key={i} className="text-lg font-semibold mt-6 mb-3 text-gray-900 dark:text-white">
            {line.replace(/^#+\s/, '')}
          </h5>
        );
      } else if (line.startsWith('####')) {
        elements.push(
          <h4 key={i} className="text-xl font-semibold mt-6 mb-3 text-gray-900 dark:text-white">
            {line.replace(/^#+\s/, '')}
          </h4>
        );
      } else if (line.startsWith('###')) {
        elements.push(
          <h3 key={i} className="text-2xl font-semibold mt-8 mb-4 text-gray-900 dark:text-white">
            {line.replace(/^#+\s/, '')}
          </h3>
        );
      } else if (line.startsWith('##')) {
        elements.push(
          <h2 key={i} className="text-3xl font-bold mt-10 mb-4 text-gray-900 dark:text-white">
            {line.replace(/^#+\s/, '')}
          </h2>
        );
      } else if (line.startsWith('#')) {
        elements.push(
          <h1 key={i} className="text-4xl font-bold mt-12 mb-6 text-gray-900 dark:text-white">
            {line.replace(/^#+\s/, '')}
          </h1>
        );
      }
      // Horizontal rule
      else if (line === '---' || line === '***' || line === '___') {
        elements.push(<hr key={i} className="my-8 border-gray-300 dark:border-gray-700" />);
      }
      // Blockquote
      else if (line.startsWith('>')) {
        elements.push(
          <blockquote key={i} className="border-l-4 border-blue-600 pl-4 py-2 my-4 text-gray-600 dark:text-gray-400 italic">
            {line.replace(/^>\s?/, '')}
          </blockquote>
        );
      }
      // Code block
      else if (line.startsWith('```')) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        elements.push(
          <pre key={i} className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-lg overflow-x-auto my-4">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
      }
      // Inline code
      else if (line.includes('`') && !line.startsWith('```')) {
        elements.push(
          <p key={i} className="text-gray-700 dark:text-gray-300 my-2">
            {formatInlineCode(line)}
          </p>
        );
      }
      // Unordered list
      else if (line.match(/^[-*+]\s/)) {
        const listItems: string[] = [];
        while (i < lines.length && lines[i].match(/^[-*+]\s/)) {
          listItems.push(lines[i].replace(/^[-*+]\s/, ''));
          i++;
        }
        elements.push(
          <ul key={i} className="list-disc list-inside my-4 text-gray-700 dark:text-gray-300 space-y-1">
            {listItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        );
        i--;
      }
      // Ordered list
      else if (line.match(/^\d+\.\s/)) {
        const listItems: string[] = [];
        while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
          listItems.push(lines[i].replace(/^\d+\.\s/, ''));
          i++;
        }
        elements.push(
          <ol key={i} className="list-decimal list-inside my-4 text-gray-700 dark:text-gray-300 space-y-1">
            {listItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ol>
        );
        i--;
      }
      // Table
      else if (line.includes('|')) {
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && lines[i].includes('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        elements.push(
          <div key={i} className="overflow-x-auto my-4">
            {renderTable(tableLines)}
          </div>
        );
        i--;
      }
      // Paragraph
      else if (line.trim()) {
        elements.push(
          <p key={i} className="text-gray-700 dark:text-gray-300 my-3 leading-relaxed">
            {formatText(line)}
          </p>
        );
      }

      i++;
    }

    return elements;
  };

  return <div className="space-y-4">{parseMarkdown(content)}</div>;
}

/**
 * Format inline code and links
 */
function formatInlineCode(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /`([^`]+)`|(\[([^\]]+)\]\(([^)]+)\))|([^`\[]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      // Inline code
      parts.push(
        <code key={parts.length} className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-gray-900 dark:text-gray-100 font-mono text-sm">
          {match[1]}
        </code>
      );
    } else if (match[3] && match[4]) {
      // Link
      parts.push(
        <a
          key={parts.length}
          href={match[4]}
          className="text-blue-600 dark:text-blue-400 hover:underline"
          target={match[4].startsWith('http') ? '_blank' : undefined}
          rel={match[4].startsWith('http') ? 'noopener noreferrer' : undefined}
        >
          {match[3]}
        </a>
      );
    } else if (match[5]) {
      // Regular text
      parts.push(match[5]);
    }
  }

  return parts;
}

/**
 * Format text with bold and italic
 */
function formatText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^\*]+)\*\*|__([^_]+)__|_([^_]+)_|\*([^\*]+)\*|([^\*_]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1] || match[2]) {
      // Bold
      parts.push(
        <strong key={parts.length} className="font-semibold">
          {match[1] || match[2]}
        </strong>
      );
    } else if (match[3] || match[4]) {
      // Italic
      parts.push(
        <em key={parts.length} className="italic">
          {match[3] || match[4]}
        </em>
      );
    } else if (match[5]) {
      // Regular text
      parts.push(match[5]);
    }
  }

  return parts;
}

/**
 * Render markdown table
 */
function renderTable(lines: string[]): React.ReactNode {
  const rows = lines.map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
  );

  if (rows.length < 2) return null;

  const headers = rows[0];
  const dataRows = rows.slice(2); // Skip header and separator

  return (
    <table className="w-full border-collapse border border-gray-300 dark:border-gray-700">
      <thead>
        <tr className="bg-gray-100 dark:bg-gray-800">
          {headers.map((header, idx) => (
            <th
              key={idx}
              className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left text-gray-900 dark:text-white font-semibold"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataRows.map((row, rowIdx) => (
          <tr key={rowIdx} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-950 dark:even:bg-gray-900">
            {row.map((cell, cellIdx) => (
              <td
                key={cellIdx}
                className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-gray-700 dark:text-gray-300"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default MarkdownRenderer;
