import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ActiveTenant } from '@/lib/tenant/context';
import { resolveTenant } from '@/lib/tenant/resolve';

/**
 * Every user-facing route group starts here.
 *
 * An unknown host calls `notFound()` so the response really is a 404 (the not-found page
 * re-resolves the host — the lookup is request-cached — and explains that the domain isn't
 * connected). A suspended tenant renders an explanation with a 200: a layout cannot set a
 * status code, and returning 404 for a client who merely fell behind on payment would send
 * them to a page that says their domain doesn't exist.
 */
export async function TenantGate({ children }: { children: React.ReactNode }) {
  const lookup = await resolveTenant();

  if (lookup.state === 'unknown') notFound();
  if (lookup.state === 'suspended') return <TenantSuspended />;

  return <>{children}</>;
}

/** Resolves the active tenant for a page that TenantGate has already admitted. */
export async function activeTenant(): Promise<ActiveTenant> {
  const lookup = await resolveTenant();
  if (lookup.state !== 'active') notFound();
  return lookup.tenant;
}

async function TenantSuspended() {
  const t = await getTranslations('error');
  return <Notice title="TRi" body={t('suspendedTenant')} />;
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="border-line bg-surface w-full max-w-md rounded-[18px] border p-8 text-center">
        <div className="tri-num text-brand text-2xl font-extrabold">{title}</div>
        <p className="text-dim mt-3 text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
