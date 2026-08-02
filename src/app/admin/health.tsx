import Link from 'next/link';
import type { SyncHealth } from '@/lib/db/unscoped';
import { formatDateTimeAt } from '@/lib/time/format';

/**
 * The monitoring table (SPEC §2: "ניטור סנכרונים ותקלות").
 *
 * Rows arrive worst-first from `syncHealth`. The status word is the answer to "is anything
 * broken", so it is the second column rather than buried at the end of a wide row.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = SyncHealth & { label: string; tone: string };

function classify(row: SyncHealth): Row {
  if (row.status === 'suspended') return { ...row, label: 'suspended', tone: 'text-warn' };
  if (!row.connected) return { ...row, label: 'no MT5 account', tone: 'text-dim' };
  if (row.lastSyncStatus === 'error') return { ...row, label: 'sync failing', tone: 'text-neg' };
  if (row.failuresLast24h > 0)
    return { ...row, label: `${row.failuresLast24h} failures today`, tone: 'text-warn' };
  if (row.lastSyncAt === null) return { ...row, label: 'never synced', tone: 'text-dim' };
  if (Date.now() - row.lastSyncAt.getTime() > 7 * DAY_MS)
    return { ...row, label: 'quiet for a week', tone: 'text-warn' };
  return { ...row, label: 'healthy', tone: 'text-pos' };
}

export function HealthTable({ rows }: { rows: SyncHealth[] }) {
  const classified = rows.map(classify);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-dim text-[11px]">
            {['Domain', 'Status', 'Client', 'Last sync', 'Last error', ''].map((header) => (
              <th key={header} className="border-line border-b px-3 py-2.5 text-start font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classified.map((row) => (
            <tr key={row.tenantId} className="border-line border-b last:border-b-0">
              <td className="tri-num px-3 py-2.5 font-bold">{row.domain}</td>
              <td className={`px-3 py-2.5 text-xs ${row.tone}`}>{row.label}</td>
              <td className="px-3 py-2.5">{row.name}</td>
              <td className="text-dim tri-num px-3 py-2.5 text-xs whitespace-nowrap">
                {row.lastSyncAt ? formatDateTimeAt(row.lastSyncAt) : '—'}
              </td>
              <td className="text-neg max-w-[22rem] truncate px-3 py-2.5 text-xs" title={row.lastError ?? ''}>
                {row.lastError ?? ''}
              </td>
              <td className="px-3 py-2.5 text-end">
                <Link
                  href={`/admin/${row.tenantId}`}
                  className="border-line bg-raised text-brand rounded-lg border px-2 py-1 text-[11px]"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}

          {classified.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-dim px-3 py-6 text-center">
                No clients yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
