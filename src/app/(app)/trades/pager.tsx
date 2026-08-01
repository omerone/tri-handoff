'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** Pagination as links, so the browser's own back/forward and middle-click keep working. */
export function Pager({
  page,
  pages,
  labels,
}: {
  page: number;
  pages: number;
  labels: { prev: string; next: string; page: string };
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (target: number) => {
    const next = new URLSearchParams(params.toString());
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const button =
    'border-line bg-raised rounded-[10px] border px-3 py-1.5 text-xs text-dim hover:text-text';
  const disabled = 'border-line rounded-[10px] border px-3 py-1.5 text-xs text-dim/40';

  return (
    <div className="flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={button} rel="prev">
          {labels.prev}
        </Link>
      ) : (
        <span className={disabled}>{labels.prev}</span>
      )}

      <span className="text-dim tri-num text-xs">{labels.page}</span>

      {page < pages ? (
        <Link href={href(page + 1)} className={button} rel="next">
          {labels.next}
        </Link>
      ) : (
        <span className={disabled}>{labels.next}</span>
      )}
    </div>
  );
}
